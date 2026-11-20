// Offline profile SELECT-policy regression. All accounts are synthetic.
// UPDATE checks cover RLS target selection and column privileges only. They do
// not reproduce the production initial-password-expiry/retired-account triggers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function verifyProfileSchoolContextPhase(o) {
 const {db,root,claims,profileClaims,actors,schoolId,evaluate,expected,migrationSql,rollbackSql,statusSql,statusRollbackSql}=o;
 const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
 const catalog=async(ignoreReadExpression=false)=>{
  await root();
  return {
   policies:(await db.query("select schemaname,tablename,policyname,cmd,permissive,roles,case when $1 and tablename='lti_profiles' and policyname='profile_read' then null else qual end qual,with_check from pg_policies where schemaname='public' order by tablename,policyname",[ignoreReadExpression])).rows,
   functions:(await db.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proowner,p.proacl,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','lti_read_private') order by n.nspname,p.proname,args")).rows,
   tables:(await db.query("select relname,relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid in ('public.lti_profiles'::regclass,'public.lti_schools'::regclass,'public.lti_records'::regclass) order by relname")).rows,
   columns:(await db.query("select attname,atttypid,attgenerated,attcollation,attacl from pg_attribute where attrelid='public.lti_profiles'::regclass and attnum>0 and not attisdropped order by attnum")).rows,
   triggers:(await db.query("select tgname,tgenabled,pg_get_triggerdef(oid) def from pg_trigger where tgrelid='public.lti_profiles'::regclass and not tgisinternal order by tgname")).rows,
   privateSchema:(await db.query("select nspowner,nspacl from pg_namespace where nspname='lti_read_private'")).rows,
   profiles:(await db.query('select to_jsonb(p) row from public.lti_profiles p order by id')).rows,
   schools:(await db.query('select to_jsonb(s) row from public.lti_schools s order by id')).rows,
   records:(await db.query('select kind,id,owner_id,data,version from public.lti_records order by kind,id')).rows,
   users:(await db.query('select id from auth.users order by id')).rows,
   sessions:(await db.query('select to_jsonb(s) row from auth.sessions s order by id')).rows,
   mfa:(await db.query('select to_jsonb(f) row from auth.mfa_factors f order by user_id,status')).rows
  };
 };
 const callerState=await catalog();
 const priorSettings=(await db.query('select feature_settings,feature_settings is null sql_null from public.lti_schools where id=$1',[schoolId])).rows[0];
 const restoreSettings=async()=>{await root();await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[priorSettings.sql_null?null:JSON.stringify(priorSettings.feature_settings),schoolId]);};
 const oldMd5='884447102dafcb3a5a16a0268453bd74',newMd5='47d00db4952ec9d6df0e30598250e3cc';
 const policyHash=async()=>{await root();return (await db.query("select md5(qual) md5 from pg_policies where schemaname='public' and tablename='lti_profiles' and policyname='profile_read'")).rows[0].md5;};
 assert.equal(await policyHash(),oldMd5);
 const current=callerState.profiles.length;
 assert(current<497);
 const extraCount=500-current;
 const extras=Array.from({length:extraCount},(_,i)=>({id:'70000000-0000-4000-b000-'+String(i+1).padStart(12,'0'),role:'student',school_id:i===extraCount-1?'POLICY-FIXTURE-B':schoolId,active:i!==extraCount-2}));
 const ids=extras.map(p=>p.id);
 const cases=[...profileClaims,{label:'tail-school-a',id:extras.at(-3).id,aal:'aal1'},{label:'extra-inactive-own',id:extras.at(-2).id,aal:'aal1'},{label:'tail-school-b',id:extras.at(-1).id,aal:'aal1'}];
 const visible=async c=>{
  await claims(c);
  try {
   const id=c.id??actors[c.actor].id;
   return {label:c.label,all:(await db.query('select id from public.lti_profiles order by id')).rows.map(r=>r.id),school:(await db.query('select id from public.lti_profiles where school_id=$1 order by id',[schoolId])).rows.map(r=>r.id),own:(await db.query('select id from public.lti_profiles where id=$1::uuid order by id',[id||null])).rows.map(r=>r.id)};
  } catch(e) {if(c.dbRole==='anon'&&e.code==='42501')return {label:c.label,permissionDenied:true};throw e;}
 };
 const collect=async()=>{const rows=[];for(const c of cases)rows.push(await visible(c));await root();return rows;};
 const preparedLabels=cases.map(c=>c.label);
 const schoolMatrix=async()=>{
  const output=[];
  for(const c of cases){
   await claims(c);
   if(c.dbRole==='anon'){await assert.rejects(()=>db.query('select id from public.lti_schools'),e=>e.code==='42501');output.push({label:c.label,permissionDenied:true});continue;}
   const all=(await db.query('select id from public.lti_schools order by id')).rows.map(r=>r.id),own=(await db.query('select id from public.lti_schools where id=$1 order by id',[schoolId])).rows.map(r=>r.id);
   await db.exec('begin');const updates=(await db.query('update public.lti_schools set name=name,feature_settings=feature_settings returning id')).rows.map(r=>r.id).sort();await db.exec('rollback');
   await db.exec('begin');const deletes=(await db.query("delete from public.lti_schools where id like 'school-fill-%' returning id")).rows.map(r=>r.id).sort();await db.exec('rollback');
   await db.exec('begin');let insert;try{insert=(await db.query("insert into public.lti_schools(id,name)values('school-probe','probe')returning id")).rows.map(r=>r.id);}catch(error){assert.equal(error.code,'42501');insert='denied';}finally{await db.exec('rollback');}
   for(const sql of ['update public.lti_schools set id=id','update public.lti_schools set next_student_number=next_student_number',"insert into public.lti_schools(id,name,feature_settings)values('forbidden','forbidden','{}')"])await assert.rejects(()=>db.exec(sql),e=>e.code==='42501');
   output.push({label:c.label,all,own,updates,deletes,insert});
  }
  await root();return output;
 };
 let schoolExpected;
 const quote=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
 const preparedRead=async byLabel=>{
  const output=[];
  for(const c of cases){
   await claims(c);const id=c.id??actors[c.actor].id,result={label:c.label};
   for(const [name,sql,want]of [
    ['all','execute fixture_profile_read_claims',byLabel[c.label]],
    ['school','execute fixture_profile_read_school('+quote(schoolId)+')',byLabel[c.label]],
    ['own','execute fixture_profile_read_own('+quote(id||null)+'::uuid)',byLabel[c.label]],
    ['schools','execute fixture_school_all',schoolExpected[c.label]],
    ['schoolOwn','execute fixture_school_own('+quote(schoolId)+')',schoolExpected[c.label]]
   ]){
    if(want.permissionDenied){await assert.rejects(()=>db.query(sql),e=>e.code==='42501');result[name]='denied';}
    else{const visible=(await db.query(sql)).rows.map(r=>r.id);assert.deepEqual(visible,want[name==='schools'?'all':name==='schoolOwn'?'own':name],c.label+'/'+name);result[name]=hash(visible);}
   }
   output.push(result);
  }
  await root();return output;
 };
 const measurePlans=async tag=>{
  const output=[];
  for(const label of ['session-current','studentA','admin']){
   const c=cases.find(c=>c.label===label);await claims(c);const id=c.id??actors[c.actor].id;
   for(const [shape,sql,params]of [['profiles-all','select id from public.lti_profiles order by id',[]],['profiles-own','select id from public.lti_profiles where id=$1::uuid order by id',[id]],['schools-all','select id from public.lti_schools order by id',[]],['schools-own','select id from public.lti_schools where id=$1 order by id',[schoolId]]]){
    const plan=(await db.query('explain(analyze,buffers,verbose,timing off,format json) '+sql,params)).rows[0]['QUERY PLAN'][0];
    const nodes=[];const visit=n=>{nodes.push(n);for(const child of n.Plans??[])visit(child);};visit(plan.Plan);
    output.push({tag,label,shape,executionMs:plan['Execution Time'],sharedHits:plan.Plan['Shared Hit Blocks'],sharedReads:plan.Plan['Shared Read Blocks'],producers:nodes.filter(n=>n['Parent Relationship']==='InitPlan').map(n=>({name:n['Subplan Name'],loops:n['Actual Loops'],output:n.Output})),cteScans:nodes.filter(n=>n['Node Type']==='CTE Scan').map(n=>({name:n['CTE Name'],loops:n['Actual Loops']}))});
   }
  }
  await root();return output;
 };
 const updateTargets=async()=>{
  const tests=[
   ['teacher-self','teacherA','teacherA',1],['teacher-visible-other','teacherA','studentA2',0],['teacher-other-school','teacherA','studentB',0],
   ['student-self','studentA','studentA',1],['student-visible-teacher','studentA','teacherA',0],['student-classmate','studentA','studentA2',0],
   ['admin-self','admin','admin',1],['admin-visible-other','admin','teacherB',0]
  ];
  const results=[];
  for(const [label,actor,target,count] of tests){
   await claims({actor,aal:actor==='admin'?'aal2':'aal1'});await db.exec('begin');
   try{const rows=(await db.query('update public.lti_profiles set name=$1 where id=$2::uuid returning id,name',['synthetic-edit',actors[target].id])).rows;assert.equal(rows.length,count,label);if(count)assert.deepEqual(rows,[{id:actors[target].id,name:'synthetic-edit'}]);results.push({label,rows});}finally{await db.exec('rollback');}
  }
  await claims({actor:'teacherA',aal:'aal1'});
  for(const column of ['id','role','school_id','active','must_change_password','session_valid_after','deleted_at'])await assert.rejects(()=>db.query('update public.lti_profiles set '+column+'='+column+' where id=$1::uuid',[actors.teacherA.id]),e=>e.code==='42501','Managed profile column must remain non-updatable: '+column);
  await root();return results;
 };
 const refusals=[];
 const refuse=async(sql,direction)=>{
  for(const test of [
   {name:'profile_read',sql:'alter policy profile_read on public.lti_profiles using(false)',error:/profile_read.*drifted/i},
   {name:'profile_self_update',sql:'alter policy profile_self_update on public.lti_profiles with check(false)',error:/profile_self_update.*drifted/i},
   {name:'role_helper',sql:'alter function public.lti_role() volatile',error:/lti_role.*drifted/i},
   {name:'auth_uid_stability',sql:'alter function auth.uid() volatile',error:/auth\.uid|auth.*helper|auth.*function|auth.*builtin/i},
   {name:'school_read',sql:'alter policy school_read on public.lti_schools using(false)',error:/School policy.*drifted/},
   {name:'school_admin_using',sql:'alter policy school_admin on public.lti_schools using(false)',error:/School policy.*drifted/},
   {name:'school_admin_check',sql:'alter policy school_admin on public.lti_schools with check(false)',error:/School policy.*drifted/},
   {name:'extra_profile_policy',sql:'create policy unexpected_profile on public.lti_profiles for select to authenticated using(false)',error:/profile policy set/i},
   {name:'extra_school_policy',sql:'create policy unexpected_school on public.lti_schools for select to authenticated using(false)',error:/school policy count/i},
   {name:'profile_column_acl',sql:'grant update(role)on public.lti_profiles to authenticated',error:/Profile editable column/},
   {name:'school_column_acl',sql:'grant update(id)on public.lti_schools to authenticated',error:/School column/},
   {name:'profile_rls',sql:'alter table public.lti_profiles disable row level security',error:/Profile table/},
   {name:'school_rls',sql:'alter table public.lti_schools disable row level security',error:/School table/},
   {name:'profile_table_acl',sql:'grant select on public.lti_profiles to anon',error:/Profile table/},
   {name:'school_table_acl',sql:'grant select on public.lti_schools to anon',error:/School table/},
   {name:'helper_acl',sql:'grant execute on function public.lti_school()to anon',error:/helper.*drifted/i},
   {name:'helper_security',sql:'alter function public.lti_role()security invoker',error:/helper.*drifted/i}
  ]){
   const before=await catalog();await db.exec('begin;'+test.sql+';');
   try{await assert.rejects(()=>db.exec(sql),test.error,direction+'/'+test.name);}finally{await db.exec('rollback');}
   assert.deepEqual(await catalog(),before);refusals.push(direction+'/'+test.name);
  }
 };
 let statusApplied=false,inserted=false,prepared=false,profileApplied=false;
 try {
  /* The caller fixture already has generated status and V5 profile policies. */
  await db.query('insert into auth.users select id from jsonb_to_recordset($1::jsonb) as x(id uuid)',[JSON.stringify(extras)]);
  await db.query('insert into public.lti_profiles(id,role,school_id,active) select id,role,school_id,active from jsonb_to_recordset($1::jsonb) as x(id uuid,role text,school_id text,active boolean)',[JSON.stringify(extras)]);inserted=true;
  await db.exec('analyze public.lti_profiles');
  const allProfiles=(await db.query('select id,role,school_id,active from public.lti_profiles order by id')).rows;
  assert.equal(allProfiles.length,500);
  const grants=(await db.query("select has_table_privilege('authenticated','public.lti_profiles','UPDATE') table_update,array(select attname from pg_attribute where attrelid='public.lti_profiles'::regclass and attnum>0 and not attisdropped and has_column_privilege('authenticated',attrelid,attname,'UPDATE') order by attname) update_columns")).rows[0];
  assert.deepEqual(grants,{table_update:false,update_columns:['class','dept','name','theme']});
  const before=await collect(),byLabel=Object.fromEntries(before.map(r=>[r.label,r]));
  const sameSchool=allProfiles.filter(p=>p.school_id===schoolId).map(p=>p.id);
  assert.equal(sameSchool.length,492);
  assert.deepEqual(byLabel.teacherA.all,sameSchool);assert.deepEqual(byLabel.teacherA2.all,sameSchool);
  const studentExpected=id=>allProfiles.filter(p=>p.id===id||p.school_id===schoolId&&p.role==='teacher'&&p.active).map(p=>p.id);
  assert.deepEqual(byLabel.studentA.all,studentExpected(actors.studentA.id));assert.deepEqual(byLabel['tail-school-a'].all,studentExpected(extras.at(-3).id));
  for(const label of ['inactive','passwordPending','admin-aal1','session-stale','mfaTeacher','mfaStudent','extra-inactive-own'])assert.deepEqual(byLabel[label].all,byLabel[label].own,'Blocked caller retains their own profile: '+label);
  assert.equal(byLabel.admin.all.length,500);assert.equal(byLabel['no-profile'].all.length,0);assert.equal(byLabel['no-auth-uid'].all.length,0);assert(byLabel['anon-role'].permissionDenied);
  const writesBefore=await updateTargets();const schoolBefore=await schoolMatrix();schoolExpected=Object.fromEntries(schoolBefore.map(c=>[c.label,c]));const beforePlans=await measurePlans('before');
  const immutable=await catalog(true);
  await claims(cases.find(c=>c.label==='teacherA'));await db.exec('set plan_cache_mode=force_generic_plan;prepare fixture_profile_read_claims as select id from public.lti_profiles order by id;prepare fixture_profile_read_school(text)as select id from public.lti_profiles where school_id=$1 order by id;prepare fixture_profile_read_own(uuid)as select id from public.lti_profiles where id=$1 order by id;prepare fixture_school_all as select id from public.lti_schools order by id;prepare fixture_school_own(text)as select id from public.lti_schools where id=$1 order by id');prepared=true;
  const preparedBefore=await preparedRead(byLabel);
  await refuse(migrationSql,'forward');await db.exec(migrationSql);profileApplied=true;
  assert.equal(await policyHash(),newMd5);assert.deepEqual(await catalog(true),immutable,'Only profile_read expression may change');
  assert.deepEqual(await collect(),before,'All 33 identities retain the exact full/school/own visible profile sets');
  assert.deepEqual(await preparedRead(byLabel),preparedBefore,'Prepared profile SELECT must use fresh claims across forward ALTER');
  assert.deepEqual(await updateTargets(),writesBefore,'Column-only UPDATE/RETURNING target rows must remain identical');assert.deepEqual(await schoolMatrix(),schoolBefore,'School SELECT/UPDATE/INSERT/DELETE authorization outcomes must remain identical');
  const plans=await measurePlans('after');
  for(const plan of plans){
   assert(plan.producers.every(p=>p.loops===0||p.loops===1));
   if(plan.shape==='profiles-own')assert(plan.producers.filter(p=>p.name!=='InitPlan 1').every(p=>p.loops===0),'Own-profile UID fast path must skip both role/school CTE producers');
   if(plan.shape==='profiles-all'){assert.equal(plan.producers.filter(p=>p.name==='CTE caller_role').length,1);assert.equal(plan.producers.filter(p=>p.name==='CTE caller').length,1);}
   if(plan.shape.startsWith('schools-')){assert.equal(plan.producers.length,3,'School policies stay unchanged');if(plan.label==='admin')assert(plan.producers.filter(p=>p.output.some(text=>text.includes('lti_school()'))).every(p=>p.loops===0),'Admin school reads must retain their existing school-helper short circuit');}
  }
  for(const label of ['session-current','studentA'])assert(plans.find(p=>p.label===label&&p.shape==='profiles-all').sharedHits<beforePlans.find(p=>p.label===label&&p.shape==='profiles-all').sharedHits);
  assert(plans.find(p=>p.label==='admin'&&p.shape==='profiles-all').sharedHits<=beforePlans.find(p=>p.label==='admin'&&p.shape==='profiles-all').sharedHits,'Cached role must skip the school helper for admins');
  assert.deepEqual(await evaluate(),expected,'Profile optimization must preserve all existing record/feature scenarios');
  await restoreSettings();assert.deepEqual(await catalog(true),immutable);
  await refuse(rollbackSql,'rollback');await db.exec(rollbackSql);profileApplied=false;
  assert.equal(await policyHash(),oldMd5);assert.deepEqual(await catalog(true),immutable);
  assert.deepEqual(await collect(),before);assert.deepEqual(await preparedRead(byLabel),preparedBefore,'Prepared SELECT must use fresh claims after rollback');
  assert.deepEqual(await updateTargets(),writesBefore);assert.deepEqual(await schoolMatrix(),schoolBefore);
  await db.exec('deallocate fixture_profile_read_claims;deallocate fixture_profile_read_school;deallocate fixture_profile_read_own;deallocate fixture_school_all;deallocate fixture_school_own;reset plan_cache_mode');prepared=false;
  await db.query('delete from public.lti_profiles where id=any($1::uuid[])',[ids]);await db.query('delete from auth.users where id=any($1::uuid[])',[ids]);inserted=false;
  /* Keep the caller's generated status policy. */
  assert.deepEqual(await catalog(),callerState,'Profile rollback and cleanup restore the exact caller V5 profile and V1 school policies, helpers, ACLs, data and accounts');
  return {completed:true,syntheticProfiles:500,schoolProfiles:sameSchool.length,identities:cases.length,visibleSetsIdentical:true,matchedRecordScenarios:expected.length,preparedComparisons:preparedLabels.length,preparedStages:3,writeScope:'RLS target rows/RETURNING and editable-column privileges only; production expiry/retired trigger behavior is not simulated',updateCases:writesBefore.length,managedColumnDenials:7,columnGrants:grants,schoolIdentities:schoolBefore.length,schoolWriteOutcomesPreserved:true,preparedQueriesPerIdentity:5,beforePlans,plans,rollbackRestored:true,allOtherPoliciesHelpersAclsAndDataPreserved:true,rejectedDrifts:refusals,sourceHashes:{migration:hash(migrationSql),rollback:hash(rollbackSql)}};
 } finally {
  await root();
  if(prepared){try{await db.exec('deallocate fixture_profile_read_claims;deallocate fixture_profile_read_school;deallocate fixture_profile_read_own;deallocate fixture_school_all;deallocate fixture_school_own;reset plan_cache_mode');}catch{}}
  if(profileApplied){try{await db.exec(rollbackSql);}catch{}}
  if(inserted){await db.query('delete from public.lti_profiles where id=any($1::uuid[])',[ids]);await db.query('delete from auth.users where id=any($1::uuid[])',[ids]);}
  await restoreSettings();
  if(statusApplied){try{await db.exec(statusRollbackSql);}catch{}}
 }
}
