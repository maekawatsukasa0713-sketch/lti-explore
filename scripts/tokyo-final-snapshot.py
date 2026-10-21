#!/usr/bin/env python3
"""Read-only source final snapshot; refuse cutover evidence unless frozen/equal.

Writes only a new private backup prefix. Never freezes, restores, or promotes.
"""
import concurrent.futures
import json
from pathlib import Path
import sys
import importlib.util

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('tokyo-migration-backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
require = backup.require
ORIGINAL = '39550057024-1/'

FREEZE_QUERY = """SELECT json_build_object(
 'tables', count(*),
 'guarded', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_trigger t
 JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
 WHERE t.tgrelid=c.oid AND t.tgname='lti_migration_write_freeze'
 AND t.tgenabled='O' AND t.tgtype=62 AND pn.nspname='lti_migration_control'
 AND p.proname='reject_writes' AND p.prosrc LIKE '%RAISE EXCEPTION%')))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')
 AND (n.nspname,c.relname) NOT IN (('auth','schema_migrations'),('storage','migrations'),('storage','buckets_vectors'),('storage','vector_indexes'));"""

EXTRA_QUERY = """SELECT jsonb_build_object(
 'mfa', (SELECT jsonb_build_object('rows',count(*),'sha256',
 encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),''),'UTF8')),'hex')) FROM auth.mfa_factors t),
 'owners', (SELECT encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(
 bucket_id,name,owner,owner_id,created_at,user_metadata)::text,'' ORDER BY bucket_id,name),''),'UTF8')),'hex')
 FROM storage.objects WHERE bucket_id='lti-documents'),
 'policies', (SELECT encode(sha256(convert_to(string_agg(to_jsonb(t)::text,'' ORDER BY schemaname,tablename,policyname),'UTF8')),'hex')
 FROM pg_policies t WHERE schemaname IN ('public','auth','storage')));"""

def perform(cli, directory, env, passwords, source, target, prefix):
    require(backup.preflight.run_private('cli-version',[cli,'--version'],cwd=directory,env=env).strip()
            ==backup.preflight.CLI_VERSION,'cli-version')
    for endpoint,password in zip(('source','target'),passwords):
        ref,host=backup.preflight.ENDPOINTS[endpoint]
        escaped=password.replace('\\','\\\\').replace(':','\\:')
        path=directory/(endpoint+'.pgpass')
        path.write_text(f'{host}:5432:postgres:postgres.{ref}:{escaped}\n')
        path.chmod(0o600)
    def query(endpoint,text):
        return json.loads(backup.sql(endpoint,directory,env,text))
    def frozen():
        v=query('source',FREEZE_QUERY)
        require(v['tables']>=40 and v['tables']==v['guarded'],'source-not-fully-frozen')
    frozen()
    require(query('target',FREEZE_QUERY)['guarded']==0,'target-frozen')
    access=query('target',"""SELECT jsonb_build_object(
      'private',(SELECT NOT public FROM storage.buckets WHERE id='lti-migration-backups'),
      'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass),
      'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='storage'),
      'scoped',(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND roles=ARRAY['authenticated']::name[] AND policyname IN ('lti_pdf_read','lti_pdf_insert','lti_pdf_delete')
      AND coalesce(qual,with_check) LIKE '%bucket_id = ''lti-documents''::text%'))""")
    require(access=={'private':True,'rls':True,'policies':3,'scoped':3},'private-backup-access')
    original=json.loads(target.get_object(Bucket=backup.BUCKET,Key=ORIGINAL+'manifest.json')['Body'].read())
    snapshots={}
    for filename in ('migration-inventory.sql','migration-auth-inventory.sql'):
        sql=Path(__file__).with_name(filename).read_text()
        a,b=[query(e,sql) for e in ('source','target')]
        if filename=='migration-inventory.sql':
            b['storage']=[row for row in b['storage'] if row['bucket_id']!=backup.BUCKET]
        require(a==b,'final-'+filename+'-mismatch')
        snapshots[filename+'.json']=a
    snapshots['additional-inventory.json']=query('source',EXTRA_QUERY)
    require(snapshots['additional-inventory.json']==query('target',EXTRA_QUERY),'final-mfa-owner-policy-mismatch')
    print('Final application, issued-login, password, MFA, owner and policy comparison: PASS',flush=True)
    initial=backup.objects(source)
    require({k:v[0] for k,v in initial.items()}=={o['key']:o['bytes'] for o in original['objects']},'final-object-list-changed')
    require({k:v[0] for k,v in backup.objects(target).items()}=={k:v[0] for k,v in initial.items()},'target-object-list-mismatch')
    def verify(obj):
        expected=(obj['bytes'],obj['sha256'])
        for client in (source,target):
            require(backup.storage.digest_object(client.get_object(Bucket=backup.SOURCE_BUCKET,Key=obj['key']))==expected,'final-object-byte-mismatch')
        return True
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for n,_ in enumerate(pool.map(verify,original['objects']),1):
            if n%100==0: print(f'Final source/target files verified: {n}/{len(original["objects"])}',flush=True)
    require(backup.objects(source)==initial,'source-objects-changed')
    source_url=backup.preflight.connection_url('source',passwords[0])
    modes=(('roles.sql',['--role-only']),('schema.sql',[]),
      ('data.sql',['--data-only','--use-copy','-x','storage.buckets_vectors','-x','storage.vector_indexes']),
      ('history_schema.sql',['--schema','supabase_migrations']),
      ('history_data.sql',['--schema','supabase_migrations','--data-only','--use-copy']))
    for filename,flags in modes:
        path=directory/filename
        path.touch(mode=0o600)
        backup.preflight.run_private('final-database-dump',[cli,'db','dump','--db-url',source_url,'-f',str(path),*flags],cwd=directory,env=env)
        require(path.stat().st_size>0,'empty-final-dump')
    for filename,value in snapshots.items():
        (directory/filename).write_text(json.dumps(value,sort_keys=True))
    metadata=backup.sql('source',directory,env,"SELECT json_build_object('buckets',(SELECT json_agg(b) FROM storage.buckets b),'objects',(SELECT json_agg(o) FROM storage.objects o));")
    (directory/'storage-metadata.json').write_text(metadata)
    files=[name for name,_ in modes]+list(snapshots)+['storage-metadata.json']
    manifest={'kind':'write-frozen-final-snapshot','object_backup_prefix':ORIGINAL,
              'objects':original['objects'],'files':[],'source_frozen':True,
              'note':'Schema includes source-only maintenance triggers. Do not restore these to active production.'}
    for name in files:
        manifest['files'].append(backup.upload_verified(target,prefix,name,directory/name))
    frozen()
    for filename in ('migration-inventory.sql','migration-auth-inventory.sql'):
        require(query('source',Path(__file__).with_name(filename).read_text())==snapshots[filename+'.json'],'final-source-changed')
    (directory/'manifest.json').write_text(json.dumps(manifest,sort_keys=True))
    backup.upload_verified(target,prefix,'manifest.json',directory/'manifest.json')
    print(f'Tokyo final frozen snapshot: PASS; objects={len(original["objects"])}; prefix={prefix}',flush=True)
    print('Source remains frozen. Production cutover has NOT been performed by this workflow.',flush=True)

backup.perform=perform
if __name__=='__main__':
    sys.exit(backup.main())
