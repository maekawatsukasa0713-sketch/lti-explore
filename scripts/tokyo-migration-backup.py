#!/usr/bin/env python3
"""Private online backup to the fixed Tokyo project. No restore or cutover.

Source clients only read. Run-specific prefixes never overwrite older backups.
Secrets, SQL, object names and subprocess errors must not enter public logs.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import tempfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


preflight = module('preflight', 'tokyo-migration-preflight.py')
storage = module('storage_backup', 'backup-storage.py')
BUCKET = 'lti-migration-backups'
SOURCE_BUCKET = 'lti-documents'


def require(condition, stage):
    if not condition:
        raise preflight.PreflightError(stage)


def sql(endpoint, directory, env, query):
    ref, host = preflight.ENDPOINTS[endpoint]
    args = ['docker', 'run', '--rm', '-i', '--network', 'host',
            '--mount', f'type=bind,source={directory / (endpoint + ".pgpass")},target=/run/pass,readonly',
            '-e', 'PGPASSFILE=/run/pass', '-e', 'PGSSLMODE=require',
            '-e', 'PGCONNECT_TIMEOUT=15',
            '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=120000 -c timezone=UTC',
            preflight.POSTGRES_IMAGE, 'psql', '-X', '-q', '-A', '-t', '-w',
            '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', '5432', '-U', f'postgres.{ref}', '-d', 'postgres']
    return preflight.run_private(endpoint + '-backup-query', args, cwd=directory, env=env,
                                 input_text=query, timeout=180).strip()


def private_bucket_guard(directory, env):
    answer = sql('target', directory, env, """SELECT json_build_object(
      'private', (SELECT public = false FROM storage.buckets WHERE id = 'lti-migration-backups'),
      'rls', (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
      'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage'));
    """)
    value = json.loads(answer)
    require(value == {'private': True, 'rls': True, 'policies': 0}, 'backup-access-guard')


def objects(client):
    result = {}
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=SOURCE_BUCKET):
        for item in page.get('Contents', []):
            require(item['Key'] not in result, 'duplicate-object')
            result[item['Key']] = (item['Size'], item['ETag'])
    require(bool(result), 'empty-source-storage')
    return result


def upload_verified(client, prefix, name, path):
    size = path.stat().st_size
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    key = prefix + name
    with path.open('rb') as stream:
        client.upload_fileobj(stream, BUCKET, key, ExtraArgs={'ContentType': 'application/octet-stream'})
    require(storage.digest_object(client.get_object(Bucket=BUCKET, Key=key)) == (size, digest),
            'backup-file-verification')
    return {'name': name, 'bytes': size, 'sha256': digest}


def perform(cli, directory, env, passwords, source, target, prefix):
    # Reuse the audited read-only/empty-target guards before any write.
    preflight.connection_inventory('source', passwords[0], directory, env)
    preflight.connection_inventory('target', passwords[1], directory, env)
    initial = objects(source)
    inventories = {}
    for filename in ('migration-inventory.sql', 'migration-auth-inventory.sql'):
        inventories[filename] = sql('source', directory, env, Path(__file__).with_name(filename).read_text())
    # The official CLI produces only private temporary files; it never restores.
    preflight.perform(cli, directory, passwords[0], passwords[1], env)
    for filename, before in inventories.items():
        after = sql('source', directory, env, Path(__file__).with_name(filename).read_text())
        require(json.loads(before) == json.loads(after), 'source-changed-during-dump')
        (directory / (filename + '.json')).write_text(before)
    # Capture metadata separately; never print its personal identifiers or paths.
    metadata = sql('source', directory, env, "SELECT json_build_object('buckets', (SELECT json_agg(b) FROM storage.buckets b), 'objects', (SELECT json_agg(o) FROM storage.objects o));")
    (directory / 'storage-metadata.json').write_text(metadata)
    meta = json.loads(metadata)
    require(len(meta['objects']) == len(initial), 'storage-inventory-count')
    require({o['name']: int(o['metadata']['size']) for o in meta['objects'] if o['bucket_id'] == SOURCE_BUCKET}
            == {key: value[0] for key, value in initial.items()}, 'storage-inventory-path-size')
    target.create_bucket(Bucket=BUCKET)
    private_bucket_guard(directory, env)
    manifest = {'kind': 'online-backup-not-final-cutover-snapshot', 'files': [], 'objects': []}
    for filename in ('roles.sql', 'schema.sql', 'data.sql', 'storage-metadata.json',
                     'migration-inventory.sql.json', 'migration-auth-inventory.sql.json'):
        manifest['files'].append(upload_verified(target, prefix, filename, directory / filename))
    total = 0
    for index, (key, expected) in enumerate(initial.items(), 1):
        with tempfile.TemporaryFile(dir=directory) as tmp:
            obj = source.get_object(Bucket=SOURCE_BUCKET, Key=key)
            size, digest = storage.digest_object(obj, tmp)
            require((size, obj['ETag']) == expected, 'source-object-changed')
            tmp.seek(0)
            target_key = prefix + 'objects/' + key
            extra = {'ContentType': obj.get('ContentType', 'application/octet-stream')}
            for field in ('CacheControl', 'ContentDisposition', 'Metadata'):
                if obj.get(field):
                    extra[field] = obj[field]
            target.upload_fileobj(tmp, BUCKET, target_key, ExtraArgs=extra)
            require(storage.digest_object(target.get_object(Bucket=BUCKET, Key=target_key)) == (size, digest),
                    'object-byte-verification')
            manifest['objects'].append({'key': key, 'bytes': size, 'sha256': digest})
            total += size
        if index % 50 == 0:
            print(f'Objects verified: {index}/{len(initial)}', flush=True)
    require(objects(source) == initial, 'source-storage-changed-during-copy')
    private_bucket_guard(directory, env)
    (directory / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True))
    upload_verified(target, prefix, 'manifest.json', directory / 'manifest.json')
    print(f'Private Tokyo backup: PASS; objects={len(initial)}; bytes={total}; prefix={prefix}', flush=True)
    print('No database restore, production cutover, source write, or deletion performed.', flush=True)


def main():
    directory = None
    os.umask(0o077)
    def interrupted(_sig, _frame):
        raise preflight.PreflightError('cancelled')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        preflight.guard_environment(os.environ)
        run_id, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
        require(bool(re.fullmatch(r'[0-9]+', run_id)) and bool(re.fullmatch(r'[0-9]+', attempt)), 'run-id-guard')
        require(len(sys.argv) == 2 and Path(sys.argv[1]).is_file(), 'cli-path-guard')
        passwords = [os.environ.pop(k) for k in ('MIGRATION_SOURCE_DB_PASSWORD', 'MIGRATION_TARGET_DB_PASSWORD')]
        credentials = [os.environ.pop(k, '') for k in ('PROD_S3_ACCESS_KEY_ID', 'PROD_S3_SECRET_ACCESS_KEY',
                       'MIGRATION_TARGET_S3_ACCESS_KEY_ID', 'MIGRATION_TARGET_S3_SECRET_ACCESS_KEY')]
        require(all(credentials), 'storage-credential-guard')
        import boto3
        from botocore.config import Config
        cfg = Config(signature_version='s3v4', s3={'addressing_style': 'path'},
                     retries={'max_attempts': 3, 'mode': 'standard'}, connect_timeout=20, read_timeout=90,
                     request_checksum_calculation='when_required', response_checksum_validation='when_required')
        clients = [boto3.client('s3', endpoint_url=f'https://{ref}.storage.supabase.co/storage/v1/s3',
                   region_name=region, aws_access_key_id=credentials[i*2], aws_secret_access_key=credentials[i*2+1],
                   config=cfg) for i, (ref, region) in enumerate((
                   ('ozmulwqzybhiekmolvyk', 'ap-southeast-1'), ('qzowxrmrxyjifoabjryr', 'ap-northeast-1')))]
        allowed = ('PATH', 'HOME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'SSL_CERT_FILE', 'SSL_CERT_DIR')
        env = {key: os.environ[key] for key in allowed if key in os.environ}
        env.update({'CI': 'true', 'NO_COLOR': '1'})
        directory = Path(tempfile.mkdtemp(prefix='lti-tokyo-backup-', dir=os.environ['RUNNER_TEMP']))
        directory.chmod(0o700)
        perform(str(Path(sys.argv[1]).resolve()), directory, env, passwords, *clients, f'{run_id}-{attempt}/')
        return 0
    except preflight.PreflightError as exc:
        print(f'Private Tokyo backup: FAIL ({exc}). Raw diagnostics suppressed.', flush=True)
        return 1
    except Exception:
        print('Private Tokyo backup: FAIL (backup-operation). Raw diagnostics suppressed.', flush=True)
        return 1
    finally:
        if directory is not None:
            shutil.rmtree(directory, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
