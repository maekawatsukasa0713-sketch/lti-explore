// Regression phase for the exact guarded SQL. The caller owns a synthetic DB.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export async function verifyCombinedRecordPhase(o){
 const {db,root,claims,profileClaims,scenarios,rows,featureCases,actors,schoolId,catalogState,withoutPolicyExpressions,expected,migrationSql,rollbackSql,statusSql,statusRollbackSql}=o;
 const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const caller=await catalogState();
 const priorSettings=(await db.query('select feature_settings,feature_settings is null sql_null from public.lti_schools where id=$1',[schoolId])).rows[0];
 const restoreSettings=async()=>{await root();await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[priorSettings.sql_null?null:JSON.stringify(priorSettings.feature_settings),schoolId]);};
 const defaults=async()=>{await root();await db.query("update public.lti_schools set feature_settings='{}'::jsonb where id=$1",[schoolId]);};
 const policyRows=async()=>{await root();return (await db.query("select policyname,cmd,permissive,roles,qual,with_check from pg_policies where schemaname='public' and tablename='lti_records' order by policyname")).rows;};
 const typed=[['published','公開中'],['null',null],['missing',undefined],['true',true],['false',false],['zero',0],['number',123.5],['array',['公開中']],['object',{state:'公開中'}]].map(([name,status])=>{const id='record-combined-status-'+name;return {id,data:{id,schoolId,...(status===undefined?{}:{status})}};});
 const ids=typed.map(x=>x.id),isTyped=x=>x.startsWith('papers:record-combined-status-');
 const evaluate=async()=>{
  const out=[];
  for(const s of scenarios){
   await root();await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[s.feature.sqlNull?null:JSON.stringify(s.feature.settings),schoolId]);await claims(s.claims);
   if(s.claims.dbRole==='anon'){await assert.rejects(()=>db.query('select kind,id from public.lti_records'),e=>e.code==='42501');out.push({label:s.label,records:[],schoolRows:[]});continue;}
   const recordRows=(await db.query('select kind,id from public.lti_records order by kind,id')).rows.map(r=>r.kind+':'+r.id);
   const schoolRows=(await db.query('select kind,id from public.lti_records where school_id=$1 order by kind,id',[schoolId])).rows.map(r=>r.kind+':'+r.id);
   const jsonRows=(await db.query("select kind,id from public.lti_records where data->>'schoolId'=$1 order by kind,id",[schoolId])).rows.map(r=>r.kind+':'+r.id);
   assert.deepEqual(schoolRows,jsonRows);out.push({label:s.label,records:recordRows,schoolRows});
  }await defaults();return out;
 };
 const writeRows=rows.filter(r=>['assignments-A','assignments-B','submissions-A-studentA','submissions-A-studentA2','submissions-B-studentB','feedback-manual-valid','feedback-manual-withdrawn-history','feedback-manual-invalid-result','papers-A-公開中','papers-B-公開中','papers-B-下書き','notes-A-teacherA','references-B-teacherA'].includes(r.id));
 assert.equal(writeRows.length,13);
 const writeScenarios=[...profileClaims.map(c=>({label:c.label,claims:c,settings:{}})),...featureCases.filter(f=>['all-hidden','manual-progress-only','manual-ai-only'].includes(f.label)).flatMap(f=>['teacherA','studentA','admin'].map(actor=>({label:actor+'/'+f.label,claims:profileClaims.find(c=>c.label===actor),settings:f.settings})))];
 const writes=async()=>{
  const out=[];
  for(const s of writeScenarios){
   await root();await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[JSON.stringify(s.settings),schoolId]);await claims(s.claims);
   const queries=writeRows.flatMap(r=>[['update',r.kind,r.id,'update public.lti_records set data=data where kind=$1 and id=$2 returning kind,id',[r.kind,r.id]],['delete',r.kind,r.id,'delete from public.lti_records where kind=$1 and id=$2 returning kind,id',[r.kind,r.id]]]);
   for(const kind of ['notes','references','papers','paper_threads','assignments','submissions','feedback','materials','notices','contests']){
    const id='record-combined-write-'+kind,data={id,schoolId,studentId:actors.studentA.id,assignmentId:'assignments-A',status:'承認待ち',source:'manual',result:{corrections:[],advice:[],nextExperiments:[]}};
    queries.push(['insert',kind,id,'insert into public.lti_records(kind,id,data)values($1,$2,$3::jsonb)returning kind,id',[kind,id,JSON.stringify(data)]]);
   }
   const outcomes=[];
   for(const [command,kind,id,sql,args]of queries){
    await db.exec('begin');let outcome;
    try{outcome={rows:(await db.query(sql,args)).rows};}catch(e){assert(['42501','23502','23503','23514'].includes(e.code),'Unexpected synthetic DML error '+e.code);outcome={error:e.code};}finally{await db.exec('rollback');}
    outcomes.push({command,kind,id,outcome});
   }out.push({label:s.label,outcomes});
  }await defaults();return out;
 };
 const preparedCases=profileClaims.filter(c=>c.dbRole!=='anon');
 const preparedRead=async()=>{const out=[];for(const c of preparedCases){await claims(c);out.push({label:c.label,rows:(await db.query('execute fixture_record_combined_claims')).rows});}await defaults();return out;};
 const rejected=[];
 const refuse=async(sql,direction)=>{
  for(const [name,mutation,error]of [
   ['record_read','alter policy record_read on public.lti_records using(false)',/Policy record_read drifted/],
   ['feature_read','alter policy feature_read on public.lti_records using(false)',/Policy feature_read drifted/],
   ['write_policy','alter policy record_delete on public.lti_records using(false)',/Policy record_delete drifted/],
   ['private_helper','alter function lti_read_private.context() volatile',/Private helper/],
   ['public_helper','alter function public.lti_role() volatile',/Existing helper/],
   ['table_acl','revoke delete on public.lti_records from authenticated',/Record table ACL/],
   ['column_acl','grant update(version)on public.lti_records to authenticated',/Record column/],
   ['status_generated','alter table public.lti_records alter column status drop expression',/Record column|Stored status/],
   ['rls_flags','alter table public.lti_records disable row level security',/Record RLS/],
   ['extra_policy','create policy extra_record_policy on public.lti_records for select to authenticated using(true)',/record policy count/],
   ['private_schema_acl','grant usage on schema lti_read_private to anon',/Private schema/]
  ]){
   await root();const state=await catalogState();await db.exec('begin;'+mutation+';');try{await assert.rejects(()=>db.exec(sql),error,direction+'/'+name);}finally{await db.exec('rollback');}
   assert.deepEqual(await catalogState(),state,'Rejected drift must be atomic');rejected.push(direction+'/'+name);
  }
 };
 let statusApplied=false,combinedApplied=false,inserted=false,privilegesChanged=false,prepared=false;
 try{
  await defaults();await db.exec(statusSql);statusApplied=true;
  // The inherited fixture originally grants anon SELECT for a zero-row RLS
  // assertion. Match the actual production ACL for these exact SQL guards;
  // the explicit anon case below now checks the production permission denial.
  await db.exec('revoke all on public.lti_records from anon,authenticated,service_role;grant truncate,references,trigger,maintain on public.lti_records to anon;grant all on public.lti_records to authenticated,service_role;');privilegesChanged=true;
  await db.query("insert into public.lti_records(kind,id,owner_id,data)select 'papers',id,$2::uuid,data from jsonb_to_recordset($1::jsonb)as x(id text,data jsonb)",[JSON.stringify(typed),actors.teacherA.id]);inserted=true;
  assert((await db.query('select status,data->>\'status\'raw from public.lti_records where id=any($1::text[])',[ids])).rows.every(r=>r.status===r.raw));
  const before=await evaluate();assert.deepEqual(before.map(r=>({...r,records:r.records.filter(x=>!isTyped(x)),schoolRows:r.schoolRows.filter(x=>!isTyped(x))})),expected,'Every original known visible set remains anchored before the new migration');
  const writesBefore=await writes(),policiesBefore=await policyRows(),fixed=await catalogState();
  await db.exec('set plan_cache_mode=force_generic_plan;prepare fixture_record_combined_claims as select kind,id from public.lti_records order by kind,id');prepared=true;const preparedBefore=await preparedRead();
  await refuse(migrationSql,'forward');await db.exec(migrationSql);combinedApplied=true;
  assert.deepEqual(withoutPolicyExpressions(await catalogState()),withoutPolicyExpressions(fixed));
  const newPolicies=await policyRows();assert.deepEqual(newPolicies.map(({qual,...p})=>p),policiesBefore.map(({qual,...p})=>p));
  assert.deepEqual(await evaluate(),before);assert.deepEqual(await writes(),writesBefore);assert.deepEqual(await preparedRead(),preparedBefore);
  await root();await db.exec('create policy future_permissive_probe on public.lti_records as permissive for select to authenticated using(true)');
  assert.deepEqual(await evaluate(),before,'A future permissive SELECT policy cannot bypass the restrictive combined gate');await root();await db.exec('drop policy future_permissive_probe on public.lti_records');
  await claims(profileClaims.find(c=>c.label==='teacherA'));
  const p=(await db.query('explain(analyze,buffers,verbose,timing off,format json)select kind,id from public.lti_records order by kind,id')).rows[0]['QUERY PLAN'][0],producers=[];
  const walk=n=>{if(n.Output?.some(x=>x.includes('lti_read_private.context()')))producers.push(n);for(const c of n.Plans??[])walk(c);};walk(p.Plan);
  assert.equal(producers.length,1);assert.equal(producers[0]['Actual Loops'],1);
  await defaults();await refuse(rollbackSql,'rollback');await db.exec(rollbackSql);combinedApplied=false;
  assert.deepEqual(await catalogState(),fixed);assert.deepEqual(await policyRows(),policiesBefore);assert.deepEqual(await evaluate(),before);assert.deepEqual(await writes(),writesBefore);assert.deepEqual(await preparedRead(),preparedBefore);
  await db.exec('deallocate fixture_record_combined_claims;reset plan_cache_mode');prepared=false;
  await db.query("delete from public.lti_records where kind='papers' and id=any($1::text[])",[ids]);inserted=false;
  await db.exec('revoke all on public.lti_records from anon,authenticated,service_role;grant select on public.lti_records to authenticated,anon;');privilegesChanged=false;
  await db.exec(statusRollbackSql);statusApplied=false;await restoreSettings();assert.deepEqual(await catalogState(),caller,'Complete caller V3 fixture must be restored');
  return {completed:true,matchedScenarios:before.length,typedStatusCases:typed.length,writeIdentityFeatureScenarios:writeScenarios.length,writeCasesPerPass:writesBefore.reduce((s,x)=>s+x.outcomes.length,0),insertUpdateDeleteOutcomesIdentical:true,preparedIdentityComparisons:preparedBefore.length,preparedStages:3,extraPermissiveCannotBypassGate:true,requestContextProducers:producers.length,producerExecutions:producers.map(x=>x['Actual Loops']),allOtherPoliciesHelpersAclsAndDataPreserved:true,rollbackRestored:true,rejectedDrifts:rejected,sourceHashes:{migration:hash(migrationSql),rollback:hash(rollbackSql)},baselineWriteDigest:digest(writesBefore)};
 }finally{
  await root();
  if(prepared){try{await db.exec('deallocate fixture_record_combined_claims;reset plan_cache_mode');}catch{}}
  if(combinedApplied){try{await db.exec(rollbackSql);}catch{}}
  if(inserted)await db.query("delete from public.lti_records where kind='papers' and id=any($1::text[])",[ids]);
  if(privilegesChanged)await db.exec('revoke all on public.lti_records from anon,authenticated,service_role;grant select on public.lti_records to authenticated,anon;');
  if(statusApplied){try{await db.exec(statusRollbackSql);}catch{}}
  await restoreSettings();
 }
}
