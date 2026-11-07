// Additional phase for the existing isolated CTE fixture. No live client/network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function verifyGeneratedStatusPhase(o) {
 const {db,root,evaluate,claims,profileClaims,catalogState,withoutPolicyExpressions,expected,actors,schoolId,migrationSql,rollbackSql}=o;
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const original=await catalogState();
 const priorSettings=(await db.query('select feature_settings,feature_settings is null sql_null from public.lti_schools where id=$1',[schoolId])).rows[0];
 const setFeatures=async settings=>{await root();await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[JSON.stringify(settings),schoolId]);};
 const labels=['teacherA','studentB','inactive','admin-aal1','admin','session-current','session-stale','mfaTeacher','mfaTeacher-aal2','teacherB'];
 const defaults=Object.fromEntries(expected.map(r=>[r.label,r.records]));
 const preparedRead=async()=>{
  const rows=[];
  for(const label of labels){await claims(profileClaims.find(c=>c.label===label));const visible=(await db.query('execute fixture_generated_status_claims')).rows.map(r=>r.kind+':'+r.id);assert.deepEqual(visible,defaults[label],label);rows.push({label,hash:hash(JSON.stringify(visible))});}
  await root();return rows;
 };
 const generated=async()=>{await root();return (await db.query("select a.attgenerated,format_type(a.atttypid,a.atttypmod) type,a.attcollation=(select oid from pg_collation where collnamespace='pg_catalog'::regnamespace and collname='default') default_collation,pg_get_expr(d.adbin,d.adrelid) expression from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.lti_records'::regclass and a.attname='status' and not a.attisdropped")).rows[0];};
 const originalGenerated=await generated();
 assert.deepEqual(originalGenerated,{attgenerated:'s',type:'text',default_collation:true,expression:"(data ->> 'status'::text)"});
 const rejected=[];
 const refusal=async(sql,direction)=>{
  for(const test of [
   {name:'read_policy',mutation:'alter policy record_read on public.lti_records using(false)',error:/Policy record_read drifted/},
   {name:'private_helper',mutation:'alter function lti_read_private.context() volatile',error:/Private helper .* drifted/},
   {name:'non_read_policy',mutation:'alter policy record_delete on public.lti_records using(false)',error:/Policy record_delete drifted/},
   {name:'generated_status',mutation:'alter table public.lti_records alter column status drop expression',error:/status/i}
  ]){
   const before=await catalogState();
   await db.exec('begin;'+test.mutation+';');
   try{await assert.rejects(()=>db.exec(sql),test.error,direction+'/'+test.name);}finally{await db.exec('rollback');}
   assert.deepEqual(await catalogState(),before);assert.deepEqual(await generated(),originalGenerated);
   rejected.push(direction+'/'+test.name);
  }
 };
 const cases=[['published','公開中'],['null',null],['missing',undefined],['true',true],['false',false],['zero',0],['number',123.5],['array',['公開中']],['object',{state:'公開中'}]];
 const probes=cases.map(([name,value])=>{const id='generated-status-probe-'+name;return {id,data:{id,schoolId,...(value===undefined?{}:{status:value})}};});
 const ids=probes.map(p=>p.id);
 const typedRead=async()=>{
  const sets=[];
  for(const settings of [{},{'teacher:みんなの論文':'hidden','student:みんなの論文':'hidden'},{'teacher:探究論文の公開申請':'hidden'},{'teacher:みんなの論文':'hidden','teacher:探究論文の公開申請':'hidden','student:みんなの論文':'hidden'}]){
   await setFeatures(settings);
   for(const label of labels){await claims(profileClaims.find(c=>c.label===label));sets.push({label,rows:(await db.query("select id from public.lti_records where kind='papers' and id=any($1::text[]) order by id",[ids])).rows});}
  }
  await root();return sets;
 };
 let inserted=false,prepared=false;
 try {
  await setFeatures({});await claims(profileClaims.find(c=>c.label==='teacherA'));
  await db.exec('set plan_cache_mode=force_generic_plan;prepare fixture_generated_status_claims as select kind,id from public.lti_records order by kind,id');prepared=true;
  const beforeClaims=await preparedRead();
  assert.equal((await db.query('select count(*)::int n from public.lti_records where id=any($1::text[])',[ids])).rows[0].n,0);
  await db.query("insert into public.lti_records(kind,id,owner_id,data) select 'papers',id,$2::uuid,data from jsonb_to_recordset($1::jsonb) as x(id text,data jsonb)",[JSON.stringify(probes),actors.teacherA.id]);inserted=true;
  const native=(await db.query("select id,status,data->>'status' raw from public.lti_records where id=any($1::text[]) order by id",[ids])).rows;
  assert(native.every(r=>r.status===r.raw));
  await assert.rejects(()=>db.query("update public.lti_records set status='公開中' where id=$1",[probes[3].id]),e=>e.code==='428C9');
  await db.query("update public.lti_records set data=jsonb_set(data,'{status}','\"公開中\"'::jsonb) where id=$1",[probes[3].id]);
  assert.equal((await db.query('select status from public.lti_records where id=$1',[probes[3].id])).rows[0].status,'公開中');
  await db.query('update public.lti_records set data=$1::jsonb where id=$2',[JSON.stringify(probes[3].data),probes[3].id]);
  assert.equal((await db.query('select status from public.lti_records where id=$1',[probes[3].id])).rows[0].status,'true');
  const beforeTyped=await typedRead();
  await setFeatures({});await refusal(migrationSql,'forward');
  const beforeApply=await catalogState();
  await db.exec(migrationSql);
  assert.deepEqual(withoutPolicyExpressions(await catalogState()),withoutPolicyExpressions(beforeApply));
  assert.deepEqual(await generated(),originalGenerated);
  assert.deepEqual(await typedRead(),beforeTyped,'Every JSON status type and feature/identity combination stays equivalent');
  await root();await db.query("delete from public.lti_records where kind='papers' and id=any($1::text[])",[ids]);inserted=false;
  assert.deepEqual(await evaluate(),expected,'All 195 existing scenarios stay equivalent');
  await setFeatures({});assert.deepEqual(await preparedRead(),beforeClaims,'Same prepared query must use fresh claims after status optimization');
  await claims(profileClaims.find(c=>c.label==='teacherA'));
  const plan=(await db.query('explain(analyze,verbose,timing off,format json) select kind,id from public.lti_records order by kind,id')).rows[0]['QUERY PLAN'][0];
  const producers=[];const walk=n=>{if(n.Output?.some(v=>v.includes('lti_read_private.context()')))producers.push(n);for(const p of n.Plans??[])walk(p);};walk(plan.Plan);
  assert.equal(producers.length,2);assert(producers.every(p=>p['Actual Loops']===1));
  await root();await refusal(rollbackSql,'rollback');await db.exec(rollbackSql);
  assert.deepEqual(await generated(),originalGenerated);
  await setFeatures({});assert.deepEqual(await preparedRead(),beforeClaims,'Rollback must preserve fresh prepared-query claims');
  await db.exec('deallocate fixture_generated_status_claims;reset plan_cache_mode');prepared=false;
  await db.query('update public.lti_schools set feature_settings=$1::jsonb where id=$2',[priorSettings.sql_null?null:JSON.stringify(priorSettings.feature_settings),schoolId]);
  assert.deepEqual(await catalogState(),original,'Status rollback restores the complete caller V3 state');
  return {completed:true,matchedScenarios:expected.length,preparedComparisons:labels.length,preparedStages:3,typedStatusCases:cases.length,typedIdentityFeatureComparisons:beforeTyped.length,generatedColumnDirectUpdateRejected:true,generatedColumnRecomputed:true,contextExecutions:producers.map(p=>p['Actual Loops']),rollbackRestored:true,rejectedDrifts:rejected,sourceHashes:{migration:hash(migrationSql),rollback:hash(rollbackSql)}};
 } finally {
  await root();
  if(inserted)await db.query("delete from public.lti_records where kind='papers' and id=any($1::text[])",[ids]);
  if(prepared){try{await db.exec('deallocate fixture_generated_status_claims;reset plan_cache_mode');}catch{}}
 }
}
