import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const migration=await readFile(new URL('../../supabase/backup-destination-migrations/20261105142946_backup_destination_storage_writes.sql',import.meta.url),'utf8');
const freeze=(await readFile(new URL('../../scripts/tokyo-source-freeze.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const fingerprint=await readFile(new URL('../../scripts/backup-destination-storage-fingerprint.sql',import.meta.url),'utf8');
const postflight=await readFile(new URL('../../scripts/backup-destination-storage-postflight.sql',import.meta.url),'utf8');
const targetTables=['buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts'];
const oldBucket='lti-documents', backupBucket='lti-production-backup', restoreBucket='lti-restore-check-12345-1';
const db=new PGlite();
let checks=0;
const frozen=async(sql,args=[])=>{await assert.rejects(()=>db.query(sql,args),e=>e.code==='55000');checks++;};
const unchanged=async(sql,args=[])=>{await db.query(sql,args);checks++;};
try {
 await db.exec(`
  create role anon; create role authenticated; create role storage_writer bypassrls;
  create schema auth; create schema storage;
  create type storage.buckettype as enum('STANDARD','ANALYTICS','VECTOR');
  create table auth.users(id text primary key, encrypted_password text);
  create table public.lti_profiles(id text primary key,login_id text);
  create table public.lti_records(id text primary key,data jsonb);
  create table storage.buckets(id text primary key,name text not null,public boolean default false,
    type storage.buckettype not null default 'STANDARD',versioning_status text not null default 'DISABLED',lifecycle_configuration jsonb);
  create table storage.objects(id text primary key,bucket_id text,name text,metadata jsonb);
  create table storage.s3_multipart_uploads(id text primary key,bucket_id text not null,key text not null,version text default '1',in_progress_size bigint default 0);
  create table storage.s3_multipart_uploads_parts(id text primary key,bucket_id text not null,key text not null,upload_id text,version text default '1',size bigint default 0);
  create table storage.buckets_analytics(id text primary key);
  insert into auth.users values('fixture-existing-account','fixture-credential-that-must-stay');
  insert into public.lti_profiles values('fixture-existing-account','fixture-issued-id');
  insert into public.lti_records values('fixture-existing-record','{"keep":true}');
  insert into storage.buckets(id,name) values('lti-documents','lti-documents');
  insert into storage.objects values('old-file','lti-documents','fixture-old.pdf','{"size":12}');
  insert into storage.s3_multipart_uploads(id,bucket_id,key) values('old-upload','lti-documents','old-key');
  insert into storage.s3_multipart_uploads_parts(id,bucket_id,key,upload_id) values('old-part','lti-documents','old-key','old-upload');
  grant usage on schema storage to storage_writer;
  grant select,insert,update,delete,truncate on all tables in schema storage to storage_writer;
  alter table storage.objects enable row level security;
  create policy original_documents_policy on storage.objects for select to authenticated using(bucket_id='lti-documents');
 `);
 await db.exec(freeze);
 const metadata=async()=>JSON.stringify((await db.query(`
  select 'triggers' as kind,n.nspname||'.'||c.relname||'.'||t.tgname as name,pg_get_triggerdef(t.oid) as value
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and not(n.nspname='storage' and c.relname in('buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts') and t.tgname in('lti_migration_write_freeze','lti_migration_truncate_freeze'))
  union all select 'function','reject_writes',pg_get_functiondef('lti_migration_control.reject_writes()'::regprocedure)
  union all select 'policy',schemaname||'.'||tablename||'.'||policyname,concat(roles::text,cmd,qual,with_check) from pg_policies
  union all select 'acl',n.nspname||'.'||c.relname,concat(c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('storage','public','auth') and c.relkind='r'
  order by kind,name
 `)).rows);
 const oldData=async()=>JSON.stringify((await db.query(`
   select 'auth' as kind,row_to_json(u)::text as row from auth.users u
   union all select 'profile',row_to_json(p)::text from public.lti_profiles p
   union all select 'record',row_to_json(r)::text from public.lti_records r
   union all select 'bucket',row_to_json(b)::text from storage.buckets b where id='lti-documents'
   union all select 'object',row_to_json(o)::text from storage.objects o where bucket_id='lti-documents'
   union all select 'upload',row_to_json(u)::text from storage.s3_multipart_uploads u where bucket_id='lti-documents'
   union all select 'part',row_to_json(p)::text from storage.s3_multipart_uploads_parts p where bucket_id='lti-documents'
   order by kind,row
 `)).rows);
 const beforeMetadata=await metadata(), beforeData=await oldData();
 const beforeFingerprint=(await db.query(fingerprint)).rows[0].fingerprint;
 await frozen("insert into storage.buckets(id,name) values($1,$1)",[backupBucket]);
 await db.exec('begin');
 await db.exec(migration);
 await db.exec('commit');
 await db.exec(postflight);
 const afterFingerprint=(await db.query(fingerprint)).rows[0].fingerprint;
 for(const key of Object.keys(beforeFingerprint).filter(k=>k.startsWith('preserved_')))assert.equal(afterFingerprint[key],beforeFingerprint[key],key+' must remain unchanged');
 assert.equal(beforeFingerprint.planned_storage_guards.length,4);assert.equal(afterFingerprint.planned_storage_guards.length,8);
 assert.equal(await metadata(),beforeMetadata,'other triggers, the shared reject function, policies and table ACL/RLS are unchanged');
 assert.equal(await oldData(),beforeData,'DDL does not touch stored accounts, credentials or existing records/objects');
 const guard=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',oid,'EXECUTE') as authenticated_execute,md5(prosrc) as source_md5 from pg_proc where oid='lti_migration_control.guard_backup_storage_writes()'::regprocedure")).rows[0];
 assert.equal(guard.prosecdef,false);assert.deepEqual(guard.proconfig,['search_path=pg_catalog']);assert.equal(guard.anon_execute,false);assert.equal(guard.authenticated_execute,false);

 // Trigger invocation must work for the S3 writer without a schema/EXECUTE grant
 // to lti_migration_control; those privileges are checked when attaching triggers.
 await db.exec('set role storage_writer');
 await unchanged("insert into storage.buckets(id,name) values($1,$1)",[backupBucket]);
 await unchanged("insert into storage.buckets(id,name) values($1,$1)",[restoreBucket]);
 for(const table of ['objects','s3_multipart_uploads','s3_multipart_uploads_parts']) {
  const keyColumn=table==='objects'?'name':'key';
  await unchanged(`insert into storage.${table}(id,bucket_id,${keyColumn}) values($1,$2,'fixture-new')`,[table+'-backup',backupBucket]);
  await unchanged(`insert into storage.${table}(id,bucket_id,${keyColumn}) values($1,$2,'fixture-restored')`,[table+'-restore',restoreBucket]);
  await unchanged(`update storage.${table} set ${keyColumn}='fixture-updated' where id=$1`,[table+'-backup']);
  await frozen(`update storage.${table} set bucket_id=$1 where id=$2`,[oldBucket,table+'-backup']);
  await frozen(`update storage.${table} set bucket_id=$1 where id=$2`,[restoreBucket,table+'-backup']);
  const oldId=table==='objects'?'old-file':table==='s3_multipart_uploads'?'old-upload':'old-part';
  await frozen(`update storage.${table} set bucket_id=$1 where id=$2`,[backupBucket,oldId]);
  await frozen(`update storage.${table} set ${keyColumn}='changed' where id=$1`,[oldId]);
  await frozen(`delete from storage.${table} where id=$1`,[oldId]);
  await frozen(`insert into storage.${table}(id,bucket_id,${keyColumn}) values('bad-old',$1,'changed')`,[oldBucket]);
  await frozen(`insert into storage.${table}(id,bucket_id,${keyColumn}) values('bad-other','unrelated','changed')`);
  if(table==='objects')await frozen(`insert into storage.${table}(id,bucket_id,${keyColumn}) values('bad-null',null,'changed')`);
  await unchanged(`delete from storage.${table} where id=$1`,[table+'-restore']);
 }
 for(const name of ['lti-production-backup-copy','lti-restore-check-1-x','lti-restore-check-1-1-extra','lti-restore-check-123456789012345678901-1','lti-restore-check-1-1\n','unrelated']) {
  await frozen('insert into storage.buckets(id,name) values($1,$1)',[name]);
 }
 await frozen("insert into storage.buckets(id,name,public) values('lti-restore-check-2-1','lti-restore-check-2-1',true)");
 await frozen("insert into storage.buckets(id,name,public) values('lti-restore-check-2-1','lti-restore-check-2-1',null)");
 await frozen("insert into storage.buckets(id,name) values('lti-restore-check-2-1','different-name')");
 await frozen("insert into storage.buckets(id,name,type) values('lti-restore-check-2-1','lti-restore-check-2-1','ANALYTICS')");
 await frozen("insert into storage.buckets(id,name,versioning_status) values('lti-restore-check-2-1','lti-restore-check-2-1','ENABLED')");
 await frozen("insert into storage.buckets(id,name,lifecycle_configuration) values('lti-restore-check-2-1','lti-restore-check-2-1','{}')");
 for(const value of [true,null])await frozen('update storage.buckets set public=$1 where id=$2',[value,backupBucket]);
 await frozen("update storage.buckets set id='lti-restore-check-99-1',name='lti-restore-check-99-1' where id=$1",[backupBucket]);
 await frozen("update storage.buckets set name='different' where id=$1",[backupBucket]);
 await frozen("update storage.buckets set type='ANALYTICS' where id=$1",[backupBucket]);
 await frozen("update storage.buckets set lifecycle_configuration='{}' where id=$1",[backupBucket]);
 await frozen('delete from storage.buckets where id=$1',[backupBucket]);
 await unchanged('delete from storage.buckets where id=$1',[restoreBucket]);
 for(const table of [...targetTables,'buckets_analytics'])await frozen(`truncate storage.${table}`);
 await frozen("update storage.buckets set name='changed' where id='lti-documents'");
 await frozen("delete from storage.buckets where id='lti-documents'");
 // A mixed bulk operation must roll back even its preceding allowed row.
 await frozen("insert into storage.objects(id,bucket_id,name) values('mixed-backup','lti-production-backup','allowed'),('mixed-old','lti-documents','forbidden')");
 assert.equal((await db.query("select count(*)::int as n from storage.objects where id='mixed-backup'")).rows[0].n,0);
 await db.exec('reset role');
 for(const sql of ["update auth.users set encrypted_password='changed'","delete from public.lti_profiles","update public.lti_records set data='{}'","truncate auth.users","insert into storage.buckets_analytics values('forbidden')"])await frozen(sql);
 assert.equal(await oldData(),beforeData,'existing file metadata, records, issued IDs and fixture passwords remain identical after all attempted mutations');
 assert.equal(await metadata(),beforeMetadata,'unrelated freezes, RLS and ACL remain identical after permitted backup operations');

 // Preflight fails closed if reused, namespace occupied, or old guard modified.
 await db.exec('begin');
 await assert.rejects(()=>db.exec(migration),/already exists|already occupied/);await db.exec('rollback');
 const preflight=migration.slice(0,migration.indexOf('CREATE FUNCTION lti_migration_control.guard_backup_storage_writes()'));
 async function rejectChangedPreflight(change,expected,{keepBackupBucket=false}={}) {
  await db.exec('begin');
  // Reset only this in-memory fixture to the original four statement freezes.
  await db.exec('drop function lti_migration_control.guard_backup_storage_writes() cascade');
  for(const table of targetTables)await db.exec(`drop trigger lti_migration_truncate_freeze on storage.${table}`);
  for(const table of targetTables.filter(t=>t!=='buckets'))await db.exec(`delete from storage.${table} where bucket_id<>'lti-documents'`);
  if(!keepBackupBucket)await db.exec("delete from storage.buckets where id<>'lti-documents'");
  for(const table of targetTables)await db.exec(`create trigger lti_migration_write_freeze before insert or update or delete or truncate on storage.${table} for each statement execute function lti_migration_control.reject_writes()`);
  await db.exec(change);
  await assert.rejects(()=>db.exec(preflight),expected);checks++;
  await db.exec('rollback');
 }
 await rejectChangedPreflight('alter table storage.objects disable trigger lti_migration_write_freeze',/Expected complete statement freeze/);
 await rejectChangedPreflight('drop trigger lti_migration_write_freeze on storage.objects',/Expected complete statement freeze/);
 await rejectChangedPreflight("alter table storage.buckets alter column versioning_status set default 'ENABLED'",/private-bucket default definitions changed/);
 await rejectChangedPreflight("create or replace function lti_migration_control.reject_writes() returns trigger language plpgsql set search_path=pg_catalog as $$begin return null; end;$$",/freeze definition changed/);
 await rejectChangedPreflight('select 1',/namespace is already occupied/,{keepBackupBucket:true});
 await rejectChangedPreflight('drop schema lti_migration_control cascade',/Old-project write freeze is absent/);
 assert.equal(await oldData(),beforeData);assert.equal(await metadata(),beforeMetadata);
 console.log('PASS: old-project backup-only Storage guard; '+checks+' allowed/denied cases, bulk atomicity, preserved credentials/data/RLS/ACL, and private bucket constraints');
 console.log('Backup guard source MD5: '+guard.source_md5);
} catch(error) {
 console.error(error.stack?.split('\n').slice(0,9).join('\n') || error.message);
 if(error.code)console.error('SQLSTATE: '+error.code+'; '+(error.where||''));
 process.exitCode=1;
} finally {await db.close();}
