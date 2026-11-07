// Offline guarded CTE-policy migration and durable rollback regression. All data is synthetic.
import assert from 'node:assert/strict';
import {verifyGeneratedStatusPhase} from './generated-status-phase.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

let networkAttempts=0;
const forbidden=()=>{networkAttempts++;throw Error('Network forbidden in offline policy differential test');};
globalThis.fetch=forbidden;
http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=forbidden;
const {PGlite}=await import('@electric-sql/pglite');
const own=p=>new URL(p,import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const fixtureText=await readFile(own('record-read-policy-baseline.json'),'utf8');
assert.equal(sha(fixtureText.replace(/\r\n/g,'\n')),'1bcc6b037dff020d17495fe88664c8f5997e34754f7d81fa177476e31b539063','Schema baseline changed: inspect and review before updating the pinned hash');
const {access,metadata,supportPolicies}=JSON.parse(fixtureText);
const accessText=JSON.stringify(access),metadataText=JSON.stringify(metadata);
// Keep strict function-definition fingerprints identical across LF/CRLF checkouts.
const readSql=async(url,encoding='utf8')=>(await readFile(url,encoding)).replace(/\r\n/g,'\n');
const patchText=await readSql(new URL('../../supabase/migrations/20261106041152_optimize_record_read_policy.sql',import.meta.url),'utf8');
assert.match(patchText,/ALTER POLICY record_read ON public\.lti_records/);
assert.match(patchText,/ALTER POLICY feature_read ON public\.lti_records/);
const contextSql=await readSql(new URL('../../supabase/migrations/20261106051403_optimize_record_read_context.sql',import.meta.url),'utf8');
const cteSql=await readSql(new URL('../../supabase/migrations/20261106065802_optimize_record_read_cte.sql',import.meta.url),'utf8');
const rollbackSql=await readSql(new URL('../../supabase/rollbacks/20261106065802_optimize_record_read_cte.sql',import.meta.url),'utf8');
const statusSql=await readSql(new URL('../../supabase/migrations/20261107050622_optimize_record_read_generated_status.sql',import.meta.url),'utf8');
const statusRollbackSql=await readSql(new URL('../../supabase/rollbacks/20261107050622_optimize_record_read_generated_status.sql',import.meta.url),'utf8');
const db=new PGlite(),started=performance.now();
const A='POLICY-FIXTURE-A',B='POLICY-FIXTURE-B',DELETED='POLICY-FIXTURE-DELETED';
const uid=n=>'40000000-0000-4000-a000-'+String(n).padStart(12,'0');
const sid=n=>'50000000-0000-4000-a000-'+String(n).padStart(12,'0');
const actorDefs=[
 ['teacherA','teacher',A],['teacherA2','teacher',A],['teacherB','teacher',B],
 ['studentA','student',A],['studentA2','student',A],['studentB','student',B],
 ['admin','admin',null],['inactive','teacher',A,false],['passwordPending','student',A,true,true],
 ['sessionGated','teacher',A,true,false,'2026-01-01T00:00:00Z'],
 ['mfaTeacher','teacher',A],['mfaStudent','student',A],
 ['nullSchool','teacher',null],['deletedSchoolTeacher','teacher',DELETED],
 ['softDeletedActive','teacher',A],['softDeletedInactive','teacher',A,false],
 ['unknownRole','custom',A],['noSchoolRow','student','POLICY-FIXTURE-MISSING'],['nullSchoolStudent','student',null]
];
const actors=Object.fromEntries(actorDefs.map((d,i)=>[d[0],{id:uid(i+1),label:d[0],role:d[1],school_id:d[2],active:d[3]??true,must_change_password:d[4]??false,session_valid_after:d[5]??'-infinity',deleted_at:d[0].startsWith('softDeleted')?'2026-01-01T00:00:00Z':null}]));
const rows=[];
function add(kind,label,data={},owner='teacherA') {
 const id=kind+'-'+label;
 assert(!rows.some(r=>r.kind===kind&&r.id===id));
 rows.push({kind,id,owner_id:actors[owner]?.id??owner,data:{id,...data}});
 return id;
}
const shape={corrections:[],advice:[],nextExperiments:[]};
for(const schoolId of [A,B,null,DELETED]){
 const tag=schoolId===null?'null':schoolId.slice(schoolId.lastIndexOf('-')+1);
 for(const kind of ['assignments','materials','paper_threads'])add(kind,tag,{schoolId});
 for(const student of ['studentA','studentA2','studentB']){
  for(const kind of ['submissions','feedback'])add(kind,tag+'-'+student,{schoolId,studentId:actors[student].id,result:shape,source:'ai'});
 }
 for(const status of ['公開中','下書き','審査中','',null,undefined])add('papers',tag+'-'+String(status),{schoolId,...(status===undefined?{}:{status})});
 for(const owner of ['teacherA','teacherB','studentA','studentB'])for(const kind of ['references','notes'])add(kind,tag+'-'+owner,{schoolId},owner);
}
for(const kind of ['notices','contests']){
 for(const [tag,data] of [
  ['legacy',{}],['all',{targetType:'all'}],['null-type',{targetType:null}],
  ['specific-a',{targetType:'specific',targetSchoolIds:[A]}],['specific-b',{targetType:'specific',targetSchoolIds:[B]}],
  ['specific-both',{targetType:'specific',targetSchoolIds:[A,B]}],['specific-empty',{targetType:'specific',targetSchoolIds:[]}],
  ['specific-null',{targetType:'specific',targetSchoolIds:null}],['specific-missing',{targetType:'specific'}],
  ['specific-string',{targetType:'specific',targetSchoolIds:A}],['specific-object',{targetType:'specific',targetSchoolIds:{[A]:true}}],
  ['other-type',{targetType:'other',targetSchoolIds:[A]}]
 ])add(kind,tag,data);
}
for(const [label,extra] of [
 ['manual-valid',{source:'manual',assignmentId:'assignments-A',result:shape}],
 ['manual-withdrawn-history',{source:'manual',assignmentId:'withdrawn-assignment',result:shape}],
 ['manual-no-assignment',{source:'manual',result:shape}],
 ['manual-empty-assignment',{source:'manual',assignmentId:'',result:shape}],
 ['legacy-manual',{assignmentId:'assignments-A',result:shape}],
 ['manual-invalid-result',{source:'manual',assignmentId:'assignments-A',result:{...shape,advice:['x']}}],
 ['manual-null-result',{source:'manual',assignmentId:'assignments-A',result:null}],
 ['manual-missing-result',{source:'manual',assignmentId:'assignments-A'}],
 ['ai-claim-manual',{source:'ai',assignmentId:'assignments-A',result:shape}],
 ['unknown-source',{source:'invented',result:shape}],
 ['null-source',{source:null,result:shape}],
 ['empty-source',{source:'',result:shape}]
 ])add('feedback',label,{schoolId:A,studentId:actors.studentA.id,...extra});

const profileClaims=[
 ...Object.keys(actors).map(actor=>({label:actor,actor,aal:actor==='admin'?'aal2':'aal1'})),
 {label:'admin-aal1',actor:'admin',aal:'aal1'},
 {label:'teacher-aal2',actor:'teacherA',aal:'aal2'},
 {label:'mfaTeacher-aal2',actor:'mfaTeacher',aal:'aal2'},
 {label:'mfaStudent-aal2',actor:'mfaStudent',aal:'aal2'},
 {label:'session-current',actor:'sessionGated',session:sid(2),aal:'aal1'},
 {label:'session-stale',actor:'sessionGated',session:sid(1),aal:'aal1'},
 {label:'session-wrong-owner',actor:'sessionGated',session:sid(3),aal:'aal1'},
 {label:'session-nonexistent',actor:'sessionGated',session:sid(999),aal:'aal1'},
 {label:'no-profile',id:uid(999),aal:'aal1'},
 {label:'no-auth-uid',id:'',aal:'aal1'},
 {label:'anon-role',actor:'teacherA',aal:'aal2',dbRole:'anon'}
];
const tabs=['みんなの論文','探究論文の公開申請','教材','学会・コンテスト','学術論文の検索','課題・提出物','課題配信','進捗管理','先生からのフィードバック','AI添削'];
const featureCases=[{label:'all-default',settings:{}}];
for(const tab of tabs)for(const role of ['teacher','student'])featureCases.push({label:role+'-hidden-'+tab,settings:{[role+':'+tab]:'hidden'}});
featureCases.push({label:'all-hidden',settings:Object.fromEntries(tabs.flatMap(tab=>['teacher','student'].map(role=>[role+':'+tab,'hidden'])))});
featureCases.push({label:'manual-progress-only',settings:{'teacher:AI添削':'hidden','teacher:課題配信':'hidden'}});
featureCases.push({label:'manual-ai-only',settings:{'teacher:進捗管理':'hidden'}});
featureCases.push({label:'paper-both-hidden',settings:{'teacher:みんなの論文':'hidden','teacher:探究論文の公開申請':'hidden','student:みんなの論文':'hidden'}});
featureCases.push({label:'paper-null-settings',settings:{'teacher:みんなの論文':null,'student:みんなの論文':null}});

featureCases.push(
 {label:'defensive-settings-sql-null',settings:null,sqlNull:true},
 {label:'defensive-settings-json-null',settings:null},
 {label:'defensive-settings-array',settings:[]},
 {label:'defensive-settings-string',settings:'hidden'},
 {label:'defensive-settings-number',settings:7},
 {label:'defensive-settings-boolean',settings:false},
 {label:'custom-hidden',settings:{'custom:教材':'hidden','teacher:教材':'enabled','student:教材':null}},
 {label:'typed-feature-values',settings:{'custom:教材':true,'teacher:教材':false,'student:教材':7}}
);
const scenarios=[
 ...profileClaims.map(c=>({label:c.label,claims:c,feature:featureCases[0]})),
 ...featureCases.slice(1).flatMap(f=>['teacherA','teacherB','studentA','admin','unknownRole'].map(actor=>({label:actor+'/'+f.label,claims:{actor,aal:actor==='admin'?'aal2':'aal1'},feature:f})))
];
const root=()=>db.exec('reset role');
async function claims(c){
 await root();
 await db.query("select set_config('test.uid',$1,false),set_config('test.aal',$2,false),set_config('test.session',$3,false)",[c.id??actors[c.actor].id,c.aal??'aal1',c.session??'']);
 await db.exec('set role '+(c.dbRole??'authenticated'));
}
const digest=values=>sha(JSON.stringify(values));
async function snapshot(){
 await root();
 const records=(await db.query('select kind,id,owner_id,data,version from public.lti_records order by kind,id')).rows;
 const functions=(await db.query("select p.proname,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
 const nonRead=(await db.query("select policyname,cmd,permissive,roles,qual,with_check from pg_policies where schemaname='public' and (tablename<>'lti_records' or cmd<>'SELECT') order by tablename,policyname")).rows;
 return {records:digest(records),functions:digest(functions),nonReadPolicies:digest(nonRead)};
}
async function evaluate(){
 const results=[];
 for(const scenario of scenarios){
  await root();
  await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[scenario.feature.sqlNull?null:JSON.stringify(scenario.feature.settings),A]);
  await claims(scenario.claims);
  const records=(await db.query('select kind,id from public.lti_records order by kind,id')).rows.map(r=>r.kind+':'+r.id);
  const schoolRows=(await db.query('select kind,id from public.lti_records where school_id=$1 order by kind,id',[A])).rows.map(r=>r.kind+':'+r.id);
  const jsonRows=(await db.query("select kind,id from public.lti_records where data->>'schoolId'=$1 order by kind,id",[A])).rows.map(r=>r.kind+':'+r.id);
  assert.deepEqual(schoolRows,jsonRows,'generated vs JSON school column should agree');
  results.push({label:scenario.label,records,schoolRows});
 }
 return results;
}

try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true),'session_id',current_setting('test.session',true))$$;
 create table auth.users(id uuid primary key);
 create table auth.sessions(id uuid,user_id uuid,created_at timestamptz);
 create table auth.mfa_factors(user_id uuid,status text);
 create table public.lti_profiles(id uuid primary key,role text not null,school_id text,active boolean not null default true,must_change_password boolean not null default false,session_valid_after timestamptz not null default '-infinity',deleted_at timestamptz);
 create table public.lti_schools(id text primary key,feature_settings jsonb default '{}',deleted_at timestamptz);
 grant usage on schema public,auth to authenticated,anon;
 grant select on public.lti_profiles,public.lti_schools to authenticated;
 alter table public.lti_profiles enable row level security;
 alter table public.lti_schools enable row level security;`);
 const cols=access.columns.map(c=>c.name+' '+c.type+(c.generated==='ALWAYS'?' generated always as ('+c.expression+') stored':c.default?' default '+c.default:'')+(c.nullable==='NO'?' not null':''));
 await db.exec('create table public.lti_records('+[...cols,...metadata.constraints].join(',')+');alter table public.lti_records enable row level security;grant select on public.lti_records to authenticated,anon;');
 for(const name of ['lti_role','lti_school','lti_feature_enabled','lti_record_feature_enabled','lti_read_record'])for(const f of access.functions.filter(f=>f.name===name).sort((a,b)=>a.definition.includes('record_data jsonb')-b.definition.includes('record_data jsonb')))await db.exec(f.definition+';');
 // Schema-only definitions omit ACLs. Match the existing production helper ACL
 // explicitly so the forward/rollback catalog guards are tested unchanged.
 const publicHelperSignatures=['public.lti_role()','public.lti_school()','public.lti_feature_enabled(text)','public.lti_read_record(text,uuid,text,text,jsonb)','public.lti_record_feature_enabled(text,text,boolean)','public.lti_record_feature_enabled(text,text,boolean,jsonb)'];
 for(const signature of publicHelperSignatures)await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;grant execute on function '+signature+' to authenticated,service_role;');
 for(const line of supportPolicies)await db.exec(line);
 for(const p of access.policies)await db.exec(`create policy ${p.policyname} on public.lti_records as ${p.permissive} for ${p.cmd} to authenticated`+(p.qual?' using ('+p.qual+')':'')+(p.with_check?' with check ('+p.with_check+')':''));
 await db.query('insert into public.lti_schools(id,deleted_at) values($1,null),($2,null),($3,$4)',[A,B,DELETED,'2026-01-01T00:00:00Z']);
 await db.query('insert into auth.users select id from jsonb_to_recordset($1::jsonb) as x(id uuid)',[JSON.stringify(Object.values(actors))]);
 await db.query('insert into public.lti_profiles select id,role,school_id,active,must_change_password,session_valid_after,deleted_at from jsonb_to_recordset($1::jsonb) as x(id uuid,role text,school_id text,active boolean,must_change_password boolean,session_valid_after timestamptz,deleted_at timestamptz)',[JSON.stringify(Object.values(actors))]);
 await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,$3),($4,$2,$5),($6,$7,$5)',[sid(1),actors.sessionGated.id,'2025-12-31T23:59:59Z',sid(2),'2026-01-01T00:00:01Z',sid(3),actors.teacherB.id]);
 await db.query("insert into auth.mfa_factors(user_id,status) values($1,'verified'),($2,'verified'),($3,'unverified')",[actors.mfaTeacher.id,actors.mfaStudent.id,actors.teacherA.id]);
 await db.query('insert into public.lti_records(kind,id,owner_id,data) select kind,id,owner_id,data from jsonb_to_recordset($1::jsonb) as x(kind text,id text,owner_id uuid,data jsonb)',[JSON.stringify(rows)]);
 await root();await db.exec(patchText);

 await root();await db.exec(contextSql);
 const privateBoundaryDigest=async()=>digest({schema:(await db.query("select nspowner,nspacl from pg_namespace where nspname='lti_read_private'")).rows,functions:(await db.query("select p.proname,p.proowner,p.proacl,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lti_read_private' order by p.proname")).rows});
 const privateV2=await privateBoundaryDigest();

 const catalogState=async()=>{
  await root();
  return {
   preserved:await snapshot(),
   policies:digest((await db.query("select policyname,cmd,permissive,roles,qual,with_check from pg_policies where schemaname='public' and tablename='lti_records' order by policyname")).rows),
   readPolicyShape:digest((await db.query("select policyname,cmd,permissive,roles,with_check from pg_policies where schemaname='public' and tablename='lti_records' and cmd='SELECT' order by policyname")).rows),
   relation:digest((await db.query("select relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid='public.lti_records'::regclass")).rows),
   helpers:digest((await db.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proowner,p.proacl,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','lti_read_private') order by n.nspname,p.proname,args")).rows),
   privateSchema:digest((await db.query("select nspowner,nspacl from pg_namespace where nspname='lti_read_private'")).rows),
   fixtureAccounts:digest({profiles:(await db.query('select to_jsonb(p) row from public.lti_profiles p order by id')).rows,schools:(await db.query('select to_jsonb(s) row from public.lti_schools s order by id')).rows,users:(await db.query('select id from auth.users order by id')).rows,sessions:(await db.query('select to_jsonb(s) row from auth.sessions s order by id')).rows,mfa:(await db.query('select to_jsonb(f) row from auth.mfa_factors f order by user_id,status')).rows})
  };
 };
 const withoutPolicyExpressions=({policies,...rest})=>rest;
 const rejectedDrifts=[];
 const checkDriftRefusal=async(sql,direction)=>{
  for(const test of [
   {name:'read_policy',mutation:'alter policy record_read on public.lti_records using(false)',error:/Policy record_read drifted/},
   {name:'private_helper',mutation:'alter function lti_read_private.record_allowed(text,uuid,text,text,jsonb,jsonb) volatile',error:/Private helper .* drifted/},
   {name:'non_read_policy',mutation:'alter policy record_delete on public.lti_records using(false)',error:/Policy record_delete drifted/}
  ]){
   const before=await catalogState();
   await db.exec('begin;'+test.mutation+';');
   await assert.rejects(()=>db.exec(sql),test.error,direction+': '+test.name);
   await db.exec('rollback');
   assert.deepEqual(await catalogState(),before,'Rejected drift must leave no partial migration/restore: '+direction+'/'+test.name);
   rejectedDrifts.push(direction+'/'+test.name);
  }
 };
 const v2Catalog=await catalogState();

 const preservedBefore=await snapshot();
 console.log(JSON.stringify({phase:'baseline',scenarios:scenarios.length,syntheticRows:rows.length,networkAttempts}));
 const before=await evaluate();
 const byLabel=Object.fromEntries(before.map(r=>[r.label,r]));
 const emptyLabels=['inactive','passwordPending','sessionGated','mfaTeacher','mfaStudent','admin-aal1','session-stale','session-wrong-owner','session-nonexistent','no-profile','no-auth-uid','anon-role'];
 for(const label of emptyLabels)assert.equal(byLabel[label].records.length,0,'baseline gate '+label);
 for(const label of ['session-current','mfaTeacher-aal2','mfaStudent-aal2','nullSchool','nullSchoolStudent'])assert(byLabel[label].records.length>0,'baseline positive gate '+label);
 assert(byLabel.admin.records.length===rows.length,'MFA admin sees all record fixture rows');
 assert(byLabel.teacherA.records.includes('papers:papers-B-公開中'),'published other-school paper visible');
 assert(!byLabel.teacherA.records.includes('papers:papers-B-下書き'),'other-school draft denied');
 assert(byLabel.teacherA.records.includes('submissions:submissions-A-studentA2'),'unassigned same-school student visible');
 assert(byLabel.teacherA.records.includes('references:references-B-teacherA'),'owner reference visible despite different school metadata');
 assert(byLabel.teacherA.records.includes('notices:notices-legacy'),'legacy notice visible');
 assert(!byLabel.teacherA.records.includes('notices:notices-specific-b'),'non-targeted notice denied');
 assert(byLabel.teacherA.records.includes('feedback:feedback-manual-withdrawn-history'),'withdrawn assignment manual feedback history readable');
 assert(!byLabel.teacherA.records.includes('feedback:feedback-manual-invalid-result'),'invalid manual result denied');
 assert(byLabel.studentA.records.includes('submissions:submissions-A-studentA'),'student sees own submission');
 assert(!byLabel.studentA.records.includes('submissions:submissions-A-studentA2'),'student cannot see classmate submission');
 assert(!byLabel['teacherA/teacher-hidden-学術論文の検索'].records.some(k=>k.startsWith('references:')),'hidden references feature removes owner references');
 assert(byLabel['teacherA/manual-progress-only'].records.includes('feedback:feedback-manual-valid'),'progress-only teacher sees valid manual comment');
 assert(!byLabel['teacherA/manual-progress-only'].records.includes('feedback:feedback-A-studentA'),'progress-only teacher cannot read AI comment');
 assert(!byLabel['teacherA/manual-ai-only'].records.includes('feedback:feedback-manual-valid'),'AI-only teacher cannot read manual comment');
 assert(byLabel['teacherA/manual-ai-only'].records.includes('feedback:feedback-A-studentA'),'AI-only teacher sees AI comment');

 const preparedLabels=['teacherA','studentB','inactive','admin-aal1','admin','session-current','session-stale','mfaTeacher','mfaTeacher-aal2','teacherB'];
 const preparedRead=async()=>{
  const result=[];
  for(const label of preparedLabels){
   await claims(profileClaims.find(c=>c.label===label));
   const visible=(await db.query('execute fixture_context_generic_read')).rows.map(r=>r.kind+':'+r.id);
   assert.deepEqual(visible,byLabel[label].records,'Prepared generic statement must reevaluate identity/session/features: '+label);
   result.push({label,count:visible.length,digest:digest(visible)});
  }
  await root();return result;
 };
 await root();await db.query("update public.lti_schools set feature_settings='{}'::jsonb where id=$1",[A]);
 await claims({actor:'teacherA',aal:'aal1'});
 await db.exec('set plan_cache_mode=force_generic_plan;prepare fixture_context_generic_read as select kind,id from public.lti_records order by kind,id');
 const preparedBefore=await preparedRead();

 let result={scope:'Offline synthetic RLS differential: private context v2 versus correlated MATERIALIZED CTE policies; no live accounts, JWT signatures, network or production writes',completed:false,patchApplied:false,syntheticRows:rows.length,scenarios:scenarios.length,queriesPerPass:scenarios.length*3,networkAttempts,sourceHashes:{accessMetadata:sha(accessText),recordsMetadata:sha(metadataText)},baselineCounts:before.map(r=>({label:r.label,visible:r.records.length,schoolVisible:r.schoolRows.length,digest:digest(r)}))};
 if(patchText){

  await root();

  await checkDriftRefusal(cteSql,'forward');
  const beforeForward=await catalogState();
  await db.exec(cteSql);
  assert.deepEqual(withoutPolicyExpressions(await catalogState()),withoutPolicyExpressions(beforeForward),'Forward SQL changes only the two read-policy expressions');

  assert.equal(await privateBoundaryDigest(),privateV2,'Existing private helper bodies, owners and ACLs must not change');
  const schema=(await db.query("select has_schema_privilege('authenticated',oid,'USAGE') auth_usage,has_schema_privilege('authenticated',oid,'CREATE') auth_create,has_schema_privilege('anon',oid,'USAGE') anon_usage,has_schema_privilege('service_role',oid,'USAGE') service_usage,exists(select 1 from aclexplode(nspacl) a where a.grantee=0) public_acl from pg_namespace where nspname='lti_read_private'")).rows[0];
  assert.deepEqual(schema,{auth_usage:true,auth_create:false,anon_usage:false,service_usage:false,public_acl:false});
  const helpers=(await db.query("select p.proname,p.prosecdef,p.provolatile,l.lanname language,p.prosqlbody is not null parsed_sql_body,p.proconfig,has_function_privilege('authenticated',p.oid,'EXECUTE') auth_execute,has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0) public_acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='lti_read_private' order by p.proname")).rows;
  assert.equal(helpers.length,3);
  for(const helper of helpers){assert.equal(helper.prosecdef,false);assert.equal(helper.provolatile,helper.proname==='context'?'s':'i');assert.equal(helper.language,'plpgsql');assert.equal(helper.parsed_sql_body,false);assert.deepEqual(helper.proconfig,['search_path=""']);assert.equal(helper.auth_execute,true);assert.equal(helper.anon_execute,false);assert.equal(helper.service_execute,false);assert.equal(helper.public_acl,false);}
  for(const dbRole of ['anon','service_role']){
   await db.exec('set role '+dbRole);
   await assert.rejects(()=>db.query('select lti_read_private.context()'),e=>e.code==='42501');
   await root();
  }
  result.privateBoundary={schema,helpers,existingFunctionsAndAclsUnchanged:true};
  await root();await db.query("update public.lti_schools set feature_settings='{}'::jsonb where id=$1",[A]);
  const preparedAfter=await preparedRead();
  assert.deepEqual(preparedAfter,preparedBefore,'Same prepared query must retain authorization across policy replacement and identity switches');
  await db.exec('deallocate fixture_context_generic_read;reset plan_cache_mode');
  result.preparedGenericStatements={comparisons:preparedLabels.length,visibleSetsIdentical:true,identitySwitches:preparedAfter};
  result.existingPrivateFunctionsAndAclsPreserved=true;


  await claims({actor:'teacherA',aal:'aal1'});
  const plan=(await db.query('explain(analyze,timing off,format json) select kind,id from public.lti_records order by kind,id')).rows[0]['QUERY PLAN'][0];
  const initPlans=[],filters=[];
  const walk=node=>{if(node['Parent Relationship']==='InitPlan')initPlans.push(node);if(node.Filter)filters.push(node.Filter);for(const child of node.Plans??[])walk(child);};
  walk(plan.Plan);
  assert.equal(initPlans.length,2,'Exactly one request context per SELECT policy');
  assert(initPlans.every(p=>p['Actual Loops']===1),'Each request context executes once per statement');
  assert(filters.every(f=>!f.includes('lti_read_private.record_allowed')&&!f.includes('lti_read_private.feature_allowed')),'Row UDF calls must be removed from both policy expressions');
  await root();
  result.contextInitPlans={count:initPlans.length,executions:initPlans.map(p=>p['Actual Loops']),rowHelperCallsRemoved:true};

  const preservedAfter=await snapshot();
  assert.deepEqual(preservedAfter,preservedBefore,'Only read policies may change; no rows, helper functions, or non-read policies');
  console.log(JSON.stringify({phase:'after-patch',scenarios:scenarios.length,syntheticRows:rows.length,networkAttempts}));
  const after=await evaluate();
  assert.deepEqual(after,before,'Each actor, feature setting, full visible set and school-filtered visible set must be identical');

  result.generatedStatus=await verifyGeneratedStatusPhase({db,root,evaluate,claims,profileClaims,catalogState,withoutPolicyExpressions,expected:after,actors,schoolId:A,migrationSql:statusSql,rollbackSql:statusRollbackSql});
  console.log(JSON.stringify({phase:'generated-status',matchedScenarios:result.generatedStatus.matchedScenarios,typedStatusCases:result.generatedStatus.typedStatusCases,rollbackRestored:result.generatedStatus.rollbackRestored}));

  await checkDriftRefusal(rollbackSql,'rollback');
  // The matrix deliberately changes synthetic feature settings. Restore its
  // initial values before comparing the entire synthetic V2 catalog/data state.
  await root();await db.query("update public.lti_schools set feature_settings='{}'::jsonb where id=$1",[A]);
  const beforeRollback=await catalogState();
  await db.exec(rollbackSql);
  const restored=await catalogState();
  assert.deepEqual(withoutPolicyExpressions(restored),withoutPolicyExpressions(beforeRollback),'Rollback changes only the two read-policy expressions');
  assert.deepEqual(restored,v2Catalog,'Repository rollback restores the complete V2 policies, helper definitions/ACLs, RLS, and synthetic data');
  await claims({actor:'teacherA',aal:'aal1'});
  await db.exec('set plan_cache_mode=force_generic_plan;prepare fixture_context_generic_read as select kind,id from public.lti_records order by kind,id');
  const preparedRollback=await preparedRead();
  assert.deepEqual(preparedRollback,preparedBefore,'Restored V2 must reevaluate all ten identities/session/MFA states');
  await db.exec('deallocate fixture_context_generic_read;reset plan_cache_mode');
  assert.equal(rejectedDrifts.length,6);
  result.rollback={catalogRestored:true,preparedComparisons:preparedRollback.length,rejectedDrifts};

  assert.equal(networkAttempts,0);
  result={...result,completed:true,patchApplied:true,sourceHashes:{...result.sourceHashes,initPlanMigration:sha(patchText),v2Migration:sha(contextSql),patch:sha(cteSql),rollback:sha(rollbackSql)},matchedScenarios:after.length,visibleSetsIdentical:true,preserved:preservedAfter};
 }
 result.sqlInputLineEndings='LF';
 result.elapsedMs=Math.round(performance.now()-started);
 const outArg=process.argv.indexOf('--out');
 if(outArg>=0)await writeFile(pathToFileURL(process.argv[outArg+1]),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({completed:result.completed,patchApplied:result.patchApplied,scenarios:result.scenarios,matchedScenarios:result.matchedScenarios,syntheticRows:rows.length,elapsedMs:result.elapsedMs,networkAttempts}));
}catch(e){console.error(JSON.stringify({completed:false,error:e.code??e.name,message:e.message}));process.exitCode=1;}finally{await db.close();}
