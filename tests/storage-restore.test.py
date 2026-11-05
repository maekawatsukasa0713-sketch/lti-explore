"""Meaningful restore safety checks using an in-memory S3 fixture (no credentials)."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import json
from io import BytesIO, StringIO
from pathlib import Path
import tempfile
import sys
import types
import unittest
from unittest.mock import patch
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('restore_storage', Path(__file__).parents[1] / 'scripts/restore-storage-test.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
TARGET = restore.target_name('123456', '1')
SNAPSHOT_ID = 'fixture-completed-snapshot'


class Missing(Exception):
    response = {'Error': {'Code': 'NoSuchKey'}, 'ResponseMetadata': {'HTTPStatusCode': 404}}


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
        self.allow_backup_writes = False
        self.buckets['fixture-source'] = {key: dict(value) for key,value in self.buckets[restore.BACKUP_BUCKET].items()}
        self.allow_backup_writes = True
        with redirect_stdout(StringIO()):
            result = restore.backup_module.backup(self,self,'fixture-source',restore.BACKUP_BUCKET,SNAPSHOT_ID)
        assert result['completed']
        self.allow_backup_writes = False
        self.writes.clear()

    @staticmethod
    def etag(data):
        return hashlib.sha256(data).hexdigest()

    def get_paginator(self, name):
        return Paginator(self)

    def list_buckets(self):
        return {'Buckets': [{'Name': b} for b in self.buckets]}

    def head_bucket(self, Bucket):
        if Bucket not in self.buckets:
            raise Missing()
        return {}

    def create_bucket(self, Bucket):
        self.writes.append(('create', Bucket))
        assert Bucket == TARGET
        assert Bucket not in self.buckets
        self.buckets[Bucket] = {}

    def get_object(self, Bucket, Key):
        if Key not in self.buckets[Bucket]:
            raise Missing()
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
        assert Bucket == TARGET or (self.allow_backup_writes and Bucket == restore.BACKUP_BUCKET)
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
    def run_restore(self, client, count=2, viewer=fake_viewer, probe=lambda *_: True, snapshot_id=SNAPSHOT_ID):
        with redirect_stdout(StringIO()) as log:
            result = restore.restore(client, TARGET, count, viewer=viewer, access_probe=probe, snapshot_id=snapshot_id)
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
        with self.assertRaises((ValueError,Missing)):
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
        client.buckets[TARGET] = {k: dict(v) for k,v in client.buckets['fixture-source'].items()}
        with redirect_stdout(StringIO()):
            result = restore.cleanup_previous_run(client, TARGET, 2, snapshot_id=SNAPSHOT_ID)
        self.assertEqual(result['removed'], 2)
        self.assertTrue(result['backup_unchanged'] and result['cleanup_success'])
        self.assertIn('do-not-touch.pdf', client.buckets['lti-documents'])

    def test_recovery_cleanup_refuses_unexpected_objects(self):
        client = Client()
        client.buckets[TARGET] = {'unexpected.pdf': {'data': b'important'}}
        with self.assertRaises(ValueError):
            restore.cleanup_previous_run(client, TARGET, 2, snapshot_id=SNAPSHOT_ID)
        self.assertEqual(client.writes, [])

    def test_word_document_structure_is_opened_without_extraction(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path=Path(temp_dir)/'fixture.docx'
            with ZipFile(path, 'w') as doc:
                doc.writestr('[Content_Types].xml', '<Types/>')
                doc.writestr('word/document.xml', '<document/>')
            result = restore.open_document(path, 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        self.assertEqual(result['kind'], 'docx')

    def make_snapshot(self, client, snapshot_id='github-987-1', source=None):
        if source is not None:
            client.buckets['snapshot-source'] = source
        elif 'snapshot-source' not in client.buckets:
            client.buckets['snapshot-source'] = {key: dict(value) for key,value in client.buckets['fixture-source'].items()}
        client.allow_backup_writes = True
        try:
            with redirect_stdout(StringIO()):
                result=restore.backup_module.backup(client,client,'snapshot-source',restore.BACKUP_BUCKET,snapshot_id)
            self.assertTrue(result['completed'],result)
        finally:
            client.allow_backup_writes = False
        client.writes.clear()
        return snapshot_id

    def test_selected_snapshot_restores_original_names_content_and_metadata(self):
        client=Client()
        source={'private-owner/one.pdf':{'data':b'old-good','ContentType':'application/pdf','ContentDisposition':'inline','Metadata':{'version':'old'}},
                'private-owner/two.docx':{'data':b'old-word','ContentType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}}
        old=self.make_snapshot(client,source=source)
        self.make_snapshot(client,'github-987-2',{'private-owner/one.pdf':{'data':b'new-bad!','ContentType':'application/pdf'}})
        before=restore.snapshot(client,restore.BACKUP_BUCKET)
        seen={}
        def viewer(path,key,content_type):
            seen[key]=Path(path).read_bytes()
            return fake_viewer(path,key,content_type)
        result=self.run_restore(client,count=None,snapshot_id=old,viewer=viewer)
        self.assertEqual(result['expected'],2)
        self.assertEqual((result['restored'],result['failed']),(2,0))
        self.assertEqual(seen,{'private-owner/one.pdf':b'old-good','private-owner/two.docx':b'old-word'})
        self.assertEqual(restore.snapshot(client,restore.BACKUP_BUCKET),before)
        self.assertTrue(result['backup_unchanged'] and result['cleanup_success'])
        self.assertTrue(all(bucket==TARGET for _,bucket in client.writes))

    def test_new_destination_requires_snapshot_and_never_falls_back_to_legacy(self):
        client=Client()
        self.assertGreater(len(restore.snapshot(client,restore.BACKUP_BUCKET)),2)
        with self.assertRaisesRegex(ValueError,'snapshot ID is required'):
            self.run_restore(client,snapshot_id=None)
        with self.assertRaisesRegex(ValueError,'snapshot ID is required'):
            restore.cleanup_previous_run(client,TARGET,2)
        self.assertEqual(client.writes,[])

    def test_partial_snapshot_is_rejected_before_creating_destination(self):
        client=Client();snapshot_id=self.make_snapshot(client)
        _,marker=restore.backup_module.snapshot_keys(snapshot_id)
        client.buckets[restore.BACKUP_BUCKET].pop(marker)
        with self.assertRaises(Missing):self.run_restore(client,count=None,snapshot_id=snapshot_id)
        self.assertEqual(client.writes,[])

    def test_manifest_corruption_is_rejected_before_any_restore(self):
        client=Client();snapshot_id=self.make_snapshot(client)
        manifest,_=restore.backup_module.snapshot_keys(snapshot_id)
        client.buckets[restore.BACKUP_BUCKET][manifest]['data']+=b' '
        with self.assertRaisesRegex(ValueError,'checksum'):self.run_restore(client,count=None,snapshot_id=snapshot_id)
        self.assertEqual(client.writes,[])

    def test_wrong_selected_count_is_rejected_before_any_write(self):
        client=Client();snapshot_id=self.make_snapshot(client)
        with self.assertRaises(ValueError):self.run_restore(client,count=3,snapshot_id=snapshot_id)
        self.assertEqual(client.writes,[])

    def test_tampered_blob_is_rejected_before_bulk_restore_and_keeps_backups(self):
        client=Client();snapshot_id=self.make_snapshot(client)
        plan=restore.restore_plan(client,snapshot_id)
        blob=plan[0]['source_key'];client.buckets[restore.BACKUP_BUCKET][blob]['data']=b'x'*plan[0]['size']
        before=restore.snapshot(client,restore.BACKUP_BUCKET)
        result=self.run_restore(client,count=None,snapshot_id=snapshot_id)
        self.assertGreater(result['failed'],0);self.assertEqual(result['restored'],0)
        self.assertTrue(result['cleanup_success']);self.assertEqual(restore.snapshot(client,restore.BACKUP_BUCKET),before)

    def test_selected_snapshot_cleanup_recovery_verifies_hashes(self):
        client=Client();snapshot_id=self.make_snapshot(client)
        plan=restore.restore_plan(client,snapshot_id)
        client.buckets[TARGET]={row['key']:{'data':client.buckets[restore.BACKUP_BUCKET][row['source_key']]['data'],**row['metadata']} for row in plan}
        with redirect_stdout(StringIO()):result=restore.cleanup_previous_run(client,TARGET,snapshot_id=snapshot_id)
        self.assertTrue(result['cleanup_success'] and result['backup_unchanged'])
        self.assertNotIn(TARGET,client.buckets)

    def test_recovery_refuses_same_names_and_sizes_with_different_bytes(self):
        for snapshot_id in (SNAPSHOT_ID,'github-987-1'):
            client=Client()
            if snapshot_id != SNAPSHOT_ID:self.make_snapshot(client,snapshot_id)
            plan=restore.restore_plan(client,snapshot_id)
            client.buckets[TARGET]={row['key']:{'data':b'x'*row['size']} for row in plan}
            with self.assertRaisesRegex(ValueError,'content differs'):
                restore.cleanup_previous_run(client,TARGET,2,snapshot_id=snapshot_id)
            self.assertEqual(client.writes,[])

    def test_selected_snapshot_cannot_redirect_restore_source_to_legacy_object(self):
        client=Client();snapshot_id=self.make_snapshot(client)
        manifest_key,marker_key=restore.backup_module.snapshot_keys(snapshot_id)
        manifest=json.loads(client.buckets[restore.BACKUP_BUCKET][manifest_key]['data'])
        manifest['objects'][0]['object_key']='private-owner/one.pdf'
        raw=restore.backup_module.json_bytes(manifest)
        client.buckets[restore.BACKUP_BUCKET][manifest_key]['data']=raw
        marker=json.loads(client.buckets[restore.BACKUP_BUCKET][marker_key]['data'])
        marker['manifest_sha256']=hashlib.sha256(raw).hexdigest()
        client.buckets[restore.BACKUP_BUCKET][marker_key]['data']=restore.backup_module.json_bytes(marker)
        with self.assertRaisesRegex(ValueError,'content reference'):
            self.run_restore(client,count=None,snapshot_id=snapshot_id)
        self.assertEqual(client.writes,[])


class RestoreConfigurationTests(unittest.TestCase):
    def test_main_uses_only_backup_project_credentials_and_requires_completed_id(self):
        env={'BACKUP_ACCESS_KEY_ID':'backup-fixture-access','BACKUP_SECRET_ACCESS_KEY':'backup-fixture-secret',
             'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1','RESTORE_SNAPSHOT_ID':'github-987-1'}
        calls=[]; client=object()
        def create_client(service,**kwargs):
            calls.append((service,kwargs));return client
        boto3=types.ModuleType('boto3');boto3.client=create_client
        config=types.ModuleType('botocore.config');config.Config=lambda **kwargs:kwargs
        imports={'boto3':boto3,'botocore':types.ModuleType('botocore'),'botocore.config':config}
        success={'failed':0,'view_failed':0,'restored':2,'expected':2}
        with patch.dict(sys.modules,imports),patch.dict(restore.os.environ,env,clear=True),patch.object(restore,'restore',return_value=success) as run:
            restore.main()
            run.assert_called_once_with(client,TARGET,None,snapshot_id='github-987-1')
        self.assertEqual(calls[0][0],'s3')
        self.assertEqual(calls[0][1]['endpoint_url'],'https://ozmulwqzybhiekmolvyk.storage.supabase.co/storage/v1/s3')
        self.assertEqual(calls[0][1]['region_name'],'ap-southeast-1')
        self.assertEqual(calls[0][1]['aws_access_key_id'],'backup-fixture-access')
        self.assertEqual(calls[0][1]['aws_secret_access_key'],'backup-fixture-secret')
        for missing in ('RESTORE_SNAPSHOT_ID','BACKUP_ACCESS_KEY_ID','BACKUP_SECRET_ACCESS_KEY'):
            incomplete={**env,'TEST_ACCESS_KEY_ID':'legacy-fixture-access','TEST_SECRET_ACCESS_KEY':'legacy-fixture-secret'}
            incomplete.pop(missing);calls.clear()
            with patch.dict(sys.modules,imports),patch.dict(restore.os.environ,incomplete,clear=True),patch.object(restore,'restore') as run:
                with self.assertRaisesRegex(SystemExit,'configuration is incomplete'):restore.main()
                self.assertEqual(calls,[]);run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
