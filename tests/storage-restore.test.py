"""Meaningful restore safety checks using an in-memory S3 fixture (no credentials)."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
from io import BytesIO, StringIO
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('restore_storage', Path(__file__).parents[1] / 'scripts/restore-storage-test.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
TARGET = restore.target_name('123456', '1')


class Paginator:
    def __init__(self, client):
        self.client = client

    def paginate(self, Bucket):
        yield {'Contents': [{'Key': k, 'Size': len(v['data']), 'ETag': self.client.etag(v['data'])}
                            for k, v in self.client.buckets[Bucket].items()]}


class Client:
    def __init__(self):
        self.buckets = {restore.BACKUP_BUCKET: {
            'private-owner/one.pdf': {'data': b'first-content', 'ContentType': 'application/pdf'},
            'private-owner/two.docx': {'data': b'second-content', 'ContentType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}},
            'lti-documents': {'do-not-touch.pdf': {'data': b'existing'}}}
        self.writes = []
        self.corrupt = False
        self.drop_metadata = False
        self.change_source = False
        self.cleanup_error = False

    @staticmethod
    def etag(data):
        return hashlib.sha256(data).hexdigest()

    def get_paginator(self, name):
        return Paginator(self)

    def list_buckets(self):
        return {'Buckets': [{'Name': b} for b in self.buckets]}

    def create_bucket(self, Bucket):
        self.writes.append(('create', Bucket))
        assert Bucket == TARGET
        assert Bucket not in self.buckets
        self.buckets[Bucket] = {}

    def get_object(self, Bucket, Key):
        v = self.buckets[Bucket][Key]
        return {**{k: value for k, value in v.items() if k != 'data'},
                'Body': BytesIO(v['data']), 'ContentLength': len(v['data']), 'ETag': self.etag(v['data'])}

    def head_object(self, Bucket, Key):
        v = self.buckets[Bucket][Key]
        value = {**v, 'ContentLength': len(v['data']), 'ETag': self.etag(v['data'])}
        if self.change_source and Bucket == restore.BACKUP_BUCKET:
            value['ETag'] = 'changed'
        return value

    def upload_fileobj(self, source, Bucket, Key, ExtraArgs):
        assert Bucket == TARGET
        self.writes.append(('upload', Bucket))
        data = source.read()
        if self.corrupt:
            data = bytes([data[0] ^ 1]) + data[1:]
        self.buckets[Bucket][Key] = {'data': data, **ExtraArgs}
        if self.drop_metadata:
            self.buckets[Bucket][Key]['ContentType'] = 'application/octet-stream'

    def delete_object(self, Bucket, Key):
        assert Bucket == TARGET
        self.writes.append(('delete_object', Bucket))
        if self.cleanup_error:
            raise PermissionError('cleanup denied')
        self.buckets[Bucket].pop(Key, None)
        return {}

    def delete_bucket(self, Bucket):
        assert Bucket == TARGET
        self.writes.append(('delete_bucket', Bucket))
        assert not self.buckets[Bucket]
        del self.buckets[Bucket]


def fake_viewer(path, key, content_type):
    assert Path(path).exists()
    return {'kind': 'pdf' if key.endswith('.pdf') else 'docx', 'pages': 2}


class RestoreTests(unittest.TestCase):
    def run_restore(self, client, count=2, viewer=fake_viewer, probe=lambda *_: True):
        with redirect_stdout(StringIO()) as log:
            result = restore.restore(client, TARGET, count, viewer=viewer, access_probe=probe)
        self.assertNotIn('private-owner', log.getvalue())
        return result

    def test_restores_bytes_and_opens_documents_then_cleans_only_new_bucket(self):
        client = Client()
        before = restore.snapshot(client, restore.BACKUP_BUCKET)
        result = self.run_restore(client)
        self.assertEqual((result['restored'], result['failed'], result['view_failed']), (2, 0, 0))
        self.assertEqual((result['pdf_rendered'], result['docx_opened']), (1, 1))
        self.assertTrue(result['private_access_verified'] and result['backup_unchanged'] and result['cleanup_success'])
        self.assertEqual(restore.snapshot(client, restore.BACKUP_BUCKET), before)
        self.assertIn('do-not-touch.pdf', client.buckets['lti-documents'])
        self.assertNotIn(TARGET, client.buckets)
        self.assertTrue(all(bucket == TARGET for _, bucket in client.writes))

    def test_corrupt_restore_is_rejected_and_original_is_kept(self):
        client = Client()
        client.corrupt = True
        result = self.run_restore(client)
        self.assertGreater(result['failed'], 0)
        self.assertEqual(result['restored'], 0)
        self.assertTrue(result['cleanup_success'])
        self.assertEqual(client.buckets[restore.BACKUP_BUCKET]['private-owner/one.pdf']['data'], b'first-content')

    def test_metadata_loss_is_rejected(self):
        client = Client()
        client.drop_metadata = True
        result = self.run_restore(client)
        self.assertGreater(result['failed'], 0)
        self.assertTrue(result['cleanup_success'])

    def test_changed_backup_is_rejected(self):
        client = Client()
        client.change_source = True
        result = self.run_restore(client)
        self.assertGreater(result['failed'], 0)
        self.assertTrue(result['cleanup_success'])

    def test_public_destination_stops_before_bulk_restore(self):
        client = Client()
        result = self.run_restore(client, probe=lambda *_: False)
        self.assertGreater(result['failed'], 0)
        self.assertFalse(result['private_access_verified'])
        self.assertEqual(sum(op == 'upload' for op, _ in client.writes), 1)
        self.assertTrue(result['cleanup_success'])

    def test_existing_destination_is_never_overwritten_or_deleted(self):
        client = Client()
        client.buckets[TARGET] = {'existing.pdf': {'data': b'important'}}
        with self.assertRaises(ValueError):
            self.run_restore(client)
        self.assertEqual(client.writes, [])
        self.assertEqual(client.buckets[TARGET]['existing.pdf']['data'], b'important')

    def test_wrong_count_stops_before_any_write(self):
        client = Client()
        with self.assertRaises(ValueError):
            self.run_restore(client, count=3)
        self.assertEqual(client.writes, [])

    def test_empty_source_stops_before_any_write(self):
        client = Client()
        client.buckets[restore.BACKUP_BUCKET] = {}
        with self.assertRaises(ValueError):
            self.run_restore(client, count=0)
        self.assertEqual(client.writes, [])

    def test_document_open_failure_is_reported_separately_and_cleans(self):
        def bad_viewer(*_):
            raise ValueError('malformed original document')
        result = self.run_restore(Client(), viewer=bad_viewer)
        self.assertEqual((result['restored'], result['view_failed']), (2, 2))
        self.assertTrue(result['cleanup_success'])

    def test_cleanup_failure_never_reports_success(self):
        client = Client()
        client.cleanup_error = True
        result = self.run_restore(client)
        self.assertFalse(result['cleanup_success'])
        self.assertGreater(result['failed'], 0)
        self.assertIn(restore.BACKUP_BUCKET, client.buckets)

    def test_production_and_application_bucket_targets_are_rejected(self):
        client = Client()
        for target in ['lti-documents', 'lti-production-backup', 'lti-restore-check-../evil', 'other']:
            with self.assertRaises(ValueError):
                restore.restore(client, target, 2)
            with self.assertRaises(ValueError):
                restore.cleanup(client, target)
        self.assertEqual(client.writes, [])

    def test_run_identifiers_cannot_supply_paths_or_other_buckets(self):
        for run_id in ['../lti-documents', '', 'hello', '1\n2']:
            with self.assertRaises(ValueError):
                restore.target_name(run_id, '1')

    def test_bulk_delete_is_never_used_for_cleanup(self):
        client = Client()
        def reject_bulk(*_, **__):
            raise RuntimeError('bulk DeleteObjects returns HTTP 400')
        client.delete_objects = reject_bulk
        result = self.run_restore(client)
        self.assertTrue(result['cleanup_success'])

    def test_recovery_cleanup_verifies_inventory_and_preserves_backup(self):
        client = Client()
        client.buckets[TARGET] = {k: dict(v) for k,v in client.buckets[restore.BACKUP_BUCKET].items()}
        with redirect_stdout(StringIO()):
            result = restore.cleanup_previous_run(client, TARGET, 2)
        self.assertEqual(result['removed'], 2)
        self.assertTrue(result['backup_unchanged'] and result['cleanup_success'])
        self.assertIn('do-not-touch.pdf', client.buckets['lti-documents'])

    def test_recovery_cleanup_refuses_unexpected_objects(self):
        client = Client()
        client.buckets[TARGET] = {'unexpected.pdf': {'data': b'important'}}
        with self.assertRaises(ValueError):
            restore.cleanup_previous_run(client, TARGET, 2)
        self.assertEqual(client.writes, [])

    def test_word_document_structure_is_opened_without_extraction(self):
        with tempfile.NamedTemporaryFile() as tmp:
            with ZipFile(tmp, 'w') as doc:
                doc.writestr('[Content_Types].xml', '<Types/>')
                doc.writestr('word/document.xml', '<document/>')
            tmp.flush()
            result = restore.open_document(tmp.name, 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        self.assertEqual(result['kind'], 'docx')


if __name__ == '__main__':
    unittest.main()
