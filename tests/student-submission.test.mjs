import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real form callback, with fake IO. No DOM shim, production client,
// credentials or network requests are involved in these regression tests.
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
const resubmitHandlers = [];
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(app) === 'onSubmit' && node.initializer && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression;
    if (expression && expression.getText(app).includes('setStudentSubmitSuccessMsg')) handlers.push(expression.getText(app));
  }
  if (ts.isJsxAttribute(node) && node.name.getText(app) === 'onEdit' && node.initializer && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression;
    if (expression && expression.getText(app).includes('selectedAssignmentId')) resubmitHandlers.push(expression.getText(app));
  }
  ts.forEachChild(node, visit);
}
visit(app);
assert.equal(handlers.length, 1, 'locate the actual student submission form');
const handlerCode = ts.transpileModule(`globalThis.submit = ${handlers[0]};`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const event = () => ({preventDefault() {}});

function fixture({save = async () => ({ok: true, refreshed: true}), upload = async () => 'student-test/attachment.pdf'} = {}) {
  const file = {name: 'report.pdf', size: 128, type: 'application/pdf'};
  const state = {text: '失敗しても保持する提出本文', file, success: '', error: '', alerts: [], saves: [], uploads: 0, busy: false};
  const assignment = {id: 'assignment-test', schoolId: 'school-test', deadline: '2027/04/02', submissions: {}};
  const context = {
    Error,
    studentSubmissionText: state.text,
    studentSubmissionFile: file,
    retainedAttachment: undefined,
    submission: undefined,
    updateStudentDraft: (_id, patch) => Object.assign(state, patch),
    studentSubmissionPending: {current: false},
    uploadedStudentSubmission: {current: null},
    assignments: [assignment], assign: assignment, currentStudentId: 'student-test',
    alert: text => state.alerts.push(String(text)), setTimeout: () => 0,
    uploadPdf: async selected => { assert.equal(selected, file); state.uploads++; return upload(selected); },
    saveAssignments: async value => { state.saves.push(value); return save(value); },
    setStudentSubmitting: value => { state.busy = value; },
    setStudentSubmissionText: value => { state.text = value; },
    setStudentSubmissionFile: value => { state.file = value; },
    setStudentSubmitSuccessMsg: value => { state.success = value; },
    setStudentSubmitErrorMsg: value => { state.error = value; },
  };
  vm.createContext(context);
  vm.runInContext(handlerCode, context);
  return {state, context, file, submit: context.submit};
}

{
  const ack = deferred();
  const f = fixture({save: () => ack.promise});
  const pending = f.submit(event());
  await flush();
  assert.equal(f.state.saves.length, 1);
  assert.equal(f.state.text, '失敗しても保持する提出本文', 'keep text while database acknowledgement is pending');
  assert.equal(f.state.file, f.file, 'keep selected file while save is pending');
  assert.equal(f.state.success, '', 'do not claim success before database acknowledgement');
  assert.equal(f.state.busy, true);
  ack.resolve({ok: true, refreshed: true});
  await pending;
  assert.equal(f.state.text, '');
  assert.equal(f.state.file, null);
  assert.match(f.state.success, /提出/);
  assert.equal(f.state.busy, false);
}

{
  let tries = 0;
  const f = fixture({save: async () => ++tries === 1 ? {ok: false, error: '通信エラー'} : {ok: true, refreshed: true}});
  await f.submit(event());
  assert.equal(f.state.text, '失敗しても保持する提出本文');
  assert.equal(f.state.file, f.file);
  assert.equal(f.state.success, '');
  assert.match(f.state.error, /保存.*確認できません/);
  assert.equal(f.state.busy, false);
  assert.equal(f.context.studentSubmissionPending.current, false);
  assert.equal(f.state.uploads, 1);
  await f.submit(event());
  assert.equal(f.state.saves.length, 2);
  assert.equal(f.state.uploads, 1, 'retry reuses the successfully uploaded attachment');
  assert.equal(f.state.text, '');
  assert.equal(f.state.file, null);
  assert.match(f.state.success, /提出/);
}

{
  const transfer = deferred();
  const ack = deferred();
  const f = fixture({upload: () => transfer.promise, save: () => ack.promise});
  const first = f.submit(event());
  const duplicateDuringUpload = f.submit(event());
  await flush();
  assert.equal(f.state.uploads, 1, 'duplicate clicks must not duplicate file uploads');
  assert.equal(f.state.saves.length, 0);
  transfer.resolve('student-test/attachment.pdf');
  await flush();
  const duplicateDuringSave = f.submit(event());
  assert.equal(f.state.saves.length, 1, 'duplicate clicks must not duplicate DB submissions');
  assert.equal(f.state.success, '');
  ack.resolve({ok: true, refreshed: true});
  await Promise.all([first, duplicateDuringUpload, duplicateDuringSave]);
  assert.equal(f.state.saves.length, 1);
  assert.equal(f.state.uploads, 1);
  assert.equal(f.state.busy, false);
}

{
  const f = fixture({upload: async () => { throw new Error('アップロード失敗'); }});
  await f.submit(event());
  assert.equal(f.state.saves.length, 0);
  assert.equal(f.state.text, '失敗しても保持する提出本文');
  assert.equal(f.state.file, f.file);
  assert.equal(f.state.success, '');
  assert.equal(f.state.busy, false);
  assert.match(f.state.error, /アップロード失敗/);
}

{
  const f = fixture({save: async () => ({ok: true, refreshed: false})});
  await f.submit(event());
  assert.equal(f.state.text, '', 'a confirmed write must not be retried just because refresh failed');
  assert.equal(f.state.file, null);
  assert.match(f.state.success, /提出/);
  assert.match(f.state.success, /再読み込み|更新|表示/);
  assert.equal(f.state.saves.length, 1);
}

{
  const f = fixture();
  f.context.studentSubmissionFile = null;
  f.state.file = null;
  await f.submit(event());
  assert.equal(f.state.uploads, 0);
  assert.equal(f.state.saves.length, 1);
  assert.equal(f.state.saves[0][0].submissions['student-test'].submittedText, '失敗しても保持する提出本文');
  assert.equal(f.state.saves[0][0].submissions['student-test'].storagePath, undefined);
  assert.equal(f.state.text, '');
}

{
  const f = fixture();
  f.context.studentSubmissionText = '   ';
  f.context.studentSubmissionFile = null;
  await f.submit(event());
  assert.equal(f.state.uploads, 0);
  assert.equal(f.state.saves.length, 0);
  assert.equal(f.state.alerts.length, 1);
  assert.equal(f.state.busy, false);
}

// Editing a submitted assignment must never delete its stored submission.
assert.equal(resubmitHandlers.length, 1);
const resubmitCode = ts.transpileModule(`globalThis.edit = ${resubmitHandlers[0]};`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
{
 const prior={submittedText:'前回提出',storagePath:'student-test/original.pdf',submittedFile:{name:'original.pdf'},status:'提出済み'};
 const assignment={id:42,submissions:{'student-test':prior,'other-student':{submittedText:'別の生徒'}}};
 const state={};
 const context={selectedAssignmentId:42,currentStudentId:'student-test',assignments:[assignment],studentDrafts:{},updateStudentDraft:(id,patch)=>{state[id]=patch;}};
 vm.createContext(context);vm.runInContext(resubmitCode,context);context.edit();
 assert.equal(state[42].text,'前回提出');assert.equal(state[42].editing,true);
 assert.equal(assignment.submissions['student-test'],prior,'starting an edit preserves the original record and attachment');
 assert.equal(assignment.submissions['other-student'].submittedText,'別の生徒');
}
{
 const ack=deferred();const f=fixture({save:()=>ack.promise});
 const prior={submittedText:'前回提出',storagePath:'student-test/original.pdf',submittedFile:{name:'original.pdf'},status:'提出済み'};
 f.context.assign.submissions['student-test']=prior;
 f.context.submission=prior;f.context.retainedAttachment=prior.storagePath;
 f.context.studentSubmissionFile=null;f.state.file=null;
 const pending=f.submit(event());await flush();
 assert.equal(f.context.assign.submissions['student-test'],prior);
 assert.equal(f.state.saves[0][0].submissions['student-test'].storagePath,prior.storagePath,'text-only edit retains previous attachment');
 assert.equal(f.state.saves[0][0].submissions['student-test'].submittedFile.name,'original.pdf');
 ack.resolve({ok:false,error:'network'});await pending;
 assert.equal(f.context.assign.submissions['student-test'],prior,'failed replacement cannot remove previous submission');
 assert.equal(f.state.text,'失敗しても保持する提出本文');
}

// Execute the actual per-card draft bindings, not a copy of the state implementation.
let mapCallback,updateDraft;
function findDraft(node){
 if(ts.isCallExpression(node)&&node.expression.getText(app)==='schoolAssignments.map')mapCallback=node.arguments[0];
 if(ts.isVariableDeclaration(node)&&node.name.getText(app)==='updateStudentDraft')updateDraft=node.initializer.getText(app);
 ts.forEachChild(node,findDraft);
}
findDraft(app);assert.ok(mapCallback&&updateDraft);
const bindings=mapCallback.body.statements.filter(ts.isVariableStatement).map(n=>n.getText(app)).join('\n');
const bindingCode=ts.transpileModule(`const updateStudentDraft=${updateDraft};globalThis.bind=(assign)=>{${bindings};return {text:studentSubmissionText,file:studentSubmissionFile,error:studentSubmitErrorMsg,setText:setStudentSubmissionText,setFile:setStudentSubmissionFile,setError:setStudentSubmitErrorMsg,setSuccess:setStudentSubmitSuccessMsg};};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
{
 const context={studentDrafts:{},emptySubmissionDraft:{text:'',file:null,error:'',success:'',editing:false,removeAttachment:false},currentStudentId:'s',setStudentDrafts:action=>{context.studentDrafts=action(context.studentDrafts);}};
 vm.createContext(context);vm.runInContext(bindingCode,context);
 const a={id:1,submissions:{}},b={id:2,submissions:{}};
 const aFile={name:'a.pdf'},bFile={name:'b.docx'};
 context.bind(a).setText('Aの本文');context.bind(a).setFile(aFile);context.bind(a).setError('Aのエラー');
 assert.equal(context.bind(b).text,'');assert.equal(context.bind(b).file,null);assert.equal(context.bind(b).error,'');
 context.bind(b).setText('Bの本文');context.bind(b).setFile(bFile);context.bind(b).setSuccess('Bの保存成功');
 assert.equal(context.bind(a).text,'Aの本文');assert.equal(context.bind(a).file,aFile);assert.equal(context.bind(a).error,'Aのエラー');
 assert.equal(context.bind(b).file,bFile);assert.equal(context.studentDrafts[1].success,'');
 context.bind(a).setText('');context.bind(a).setFile(null);
 assert.equal(context.bind(b).text,'Bの本文');assert.equal(context.bind(b).file,bFile,'saving A must not clear B');
}

const cloud = ts.createSourceFile('cloud.tsx', readFileSync(new URL('../cloud.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveExpression, kindsExpression;
const hookFunctions = [];
function visitCloud(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (node.name.text === 'save' && node.initializer && ts.isArrowFunction(node.initializer)) saveExpression = node.initializer.getText(cloud);
    if (node.name.text === 'kinds' && node.initializer) kindsExpression = node.initializer.getText(cloud);
  }
  if (ts.isFunctionDeclaration(node) && ['values', 'useCloudList'].includes(node.name?.text)) hookFunctions.push(node.getText(cloud).replace(/^export /, ''));
  ts.forEachChild(node, visitCloud);
}
visitCloud(cloud);
assert.ok(saveExpression && kindsExpression, 'exercise actual CloudGate persistence callback');
const saveCode = ts.transpileModule(`const kinds = ${kindsExpression}; globalThis.save = ${saveExpression};`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
function persistence({rpc = async () => ({error: null}), reload = async () => {}, busy = false} = {}) {
  const state = {busy: false, error: '', committedRefreshFailure: false, rpcCalls: [], reloads: 0};
  const context = {
    Error,
    lock: {current: busy}, ref: {current: []},
    supabase: {rpc: async (name, args) => { state.rpcCalls.push({name, args}); return rpc(name, args); }},
    reload: async strict => { state.reloads++; return reload(strict); },
    setBusy: value => { state.busy = value; },
    setError: value => { state.error = value; },
    setSavedButRefreshFailed: value => { state.committedRefreshFailure = value; },
  };
  vm.createContext(context);
  vm.runInContext(saveCode, context);
  return {state, context, save: () => context.save('references', [], [{id: 'ref-test', title: 'test'}])};
}

{
  const ack = deferred();
  const f = persistence({rpc: () => ack.promise});
  let finished = false;
  const pending = f.save().then(result => { finished = true; return result; });
  await flush();
  assert.equal(finished, false);
  assert.equal(f.state.busy, true);
  assert.equal(f.state.reloads, 0);
  ack.resolve({error: null});
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.equal(f.state.rpcCalls[0].name, 'lti_save_records');
  assert.equal(f.state.rpcCalls[0].args.ops[0].action, 'insert');
  assert.equal(f.state.reloads, 1);
  assert.equal(f.state.busy, false);
}

for (const rpc of [async () => ({error: {message: 'version conflict'}}), async () => { throw new Error('network unavailable'); }]) {
  const f = persistence({rpc});
  const result = await f.save();
  assert.equal(result.ok, false, 'RPC failures must reach the caller');
  assert.ok(result.error);
  assert.equal(f.state.reloads, 0);
  assert.equal(f.state.busy, false);
  assert.equal(f.context.lock.current, false);
}

{
  const f = persistence({busy: true});
  const result = await f.save();
  assert.equal(result.ok, false, 'busy writes must not look successful');
  assert.equal(f.state.rpcCalls.length, 0);
}

{
  const f = persistence({reload: async () => { throw new Error('refresh disconnected'); }});
  const result = await f.save();
  assert.equal(result.ok, true, 'successful RPC followed by failed reload is still committed');
  assert.equal(result.refreshed, false);
  assert.equal(f.state.rpcCalls.length, 1);
  assert.equal(f.state.busy, false);
}

{
  const ack = deferred();
  const calls = [];
  const store = {rows: [], profiles: [], schools: [], save: (...args) => { calls.push(args); return ack.promise; }};
  const hookCode = ts.transpileModule(`const kinds = ${kindsExpression}; ${hookFunctions.join('\n')} globalThis.readList = useCloudList;`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
  const context = {useCloud: () => store};
  vm.createContext(context);
  vm.runInContext(hookCode, context);
  const [, legacySet, saveList] = context.readList('lti_assignments', []);
  const pending = saveList([{id: 'assignment-test'}]);
  assert.equal(typeof pending.then, 'function', 'awaitable list setter preserves the persistence result');
  ack.resolve({ok: false, error: 'network'});
  assert.equal((await pending).ok, false);
  assert.equal(calls[0][0], 'assignments');
  assert.equal(legacySet([]), undefined, 'existing fire-and-forget setter remains compatible');
}

console.log('PASS: submission draft preservation, database acknowledgement, retries, duplicate clicks, upload failure, text-only/empty validation, resubmission confirmation, committed refresh failure, persistence results and hook propagation');
