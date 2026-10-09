"""Restore private backups to a disposable staging bucket, verify, then clean up.

The endpoint and source bucket are fixed. No production credentials or application
records are used. Logs contain aggregate counts and opaque hashes, never names or
file contents. PDF opening runs on the main thread (MuPDF is not thread-safe).
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
from zipfile import ZipFile
import xml.etree.ElementTree as ET

STAGING_PROJECT = 'bvjjnzhhxieyxkeorurb'
ENDPOINT = f'https://{STAGING_PROJECT}.storage.supabase.co/storage/v1/s3'
BACKUP_BUCKET = 'lti-production-backup'
TARGET_PREFIX = 'lti-restore-check-'

spec = importlib.util.spec_from_file_location('backup_storage', Path(__file__).with_name('backup-storage.py'))
backup_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_module)
digest_object = backup_module.digest_object
failure_details = backup_module.failure_details


def target_name(run_id, attempt):
    if not all(re.fullmatch(r'[0-9]{1,20}', str(v)) for v in (run_id, attempt)):
        raise ValueError('numeric run ID and attempt required')
    return f'{TARGET_PREFIX}{run_id}-{attempt}'


def validate_target(target):
    if not re.fullmatch(r'lti-restore-check-[0-9]{1,20}-[0-9]{1,20}', target):
        raise ValueError('refusing a destination outside the disposable restore namespace')


def snapshot(client, bucket):
    rows = []
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket):
        rows.extend((v['Key'], int(v['Size']), v['ETag']) for v in page.get('Contents', []))
    return sorted(rows)


def public_access_blocked(bucket, key):
    # HEAD avoids downloading or emitting document contents even if access is wrong.
    url = (f'https://{STAGING_PROJECT}.supabase.co/storage/v1/object/public/'
           f'{quote(bucket, safe="")}/{quote(key, safe="/")}')
    try:
        with urlopen(Request(url, method='HEAD'), timeout=30) as response:
            return False
    except HTTPError as exc:
        return exc.code in (400, 401, 403, 404)


def open_document(path, key, content_type):
    with open(path, 'rb') as source:
        header = source.read(1024)
    if '%PDF-'.encode() in header or key.lower().endswith('.pdf') or content_type == 'application/pdf':
        import pymupdf
        pymupdf.TOOLS.mupdf_display_errors(False)
        pymupdf.TOOLS.mupdf_display_warnings(False)
        with pymupdf.open(path, filetype='pdf') as document:
            if document.needs_pass:
                return {'kind': 'encrypted_pdf', 'pages': document.page_count}
            if document.page_count < 1:
                raise ValueError('PDF has no pages')
            page = document[0]
            if page.rect.width <= 0 or page.rect.height <= 0:
                raise ValueError('PDF page has invalid dimensions')
            scale = min(1, 256 / max(page.rect.width, page.rect.height))
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            if pixmap.width < 1 or pixmap.height < 1 or not pixmap.samples:
                raise ValueError('PDF first-page rendering failed')
            return {'kind': 'pdf', 'pages': document.page_count}
    if key.lower().endswith('.docx') or content_type.endswith('wordprocessingml.document'):
        with ZipFile(path) as document:
            for entry in ('[Content_Types].xml', 'word/document.xml'):
                info = document.getinfo(entry)
                if info.file_size > 32 * 1024 * 1024:
                    raise ValueError('Word XML exceeds verification limit')
                ET.fromstring(document.read(entry))
        return {'kind': 'docx', 'pages': 0}
    return {'kind': 'other', 'pages': 0}


def restore_object(client, target, row):
    validate_target(target)
    key, expected_size, expected_etag = row
    operation = 'download_backup'
    restored_path = None
    try:
        with tempfile.TemporaryFile() as source_file:
            source = client.get_object(Bucket=BACKUP_BUCKET, Key=key)
            size, checksum = digest_object(source, source_file)
            if size != expected_size or source.get('ETag') != expected_etag:
                raise RuntimeError('backup changed during restoration')
            extra = {'ContentType': source.get('ContentType', 'application/octet-stream')}
            for name in ('CacheControl', 'ContentDisposition', 'Metadata'):
                if source.get(name):
                    extra[name] = source[name]
            source_file.seek(0)
            operation = 'upload_restore'
            client.upload_fileobj(source_file, target, key, ExtraArgs=extra)
            operation = 'verify_restored_bytes'
            with tempfile.NamedTemporaryFile(delete=False) as restored:
                restored_path = restored.name
                dest = client.get_object(Bucket=target, Key=key)
                actual = digest_object(dest, restored)
            if actual != (size, checksum):
                raise RuntimeError('restored content checksum mismatch')
            for name, value in extra.items():
                if dest.get(name) != value:
                    raise RuntimeError('restored document metadata mismatch')
            operation = 'verify_backup_unchanged'
            latest = client.head_object(Bucket=BACKUP_BUCKET, Key=key)
            if latest.get('ETag') != expected_etag or int(latest['ContentLength']) != size:
                raise RuntimeError('backup changed during restoration')
            return {'ok': True, 'key': key, 'size': size, 'sha256': checksum,
                    'path': restored_path, 'content_type': extra['ContentType']}
    except Exception as exc:
        if restored_path is not None:
            Path(restored_path).unlink(missing_ok=True)
        return {'ok': False, 'details': failure_details(exc, operation, key)}


def cleanup(client, target):
    validate_target(target)
    rows = snapshot(client, target)
    for offset in range(0, len(rows), 500):
        response = client.delete_objects(Bucket=target, Delete={
            'Objects': [{'Key': row[0]} for row in rows[offset:offset + 500]], 'Quiet': True})
        if response.get('Errors'):
            raise RuntimeError('restore cleanup did not delete every test object')
    if snapshot(client, target):
        raise RuntimeError('restore cleanup left test objects')
    client.delete_bucket(Bucket=target)
    if target in {b['Name'] for b in client.list_buckets()['Buckets']}:
        raise RuntimeError('restore cleanup left the test bucket')


def restore(client, target, expected_count, viewer=open_document, access_probe=public_access_blocked):
    validate_target(target)
    result = {'expected': expected_count, 'restored': 0, 'verified_bytes': 0,
              'failed': 0, 'view_failed': 0, 'pdf_rendered': 0, 'pdf_pages': 0,
              'encrypted_pdf': 0, 'docx_opened': 0, 'other': 0,
              'private_access_verified': False, 'backup_unchanged': False,
              'cleanup_success': False, 'destination': target}
    original = snapshot(client, BACKUP_BUCKET)
    if len(original) != expected_count or expected_count < 1:
        raise ValueError('backup count differs from the approved restore snapshot')
    if target in {b['Name'] for b in client.list_buckets()['Buckets']}:
        raise ValueError('restore destination already exists; refusing to overwrite or delete it')
    created = False
    temporary_paths = set()
    manifest = []
    try:
        client.create_bucket(Bucket=target)  # Supabase buckets are private by default.
        created = True
        if snapshot(client, target):
            raise RuntimeError('new restore destination is not empty')
        # Serialize the first file so anonymous access is checked before bulk restore.
        first = restore_object(client, target, original[0])
        if first['ok']:
            temporary_paths.add(first['path'])
            if not access_probe(target, first['key']):
                raise RuntimeError('restore destination is publicly accessible')
            result['private_access_verified'] = True

        def consume(item):
            if not item['ok']:
                result['failed'] += 1
                print('::error::Restore object verification failed ' + json.dumps(item['details'], sort_keys=True), flush=True)
                return
            temporary_paths.add(item['path'])
            result['restored'] += 1
            result['verified_bytes'] += item['size']
            opaque_key = hashlib.sha256(item['key'].encode()).hexdigest()
            manifest.append((opaque_key, item['size'], item['sha256']))
            try:
                view = viewer(item['path'], item['key'], item['content_type'])
                kind = view['kind']
                if kind == 'pdf':
                    result['pdf_rendered'] += 1
                    result['pdf_pages'] += view['pages']
                elif kind == 'docx':
                    result['docx_opened'] += 1
                elif kind == 'encrypted_pdf':
                    result['encrypted_pdf'] += 1
                else:
                    result['other'] += 1
            except Exception as exc:
                result['view_failed'] += 1
                print('::warning::Restored document opening failed ' + json.dumps(
                    failure_details(exc, 'open_restored_document', item['key']), sort_keys=True), flush=True)
            finally:
                Path(item['path']).unlink(missing_ok=True)
                temporary_paths.discard(item['path'])
            if result['restored'] % 50 == 0:
                print(json.dumps({'progress': result['restored'], 'expected': expected_count}), flush=True)

        consume(first)
        if not first['ok']:
            raise RuntimeError('first restore failed; bulk restore not started')
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(restore_object, client, target, row) for row in original[1:]]
            for future in as_completed(futures):
                consume(future.result())
        restored = snapshot(client, target)
        if [(row[0], row[1]) for row in restored] != [(row[0], row[1]) for row in original]:
            raise RuntimeError('restored inventory differs from backup')
        result['backup_unchanged'] = snapshot(client, BACKUP_BUCKET) == original
        if not result['backup_unchanged']:
            raise RuntimeError('backup inventory changed during restoration')
        result['manifest_sha256'] = hashlib.sha256(json.dumps(sorted(manifest), separators=(',', ':')).encode()).hexdigest()
    except Exception as exc:
        result['failed'] += 1
        print('::error::Restore verification failed ' + json.dumps(
            failure_details(exc, 'restore_run', target), sort_keys=True), flush=True)
    finally:
        for path in temporary_paths:
            Path(path).unlink(missing_ok=True)
        if created:
            try:
                cleanup(client, target)
                result['cleanup_success'] = True
            except Exception as exc:
                result['failed'] += 1
                print('::error::Restore cleanup failed ' + json.dumps(
                    failure_details(exc, 'cleanup_restore_bucket', target), sort_keys=True), flush=True)
        print(json.dumps(result, sort_keys=True), flush=True)
    return result


def main():
    required = ('TEST_ACCESS_KEY_ID', 'TEST_SECRET_ACCESS_KEY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'EXPECTED_FILES')
    if any(not os.environ.get(name) for name in required):
        raise SystemExit('restore test configuration is incomplete; nothing restored')
    import boto3
    from botocore.config import Config
    target = target_name(os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'])
    client = boto3.client('s3', endpoint_url=ENDPOINT,
                          aws_access_key_id=os.environ['TEST_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['TEST_SECRET_ACCESS_KEY'],
                          region_name='ap-southeast-1',
                          config=Config(signature_version='s3v4', s3={'addressing_style': 'path'},
                                        connect_timeout=30, read_timeout=90,
                                        retries={'max_attempts': 3, 'mode': 'standard'},
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    try:
        result = restore(client, target, int(os.environ['EXPECTED_FILES']))
    except Exception as exc:
        print('::error::Restore preflight failed ' + json.dumps(
            failure_details(exc, 'restore_preflight', target), sort_keys=True), flush=True)
        raise SystemExit(1) from None
    if result['failed'] or result['view_failed'] or result['restored'] != result['expected']:
        raise SystemExit(1)
    summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_path:
        with open(summary_path, 'a') as report:
            report.write('## Private Storage restore verification\n\n```json\n' + json.dumps(result, indent=2, sort_keys=True) + '\n```\n')


if __name__ == '__main__':
    main()
