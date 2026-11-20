// Reuse the existing isolated schema/claims fixture, without running its legacy
// phase sequence. Imports stay file URLs on Windows and ordinary CI checkouts.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const fixture=new URL('record-read-cte-equivalence.mjs',import.meta.url);
let source=(await readFile(fixture,'utf8')).replace(/\r\n/g,'\n');
const marker=source.indexOf(' const v2Catalog=await catalogState();');assert(marker>0);
source=source.slice(0,marker);
source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_whole,_quote,path)=>'from '+JSON.stringify(new URL(path,fixture).href));
source=source.replaceAll("import('@electric-sql/pglite')",'import('+JSON.stringify(import.meta.resolve('@electric-sql/pglite'))+')');
source=source.replaceAll('import.meta.url',JSON.stringify(fixture.href));
source+=String.raw`
 await db.exec(cteSql);await db.exec(statusSql);await db.exec(profileSql);
 await root();await db.query("update public.lti_schools set feature_settings='{}'::jsonb where id=$1",[A]);
 await db.exec("alter table public.lti_schools add column name text;update public.lti_schools set name=id;alter table public.lti_schools alter column name set not null;alter table public.lti_schools add column next_student_number integer not null default 1;alter table public.lti_schools add column next_teacher_number integer not null default 1;alter table public.lti_schools alter column feature_settings set not null;revoke all on public.lti_schools from anon,authenticated,service_role;grant truncate,references,trigger,maintain on public.lti_schools to anon;grant select,delete,truncate,references,trigger,maintain on public.lti_schools to authenticated;grant all on public.lti_schools to service_role;grant insert(id,name),update(name,feature_settings)on public.lti_schools to authenticated;");
 await db.exec(await readSql(new URL('../../supabase/migrations/20261120044209_optimize_school_read_initplans.sql',__FIXTURE_URL__)));
 await db.exec("insert into public.lti_schools(id,name)select 'school-fill-'||g,'school-fill-'||g from generate_series(1,497)g;analyze public.lti_schools;");
 // Production feature_settings is NOT NULL. The older record-helper fixture
 // also tests a defensive SQL-NULL state which this table cannot represent.
 const excludedSqlNullScenarios=scenarios.filter(s=>s.feature.sqlNull).length;
 scenarios.splice(0,scenarios.length,...scenarios.filter(s=>!s.feature.sqlNull));
 const expected=await evaluate();await root();await db.query("update public.lti_schools set feature_settings='{}'::jsonb where id=$1",[A]);
 const contextMigration=await readSql(new URL('../../supabase/migrations/20261120050325_consolidate_profile_school_read_context.sql',__FIXTURE_URL__));
 const contextRollback=await readSql(new URL('../../supabase/rollbacks/20261120050325_consolidate_profile_school_read_context.sql',__FIXTURE_URL__));
 const {verifyProfileSchoolContextPhase}=await import(__PHASE_URL__);
 const result=await verifyProfileSchoolContextPhase({db,root,claims,profileClaims,actors,schoolId:A,evaluate,expected,migrationSql:contextMigration,rollbackSql:contextRollback,statusSql:'',statusRollbackSql:''});
 assert.equal(networkAttempts,0);
 const output={...result,scope:'Offline in-memory PostgreSQL/WASM; 500 synthetic profiles and 500 synthetic schools, no real credentials or production requests',networkAttempts,excludedSqlNullScenarios};
 const outArg=process.argv.indexOf('--out');if(outArg>=0)await writeFile(pathToFileURL(process.argv[outArg+1]),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output));
 }catch(e){console.error(JSON.stringify({completed:false,error:e.code??e.name,message:e.message}));process.exitCode=1;}finally{await db.close();}
`.replaceAll('__FIXTURE_URL__',JSON.stringify(fixture.href)).replace('__PHASE_URL__',JSON.stringify(new URL('profile-school-context-phase.mjs',import.meta.url).href));
try{await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}catch(error){console.error(JSON.stringify({completed:false,phase:'fixture-load',code:error.code??error.name}));process.exitCode=1;}
