#!/usr/bin/env python3
"""Inspect the verified private backup; no database writes or cutover.
Only schema/table names and aggregate counts may reach logs.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import importlib.util

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('tokyo-migration-backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
preflight = backup.preflight
PREFIX = '39550057024-1/'
FILES = {'roles.sql', 'schema.sql', 'data.sql', 'history_schema.sql', 'history_data.sql',
         'managed-customizations.json', 'storage-metadata.json',
         'migration-inventory.sql.json', 'migration-auth-inventory.sql.json'}


def get_backup(client, directory):
    manifest = json.loads(client.get_object(Bucket=backup.BUCKET, Key=PREFIX+'manifest.json')['Body'].read())
    backup.require(manifest['kind'] == 'online-backup-not-final-cutover-snapshot', 'manifest-kind')
    backup.require({f['name'] for f in manifest['files']} == FILES and len(manifest['files']) == len(FILES), 'manifest-files')
    for item in manifest['files']:
        body = client.get_object(Bucket=backup.BUCKET, Key=PREFIX+item['name'])['Body'].read()
        backup.require(len(body) == item['bytes'] and hashlib.sha256(body).hexdigest() == item['sha256'], 'backup-integrity')
        (directory/item['name']).write_bytes(body)
    backup.require(len(manifest['objects']) == 539 and sum(o['bytes'] for o in manifest['objects']) == 446601138, 'manifest-objects')
    backup.require(len({o['key'] for o in manifest['objects']}) == len(manifest['objects']), 'duplicate-object')
    print('Private backup files: PASS; files=9; objects=539; bytes=446601138', flush=True)
    return manifest


def inspect(directory):
    for filename in ('data.sql','history_data.sql'):
        # Parse COPY boundaries without printing row data (Auth contains secrets).
        tables = {}
        current = None
        for line in (directory/filename).read_text().splitlines():
            if current is not None:
                if line == '\\.':
                    current = None
                else:
                    tables[current] += 1
                continue
            if line.startswith('COPY '):
                match = re.fullmatch(r'COPY ("?[a-z_][a-z_0-9]*"?\."?[a-z_][a-z_0-9]*"?) \(.*\) FROM stdin;', line)
                backup.require(match is not None, 'copy-format')
                current = match.group(1).replace('"', '')
                backup.require(current not in tables, 'duplicate-copy')
                tables[current] = 0
        backup.require(current is None, 'copy-incomplete')
        print(filename+' table counts: '+json.dumps(tables,sort_keys=True), flush=True)
    role_sql = (directory/'roles.sql').read_text()
    print('Role dump statement count: '+str(sum(1 for l in role_sql.splitlines() if l.rstrip().endswith(';'))),flush=True)
    print('Role dump credential clause present: '+str(bool(re.search(r'\bPASSWORD\b',role_sql,re.I))),flush=True)
    schema = (directory/'schema.sql').read_text()
    print('Schema ownership to platform admin: '+str(bool(re.search(r'OWNER TO "?supabase_admin"?',schema))),flush=True)
    custom=json.loads((directory/'managed-customizations.json').read_text())
    print('Managed customization counts: '+json.dumps({k:len(custom[k] or []) for k in ('policies','custom_triggers','publications','extensions')},sort_keys=True),flush=True)
    meta=json.loads((directory/'storage-metadata.json').read_text())
    backup.require(len(meta['buckets'])==1 and meta['buckets'][0]['id']==backup.SOURCE_BUCKET and meta['buckets'][0]['public'] is False,'source-bucket')
    print('Storage metadata columns: '+json.dumps({'bucket':sorted(meta['buckets'][0]),'object':sorted(meta['objects'][0])}),flush=True)
    print('Restore inspection: PASS. No database or storage writes performed.',flush=True)


def main():
    directory=None
    os.umask(0o077)
    try:
        preflight.guard_environment(os.environ)
        # Remove unused source secret before any subprocess.
        os.environ.pop('MIGRATION_SOURCE_DB_PASSWORD')
        target_password=os.environ.pop('MIGRATION_TARGET_DB_PASSWORD')
        access=os.environ.pop('MIGRATION_TARGET_S3_ACCESS_KEY_ID')
        secret=os.environ.pop('MIGRATION_TARGET_S3_SECRET_ACCESS_KEY')
        import boto3
        from botocore.config import Config
        client=boto3.client('s3',endpoint_url='https://qzowxrmrxyjifoabjryr.storage.supabase.co/storage/v1/s3',
            region_name='ap-northeast-1',aws_access_key_id=access,aws_secret_access_key=secret,
            config=Config(signature_version='s3v4',s3={'addressing_style':'path'},retries={'max_attempts':3,'mode':'standard'},
                connect_timeout=20,read_timeout=90,request_checksum_calculation='when_required',response_checksum_validation='when_required'))
        directory=Path(tempfile.mkdtemp(prefix='lti-tokyo-restore-',dir=os.environ['RUNNER_TEMP']))
        directory.chmod(0o700)
        ref,host=preflight.ENDPOINTS['target']
        escaped=target_password.replace('\\','\\\\').replace(':','\\:')
        (directory/'target.pgpass').write_text(f'{host}:5432:postgres:postgres.{ref}:{escaped}\n')
        env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','DOCKER_HOST','DOCKER_CONFIG','SSL_CERT_FILE','SSL_CERT_DIR') if k in os.environ}
        backup.private_bucket_guard(directory,env)
        get_backup(client,directory)
        inspect(directory)
        return 0
    except preflight.PreflightError as exc:
        print(f'Restore inspection: FAIL ({exc}). Raw diagnostics suppressed.',flush=True)
        return 1
    except Exception as exc:
        print('Restore inspection: FAIL ('+backup.safe_failure(exc)+'). Raw diagnostics suppressed.',flush=True)
        return 1
    finally:
        if directory is not None:
            shutil.rmtree(directory,ignore_errors=True)

if __name__ == '__main__':
    sys.exit(main())
