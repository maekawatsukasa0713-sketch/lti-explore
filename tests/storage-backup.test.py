import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import unittest
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
if __name__=='__main__':unittest.main()
