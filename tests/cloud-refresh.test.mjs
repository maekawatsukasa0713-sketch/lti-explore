import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../cloud-refresh.ts',import.meta.url),'utf8');
const moduleContext={exports:{}};vm.createContext(moduleContext);
vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,moduleContext);
const {createRefreshCoordinator,savedRecordScope,mergeRecordRows,recordPermissionKey,recordSchoolFilter}=moduleContext.exports;
const clone=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const full={type:'full'},kind=k=>({type:'kinds',kinds:[k]});

assert.deepEqual(clone(savedRecordScope([{kind:'submissions'},{kind:'feedback'}])),{type:'kinds',kinds:['assignments','feedback','submissions']});
assert.deepEqual(clone(savedRecordScope([{kind:'papers'},{kind:'materials'}])),{type:'kinds',kinds:['materials','paper_threads','papers']});
{
 const teacher={role:'teacher',school_id:'school-A'},student={role:'student',school_id:'school-A'};
 const bound=['assignments','submissions','feedback','materials','paper_threads'];
 for(const profile of [teacher,student]){
  assert.equal(recordSchoolFilter({type:'kinds',kinds:bound},profile),'school-A');
  for(const kind of bound)assert.equal(recordSchoolFilter({type:'kinds',kinds:[kind]},profile),'school-A');
  assert.equal(recordSchoolFilter(full,profile),null,'Initial/manual full reads must include globally visible papers');
  for(const kind of ['papers','references','notices','contests','unknown'])assert.equal(recordSchoolFilter({type:'kinds',kinds:['assignments',kind]},profile),null,'Mixed/global scopes must not receive a school predicate');
 }
 for(const profile of [{...teacher,role:'admin'},{...teacher,school_id:null},{...teacher,school_id:''}])assert.equal(recordSchoolFilter({type:'kinds',kinds:bound},profile),null);
 assert.equal(recordSchoolFilter({type:'kinds',kinds:[]},teacher),null);
}
{
 const paper={kind:'papers',id:'public-other-school',version:7,owner_id:'other',data:{schoolId:'B',status:'公開中',aiAnalysis:{unknown:'canonical'},custom:'x'.repeat(10000)}};
 const old=[paper,{kind:'submissions',id:'removed',version:1,data:{}}];
 const fresh=[{kind:'submissions',id:'new',version:9,data:{serverTimestamp:'database'}}];
 const merged=mergeRecordRows(old,fresh,savedRecordScope([{kind:'submissions'}]));
 assert.equal(merged.find(r=>r.kind==='papers'),paper);assert.equal(merged.find(r=>r.kind==='submissions'),fresh[0]);assert(!merged.some(r=>r.id==='removed'));
 const p={id:'u',role:'teacher',school_id:'A',active:true,name:'old'},schools=[{id:'A',feature_settings:{'teacher:教材':'enabled'}}];
 const key=recordPermissionKey(p,schools,'aal1','aal1');
 assert.equal(recordPermissionKey({...p,name:'new'},schools,'aal1','aal1'),key);
 for(const changed of [{...p,role:'student'},{...p,active:false},{...p,school_id:'B'},{...p,must_change_password:true},{...p,session_valid_after:'tomorrow'},{...p,deleted_at:'retired'}])assert.notEqual(recordPermissionKey(changed,schools,'aal1','aal1'),key);
 assert.notEqual(recordPermissionKey(p,[{id:'A',feature_settings:{'teacher:教材':'hidden'}}],'aal1','aal1'),key);
 assert.notEqual(recordPermissionKey(p,schools,'aal2','aal2'),key);
}
{
 const calls=[];const c=createRefreshCoordinator(job=>{const done=deferred();calls.push({job,done});return done.promise;});
 const a=c.request(full),same=c.request(kind('papers'));
 assert.equal(calls.length,1);
 const queued=c.request(kind('submissions'),{fresh:true}),unioned=c.request(kind('feedback'),{fresh:true});
 assert.equal(calls.length,1);calls[0].done.resolve('applied');await flush();
 assert.equal((await a).status,'applied');assert.equal((await same).status,'applied');assert.equal(calls.length,2);
 assert.deepEqual(clone(calls[1].job.scope),{type:'kinds',kinds:['feedback','submissions']});
 calls[1].done.resolve('applied');assert.equal((await queued).status,'applied');assert.equal((await unioned).status,'applied');
 const pre=c.request(full);const revision=c.committed(c.epoch);const post=c.request(kind('submissions'),{minimumRevision:revision});
 assert.equal(calls[2].job.isCurrent(),false,'Write ACK invalidates a pre-ACK read even before its response arrives');
 calls[2].done.resolve('applied');await flush();assert.equal((await pre).status,'invalidated');assert.equal(calls.length,4);assert.equal(calls[3].job.revision,revision);
 calls[3].done.resolve('applied');assert.equal((await post).status,'applied');
 const old=c.request(full),oldEpoch=c.epoch;c.invalidate();assert.equal((await old).status,'invalidated');assert.equal(c.committed(oldEpoch),null);
 const next=c.request(full);assert.equal(calls.length,6,'New identity does not wait for old HTTP completion');
 calls[4].done.resolve('applied');await flush();assert.equal(calls[5].job.isCurrent(),true);
 calls[5].done.resolve('applied');assert.equal((await next).status,'applied');
 const failed=c.request(full);calls[6].done.reject(new Error('fixture failure'));assert.equal((await failed).status,'failed');
}
{
 const calls=[];const c=createRefreshCoordinator(job=>{const done=deferred();calls.push({job,done});return done.promise;});
 const pre=c.request(kind('references'));
 const first=c.request(kind('submissions'),{minimumRevision:c.committed(c.epoch)});
 const second=c.request(kind('feedback'),{minimumRevision:c.committed(c.epoch)});
 const manual=c.request(full,{fresh:true});
 calls[0].done.resolve('applied');await flush();assert.equal((await pre).status,'invalidated');assert.equal(calls.length,2);
 assert.equal(calls[1].job.revision,2);assert.equal(calls[1].job.scope.type,'full','A trailing manual request promotes the union to a full snapshot');
 calls[1].done.resolve('applied');assert.equal((await first).status,'applied');assert.equal((await second).status,'applied');assert.equal((await manual).status,'applied');
}

// Exercise the actual CloudGate callbacks, not a duplicate persistence model.
const cloudText=readFileSync(new URL('../cloud.tsx',import.meta.url),'utf8');
const cloud=ts.createSourceFile('cloud.tsx',cloudText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=(predicate)=>{const rows=[];const visit=n=>{if(predicate(n))rows.push(n);ts.forEachChild(n,visit);};visit(cloud);return rows;};
const declaration=name=>{
 const matches=nodes(n=>ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text===name&&n.initializer);
 const selected=name==='save'?matches.filter(n=>n.initializer.parameters?.[0]?.name.getText(cloud)==='kind'):matches;
 assert.equal(selected.length,1,'Unique actual declaration '+name);return selected[0].getText(cloud);
};
const runner=nodes(n=>ts.isBinaryExpression(n)&&n.left.getText(cloud)==='runRefresh.current');assert.equal(runner.length,1);
const authEffect=nodes(n=>ts.isCallExpression(n)&&n.expression.getText(cloud)==='useEffect'&&n.arguments[0]?.getText(cloud).includes('onAuthStateChange'));assert.equal(authEffect.length,1);
const effects=nodes(n=>ts.isCallExpression(n)&&n.expression.getText(cloud)==='useEffect'&&n.arguments[0]?.getText(cloud)==='()=>{void reload();}');
assert.equal(effects.length,1);assert.match(effects[0].arguments[1].getText(cloud),/access_token/,'Token/AAL scope changes trigger a fresh full load');
const callbacks=['reload','signOut','save'].map(n=>'const '+declaration(n)+';').join('\n');
const actualCode=ts.transpileModule([
 ...['clearStore','invalidateIdentity','acceptSession'].map(n=>'var '+declaration(n)+';'),
 runner[0].getText(cloud)+';',
 'var bind=()=>{const identityEpoch=refresh.epoch;'+callbacks+'return {reload,signOut,save};};',
 'var setupAuth='+authEffect[0].arguments[0].getText(cloud)+';'
].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;

function fixture(){
 const A='A',B='B',teacher={id:'teacher-A',role:'teacher',school_id:A,active:true,name:'Teacher A'},otherTeacher={...teacher,id:'teacher-B',school_id:B};
 const students=Array.from({length:500},(_,i)=>({id:'student-'+i,role:'student',school_id:A,active:true,name:'Student '+i}));
 const row=(kind,id,data,version=1)=>({kind,id,owner_id:teacher.id,school_id:data.schoolId??null,data:{id,...data},version});
 const assignment=row('assignments','assignment',{schoolId:A,title:'Fixture assignment'});
 const submission=row('submissions','assignment:student-499',{schoolId:A,assignmentId:'assignment',studentId:'student-499',submittedText:'original',submittedAt:'old',late:false});
 const paper=row('papers','global-paper',{schoolId:B,status:'公開中',title:'Global',aiAnalysis:{unlisted:{text:'preserve'}},unknownPayload:'z'.repeat(20000)},7);
 const db={lti_profiles:[teacher,{...teacher,id:'teacher-A2'},...students,otherTeacher],lti_schools:[{id:A,name:'School A',feature_settings:{}},{id:B,name:'School B',feature_settings:{}}],lti_records:[assignment,submission,paper,row('papers','own-paper',{schoolId:A,status:'承認待ち',unknown:{keep:true}}),row('paper_threads','own-paper',{schoolId:A,messages:[{text:'old'}]}),row('feedback','feedback',{schoolId:A,assignmentId:'assignment',studentId:'student-499',read:false}),...Array.from({length:995},(_,i)=>row('references','reference-'+String(i).padStart(4,'0'),{title:'Fixture reference',schoolId:A}))]};
 assert.equal(db.lti_records.length,1001);
 const state={profile:null,profiles:[],schools:[],rows:[],dataReady:false,error:'',loading:false,busy:false,savedButRefreshFailed:false,session:null,password:'',recovery:false,initial:true,authError:''};
 const calls=[],writes=[],hooks={beforeRead:null,rpc:null,signOut:null};
 const context={Error,Symbol,kinds:{lti_assignments:'assignments',lti_papers:'papers',lti_teaching_materials:'materials',lti_contests:'contests',lti_notices:'notices',lti_student_feedback_messages:'feedback',lti_academic_references:'references'},identity:{current:{id:undefined,token:undefined}},assurance:{current:{aal:'aal1',nextAal:'aal1'}},loadedContext:{current:null},runRefresh:{current:null},ref:{current:[]},lock:{current:false},activeSave:{current:null},savedRecordScope,mergeRecordRows,recordPermissionKey,recordSchoolFilter};
 const permitted=(table,r,actor)=>{
  const viewer=db.lti_profiles.find(p=>p.id===actor);if(viewer?.role==='admin')return true;
  if(table==='lti_profiles')return viewer?.role==='student'?r.id===actor:r.school_id===viewer?.school_id;
  if(table==='lti_schools')return r.id===viewer?.school_id;
  if(r.kind==='papers'&&r.data.status==='公開中')return true;
  return r.data.schoolId===viewer?.school_id&&!(viewer?.role==='student'&&['submissions','feedback'].includes(r.kind)&&r.data.studentId!==actor);
 };
 const builder=table=>{
  const filters=[],orders=[];let selection;
  return {select(value){assert.equal(value,'*');selection=value;return this;},eq(field,value){assert(['id','school_id'].includes(field));filters.push([field,value]);return this;},in(field,values){assert.equal(field,'kind');filters.push([field,[...values]]);return this;},order(field){orders.push(field);return this;},
   async single(){const actor=context.identity.current.id,request={table,actor,filters:clone(filters),selection,single:true};calls.push(request);const data=clone(db[table].find(r=>filters.every(([k,v])=>r[k]===v)));if(hooks.beforeRead)await hooks.beforeRead(request);return {data,error:null};},
   async range(start,end){
    assert.equal(end-start,499);const actor=context.identity.current.id,request={table,actor,filters:clone(filters),selection,orders:[...orders],start,end};calls.push(request);
    let records=db[table].filter(r=>permitted(table,r,actor)&&filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v));
    records=[...records].sort((a,b)=>{for(const key of orders){if(a[key]<b[key])return -1;if(a[key]>b[key])return 1;}return 0;});const data=clone(records.slice(start,end+1));
    try{if(hooks.beforeRead)await hooks.beforeRead(request);return {data,error:null};}catch(error){return {data:null,error};}
   }
  };
 };
 const initialSession=deferred();let authCallback;
 context.supabase={from:builder,rpc:async(name,{ops})=>{
  assert.equal(name,'lti_save_records');writes.push(clone(ops));
  if(hooks.rpc)await hooks.rpc(ops);
   for(const op of ops){const index=db.lti_records.findIndex(r=>r.kind===op.kind&&r.id===op.id);if(op.action==='delete'){assert(index>=0);assert.equal(db.lti_records[index].version,op.version);db.lti_records.splice(index,1);}else if(op.action==='update'){assert(index>=0);assert.equal(db.lti_records[index].version,op.version);db.lti_records[index]={...db.lti_records[index],school_id:op.data.schoolId??null,version:op.version+1,data:clone(op.data)};if(op.kind==='submissions')Object.assign(db.lti_records[index].data,{submittedAt:'server-timestamp',late:true});}else {assert.equal(index,-1);db.lti_records.push({kind:op.kind,id:op.id,owner_id:context.identity.current.id,school_id:op.data.schoolId??null,version:1,data:clone(op.data)});}}
  return {data:null,error:null};
 },auth:{onAuthStateChange(callback){authCallback=callback;return {data:{subscription:{unsubscribe(){}}}};},getSession(){return initialSession.promise;},async signOut(){if(hooks.signOut)return hooks.signOut();authCallback?.('SIGNED_OUT',null);return {error:null};}}};
 for(const key of Object.keys(state))context['set'+key[0].toUpperCase()+key.slice(1)]=value=>{state[key]=typeof value==='function'?value(state[key]):value;};
 context.refresh=createRefreshCoordinator(job=>context.runRefresh.current(job));
 vm.createContext(context);vm.runInContext(actualCode,context);
 const session=id=>({user:{id},access_token:'token-'+id});
 context.setupAuth();authCallback('SIGNED_IN',session(teacher.id));
 const bind=()=>context.bind();
 const emit=(id,token)=>authCallback(id?'SIGNED_IN':'SIGNED_OUT',id?{...session(id),...(token?{access_token:token}:{})}:null);
 const assignmentList=()=>db.lti_records.filter(r=>r.kind==='assignments').map(a=>({...clone(a.data),submissions:Object.fromEntries(context.ref.current.filter(r=>r.kind==='submissions'&&r.data.assignmentId===a.id).map(r=>[r.data.studentId,clone(r.data)]))}));
 return {db,state,context,calls,writes,hooks,bind,emit,initialSession,assignmentList,teacher,otherTeacher};
}

{
 const f=fixture(),c=f.bind();await c.reload(true);
 assert.equal(f.state.rows.length,1001);assert.equal(f.state.profiles.length,502);assert.equal(f.context.ref.current.length,1001);
 assert.deepEqual(f.calls.filter(r=>r.table==='lti_records').map(r=>r.start),[0,500,1000]);
 assert(f.calls.filter(r=>r.table==='lti_records').every(r=>r.filters.length===0&&r.orders.join(',')==='kind,id'));
 const originalPaper=clone(f.state.rows.find(r=>r.id==='global-paper')),before=f.assignmentList(),next=clone(before);next[0].submissions['student-499'].submittedText='edited';
 f.calls.length=0;const result=await c.save('assignments',before,next);
 assert.equal(result.ok,true);assert.equal(result.refreshed,true);assert.equal(f.writes[0].length,1);assert.equal(f.writes[0][0].kind,'submissions');
 const changed=f.state.rows.find(r=>r.kind==='submissions');assert.equal(changed.version,2);assert.equal(changed.data.submittedAt,'server-timestamp');assert.equal(changed.data.late,true);
 assert.deepEqual(clone(f.state.rows.find(r=>r.id==='global-paper')),originalPaper);
 assert(f.calls.some(r=>r.table==='lti_profiles'&&!r.single));assert(f.calls.some(r=>r.table==='lti_schools'));
 assert(f.calls.filter(r=>r.table==='lti_records').every(r=>JSON.stringify(r.filters)==='[["kind",["assignments","feedback","submissions"]],["school_id","A"]]'));
 // Changing feature/permission context forces a full RLS snapshot and prunes
 // records no longer returned by the server, including unrelated old families.
 f.db.lti_schools[0].feature_settings={'teacher:みんなの論文':'hidden'};
 f.db.lti_records=f.db.lti_records.filter(r=>r.id!=='global-paper');f.calls.length=0;
 const feedback=clone(f.state.rows.filter(r=>r.kind==='feedback').map(r=>r.data)),read=feedback.map(r=>({...r,read:true}));
 await c.save('feedback',feedback,read);assert(f.calls.filter(r=>r.table==='lti_records').every(r=>r.filters.length===0));assert(!f.state.rows.some(r=>r.id==='global-paper'));
}
{
 const f=fixture();
 // The school predicate must not become a teacher/owner predicate: a teacher
 // still sees and refreshes another teacher's assignments and students.
 const assignment=f.db.lti_records.find(r=>r.kind==='assignments');assignment.owner_id='teacher-A2';
 const submitted=f.db.lti_records.find(r=>r.kind==='submissions');submitted.owner_id='student-499';
 const otherSchool={kind:'submissions',id:'B:student-B',owner_id:'student-B',school_id:'B',version:9,data:{id:'B:student-B',schoolId:'B',assignmentId:'B',studentId:'student-B',submittedText:'other school'}};
 f.db.lti_records.push(otherSchool);
 const c=f.bind();await c.reload(true);const before=f.assignmentList(),next=clone(before);next[0].submissions['student-499'].submittedText='school-wide teacher view';f.calls.length=0;
 assert((await c.save('assignments',before,next)).refreshed);
 const refreshed=f.state.rows.find(r=>r.kind==='submissions');assert.equal(refreshed.owner_id,'student-499');assert.equal(refreshed.data.submittedText,'school-wide teacher view');
 assert.equal(f.state.rows.find(r=>r.kind==='assignments').owner_id,'teacher-A2');assert(!f.state.rows.some(r=>r.id===otherSchool.id));
 const reads=f.calls.filter(r=>r.table==='lti_records');assert(reads.length);assert(reads.every(r=>r.filters.some(([field,value])=>field==='school_id'&&value==='A')));assert(reads.every(r=>r.filters.every(([field])=>!['owner_id','student_id','teacher_id'].includes(field))));
 assert(f.state.rows.some(r=>r.id==='global-paper'&&r.data.schoolId==='B'),'Unrelated globally visible paper survives a school-bound refresh');
 assert.equal(JSON.stringify(f.db.lti_records.find(r=>r.id===otherSchool.id)),JSON.stringify(otherSchool),'Refresh writes cannot affect the other school');
}
for(const profileChange of [{role:'admin'}]){
 const f=fixture();Object.assign(f.db.lti_profiles[0],profileChange);const c=f.bind();await c.reload(true);f.calls.length=0;
 const before=f.assignmentList(),next=clone(before);next[0].submissions['student-499'].submittedText='no narrowing';
 assert((await c.save('assignments',before,next)).refreshed);
 const reads=f.calls.filter(r=>r.table==='lti_records');assert(reads.length);assert(reads.every(r=>r.filters.every(([field])=>field!=='school_id')),'Admin and missing-school refreshes retain the RLS snapshot scope');
}
for(const change of ['profile-role','aal','token']){
 const f=fixture(),c=f.bind();await c.reload(true);f.calls.length=0;
 if(change==='profile-role')f.db.lti_profiles[0].role='student';
 if(change==='aal')f.context.assurance.current={aal:'aal2',nextAal:'aal2'};
 if(change==='token')f.emit('teacher-A','refreshed-token');
 f.db.lti_records=f.db.lti_records.filter(r=>r.id!=='global-paper');
 const before=f.state.rows.filter(r=>r.kind==='feedback').map(r=>clone(r.data));
 const result=await f.bind().save('feedback',before,before.map(r=>({...r,read:true})));
 assert(result.refreshed);assert(f.calls.filter(r=>r.table==='lti_records').every(r=>r.filters.length===0),change+' must fetch a full RLS snapshot');assert(!f.state.rows.some(r=>r.id==='global-paper'));
}
{
 const f=fixture(),c=f.bind();await c.reload(true);f.calls.length=0;
 f.db.lti_records=f.db.lti_records.filter(r=>r.id!=='global-paper');let changed=false;
 f.hooks.beforeRead=request=>{if(!changed&&request.table==='lti_records'&&request.filters.length){changed=true;f.context.assurance.current={aal:'aal2',nextAal:'aal2'};}};
 const before=f.state.rows.filter(r=>r.kind==='feedback').map(r=>clone(r.data));
 assert((await c.save('feedback',before,before.map(r=>({...r,read:true})))).refreshed);
 const reads=f.calls.filter(r=>r.table==='lti_records');assert(reads[0].filters.length);assert(reads.slice(1).every(r=>r.filters.length===0));assert(!f.state.rows.some(r=>r.id==='global-paper'),'AAL changes during a family read promote it before any merge');
}
for(const change of ['role','school','features']){
 const f=fixture(),c=f.bind();await c.reload(true);f.calls.length=0;let changed=false;
 f.hooks.beforeRead=request=>{
  if(!changed&&request.table==='lti_records'&&request.filters.length){
   changed=true;
   if(change==='role')f.db.lti_profiles[0].role='student';
   else if(change==='school')f.db.lti_profiles[0].school_id='B';
   else {f.db.lti_schools[0].feature_settings={'teacher:みんなの論文':'hidden'};f.db.lti_records=f.db.lti_records.filter(r=>r.id!=='global-paper');}
  }
 };
 const before=f.state.rows.filter(r=>r.kind==='feedback').map(r=>clone(r.data));
 const result=await c.save('feedback',before,before.map(r=>({...r,read:true})));assert(result.refreshed,change);
 const reads=f.calls.filter(r=>r.table==='lti_records');assert(reads[0].filters.length);assert(reads.slice(1).every(r=>r.filters.length===0),change+' changes require a complete replacement snapshot');
 if(change==='role'){
  assert.equal(f.state.profile.role,'student');assert.deepEqual(clone(f.state.profiles.map(p=>p.id)),['teacher-A']);assert(!f.state.rows.some(r=>['submissions','feedback'].includes(r.kind)),'Role revocation removes previously visible unrelated records');
 }else if(change==='school'){
  assert.equal(f.state.profile.school_id,'B');assert(f.state.profiles.every(p=>p.school_id==='B'));assert(f.state.schools.every(s=>s.id==='B'));assert(f.state.rows.every(r=>r.school_id==='B'),'Moving school removes every old-school family');
 }else assert(!f.state.rows.some(r=>r.id==='global-paper'),'Feature revocation removes unrelated cached papers');
 assert(f.calls.filter(r=>r.table==='lti_profiles'&&!r.single).length>=2,'Permission promotion refreshes the profile list too');
 assert.equal(f.writes.length,1,'Permission revalidation does not repeat the acknowledged write');
}
for(const failingPostCheck of ['profile','schools']){
 const f=fixture(),c=f.bind();await c.reload(true);let recordRead=false;
 f.hooks.beforeRead=request=>{
  if(request.table==='lti_records'&&request.filters.length)recordRead=true;
  if(recordRead&&(failingPostCheck==='profile'?request.table==='lti_profiles'&&request.single:request.table==='lti_schools'))throw new Error('permission recheck unavailable');
 };
 const before=f.state.rows.filter(r=>r.kind==='feedback').map(r=>clone(r.data));const result=await c.save('feedback',before,before.map(r=>({...r,read:true})));
 assert(result.ok&&!result.refreshed,'An acknowledged write remains acknowledged if permission verification fails');assert.equal(f.writes.length,1);
 assert.equal(f.state.profile,null);assert.equal(f.state.rows.length,0);assert.equal(f.state.profiles.length,0);assert.equal(f.state.schools.length,0);assert.equal(f.context.ref.current.length,0);assert.equal(f.context.loadedContext.current,null,'Unverified permission state must not keep cached data visible');
}
{
 const f=fixture(),c=f.bind();await c.reload(true);let readCount=0;
 f.hooks.beforeRead=request=>{if(request.table==='lti_records'&&request.start===0){readCount++;f.db.lti_schools[0].feature_settings={permissionVersion:readCount};}};
 const before=f.state.rows.filter(r=>r.kind==='feedback').map(r=>clone(r.data));const result=await c.save('feedback',before,before.map(r=>({...r,read:true})));
 assert(result.ok&&!result.refreshed);assert.equal(f.writes.length,1);assert.equal(readCount,2,'Only one full-snapshot fallback is allowed when permissions keep changing');
 assert.equal(f.state.rows.length,0);assert.equal(f.state.profile,null);assert.equal(f.context.ref.current.length,0);assert.equal(f.context.loadedContext.current,null);
}
{
 const f=fixture(),c=f.bind();await c.reload(true);
 const papers=f.context.ref.current.filter(r=>r.kind==='papers').map(r=>({...clone(r.data),messages:clone(f.context.ref.current.find(t=>t.kind==='paper_threads'&&t.id===r.id)?.data.messages||[])}));
 const next=papers.filter(p=>p.id!=='own-paper');f.calls.length=0;
 const result=await c.save('papers',papers,next);assert.equal(result.refreshed,true);
 assert.deepEqual(f.writes[0].map(op=>op.kind),['papers','paper_threads']);assert(!f.state.rows.some(r=>r.id==='own-paper'));
 assert(f.calls.filter(r=>r.table==='lti_records').every(r=>JSON.stringify(r.filters)==='[["kind",["paper_threads","papers"]]]'));
 assert(f.state.rows.find(r=>r.id==='global-paper').data.aiAnalysis.unlisted.text==='preserve');
}
{
 const f=fixture(),c=f.bind();await c.reload(true);
 const original=JSON.stringify(f.state.rows),originalRef=JSON.stringify(f.context.ref.current);
 const originalMetadata=JSON.stringify({profile:f.state.profile,profiles:f.state.profiles,schools:f.state.schools});f.db.lti_profiles[0].name='updated metadata';f.db.lti_schools[0].name='renamed metadata';
 f.hooks.beforeRead=request=>{if(request.table==='lti_records'&&request.start===500)throw new Error('tail unavailable');};
 const before=f.state.rows.filter(r=>r.kind==='references').map(r=>clone(r.data)),next=before.map((r,i)=>i===0?{...r,title:'new'}:r);
 const result=await c.save('references',before,next);assert.equal(result.ok,true);assert.equal(result.refreshed,false);assert.equal(f.writes.length,1);
 assert.equal(JSON.stringify(f.state.rows),original);assert.equal(JSON.stringify(f.context.ref.current),originalRef);assert(f.state.savedButRefreshFailed);
 assert.equal(JSON.stringify({profile:f.state.profile,profiles:f.state.profiles,schools:f.state.schools}),originalMetadata,'A partial records failure cannot publish partial metadata either');
 f.hooks.beforeRead=null;await c.reload(true);assert.equal(f.state.savedButRefreshFailed,false);assert.equal(f.state.rows.find(r=>r.id===before[0].id).version,2);
}
{
 const f=fixture(),c=f.bind();await c.reload(true);
 const oldRead=deferred(),started=deferred();let blocked=false;
 f.hooks.beforeRead=async request=>{if(!blocked&&request.table==='lti_records'){blocked=true;started.resolve();await oldRead.promise;}};
 const pre=c.reload(true).catch(error=>error);await started.promise;
 const before=f.assignmentList(),next=clone(before);next[0].submissions['student-499'].submittedText='after ACK';
 let saved=false;const pending=c.save('assignments',before,next).then(result=>{saved=true;return result;});await flush();
 assert.equal(saved,false);oldRead.resolve();const preResult=await pre;assert(preResult instanceof Error);
 const result=await pending;assert.equal(result.refreshed,true);assert.equal(f.state.rows.find(r=>r.kind==='submissions').version,2);assert.equal(f.state.rows.find(r=>r.kind==='submissions').data.submittedText,'after ACK');
}
{
 const f=fixture(),old=f.bind();await old.reload(true);
 const ack=deferred();f.hooks.rpc=()=>ack.promise;
 const before=f.assignmentList(),next=clone(before);next[0].submissions['student-499'].submittedText='old identity';
 const pending=old.save('assignments',before,next);await flush();assert(f.state.busy);
 f.emit('teacher-B');const current=f.bind();await current.reload(true);
 const newAck=deferred();f.hooks.rpc=()=>newAck.promise;
 const newSave=current.save('references',[],[{id:'new-B-reference',schoolId:'B',title:'new identity'}]);await flush();
 assert(f.state.busy&&f.context.lock.current);const newSaveToken=f.context.activeSave.current;
 const snapshot=JSON.stringify(f.state),requestCount=f.calls.length;
 ack.resolve();const result=await pending;assert.equal(result.ok,true);assert.equal(result.refreshed,false);assert.equal(f.calls.length,requestCount);assert.equal(JSON.stringify(f.state),snapshot,'Old ACK, error or finally must not mutate the new user store');
 assert(f.context.lock.current);assert.equal(f.context.activeSave.current,newSaveToken,'Old finally cannot release the new identity save lock');
 const stale=await old.save('references',[],[{id:'stale-callback'}]);assert.equal(stale.ok,false);assert.equal(f.writes.length,2);assert.equal(JSON.stringify(f.state),snapshot);
 newAck.resolve();assert.equal((await newSave).refreshed,true);
}
{
 const f=fixture(),old=f.bind();await old.reload(true);
 const response=deferred(),started=deferred();let blocked=false;
 f.hooks.beforeRead=async r=>{if(!blocked&&r.table==='lti_records'){blocked=true;started.resolve();await response.promise;}};
 const pending=old.reload(true).catch(error=>error);await started.promise;
 f.emit('teacher-B');f.hooks.beforeRead=null;await f.bind().reload(true);const snapshot=JSON.stringify(f.state);
 response.resolve();await pending;assert.equal(JSON.stringify(f.state),snapshot,'A late old-user read must not repopulate rows or change loading/error');
 f.initialSession.resolve({data:{session:{user:{id:'teacher-A'},access_token:'stale'}},error:null});await flush();assert.equal(f.context.identity.current.id,'teacher-B','Stale getSession must not overwrite a newer auth event');
}
{
 const f=fixture(),old=f.bind();await old.reload(true);const out=deferred();f.hooks.signOut=()=>out.promise;
 const pending=old.signOut();assert.equal(f.context.ref.current.length,0,'Logout synchronously invalidates cached rows');
 f.emit('teacher-B');await f.bind().reload(true);const snapshot=JSON.stringify(f.state);out.resolve({error:null});await pending;
 assert.equal(JSON.stringify(f.state),snapshot,'A late signOut result must not clear a newer login');
}
{
 const f=fixture(),old=f.bind();await old.reload(true);const out=deferred();f.hooks.signOut=()=>out.promise;
 const pending=old.signOut();f.emit('teacher-A','new-login-token');await f.bind().reload(true);const snapshot=JSON.stringify(f.state);
 out.resolve({error:null});await pending;assert.equal(JSON.stringify(f.state),snapshot,'A newer login to the same account also survives an old signOut result');
}
console.log('PASS: actual CloudGate paginated canonical refresh, family replacement, server versions/timestamps, failure atomicity, ACK barriers, queued unions and identity/logout races');
