import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parents[1]/'scripts/backup-storage.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Missing(Exception):
    response={'Error':{'Code':'NoSuchKey'}}
class RemoteFailure(Exception):
    def __init__(self,code,status):
        self.response={'Error':{'Code':code,'Message':'SECRET PASSWORD'},'ResponseMetadata':{'HTTPStatusCode':status}}
class Memory:
    def __init__(self,items):self.items=items.copy();self.uploads=0;self.corrupt=False;self.denied=False;self.changed=False
    def get_paginator(self,_):return self
    def head_bucket(self,**_):return {}
    def paginate(self,**_):return [{'Contents':[{'Key':k,'Size':len(v),'ETag':hashlib.md5(v).hexdigest()} for k,v in self.items.items()]}]
    def get_object(self,Key,**_):
        if self.denied:raise PermissionError('denied')
        if Key not in self.items:raise Missing()
        data=self.items[Key]
        return {'Body':io.BytesIO(data),'ContentLength':len(data),'ETag':hashlib.md5(data).hexdigest(),'ContentType':'application/pdf'}
    def head_object(self,Key,**_):
        data=self.items[Key]
        return {'ETag':hashlib.md5(data).hexdigest(),'ContentLength':len(data)+int(self.changed)}
    def upload_fileobj(self,file,_bucket,key,**_):
        self.uploads+=1;self.items[key]=file.read()+(b'broken' if self.corrupt else b'')
def run(source,dest):
    with contextlib.redirect_stdout(io.StringIO()):return module.backup(source,dest,'source','backup')
class BackupTests(unittest.TestCase):
    def test_code_less_404_copies_and_verifies_new_object(self):
        for error in ({}, {'Code':None}, {'Code':''}, {'Code':'404'}):
            with self.subTest(error=error):
                class NewObject(Memory):
                    def __init__(self):super().__init__({});self.bucket_checks=0
                    def get_object(self,Key,**kwargs):
                        if Key not in self.items:
                            exc=Exception('private remote error')
                            exc.response={'Error':error,'ResponseMetadata':{'HTTPStatusCode':404}}
                            raise exc
                        return super().get_object(Key=Key,**kwargs)
                    def head_bucket(self,Bucket):
                        self.assert_bucket=Bucket;self.bucket_checks+=1
                dest=NewObject();result=run(Memory({'a':b'paper'}),dest)
                self.assertEqual(result,{'copied':1,'verified_existing':0,'failed':0,'verified_bytes':5})
                self.assertEqual(dest.items['a'],b'paper');self.assertEqual(dest.uploads,1)
                self.assertEqual(dest.bucket_checks,1);self.assertEqual(dest.assert_bucket,'backup')
    def test_missing_or_inaccessible_bucket_never_uploads(self):
        for code,status in [('NoSuchBucket',404),('AccessDenied',403),(None,404),('InternalError',500)]:
            with self.subTest(code=code,status=status):
                class BadBucket(Memory):
                    def get_object(self,**_):raise RemoteFailure(None,404)
                    def head_bucket(self,**_):raise RemoteFailure(code,status)
                dest=BadBucket({});out=io.StringIO()
                with contextlib.redirect_stdout(out):result=module.backup(Memory({'a':b'paper'}),dest,'source','backup')
                self.assertEqual(result['failed'],1);self.assertEqual(dest.uploads,0)
                self.assertIn('verify_backup_bucket',out.getvalue())
    def test_other_read_failures_never_upload_or_check_bucket(self):
        for code,status in [(None,403),(None,500),('AccessDenied',404),('NoSuchBucket',404),('NoSuchKey',500)]:
            with self.subTest(code=code,status=status):
                class BadRead(Memory):
                    def get_object(self,**_):raise RemoteFailure(code,status)
                    def head_bucket(self,**_):raise AssertionError('must not check bucket')
                dest=BadRead({});result=run(Memory({'a':b'paper'}),dest)
                self.assertEqual(result['failed'],1);self.assertEqual(dest.uploads,0)
    def test_code_less_404_still_rejects_corrupt_upload(self):
        class Corrupt(Memory):
            def get_object(self,Key,**kwargs):
                if Key not in self.items:raise RemoteFailure(None,404)
                return super().get_object(Key=Key,**kwargs)
        dest=Corrupt({});dest.corrupt=True
        result=run(Memory({'a':b'paper'}),dest)
        self.assertEqual(result['failed'],1);self.assertEqual(result['verified_bytes'],0)
    def test_error_diagnostics_are_safe_and_identify_operation(self):
        details=module.failure_details(RemoteFailure('AccessDenied',403),'read_backup','private/student/paper.pdf')
        self.assertEqual(details['code'],'AccessDenied');self.assertEqual(details['http_status'],403)
        self.assertEqual(details['operation'],'read_backup')
        self.assertEqual(details['object_sha256'],hashlib.sha256(b'private/student/paper.pdf').hexdigest())
        text=str(details);self.assertNotIn('SECRET',text);self.assertNotIn('private/student',text)
        self.assertIsNone(module.failure_details(RemoteFailure('SECRET\nPASSWORD',403),'read_backup','a')['code'])
    def test_remote_denial_is_logged_and_never_copied(self):
        class Denied(Memory):
            def get_object(self,**_):raise RemoteFailure('AccessDenied',403)
        dest=Denied({});out=io.StringIO()
        with contextlib.redirect_stdout(out):result=module.backup(Memory({'a':b'paper'}),dest,'source','backup')
        self.assertEqual(result['failed'],1);self.assertEqual(dest.uploads,0)
        self.assertIn('read_backup',out.getvalue());self.assertIn('AccessDenied',out.getvalue())
        self.assertNotIn('SECRET PASSWORD',out.getvalue())
    def test_upload_failure_has_correct_stage(self):
        class UploadDenied(Memory):
            def upload_fileobj(self,*args,**kwargs):raise RemoteFailure('NotImplemented',501)
        out=io.StringIO()
        with contextlib.redirect_stdout(out):result=module.backup(Memory({'a':b'paper'}),UploadDenied({}),'source','backup')
        self.assertEqual(result['failed'],1);self.assertIn('upload_backup',out.getvalue())
    def test_equal_verified_without_overwrite(self):
        source=Memory({'a':b'paper'});dest=Memory(source.items)
        result=run(source,dest);self.assertEqual(result['verified_existing'],1);self.assertEqual(dest.uploads,0);self.assertEqual(result['failed'],0)
    def test_same_size_changes_and_new_files_copy_orphans_remain(self):
        source=Memory({'a':b'new','b':b'paper'});dest=Memory({'a':b'old','retained':b'backup'})
        self.assertEqual(run(source,dest)['copied'],2);self.assertEqual(dest.items['a'],b'new');self.assertIn('retained',dest.items)
    def test_corrupt_upload_fails(self):
        dest=Memory({});dest.corrupt=True;self.assertEqual(run(Memory({'a':b'paper'}),dest)['failed'],1)
    def test_permission_error_never_overwrites(self):
        dest=Memory({});dest.denied=True;self.assertEqual(run(Memory({'a':b'paper'}),dest)['failed'],1);self.assertEqual(dest.uploads,0)
    def test_changed_source_fails(self):
        source=Memory({'a':b'paper'});source.changed=True;self.assertEqual(run(source,Memory({}))['failed'],1)

class ClientConfigurationTests(unittest.TestCase):
    def configured_backup(self, regions, missing_credential=None):
        # Exercise main and the byte-verifying copy with in-memory S3 clients.
        # Isolate the environment so no real credentials or network are used.
        env={
            'PROD_ENDPOINT':'https://production.example/storage/v1/s3',
            'STAGING_ENDPOINT':'https://staging.example/storage/v1/s3',
            'PROD_ACCESS_KEY_ID':'prod-access',
            'PROD_SECRET_ACCESS_KEY':'prod-secret',
            'STAGING_ACCESS_KEY_ID':'test-access',
            'STAGING_SECRET_ACCESS_KEY':'test-secret',
            'SOURCE_BUCKET':'source',
            'BACKUP_BUCKET':'backup',
            **regions,
        }
        if missing_credential:
            env.pop(missing_credential)
        source=Memory({'a':b'paper'});dest=Memory({});calls=[]
        def client(service, **kwargs):
            calls.append({'service':service,**kwargs})
            return source if len(calls)==1 else dest
        boto3=types.ModuleType('boto3');boto3.client=client
        config=types.ModuleType('botocore.config');config.Config=lambda **kwargs:kwargs
        imports={'boto3':boto3,'botocore':types.ModuleType('botocore'),'botocore.config':config}
        with patch.dict(sys.modules,imports),patch.dict(module.os.environ,env,clear=True),contextlib.redirect_stdout(io.StringIO()) as output:
            if missing_credential:
                with self.assertRaisesRegex(SystemExit,'credentials are incomplete'):
                    module.main()
                self.assertEqual(calls,[])
            else:
                module.main()
                self.assertEqual(source.items,{'a':b'paper'})
                self.assertEqual(dest.items,source.items)
                self.assertEqual(dest.uploads,1)
                self.assertIn('"failed": 0',output.getvalue())
                self.assertIn('"verified_bytes": 5',output.getvalue())
        self.assertNotIn('prod-secret',output.getvalue())
        self.assertNotIn('test-secret',output.getvalue())
        return calls

    def test_tokyo_source_and_singapore_backup_have_independent_regions(self):
        source,dest=self.configured_backup({'PROD_AWS_REGION':'ap-northeast-1','TEST_AWS_REGION':'ap-southeast-1','AWS_REGION':'us-east-1'})
        self.assertEqual(source['region_name'],'ap-northeast-1')
        self.assertEqual(dest['region_name'],'ap-southeast-1')
        self.assertEqual(source['endpoint_url'],'https://production.example/storage/v1/s3')
        self.assertEqual(dest['endpoint_url'],'https://staging.example/storage/v1/s3')
        self.assertEqual(source['aws_access_key_id'],'prod-access')
        self.assertEqual(dest['aws_access_key_id'],'test-access')
        self.assertEqual(source['config'],{'signature_version':'s3v4','s3':{'addressing_style':'path'}})
        self.assertEqual(dest['config'],source['config'])

    def test_legacy_shared_region_remains_supported(self):
        calls=self.configured_backup({'AWS_REGION':'eu-central-1'})
        self.assertEqual([call['region_name'] for call in calls],['eu-central-1','eu-central-1'])

    def test_individual_override_does_not_change_other_client_fallback(self):
        calls=self.configured_backup({'PROD_AWS_REGION':'ap-northeast-1','AWS_REGION':'ap-southeast-1'})
        self.assertEqual([call['region_name'] for call in calls],['ap-northeast-1','ap-southeast-1'])

    def test_missing_or_empty_regions_use_existing_workflow_region(self):
        for regions in ({},{'PROD_AWS_REGION':'','TEST_AWS_REGION':'','AWS_REGION':''}):
            with self.subTest(regions=regions):
                calls=self.configured_backup(regions)
                self.assertEqual([call['region_name'] for call in calls],['ap-southeast-1','ap-southeast-1'])

    def test_region_overrides_never_bypass_missing_credentials(self):
        self.configured_backup({'PROD_AWS_REGION':'ap-northeast-1','TEST_AWS_REGION':'ap-southeast-1'},missing_credential='PROD_SECRET_ACCESS_KEY')

if __name__=='__main__':unittest.main()
