"""Copy private Storage objects; verify bytes and retain deleted-source backups."""
import hashlib
import json
import os
import re
import tempfile

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

def backup(source, dest, source_bucket, backup_bucket):
    result = {'copied': 0, 'verified_existing': 0, 'failed': 0, 'verified_bytes': 0}
    for page in source.get_paginator('list_objects_v2').paginate(Bucket=source_bucket):
        for item in page.get('Contents', []):
            key = item['Key']
            operation = 'download_source'
            try:
                with tempfile.TemporaryFile() as tmp:
                    obj = source.get_object(Bucket=source_bucket, Key=key)
                    size, sha256 = digest_object(obj, tmp)
                    if size != int(item['Size']) or obj.get('ETag') != item.get('ETag'):
                        raise RuntimeError('source changed during backup; retry')
                    try:
                        operation = 'read_backup'
                        existing = digest_object(dest.get_object(Bucket=backup_bucket, Key=key))
                    except Exception as exc:
                        code = getattr(exc, 'response', {}).get('Error', {}).get('Code')
                        if code not in ('404', 'NoSuchKey', 'NotFound'):
                            raise
                        existing = None
                    if existing == (size, sha256):
                        result['verified_existing'] += 1
                    else:
                        extra = {'ContentType': obj.get('ContentType', 'application/octet-stream')}
                        for name in ('CacheControl', 'ContentDisposition', 'Metadata'):
                            if obj.get(name):
                                extra[name] = obj[name]
                        tmp.seek(0)
                        operation = 'upload_backup'
                        dest.upload_fileobj(tmp, backup_bucket, key, ExtraArgs=extra)
                        operation = 'verify_uploaded_backup'
                        if digest_object(dest.get_object(Bucket=backup_bucket, Key=key)) != (size, sha256):
                            raise RuntimeError('backup byte verification failed')
                        result['copied'] += 1
                    operation = 'verify_source_unchanged'
                    latest = source.head_object(Bucket=source_bucket, Key=key)
                    if latest.get('ETag') != obj.get('ETag') or int(latest['ContentLength']) != size:
                        raise RuntimeError('source changed during backup; retry')
                    result['verified_bytes'] += size
            except Exception as exc:
                result['failed'] += 1
                details = failure_details(exc, operation, key)
                print('::error::Storage object verification failed ' + json.dumps(details, sort_keys=True), flush=True)
    print(json.dumps(result, sort_keys=True))
    return result

def main():
    import boto3
    from botocore.config import Config
    required = ['PROD_ACCESS_KEY_ID', 'PROD_SECRET_ACCESS_KEY', 'STAGING_ACCESS_KEY_ID', 'STAGING_SECRET_ACCESS_KEY']
    if any(not os.environ.get(key) for key in required):
        raise SystemExit('Storage backup credentials are incomplete; nothing copied')
    cfg = Config(signature_version='s3v4', s3={'addressing_style': 'path'})
    def client(prefix, endpoint):
        return boto3.client('s3', endpoint_url=os.environ[endpoint],
                            aws_access_key_id=os.environ[prefix + '_ACCESS_KEY_ID'],
                            aws_secret_access_key=os.environ[prefix + '_SECRET_ACCESS_KEY'],
                            region_name=os.environ['AWS_REGION'], config=cfg)
    result = backup(client('PROD', 'PROD_ENDPOINT'), client('STAGING', 'STAGING_ENDPOINT'),
                    os.environ['SOURCE_BUCKET'], os.environ['BACKUP_BUCKET'])
    if result['failed']:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
