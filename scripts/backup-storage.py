"""Append verified, content-addressed Storage snapshots; never replace old backups."""
from datetime import datetime, timezone
import hashlib
import io
import json
import os
import re
import tempfile
import uuid
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

SNAPSHOT_PREFIX = '.lti-snapshots/v1/'
MAX_MANIFEST_BYTES = 64 * 1024 * 1024
SOURCE_PROJECT = 'qzowxrmrxyjifoabjryr'
SOURCE_ENDPOINT = f'https://{SOURCE_PROJECT}.storage.supabase.co/storage/v1/s3'
SOURCE_BUCKET = 'lti-documents'
BACKUP_PROJECT = 'ozmulwqzybhiekmolvyk'
BACKUP_ENDPOINT = f'https://{BACKUP_PROJECT}.storage.supabase.co/storage/v1/s3'
BACKUP_BUCKET = 'lti-production-backup'


def validate_backup_configuration(source_endpoint, source_bucket, backup_endpoint, backup_bucket):
    if (source_endpoint, source_bucket) != (SOURCE_ENDPOINT, SOURCE_BUCKET):
        raise ValueError('refusing an unexpected production source')
    if (backup_endpoint, backup_bucket) != (BACKUP_ENDPOINT, BACKUP_BUCKET):
        raise ValueError('refusing an unexpected backup destination')


def public_access_blocked(bucket, key):
    # A denied unsigned S3 request alone cannot establish that a bucket is private.
    # Probe the public Storage route for an object already verified through S3.
    url = (f'https://{BACKUP_PROJECT}.supabase.co/storage/v1/object/public/'
           f'{quote(bucket, safe="")}/{quote(key, safe="/")}')
    try:
        with urlopen(Request(url, method='HEAD'), timeout=30):
            return False
    except HTTPError as exc:
        return exc.code in (400, 401, 403, 404)


def prepare_backup_destination(client, endpoint, bucket, access_probe=None):
    """Create only the approved bucket; prove privacy before copying any source data."""
    if (endpoint, bucket) != (BACKUP_ENDPOINT, BACKUP_BUCKET):
        raise ValueError('refusing an unexpected backup destination')
    created = False
    try:
        client.head_bucket(Bucket=bucket)
    except Exception as exc:
        response = getattr(exc, 'response', {})
        error = response.get('Error', {}) if isinstance(response, dict) else {}
        metadata = response.get('ResponseMetadata', {}) if isinstance(response, dict) else {}
        code = error.get('Code') if isinstance(error, dict) else None
        status = metadata.get('HTTPStatusCode') if isinstance(metadata, dict) else None
        if not ((code in ('NoSuchBucket', '404', 'NotFound') and status in (None, 404)) or
                (code in (None, '') and status == 404)):
            raise
        # Supabase CreateBucket defaults to private; ACL arguments are unsupported.
        client.create_bucket(Bucket=bucket)
        created = True
        client.head_bucket(Bucket=bucket)
    key = SNAPSHOT_PREFIX + 'privacy-checks/' + uuid.uuid4().hex
    existing = optional_object(client, bucket, key)
    if existing is not None:
        existing['Body'].close()
        raise ValueError('privacy canary already exists; refusing overwrite')
    data = b'LTI backup privacy check. Synthetic non-sensitive content.\n'
    client.upload_fileobj(io.BytesIO(data), bucket, key, ExtraArgs={
        'ContentType': 'text/plain', 'CacheControl': 'no-store'})
    if digest_object(client.get_object(Bucket=bucket, Key=key)) != (len(data), hashlib.sha256(data).hexdigest()):
        raise RuntimeError('privacy canary verification failed')
    if not (access_probe or public_access_blocked)(bucket, key):
        raise RuntimeError('backup destination is publicly accessible')
    # Append-only, even on failure. Never delete an existing bucket or canary.
    return {'backup_bucket_created': created, 'private_access_verified': True}


def validate_snapshot_id(snapshot_id):
    if not isinstance(snapshot_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}', snapshot_id):
        raise ValueError('invalid snapshot ID')


def snapshot_keys(snapshot_id):
    validate_snapshot_id(snapshot_id)
    prefix = SNAPSHOT_PREFIX + 'snapshots/' + snapshot_id + '/'
    return prefix + 'manifest.json', prefix + 'COMPLETED.json'


def content_key(sha256):
    if not isinstance(sha256, str) or not re.fullmatch(r'[0-9a-f]{64}', sha256):
        raise ValueError('invalid content checksum')
    return SNAPSHOT_PREFIX + 'objects/' + sha256


def inventory(client, bucket):
    rows = []
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket):
        rows.extend((v['Key'], int(v['Size']), v['ETag']) for v in page.get('Contents', []))
    rows.sort()
    if len({v[0] for v in rows}) != len(rows):
        raise ValueError('duplicate inventory key; retry')
    return rows


def is_missing(exc):
    response = getattr(exc, 'response', {})
    error = response.get('Error', {}) if isinstance(response, dict) else {}
    metadata = response.get('ResponseMetadata', {}) if isinstance(response, dict) else {}
    code = error.get('Code') if isinstance(error, dict) else None
    status = metadata.get('HTTPStatusCode') if isinstance(metadata, dict) else None
    return (code in ('404', 'NoSuchKey', 'NotFound') and status in (None, 404)) or (code in (None, '') and status == 404)


def optional_object(client, bucket, key):
    try:
        return client.get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if not is_missing(exc):
            raise
        # A code-less 404 can also mean a missing bucket; never write until checked.
        client.head_bucket(Bucket=bucket)
        return None


def document_metadata(obj):
    metadata = {'ContentType': obj.get('ContentType') or 'application/octet-stream'}
    for name in ('CacheControl', 'ContentDisposition', 'Metadata'):
        if obj.get(name):
            metadata[name] = obj[name]
    if any(not isinstance(value, str) for name, value in metadata.items() if name != 'Metadata'):
        raise ValueError('invalid document metadata')
    if 'Metadata' in metadata and (not isinstance(metadata['Metadata'], dict) or
            any(not isinstance(k, str) or not isinstance(v, str) for k, v in metadata['Metadata'].items())):
        raise ValueError('invalid document metadata')
    return metadata


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def read_small_object(obj):
    body = obj['Body']
    try:
        data = body.read(MAX_MANIFEST_BYTES + 1)
        if len(data) > MAX_MANIFEST_BYTES or ('ContentLength' in obj and len(data) != int(obj['ContentLength'])):
            raise ValueError('manifest size invalid or incomplete')
        return data
    finally:
        body.close()


def parse_json(data):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate manifest field')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique_pairs)


def load_snapshot(client, bucket, snapshot_id):
    """Require a verified manifest AND final commit marker; never accept partial runs."""
    manifest_key, complete_key = snapshot_keys(snapshot_id)
    complete_bytes = read_small_object(client.get_object(Bucket=bucket, Key=complete_key))
    complete = parse_json(complete_bytes)
    if not isinstance(complete, dict) or complete.get('format') != 'lti-storage-snapshot-complete' or complete.get('version') != 1 or complete.get('snapshot_id') != snapshot_id:
        raise ValueError('invalid completed snapshot marker')
    raw = read_small_object(client.get_object(Bucket=bucket, Key=manifest_key))
    if hashlib.sha256(raw).hexdigest() != complete.get('manifest_sha256'):
        raise ValueError('snapshot manifest checksum mismatch')
    manifest = parse_json(raw)
    if not isinstance(manifest, dict) or manifest.get('format') != 'lti-storage-snapshot' or manifest.get('version') != 1 or manifest.get('snapshot_id') != snapshot_id:
        raise ValueError('invalid snapshot manifest')
    rows = manifest.get('objects')
    if not isinstance(rows, list) or not rows or type(manifest.get('object_count')) is not int or len(rows) != manifest['object_count']:
        raise ValueError('invalid snapshot object count')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('key'), str) or not row['key'] or row['key'].startswith(SNAPSHOT_PREFIX) or row['key'] in seen:
            raise ValueError('invalid or duplicate snapshot key')
        seen.add(row['key'])
        if type(row.get('size')) is not int or row['size'] < 0 or row.get('object_key') != content_key(row.get('sha256')):
            raise ValueError('invalid snapshot content reference')
        metadata = row.get('metadata')
        if not isinstance(metadata, dict) or set(metadata) - {'ContentType', 'CacheControl', 'ContentDisposition', 'Metadata'} or document_metadata(metadata) != metadata:
            raise ValueError('invalid snapshot document metadata')
    if sum(row['size'] for row in rows) != manifest.get('total_bytes'):
        raise ValueError('invalid snapshot total bytes')
    return manifest, hashlib.sha256(raw).hexdigest(), hashlib.sha256(complete_bytes).hexdigest()

def failure_details(exc, operation, key):
    """Log diagnostic codes only: exception messages may contain credentials."""
    response = getattr(exc, 'response', {})
    if not isinstance(response, dict):
        response = {}
    error = response.get('Error', {})
    metadata = response.get('ResponseMetadata', {})
    code = error.get('Code') if isinstance(error, dict) else None
    status = metadata.get('HTTPStatusCode') if isinstance(metadata, dict) else None
    return {
        'operation': operation,
        'object_sha256': hashlib.sha256(key.encode('utf-8')).hexdigest(),
        'exception': type(exc).__name__,
        'code': code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', code) else None,
        'http_status': status if type(status) is int and 100 <= status <= 599 else None,
    }

def digest_object(obj, target=None):
    digest = hashlib.sha256()
    size = 0
    body = obj['Body']
    try:
        while chunk := body.read(8 * 1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
            if target is not None:
                target.write(chunk)
    finally:
        body.close()
    if 'ContentLength' in obj and size != int(obj['ContentLength']):
        raise RuntimeError('incomplete object download')
    return size, digest.hexdigest()

def backup(source, dest, source_bucket, backup_bucket, snapshot_id=None):
    snapshot_id = snapshot_id or datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex
    manifest_key, complete_key = snapshot_keys(snapshot_id)
    result = {'copied': 0, 'verified_existing': 0, 'failed': 0, 'verified_bytes': 0,
              'completed': False, 'snapshot_id': snapshot_id}
    operation, key = 'list_source', snapshot_id
    try:
        original = inventory(source, source_bucket)
        if not original:
            raise ValueError('empty source refused; older snapshots retained')
        if any(not isinstance(key,str) or not key or key.startswith(SNAPSHOT_PREFIX) for key, _, _ in original):
            raise ValueError('source uses reserved backup namespace')
        # IDs are unique per serialized workflow run/attempt. Never reuse a published
        # or partially published ID, even if its data looks similar.
        operation = 'check_snapshot_id'
        for key in (manifest_key, complete_key):
            existing = optional_object(dest, backup_bucket, key)
            if existing is not None:
                existing['Body'].close()
                raise ValueError('snapshot ID already exists; use a new attempt ID')
        rows = []
        for key, expected_size, expected_etag in original:
            operation = 'download_source'
            try:
                with tempfile.TemporaryFile() as tmp:
                    obj = source.get_object(Bucket=source_bucket, Key=key)
                    size, sha256 = digest_object(obj, tmp)
                    if size != expected_size or obj.get('ETag') != expected_etag:
                        raise RuntimeError('source changed during backup; retry')
                    object_key = content_key(sha256)
                    metadata = document_metadata(obj)
                    operation = 'read_backup'
                    existing = optional_object(dest, backup_bucket, object_key)
                    if existing is not None:
                        if digest_object(existing) != (size, sha256):
                            raise RuntimeError('immutable backup content is corrupt; refusing overwrite')
                        result['verified_existing'] += 1
                    else:
                        tmp.seek(0)
                        operation = 'upload_backup'
                        dest.upload_fileobj(tmp, backup_bucket, object_key, ExtraArgs={'ContentType': 'application/octet-stream'})
                        operation = 'verify_uploaded_backup'
                        if digest_object(dest.get_object(Bucket=backup_bucket, Key=object_key)) != (size, sha256):
                            raise RuntimeError('backup byte verification failed')
                        result['copied'] += 1
                    operation = 'verify_source_unchanged'
                    latest = source.head_object(Bucket=source_bucket, Key=key)
                    if latest.get('ETag') != obj.get('ETag') or int(latest['ContentLength']) != size or document_metadata(latest) != metadata:
                        raise RuntimeError('source changed during backup; retry')
                    result['verified_bytes'] += size
                    rows.append({'key': key, 'size': size, 'sha256': sha256, 'object_key': object_key, 'metadata': metadata})
            except Exception as exc:
                result['failed'] += 1
                print('::error::Storage object verification failed ' + json.dumps(failure_details(exc, operation, key), sort_keys=True), flush=True)
        if result['failed']:
            return result
        operation, key = 'verify_source_inventory', snapshot_id
        if inventory(source, source_bucket) != original:
            raise RuntimeError('source inventory changed; snapshot not committed')
        manifest = {'format': 'lti-storage-snapshot', 'version': 1, 'snapshot_id': snapshot_id,
                    'created_at': datetime.now(timezone.utc).isoformat(), 'source_bucket': source_bucket,
                    'object_count': len(rows), 'total_bytes': sum(row['size'] for row in rows), 'objects': rows}
        raw = json_bytes(manifest)
        if len(raw) > MAX_MANIFEST_BYTES:
            raise ValueError('snapshot manifest exceeds supported size')
        operation = 'recheck_snapshot_id'
        for key in (manifest_key, complete_key):
            existing = optional_object(dest, backup_bucket, key)
            if existing is not None:
                existing['Body'].close()
                raise ValueError('snapshot ID appeared during copy; refusing overwrite')
        operation, key = 'publish_manifest', manifest_key
        dest.upload_fileobj(io.BytesIO(raw), backup_bucket, manifest_key, ExtraArgs={'ContentType': 'application/json'})
        operation = 'verify_manifest'
        if read_small_object(dest.get_object(Bucket=backup_bucket, Key=manifest_key)) != raw:
            raise RuntimeError('snapshot manifest verification failed')
        manifest_sha256 = hashlib.sha256(raw).hexdigest()
        marker = json_bytes({'format': 'lti-storage-snapshot-complete', 'version': 1,
                             'snapshot_id': snapshot_id, 'manifest_sha256': manifest_sha256})
        operation, key = 'commit_snapshot', complete_key
        dest.upload_fileobj(io.BytesIO(marker), backup_bucket, complete_key, ExtraArgs={'ContentType': 'application/json'})
        operation = 'verify_snapshot_commit'
        if read_small_object(dest.get_object(Bucket=backup_bucket, Key=complete_key)) != marker:
            raise RuntimeError('snapshot commit verification failed')
        result.update(completed=True, object_count=len(rows), manifest_sha256=manifest_sha256)
    except Exception as exc:
        result['failed'] += 1
        print('::error::Storage snapshot failed ' + json.dumps(failure_details(exc, operation, key), sort_keys=True), flush=True)
    finally:
        print(json.dumps(result, sort_keys=True), flush=True)
    return result

def main():
    import boto3
    from botocore.config import Config
    required = ['PROD_ACCESS_KEY_ID', 'PROD_SECRET_ACCESS_KEY', 'BACKUP_ACCESS_KEY_ID', 'BACKUP_SECRET_ACCESS_KEY']
    if any(not os.environ.get(key) for key in required):
        raise SystemExit('Storage backup credentials are incomplete; nothing copied')
    # Match the already-used restore client's S3 compatibility settings. These
    # SDK checksum options do not replace our full SHA-256 read-back verification.
    cfg = Config(signature_version='s3v4', s3={'addressing_style': 'path'},
                 connect_timeout=30, read_timeout=90,
                 retries={'max_attempts': 3, 'mode': 'standard'},
                 request_checksum_calculation='when_required',
                 response_checksum_validation='when_required')
    def client(prefix, endpoint, region_key):
        return boto3.client('s3', endpoint_url=os.environ[endpoint],
                            aws_access_key_id=os.environ[prefix + '_ACCESS_KEY_ID'],
                            aws_secret_access_key=os.environ[prefix + '_SECRET_ACCESS_KEY'],
                            region_name=os.environ.get(region_key) or os.environ.get('AWS_REGION') or 'ap-southeast-1',
                            config=cfg)
    try:
        validate_backup_configuration(os.environ.get('PROD_ENDPOINT'), os.environ.get('SOURCE_BUCKET'),
                                      os.environ.get('BACKUP_ENDPOINT'), os.environ.get('BACKUP_BUCKET'))
        source = client('PROD', 'PROD_ENDPOINT', 'PROD_AWS_REGION')
        dest = client('BACKUP', 'BACKUP_ENDPOINT', 'BACKUP_AWS_REGION')
        preflight = prepare_backup_destination(dest, BACKUP_ENDPOINT, BACKUP_BUCKET)
        print(json.dumps(preflight, sort_keys=True), flush=True)
    except Exception as exc:
        print('::error::Storage destination preflight failed ' + json.dumps(
            failure_details(exc, 'prepare_backup_destination', BACKUP_BUCKET), sort_keys=True), flush=True)
        raise SystemExit(1) from None
    result = backup(source, dest, SOURCE_BUCKET, BACKUP_BUCKET, os.environ.get('BACKUP_SNAPSHOT_ID'))
    if result['failed'] or not result['completed']:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
