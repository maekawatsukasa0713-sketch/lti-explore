#!/usr/bin/env python3
"""Target-only HTTP checks with disposable test users; never use real passwords."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


backup=module('backup','tokyo-migration-backup.py')
ops=module('ops','tokyo-restore-operations.py')
BASE='https://qzowxrmrxyjifoabjryr.supabase.co'
STORAGE='https://qzowxrmrxyjifoabjryr.storage.supabase.co'
KEY='sb_publishable_pm8pMNtl8Ay3kIF_G4kfLw_IG4nb35b'
STAGE='startup'


def request(path, method='GET', token=None, body=None, headers=None, expected=(200,)):
    global STAGE
    url=path if path.startswith('https://') else BASE+path
    backup.require(urllib.parse.urlsplit(url).netloc in (urllib.parse.urlsplit(BASE).netloc,urllib.parse.urlsplit(STORAGE).netloc),'http-host')
    hdr={'apikey':KEY,'Origin':'https://explore.labtoimpact.com'}
    if token:hdr['Authorization']='Bearer '+token
    if isinstance(body,(dict,list)):
        body=json.dumps(body).encode();hdr['Content-Type']='application/json'
    hdr.update(headers or {})
    try:
        with urllib.request.urlopen(urllib.request.Request(url,data=body,headers=hdr,method=method),timeout=180) as response:
            status,response_headers,data=response.status,response.headers,response.read()
    except urllib.error.HTTPError as error:
        status,response_headers,data=error.code,error.headers,error.read()
    backup.require(status in expected,STAGE+'-http-'+str(status))
    return response_headers,data


def sqlfile(directory,env,name,query):
    (directory/name).write_text(query)
    ops.target_psql(backup,directory,env,[name])


def inventory(directory,env):
    return [json.loads(backup.sql('target',directory,env,Path(__file__).with_name(f).read_text()))
            for f in ('migration-inventory.sql','migration-auth-inventory.sql')]


def perform(directory,env):
    global STAGE
    before=inventory(directory,env)
    backup.require(before[0]['auth_users']['rows']==50,'target-baseline-users')
    unique=secrets.token_hex(5)
    schools=['migration-'+unique+'-a','migration-'+unique+'-b']
    users=[{'id':str(uuid.uuid4()),'school':schools[i//2], 'role':('student' if i!=1 else 'teacher'),
            'login':('t001' if i==1 else 's001'),'password':secrets.token_urlsafe(30)} for i in range(3)]
    for u in users:u['email']=hashlib.sha256((u['school']+'\0'+u['login']).encode()).hexdigest()+'@accounts.lti.invalid'
    literal=ops.literal
    fixture=['SET session_replication_role=replica;']
    for school in schools:
        fixture.append('INSERT INTO public.lti_schools(id,name) VALUES ('+literal(school)+",'Migration verification');")
    for u in users:
        fixture.append("INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES ('00000000-0000-0000-0000-000000000000',"+literal(u['id'])+",'authenticated','authenticated',"+literal(u['email'])+",extensions.crypt("+literal(u['password'])+",extensions.gen_salt('bf')),now(),'','','','','{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',now(),now());")
        fixture.append('INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) VALUES ('+literal(u['id'])+','+literal(u['id'])+','+literal(json.dumps({'sub':u['id'],'email':u['email'],'email_verified':True}))+",'email',now(),now());")
        fixture.append('INSERT INTO public.lti_profiles(id,school_id,role,active,name,login_id) VALUES ('+','.join(literal(u[k]) for k in ('id','school','role'))+",true,'Migration verification',"+literal(u['login'])+');')
    record_id='migration-'+unique
    fixture.append("INSERT INTO public.lti_records(kind,id,owner_id,school_id,data) VALUES ('assignments',"+literal(record_id)+','+literal(users[1]['id'])+','+literal(schools[0])+",'{\"title\":\"Migration verification\"}');")
    ids=','.join(literal(u['id']) for u in users)
    cleanup="SET session_replication_role=replica; DELETE FROM public.lti_ai_usage WHERE user_id IN ("+ids+"); DELETE FROM public.lti_records WHERE id="+literal(record_id)+"; DELETE FROM public.lti_profiles WHERE id IN ("+ids+"); SET session_replication_role=origin; DELETE FROM auth.users WHERE id IN ("+ids+"); DELETE FROM public.lti_schools WHERE id IN ("+','.join(map(literal,schools))+');'
    created=False
    file_key=users[0]['id']+'/migration-verification.pdf'
    uploaded=False
    try:
        STAGE='create-disposable-fixtures'
        sqlfile(directory,env,'fixture.sql','\n'.join(fixture));created=True
        for u in users:
            STAGE='password-login-'+u['role']
            _,data=request('/auth/v1/token?grant_type=password','POST',body={'email':u['email'],'password':u['password']})
            response=json.loads(data);backup.require(response['user']['id']==u['id'],'login-identity')
            u['token']=response['access_token']
            _,data=request('/rest/v1/rpc/lti_role','POST',u['token'],{})
            backup.require(json.loads(data)==u['role'],'role-claims')
        print('Tokyo HTTP password login and role claims: PASS; users=3',flush=True)
        STAGE='school-isolation'
        for i,u in enumerate(users):
            _,data=request('/rest/v1/lti_records?select=id&id=eq.'+record_id,token=u['token'])
            backup.require(len(json.loads(data))==(1 if i<2 else 0),'cross-school-record-access')
        print('Tokyo HTTP school isolation: PASS',flush=True)
        STAGE='private-backup-access'
        request('/storage/v1/object/authenticated/lti-migration-backups/39550057024-1/manifest.json',token=users[0]['token'],expected=(400,401,403,404))
        STAGE='tus-upload'
        data=b'%PDF-1.4\n% migration verification synthetic payload\n'+b'%'*(7*1024*1024)+b'\n%%EOF\n'
        meta={'bucketName':'lti-documents','objectName':file_key,'contentType':'application/pdf','cacheControl':'3600'}
        headers={'Tus-Resumable':'1.0.0','Upload-Length':str(len(data)),'Upload-Metadata':','.join(k+' '+base64.b64encode(v.encode()).decode() for k,v in meta.items())}
        h,_=request(STORAGE+'/storage/v1/upload/resumable','POST',users[0]['token'],b'',headers,expected=(201,))
        location=urllib.parse.urljoin(STORAGE,h['Location'])
        for offset in range(0,len(data),6*1024*1024):
            part=data[offset:offset+6*1024*1024]
            h,_=request(location,'PATCH',users[0]['token'],part,{'Tus-Resumable':'1.0.0','Upload-Offset':str(offset),'Content-Type':'application/offset+octet-stream'},expected=(204,))
            backup.require(int(h['Upload-Offset'])==offset+len(part),'tus-offset')
        uploaded=True
        STAGE='uploaded-object-read'
        _,received=request('/storage/v1/object/authenticated/lti-documents/'+file_key,token=users[0]['token'])
        backup.require(hashlib.sha256(received).digest()==hashlib.sha256(data).digest(),'tus-readback')
        request('/storage/v1/object/authenticated/lti-documents/'+file_key,token=users[2]['token'],expected=(400,401,403,404))
        print('Tokyo TUS >6MB upload, read-back and ownership isolation: PASS',flush=True)
        STAGE='research-ai-configuration'
        _,data=request('/functions/v1/research-ai','POST',users[1]['token'],{'mode':'status'})
        backup.require(json.loads(data).get('configured') is True,'ai-key-configured')
        print('Tokyo authenticated AI configuration: PASS',flush=True)
        STAGE='account-admin-gate'
        request('/functions/v1/lti-accounts','POST',users[0]['token'],{'action':'create-school','schoolId':'must-not-create','name':'must-not-create'},expected=(403,))
        print('Tokyo account administration denial for student: PASS',flush=True)
    finally:
        try:
            if created and users[0].get('token'):
                STAGE='remove-disposable-upload'
                request('/storage/v1/object/lti-documents','DELETE',users[0]['token'],{'prefixes':[file_key]})
        finally:
            if created:
                STAGE='remove-disposable-fixtures'
                sqlfile(directory,env,'cleanup.sql',cleanup)
                backup.require(inventory(directory,env)==before,'post-test-data-integrity')
                print('Original account/data inventories after fixture cleanup: PASS',flush=True)


def main():
    directory=None
    os.umask(0o077)
    try:
        backup.preflight.guard_environment(os.environ)
        config=Path(__file__).parent.parent.joinpath('supabase-config.ts').read_text()
        backup.require("const PROD_SUPABASE_URL = 'https://ozmulwqzybhiekmolvyk.supabase.co';" in config,
                       'target-must-not-be-production')
        os.environ.pop('MIGRATION_SOURCE_DB_PASSWORD')
        password=os.environ.pop('MIGRATION_TARGET_DB_PASSWORD')
        directory=Path(tempfile.mkdtemp(prefix='lti-tokyo-check-',dir=os.environ['RUNNER_TEMP']))
        ref,host=backup.preflight.ENDPOINTS['target']
        escaped=password.replace('\\','\\\\').replace(':','\\:')
        (directory/'target.pgpass').write_text(f'{host}:5432:postgres:postgres.{ref}:{escaped}\n')
        env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','DOCKER_HOST','DOCKER_CONFIG','SSL_CERT_FILE','SSL_CERT_DIR') if k in os.environ}
        perform(directory,env)
        print('Tokyo functional checks: PASS. Production cutover NOT performed.',flush=True)
        return 0
    except backup.preflight.PreflightError as error:
        print(f'Tokyo functional checks: FAIL ({error}); stage={STAGE}. Raw diagnostics suppressed.',flush=True)
        return 1
    except Exception:
        print(f'Tokyo functional checks: FAIL; stage={STAGE}. Raw diagnostics suppressed.',flush=True)
        return 1
    finally:
        if directory is not None:shutil.rmtree(directory,ignore_errors=True)


if __name__=='__main__':sys.exit(main())
