import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db=new PGlite();
try {
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(current_setting('test.aal',true),'aal1'),'session_id',current_setting('test.session',true))$$;
create table auth.sessions(id uuid,user_id uuid,created_at timestamptz);
create table auth.mfa_factors(user_id uuid,status text);
create table public.lti_profiles(id uuid primary key,role text,school_id text,active boolean default true,must_change_password boolean default false,session_valid_after timestamptz default '-infinity');
create table public.lti_schools(id text primary key,feature_settings jsonb default '{}');
create table public.lti_records(kind text,id text,owner_id uuid default auth.uid(),data jsonb not null,
 school_id text generated always as(data->>'schoolId') stored,
 student_id text generated always as(data->>'studentId') stored,
 status text generated always as(data->>'status') stored,version integer default 1,primary key(kind,id));
create table public.lti_ai_usage(id bigint,user_id uuid,created_at timestamptz);
grant usage on schema auth,public to authenticated,anon;
grant select on public.lti_profiles,public.lti_schools to authenticated;
grant select,insert,update,delete on public.lti_records to authenticated;
alter table public.lti_profiles enable row level security;
alter table public.lti_schools enable row level security;
alter table public.lti_records enable row level security;
`);
await db.exec(await readFile(new URL('auth-defs.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('record-policy-fixture.sql',import.meta.url),'utf8'));
const teacherA='00000000-0000-4000-8000-000000000001';
const teacherA2='00000000-0000-4000-8000-000000000002';
const teacherB='00000000-0000-4000-8000-000000000003';
const studentA='00000000-0000-4000-8000-000000000004';
const studentA2='00000000-0000-4000-8000-000000000005';
const studentB='00000000-0000-4000-8000-000000000006';
const admin='00000000-0000-4000-8000-000000000007';
const session='00000000-0000-4000-8000-000000000008';
for (const [id,role,school] of [[teacherA,'teacher','A'],[teacherA2,'teacher','A'],[teacherB,'teacher','B'],[studentA,'student','A'],[studentA2,'student','A'],[studentB,'student','B'],[admin,'admin',null]]) {
 await db.query('insert into lti_profiles(id,role,school_id) values($1,$2,$3)',[id,role,school]);
}
await db.exec(`insert into lti_schools(id,feature_settings) values('A','{"teacher:AI添削":"hidden"}'),('B','{}')`);
const insertRaw=async(kind,id,data,owner=teacherA)=>db.query('insert into lti_records(kind,id,data,owner_id) values($1,$2,$3,$4)',[kind,id,JSON.stringify(data),owner]);
for (const [id,data] of [
 ['all',{targetType:'all'}],['legacy',{}],['A',{targetType:'specific',targetSchoolIds:['A']}],['B',{targetType:'specific',targetSchoolIds:['B']}],
 ['missing',{targetType:'specific'}],['object',{targetType:'specific',targetSchoolIds:{A:true}}],['string',{targetType:'specific',targetSchoolIds:'A'}],['unknown',{targetType:'typo'}],
]) await insertRaw('notices',id,data,admin);
await insertRaw('assignments','assignment-A',{schoolId:'A',title:'fixture A'});
await insertRaw('assignments','assignment-B',{schoolId:'B',title:'fixture B'},teacherB);
await insertRaw('submissions','assignment-A:'+studentA,{schoolId:'A',studentId:studentA,assignmentId:'assignment-A',text:'keep'},studentA);
const result={corrections:[],advice:[],nextExperiments:[]};
const manual={schoolId:'A',studentId:studentA,assignmentId:'assignment-A',source:'manual',result,note:'fixture manual',read:false};
const ai={schoolId:'A',studentId:studentA,source:'ai',result:{...result,advice:[{text:'fixture AI'}]},note:'fixture AI',read:false};
await insertRaw('feedback','legacy-manual',{...manual,source:undefined});
await insertRaw('feedback','ai-existing',ai);

// Use the actual record validator (student may change only the read flag).
const prior=await readFile(new URL('../../supabase/migrations/20260916_security_fixes.sql',import.meta.url),'utf8');
const validator=prior.slice(prior.indexOf('create or replace function public.lti_validate_record()'),prior.indexOf('create or replace function public.lti_guard_record_delete()'));
assert.ok(validator.includes('生徒は既読状態のみ変更できます'));
await db.exec(validator);
await db.exec('create trigger record_validate before insert or update on public.lti_records for each row execute function public.lti_validate_record()');

const asUser=async(uid,aal='aal1')=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.aal',$2,false)",[uid,aal]);await db.exec('set role authenticated');};
const asRoot=()=>db.exec('reset role');
const visible=async(kind)=>(await db.query('select id from lti_records where kind=$1 order by id',[kind])).rows.map(r=>r.id);
const insert=async(id,data)=>db.query("insert into lti_records(kind,id,data) values('feedback',$1,$2)",[id,JSON.stringify(data)]);
const rejectsWrite=(id,data)=>assert.rejects(()=>insert(id,data),/row-level security|宛先の生徒/);
const snapshot=async()=>JSON.stringify((await db.query('select * from lti_records order by kind,id')).rows);

await asUser(teacherB);
assert.ok((await visible('notices')).includes('A'),'baseline exposes another school notice');
await asUser(teacherA);
await rejectsWrite('before-fix',manual);
await asRoot();
const before=await snapshot();
const migration=await readFile(new URL('../../supabase/migrations/20261105101728_school_notice_and_manual_feedback_access.sql',import.meta.url),'utf8');
assert.doesNotMatch(migration,/\b(?:insert\s+into|update\s+(?:public\.|auth\.)|delete\s+from|truncate)\b/i);
await db.exec(migration);
assert.equal(await snapshot(),before,'migration changes no record data');
await db.exec(migration);
assert.equal(await snapshot(),before,'reapplying definitions is idempotent and changes no record data');

for(const user of [teacherA,studentA]) {await asUser(user);assert.deepEqual(await visible('notices'),['A','all','legacy']);}
for(const user of [teacherB,studentB]) {await asUser(user);assert.deepEqual(await visible('notices'),['B','all','legacy']);}
await asUser(admin);assert.deepEqual(await visible('notices'),[],'admin requires MFA');
await asUser(admin,'aal2');assert.equal((await visible('notices')).length,8);
await asUser('');assert.deepEqual(await visible('notices'),[]);

await asUser(teacherA);
assert.deepEqual(await visible('feedback'),['legacy-manual']);
await insert('manual-new',manual);
await rejectsWrite('ai-denied',ai);
await rejectsWrite('label-only',{...manual,assignmentId:undefined});
await rejectsWrite('missing-assignment',{...manual,assignmentId:'missing'});
await rejectsWrite('foreign-assignment',{...manual,assignmentId:'assignment-B'});
await rejectsWrite('foreign-student',{...manual,studentId:studentB});
await rejectsWrite('not-student',{...manual,studentId:teacherA});
await rejectsWrite('manual-with-ai',{...manual,result:ai.result});
await rejectsWrite('ai-with-assignment',{...manual,source:'ai'});
await rejectsWrite('legacy-with-ai',{...manual,source:undefined,result:ai.result});
await rejectsWrite('unknown-source',{...ai,source:'other'});
await assert.rejects(()=>db.query("update lti_records set data=$1 where kind='feedback' and id='manual-new'",[JSON.stringify(ai)]),/row-level security/);
await asUser(teacherA2);
assert.ok((await visible('feedback')).includes('manual-new'),'same-school other teacher access remains intentional');
assert.deepEqual(await visible('submissions'),['assignment-A:'+studentA]);
await asUser(teacherB);assert.deepEqual(await visible('feedback'),[]);assert.deepEqual(await visible('submissions'),[]);
await asUser(studentA2);assert.deepEqual(await visible('feedback'),[]);assert.deepEqual(await visible('submissions'),[]);
await asUser(studentA);assert.deepEqual(await visible('feedback'),['ai-existing','legacy-manual','manual-new']);
const replacement=await db.query("update lti_records set data=jsonb_set(data,'{text}','\"replacement\"') where kind='submissions' and id=$1 returning id,data",['assignment-A:'+studentA]);
assert.equal(replacement.rows.length,1,'student can replace their own submission without deleting it');
assert.equal(replacement.rows[0].id,'assignment-A:'+studentA);
assert.equal(replacement.rows[0].data.text,'replacement');
await db.query("update lti_records set data=jsonb_set(data,'{read}','true') where kind='feedback' and id='manual-new'");
await assert.rejects(()=>db.query("update lti_records set data=jsonb_set(data,'{note}','\"forged\"') where kind='feedback' and id='manual-new'"),/生徒は既読状態のみ/);

await asRoot();
await db.query("update lti_schools set feature_settings=$1 where id='A'",[JSON.stringify({'teacher:進捗管理':'hidden','teacher:AI添削':'enabled'})]);
await asUser(teacherA);assert.deepEqual(await visible('feedback'),['ai-existing']);
await insert('ai-new',ai);await rejectsWrite('manual-progress-hidden',manual);
await asRoot();await db.query("update lti_schools set feature_settings=$1 where id='A'",[JSON.stringify({'teacher:AI添削':'premium'})]);
await asUser(teacherA);await insert('manual-ai-premium',manual);await rejectsWrite('ai-premium',ai);
await asRoot();await db.query("update lti_schools set feature_settings=$1 where id='A'",[JSON.stringify({'teacher:進捗管理':'premium','teacher:AI添削':'hidden'})]);
await asUser(teacherA);await rejectsWrite('manual-progress-premium',manual);assert.deepEqual(await visible('feedback'),[]);
await asRoot();await db.exec("update lti_schools set feature_settings='{}' where id='A'");

// Existing active/password-change/session/MFA protections still guard both paths.
for(const patch of ['active=false','must_change_password=true',"session_valid_after=now()"]){
 await asRoot();await db.exec(`update lti_profiles set ${patch} where id='${teacherA}'`);
 await asUser(teacherA);assert.deepEqual(await visible('notices'),[]);assert.deepEqual(await visible('feedback'),[]);await rejectsWrite('blocked-'+patch,manual);
 await asRoot();await db.exec(`update lti_profiles set active=true,must_change_password=false,session_valid_after='-infinity' where id='${teacherA}'`);
}
await asRoot();await db.query('insert into auth.mfa_factors values($1,$2)',[teacherA,'verified']);
await asUser(teacherA);await rejectsWrite('mfa-required',manual);assert.deepEqual(await visible('notices'),[]);
await asUser(teacherA,'aal2');assert.deepEqual(await visible('notices'),['A','all','legacy']);await insert('manual-mfa',manual);
await asRoot();await db.query('delete from auth.mfa_factors where user_id=$1',[teacherA]);
await db.query('insert into auth.sessions values($1,$2,now()+interval \'1 minute\')',[session,teacherA]);
await db.query('update lti_profiles set session_valid_after=now() where id=$1',[teacherA]);
await db.query("select set_config('test.session',$1,false)",[session]);
await asUser(teacherA);await insert('valid-new-session',manual);

// No new function privilege is granted to anonymous callers.
await asRoot();await db.exec('set role anon');
await assert.rejects(()=>db.query("select public.lti_record_feature_enabled('feedback',null,true,'{}')"),/permission denied/);
await asRoot();await db.query('update lti_profiles set session_valid_after=\'-infinity\' where id=$1',[teacherA]);
await db.query("delete from lti_records where kind='assignments' and id='assignment-A'");
await asUser(teacherA);assert.ok((await visible('feedback')).includes('legacy-manual'),'past comments remain readable after assignment removal');
console.log('PASS: record RLS regression: school-target notices, legacy global notices, manual/AI feature separation, forged classification, same-school teacher access, recipient read-only state, active/password/session/MFA gates, no record mutation');
} finally {await db.close();}
