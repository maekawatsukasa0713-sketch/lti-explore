"""Target-only restore helpers; never execute source mutations."""
import json
import re
import subprocess
import tempfile
from pathlib import Path


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def target_psql(backup, directory, env, files):
    ref, host = backup.preflight.ENDPOINTS['target']
    args = ['docker', 'run', '--rm', '-i', '--network', 'host',
            '--mount', f'type=bind,source={directory},target=/restore,readonly',
            '-e', 'PGPASSFILE=/restore/target.pgpass', '-e', 'PGSSLMODE=require',
            '-e', 'PGCONNECT_TIMEOUT=15',
            '-e', 'PGOPTIONS=-c timezone=UTC -c statement_timeout=300000 -c lock_timeout=15000',
            backup.preflight.POSTGRES_IMAGE, 'psql', '-X', '-q', '-w',
            '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '--single-transaction',
            '-h', host, '-p', '5432', '-U', f'postgres.{ref}', '-d', 'postgres']
    for name in files:
        backup.require(re.fullmatch(r'[a-z_]+\.sql', name) is not None, 'restore-filename')
        args.extend(['-f', '/restore/'+name])
    result = subprocess.run(args, cwd=directory, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=900)
    if result.returncode:
        # SQLSTATE only; SQL contexts can contain passwords or personal records.
        found = re.search(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5}):', result.stderr)
        code = found.group(1) if found else 'unavailable'
        location = re.search(r'psql:/restore/([a-z_]+\.sql):([0-9]+):', result.stderr)
        location_text = ('; file='+location.group(1)+'; line='+location.group(2)) if location else ''
        reasons = [name for name,pattern in {
            'role-grant': r'permission denied to grant role',
            'schema-permission': r'permission denied for schema',
            'table-permission': r'permission denied for (?:table|relation)',
            'function-permission': r'permission denied for function',
            'must-own': r'must be owner of',
            'role-membership': r'must be (?:a )?member of role|must be able to SET ROLE',
            'superuser': r'must be superuser|Only superusers',
            'role-create': r'permission denied to create role',
            'role-alter': r'permission denied to alter role',
            'parameter': r'permission denied to set parameter',
        }.items() if re.search(pattern,result.stderr,re.I)]
        denied = re.search(r'(?:permission denied for|must be owner of) (?:schema|table|relation|function|sequence) "?([a-z_][a-z_0-9]*)"?', result.stderr)
        role = re.search(r'(?:grant role|member of role|SET ROLE|alter role|create role) "([a-z_][a-z_0-9]*)"', result.stderr)
        details = ('; object='+denied.group(1) if denied else '')+('; role='+role.group(1) if role else '')
        print('Target restore transaction: FAIL; sqlstate='+code+location_text+'; reasons='+','.join(reasons)+details, flush=True)
        raise backup.preflight.PreflightError('target-restore-transaction')
    print('Target restore transaction: PASS', flush=True)


def custom_sql(backup, custom):
    commands = ['SET session_replication_role = origin; SET search_path = public, extensions;']
    for p in custom['policies']:
        if p['schemaname'] == 'public':
            continue
        backup.require(p['schemaname']=='storage' and p['tablename']=='objects'
                       and p['policyname'] in ('lti_pdf_read','lti_pdf_insert','lti_pdf_delete')
                       and p['roles']==['authenticated'] and p['permissive']=='PERMISSIVE'
                       and p['cmd'] in ('SELECT','INSERT','DELETE'), 'managed-policy-guard')
        expr = p['qual'] or p['with_check']
        backup.require("bucket_id = 'lti-documents'::text" in expr, 'policy-bucket-guard')
        statement = 'CREATE POLICY '+ident(p['policyname'])+' ON storage.objects AS PERMISSIVE FOR '+p['cmd']+' TO authenticated'
        if p['qual'] is not None:
            statement += ' USING ('+p['qual']+')'
        if p['with_check'] is not None:
            statement += ' WITH CHECK ('+p['with_check']+')'
        commands.append(statement+';')
    triggers = custom['custom_triggers'] or []
    backup.require(triggers == ['CREATE TRIGGER lti_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION lti_new_user()'], 'custom-trigger-guard')
    commands.extend(t+';' for t in triggers)
    backup.require(not custom['publications'], 'publication-guard')
    return '\n'.join(commands)


def assertion_sql(query, expected, label):
    return ('DO $lti_verify$ DECLARE actual jsonb; BEGIN SELECT to_jsonb(q.v) INTO actual FROM ('
            + query.strip().rstrip(';') + ') AS q(v); IF actual IS DISTINCT FROM '
            + literal(json.dumps(expected))+'::jsonb THEN RAISE EXCEPTION '+literal(label)
            + '; END IF; END $lti_verify$;\n')


def restore_database(backup, directory, env):
    # Refuse any target containing application data; backup namespace is preserved.
    guard = """DO $guard$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public')
      OR EXISTS (SELECT 1 FROM auth.users)
      OR EXISTS (SELECT 1 FROM storage.buckets WHERE id <> 'lti-migration-backups')
      OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id <> 'lti-migration-backups')
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations')
    THEN RAISE EXCEPTION 'target-not-empty'; END IF;
    END $guard$;"""
    (directory/'guard.sql').write_text(guard)
    (directory/'replica.sql').write_text('SET session_replication_role = replica;')
    custom=json.loads((directory/'managed-customizations.json').read_text())
    (directory/'custom.sql').write_text(custom_sql(backup,custom))
    assertions = ''
    for filename in ('migration-inventory.sql','migration-auth-inventory.sql'):
        query=Path(__file__).with_name(filename).read_text()
        if filename=='migration-inventory.sql':
            query=query.replace('FROM storage.objects GROUP BY bucket_id',
                                "FROM storage.objects WHERE bucket_id <> 'lti-migration-backups' GROUP BY bucket_id")
        expected=json.loads((directory/(filename+'.json')).read_text())
        assertions += assertion_sql(query, expected, filename+' mismatch')
    assertions += """DO $guard$ BEGIN IF NOT EXISTS
       (SELECT 1 FROM storage.buckets WHERE id='lti-migration-backups' AND NOT public)
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity)
       THEN RAISE EXCEPTION 'backup-access'; END IF; END $guard$;
       NOTIFY pgrst, 'reload schema';"""
    (directory/'verify.sql').write_text(assertions)
    target_psql(backup,directory,env,['guard.sql','roles.sql','schema.sql','replica.sql','data.sql',
                                    'history_schema.sql','history_data.sql','custom.sql','verify.sql'])


def restore_objects(backup, directory, env, client, manifest, prefix):
    metadata=json.loads((directory/'storage-metadata.json').read_text())
    expected={o['name']:o for o in metadata['objects']}
    backup.require(set(expected)=={o['key'] for o in manifest['objects']},'object-key-set')
    for index,item in enumerate(manifest['objects'],1):
        key=item['key']
        with tempfile.TemporaryFile(dir=directory) as stream:
            source=client.get_object(Bucket=backup.BUCKET,Key=prefix+'objects/'+key)
            value=backup.storage.digest_object(source,stream)
            backup.require(value==(item['bytes'],item['sha256']),'backup-object-digest')
            stream.seek(0)
            extra={'ContentType':source.get('ContentType','application/octet-stream')}
            for field in ('CacheControl','ContentDisposition','Metadata'):
                if source.get(field): extra[field]=source[field]
            client.upload_fileobj(stream,backup.SOURCE_BUCKET,key,ExtraArgs=extra)
            restored=client.get_object(Bucket=backup.SOURCE_BUCKET,Key=key)
            backup.require(backup.storage.digest_object(restored)==value,'restored-object-digest')
            for field,value_expected in extra.items():
                backup.require(restored.get(field)==value_expected,'restored-display-metadata')
        if index%50==0: print(f'Restored objects verified: {index}/{len(manifest["objects"])}',flush=True)
    # S3 upserts may reset ownership. Restore only application metadata, never the
    # new provider version pointer/ETag. PostgreSQL JSON handles quoted file names.
    payload=literal(json.dumps(metadata['objects']))
    owner_sql = """SET standard_conforming_strings=on;
    WITH saved AS (SELECT * FROM jsonb_populate_recordset(NULL::storage.objects, """+payload+"""::jsonb))
    UPDATE storage.objects o SET owner=s.owner, owner_id=s.owner_id,
      created_at=s.created_at, user_metadata=s.user_metadata
    FROM saved s WHERE o.bucket_id='lti-documents' AND o.bucket_id=s.bucket_id AND o.name=s.name;
    DO $verify$ BEGIN IF EXISTS (
      SELECT 1 FROM jsonb_populate_recordset(NULL::storage.objects, """+payload+"""::jsonb) s
      LEFT JOIN storage.objects o ON o.bucket_id=s.bucket_id AND o.name=s.name
      WHERE o.id IS NULL OR o.owner IS DISTINCT FROM s.owner OR o.owner_id IS DISTINCT FROM s.owner_id
      OR o.created_at IS DISTINCT FROM s.created_at OR o.user_metadata IS DISTINCT FROM s.user_metadata
    ) THEN RAISE EXCEPTION 'storage-owner-mismatch'; END IF; END $verify$;
    """
    (directory/'owners.sql').write_text(owner_sql)
    target_psql(backup,directory,env,['owners.sql'])
    print(f'Tokyo initial restore: PASS; objects={len(manifest["objects"])}. Production cutover NOT performed.',flush=True)
