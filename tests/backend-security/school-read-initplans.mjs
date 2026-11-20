// Isolated PostgreSQL/WASM regression. All accounts, credentials and rows are synthetic.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
let networkAttempts=0;
const forbidden=()=>{networkAttempts++;throw Error('Network forbidden in offline school policy test');};
globalThis.fetch=forbidden;http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=forbidden;
const {PGlite}=await import('@electric-sql/pglite');
const readSql=async path=>(await readFile(new URL(path,import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const sha=x=>createHash('sha256').update(x).digest('hex');
const baselineText=await readSql('record-read-policy-baseline.json');
assert.equal(sha(baselineText),'1bcc6b037dff020d17495fe88664c8f5997e34754f7d81fa177476e31b539063');
const baseline=JSON.parse(baselineText);
const migration=await readSql('../../supabase/migrations/20261120044209_optimize_school_read_initplans.sql');
const rollback=await readSql('../../supabase/rollbacks/20261120044209_optimize_school_read_initplans.sql');
const db=new PGlite(),started=performance.now();
const A='POLICY-FIXTURE-A',B='POLICY-FIXTURE-B',DELETED='POLICY-FIXTURE-DELETED';
const uid=n=>'40000000-0000-4000-a000-'+String(n).padStart(12,'0');
const sid=n=>'50000000-0000-4000-a000-'+String(n).padStart(12,'0');
const defs=[['teacherA','teacher',A],['teacherA2','teacher',A],['teacherB','teacher',B],['studentA','student',A],['studentA2','student',A],['studentB','student',B],['admin','admin',null],['inactive','teacher',A,false],['passwordPending','student',A,true,true],['sessionGated','teacher',A,true,false,'2026-01-01T00:00:00Z'],['mfaTeacher','teacher',A],['mfaStudent','student',A],['nullSchool','teacher',null],['deletedSchoolTeacher','teacher',DELETED],['softDeletedActive','teacher',A],['softDeletedInactive','teacher',A,false],['unknownRole','custom',A],['noSchoolRow','student','POLICY-FIXTURE-MISSING'],['nullSchoolStudent','student',null]];
const actors=Object.fromEntries(defs.map((d,i)=>[d[0],{id:uid(i+1),role:d[1],school_id:d[2],active:d[3]??true,must_change_password:d[4]??false,session_valid_after:d[5]??'-infinity',deleted_at:d[0].startsWith('softDeleted')?'2026-01-01T00:00:00Z':null}]));
const cases=[...Object.keys(actors).map(actor=>({label:actor,actor,aal:actor==='admin'?'aal2':'aal1'})),{label:'admin-aal1',actor:'admin',aal:'aal1'},{label:'teacher-aal2',actor:'teacherA',aal:'aal2'},{label:'mfaTeacher-aal2',actor:'mfaTeacher',aal:'aal2'},{label:'mfaStudent-aal2',actor:'mfaStudent',aal:'aal2'},{label:'session-current',actor:'sessionGated',session:sid(2),aal:'aal1'},{label:'session-stale',actor:'sessionGated',session:sid(1),aal:'aal1'},{label:'session-wrong-owner',actor:'sessionGated',session:sid(3),aal:'aal1'},{label:'session-nonexistent',actor:'sessionGated',session:sid(999),aal:'aal1'},{label:'no-profile',id:uid(999),aal:'aal1'},{label:'no-auth-uid',id:'',aal:'aal1'},{label:'anon-role',actor:'teacherA',aal:'aal2',dbRole:'anon'}];
const root=()=>db.exec('reset role');
const claims=async c=>{await root();await db.query("select set_config('test.uid',$1,false),set_config('test.aal',$2,false),set_config('test.session',$3,false)",[c.id??actors[c.actor].id,c.aal,c.session??'']);await db.exec('set role '+(c.dbRole??'authenticated'));};
const digest=x=>sha(JSON.stringify(x));
const schoolPolicies=async()=>{await root();return (await db.query("select policyname,cmd,permissive,roles,qual,with_check from pg_policies where schemaname='public' and tablename='lti_schools' order by policyname")).rows;};
const snapshot=async()=>{
 await root();return {
  data:digest((await db.query("select jsonb_build_object('schools',(select jsonb_agg(to_jsonb(s)order by id)from public.lti_schools s),'profiles',(select jsonb_agg(to_jsonb(p)order by id)from public.lti_profiles p),'users',(select jsonb_agg(to_jsonb(u)order by id)from auth.users u),'sessions',(select jsonb_agg(to_jsonb(s)order by id)from auth.sessions s),'mfa',(select jsonb_agg(to_jsonb(m)order by user_id,status)from auth.mfa_factors m)) data")).rows),
  functions:digest((await db.query("select p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth') order by p.oid")).rows),
  table:digest((await db.query("select relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid='public.lti_schools'::regclass")).rows),
  columns:digest((await db.query("select a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,a.attgenerated,d.adbin from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.lti_schools'::regclass and a.attnum>0 and not a.attisdropped order by a.attnum")).rows),
  policyShape:digest((await db.query("select policyname,cmd,permissive,roles,with_check from pg_policies where schemaname='public' and tablename='lti_schools' order by policyname")).rows),
  otherPolicies:digest((await db.query("select * from pg_policies where not(schemaname='public' and tablename='lti_schools') order by schemaname,tablename,policyname")).rows)
 };
};
async function matrix(){
 const out=[];
 for(const c of cases){
  await claims(c);
  if(c.dbRole==='anon'){await assert.rejects(()=>db.query('select id from public.lti_schools'),e=>e.code==='42501');out.push({label:c.label,denied:true});continue;}
  const all=(await db.query('select id from public.lti_schools order by id')).rows,own=(await db.query('select id from public.lti_schools where id=$1',[A])).rows;
  await db.exec('begin');const updates=(await db.query('update public.lti_schools set name=name,feature_settings=feature_settings returning id')).rows.sort((a,b)=>a.id.localeCompare(b.id));await db.exec('rollback');
  await db.exec('begin');const deletes=(await db.query("delete from public.lti_schools where id like 'school-fill-%' returning id")).rows.sort((a,b)=>a.id.localeCompare(b.id));await db.exec('rollback');
  await db.exec('begin');let insert;try{insert=(await db.query("insert into public.lti_schools(id,name) values('school-probe','probe') returning id")).rows;}catch(e){assert.equal(e.code,'42501');insert='denied';}finally{await db.exec('rollback');}
  for(const query of ["update public.lti_schools set id=id","update public.lti_schools set next_student_number=next_student_number","insert into public.lti_schools(id,name,feature_settings)values('forbidden','forbidden','{}')"]){await assert.rejects(()=>db.exec(query),e=>e.code==='42501');}
  out.push({label:c.label,all,own,updates,deletes,insert});
 }await root();return out;
}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true),'session_id',current_setting('test.session',true))$$;
 create table auth.users(id uuid primary key,encrypted_password text not null default 'synthetic-credential-fingerprint');
 create table auth.sessions(id uuid,user_id uuid,created_at timestamptz);
 create table auth.mfa_factors(user_id uuid,status text);
 create table public.lti_profiles(id uuid primary key,role text not null,school_id text,active boolean not null default true,must_change_password boolean not null default false,session_valid_after timestamptz not null default '-infinity',deleted_at timestamptz);
 create table public.lti_schools(id text primary key,name text not null,next_student_number integer not null default 1,next_teacher_number integer not null default 1,deleted_at timestamptz,feature_settings jsonb not null default '{}');
 grant usage on schema public,auth to authenticated,anon;
 grant truncate,references,trigger,maintain on public.lti_schools to anon;
 grant select,delete,truncate,references,trigger,maintain on public.lti_schools to authenticated;
 grant all on public.lti_schools to service_role;
 grant insert(id,name),update(name,feature_settings)on public.lti_schools to authenticated;
 alter table public.lti_schools enable row level security;
 alter table public.lti_profiles enable row level security;
 create policy unrelated_profile_read on public.lti_profiles for select to authenticated using(id=auth.uid());`);
 for(const name of ['lti_role','lti_school']){await db.exec(baseline.access.functions.find(f=>f.name===name).definition.replace(/\r\n/g,'\n'));await db.exec('revoke all on function public.'+name+'()from public,anon,authenticated,service_role;grant execute on function public.'+name+'()to authenticated,service_role;');}
 for(const sql of baseline.supportPolicies.filter(s=>s.includes('on public.lti_schools')))await db.exec(sql);
 await db.query('insert into public.lti_schools(id,name,deleted_at)values($1,$1,null),($2,$2,null),($3,$3,$4)',[A,B,DELETED,'2026-01-01T00:00:00Z']);
 await db.exec("insert into public.lti_schools(id,name)select 'school-fill-'||g,'school-fill-'||g from generate_series(1,497)g");
 await db.query('insert into auth.users(id)select id from jsonb_to_recordset($1::jsonb)as x(id uuid)',[JSON.stringify(Object.values(actors))]);
 await db.query('insert into public.lti_profiles select id,role,school_id,active,must_change_password,session_valid_after,deleted_at from jsonb_to_recordset($1::jsonb)as x(id uuid,role text,school_id text,active boolean,must_change_password boolean,session_valid_after timestamptz,deleted_at timestamptz)',[JSON.stringify(Object.values(actors))]);
 await db.query('insert into auth.sessions values($1,$2,$3),($4,$2,$5),($6,$7,$5)',[sid(1),actors.sessionGated.id,'2025-12-31T23:59:59Z',sid(2),'2026-01-01T00:00:01Z',sid(3),actors.teacherB.id]);
 await db.query("insert into auth.mfa_factors values($1,'verified'),($2,'verified'),($3,'unverified')",[actors.mfaTeacher.id,actors.mfaStudent.id,actors.teacherA.id]);
 await db.exec('analyze public.lti_schools');
 const oldPolicies=await schoolPolicies(),immutable=await snapshot(),before=await matrix(),byLabel=Object.fromEntries(before.map(c=>[c.label,c]));
 assert.equal(byLabel.teacherA.all.length,1);assert.equal(byLabel.studentA.all.length,1);assert.equal(byLabel.admin.all.length,500);assert.equal(byLabel['admin-aal1'].all.length,0);
 for(const label of ['teacherA','studentA','inactive','passwordPending','admin-aal1','session-stale','mfaTeacher']){assert.equal(byLabel[label].updates.length,0);assert.equal(byLabel[label].deletes.length,0);assert.equal(byLabel[label].insert,'denied');}
 assert.equal(byLabel.admin.updates.length,500);assert.equal(byLabel.admin.deletes.length,497);assert(Array.isArray(byLabel.admin.insert));
 const prepared=async()=>{const out=[];for(const c of cases.filter(c=>!c.dbRole)){await claims(c);out.push({label:c.label,rows:(await db.query('execute fixture_school_generic')).rows});}await root();return out;};
 await db.exec('set plan_cache_mode=force_generic_plan;prepare fixture_school_generic as select id from public.lti_schools order by id');const preparedBefore=await prepared();
 const rejected=[];
 async function refuse(sql,direction){
  for(const [name,mutation,error]of [
   ['read_policy','alter policy school_read on public.lti_schools using(true)',/School policy/],
   ['all_check','alter policy school_admin on public.lti_schools with check(true)',/School policy/],
   ['helper','alter function public.lti_role() volatile',/Request helper/],
   ['column_acl','grant update(id)on public.lti_schools to authenticated',/School column/],
   ['table_acl','grant insert on public.lti_schools to authenticated',/School table/],
   ['rls_flags','alter table public.lti_schools disable row level security',/School table/],
   ['extra_policy','create policy unexpected_school on public.lti_schools for select to authenticated using(false)',/school policy count/]
  ]){
   await root();const state=await snapshot(),policies=await schoolPolicies();await db.exec('begin;'+mutation+';');try{await assert.rejects(()=>db.exec(sql),error,direction+'/'+name);}finally{await db.exec('rollback');}
   assert.deepEqual(await snapshot(),state);assert.deepEqual(await schoolPolicies(),policies);rejected.push(direction+'/'+name);
  }
 }
 await refuse(migration,'forward');await db.exec(migration);assert.deepEqual(await snapshot(),immutable);assert.deepEqual(await matrix(),before);assert.deepEqual(await prepared(),preparedBefore);
 const plans=[];
 for(const actor of ['teacherA','studentA','admin']){await claims({actor,aal:actor==='admin'?'aal2':'aal1'});const p=(await db.query('explain(analyze,buffers,verbose,timing off,format json)select id from public.lti_schools order by id')).rows[0]['QUERY PLAN'][0];const init=[];const walk=n=>{if(n['Parent Relationship']==='InitPlan')init.push({name:n['Subplan Name'],executions:n['Actual Loops']});for(const c of n.Plans??[])walk(c);};walk(p.Plan);assert.equal(init.length,3);assert(init.every(n=>n.executions===0||n.executions===1));plans.push({actor,executionMs:p['Execution Time'],sharedHits:p.Plan['Shared Hit Blocks'],initPlans:init});}
 await root();await refuse(rollback,'rollback');await db.exec(rollback);assert.deepEqual(await snapshot(),immutable);assert.deepEqual(await schoolPolicies(),oldPolicies);assert.deepEqual(await matrix(),before);assert.deepEqual(await prepared(),preparedBefore);await db.exec('deallocate fixture_school_generic;reset plan_cache_mode');
 assert.equal(networkAttempts,0);
 const output={completed:true,scope:'Offline 500-school fixture; no production requests or real credentials',identities:cases.length,syntheticSchools:500,visibleSetsAndWriteAuthorizationsIdentical:true,preparedIdentityComparisons:preparedBefore.length,preparedStages:3,adminAllWithCheckPreserved:true,otherCatalogAndDataPreserved:true,rollbackRestored:true,rejectedDrifts:rejected,plans,networkAttempts,sourceHashes:{migration:sha(migration),rollback:sha(rollback),baseline:sha(baselineText)},elapsedMs:Math.round(performance.now()-started)};
 const out=process.argv.indexOf('--out');if(out>=0)await writeFile(pathToFileURL(process.argv[out+1]),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
}catch(e){console.error(JSON.stringify({completed:false,error:e.code??e.name,message:e.message}));process.exitCode=1;}finally{await db.close();}
