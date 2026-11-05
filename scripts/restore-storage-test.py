"""Restore private snapshots to a disposable backup-project bucket, then clean up.

The endpoint and source bucket are fixed. No current Tokyo production credentials
or application records are used. Logs contain aggregate counts and opaque hashes, never names or
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
from zipfile import ZipFile
import xml.etree.ElementTree as ET

BACKUP_PROJECT = 'ozmulwqzybhiekmolvyk'
ENDPOINT = f'https://{BACKUP_PROJECT}.storage.supabase.co/storage/v1/s3'
BACKUP_BUCKET = 'lti-production-backup'
TARGET_PREFIX = 'lti-restore-check-'

spec = importlib.util.spec_from_file_location('backup_storage', Path(__file__).with_name('backup-storage.py'))
backup_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_module)
digest_object = backup_module.digest_object
failure_details = backup_module.failure_details
public_access_blocked = backup_module.public_access_blocked


def target_name(run_id, attempt):
    if not all(re.fullmatch(r'[0-9]{1,20}', str(v)) for v in (run_id, attempt)):
        raise ValueError('numeric run ID and attempt required')
    return f'{TARGET_PREFIX}{run_id}-{attempt}'


def validate_target(target):
    if not re.fullmatch(r'lti-restore-check-[0-9]{1,20}-[0-9]{1,20}', target):
        raise ValueError('refusing a destination outside the disposable restore namespace')


def snapshot(client, bucket):
    return backup_module.inventory(client, bucket)


def restore_plan(client, snapshot_id=None):
    if not snapshot_id:
        raise ValueError('a completed snapshot ID is required; legacy restore is a separate procedure')
    manifest, _, _ = backup_module.load_snapshot(client, BACKUP_BUCKET, snapshot_id)
    return [{'key': row['key'], 'source_key': row['object_key'], 'size': row['size'],
             'sha256': row['sha256'], 'metadata': row['metadata']} for row in manifest['objects']]


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
    key, source_key, expected_size = row['key'], row['source_key'], row['size']
    operation = 'download_backup'
    restored_path = None
    try:
        with tempfile.TemporaryFile() as source_file:
            source = client.get_object(Bucket=BACKUP_BUCKET, Key=source_key)
            size, checksum = digest_object(source, source_file)
            if size != expected_size or ('etag' in row and source.get('ETag') != row['etag']) or ('sha256' in row and checksum != row['sha256']):
                raise RuntimeError('backup changed during restoration')
            extra = row.get('metadata') or backup_module.document_metadata(source)
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
            latest = client.head_object(Bucket=BACKUP_BUCKET, Key=source_key)
            if latest.get('ETag') != source.get('ETag') or int(latest['ContentLength']) != size:
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
    # Use the individually supported DeleteObject path. The live S3 endpoint
    # returned a code-less HTTP 400 for SDK-generated bulk DeleteObjects.
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(client.delete_object, Bucket=target, Key=row[0]) for row in rows]
        for future in as_completed(futures):
            future.result()
    if snapshot(client, target):
        raise RuntimeError('restore cleanup left test objects')
    client.delete_bucket(Bucket=target)
    if target in {b['Name'] for b in client.list_buckets()['Buckets']}:
        raise RuntimeError('restore cleanup left the test bucket')


def cleanup_previous_run(client, target, expected_count=None, snapshot_id=None):
    """Recover an owned disposable bucket only if its inventory matches backup."""
    validate_target(target)
    original = snapshot(client, BACKUP_BUCKET)
    plan = restore_plan(client, snapshot_id)
    if expected_count is None and snapshot_id:
        expected_count = len(plan)
    restored = snapshot(client, target)
    if expected_count is None or expected_count < 1 or len(plan) != expected_count or len(restored) != expected_count:
        raise ValueError('cleanup recovery count does not match the verified restore run')
    if [(row[0], row[1]) for row in restored] != sorted((row['key'], row['size']) for row in plan):
        raise ValueError('cleanup recovery inventory differs from backup; refusing deletion')
    # Matching names/sizes alone cannot identify an owned recovery run. Verify
    # actual content before deleting anything.
    for row in plan:
        expected = (row['size'], row['sha256']) if 'sha256' in row else digest_object(client.get_object(Bucket=BACKUP_BUCKET, Key=row['source_key']))
        if digest_object(client.get_object(Bucket=target, Key=row['key'])) != expected:
            raise ValueError('cleanup recovery content differs from backup; refusing deletion')
    cleanup(client, target)
    result = {'cleanup_success': True, 'removed': len(restored), 'destination': target,
              'backup_unchanged': snapshot(client, BACKUP_BUCKET) == original}
    if not result['backup_unchanged']:
        raise RuntimeError('backup changed during cleanup recovery')
    print(json.dumps(result, sort_keys=True), flush=True)
    return result


def restore(client, target, expected_count=None, viewer=open_document, access_probe=public_access_blocked, snapshot_id=None):
    validate_target(target)
    original = snapshot(client, BACKUP_BUCKET)
    plan = restore_plan(client, snapshot_id)
    if expected_count is None and snapshot_id:
        expected_count = len(plan)
    result = {'expected': expected_count, 'restored': 0, 'verified_bytes': 0,
              'failed': 0, 'view_failed': 0, 'pdf_rendered': 0, 'pdf_pages': 0,
              'encrypted_pdf': 0, 'docx_opened': 0, 'other': 0,
              'private_access_verified': False, 'backup_unchanged': False,
              'cleanup_success': False, 'destination': target, 'snapshot_id': snapshot_id}
    if expected_count is None or len(plan) != expected_count or expected_count < 1:
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
        first = restore_object(client, target, plan[0])
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
            futures = [executor.submit(restore_object, client, target, row) for row in plan[1:]]
            for future in as_completed(futures):
                consume(future.result())
        restored = snapshot(client, target)
        if [(row[0], row[1]) for row in restored] != sorted((row['key'], row['size']) for row in plan):
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
    required = ('BACKUP_ACCESS_KEY_ID', 'BACKUP_SECRET_ACCESS_KEY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RESTORE_SNAPSHOT_ID')
    if any(not os.environ.get(name) for name in required):
        raise SystemExit('restore test configuration is incomplete; nothing restored')
    import boto3
    from botocore.config import Config
    target = target_name(os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'])
    client = boto3.client('s3', endpoint_url=ENDPOINT,
                          aws_access_key_id=os.environ['BACKUP_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['BACKUP_SECRET_ACCESS_KEY'],
                          region_name='ap-southeast-1',
                          config=Config(signature_version='s3v4', s3={'addressing_style': 'path'},
                                        connect_timeout=30, read_timeout=90,
                                        retries={'max_attempts': 3, 'mode': 'standard'},
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    try:
        snapshot_id = os.environ.get('RESTORE_SNAPSHOT_ID') or None
        if snapshot_id:
            backup_module.validate_snapshot_id(snapshot_id)
        requested_count = os.environ.get('EXPECTED_FILES', '').strip()
        if requested_count and not re.fullmatch(r'[1-9][0-9]{0,9}', requested_count):
            raise ValueError('invalid expected file count')
        expected_count = int(requested_count) if requested_count else None
        if os.environ.get('CLEANUP_ONLY_RUN_ID'):
            previous_target = target_name(os.environ['CLEANUP_ONLY_RUN_ID'], os.environ.get('CLEANUP_ONLY_RUN_ATTEMPT', '1'))
            result = cleanup_previous_run(client, previous_target, expected_count, snapshot_id=snapshot_id)
            return
        result = restore(client, target, expected_count, snapshot_id=snapshot_id)
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
