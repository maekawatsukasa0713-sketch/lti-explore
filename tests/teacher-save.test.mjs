import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the production callbacks with delayed/rejected IO, without importing
// the app, credentials or a production client. These cases protect user drafts.
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['handleCreateOrUpdateAssignment', 'handleDeleteAssignment', 'handleTeacherSubmitPaper', 'handleTeacherBatchSubmitPapers', 'handleSendAiReviewToStudent', 'handleSendManualFeedback', 'reviewFailureDetails'];
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) callbacks.set(node.name.text, node.initializer.getText(app));
  ts.forEachChild(node, visit);
}
visit(app);
assert.equal(callbacks.size, names.length);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const event = () => ({preventDefault() {}, currentTarget: {resets: 0, reset() {this.resets++;}}});

function fixture({save = async () => ({ok: true, refreshed: true}), upload = async file => `fixture/${file.name}`} = {}) {
  const file = {name: 'draft.pdf', size: 12, lastModified: 1};
  const state = {uploads: [], writes: [], ai: {sent: false}, assignedIds: 1000};
  const context = {
    Error, Map, WeakMap, Set, Intl,
    schoolId: 'fixture-school', cloud: {schools: [{id: 'fixture-school', name: 'Fixture school'}]}, loggedInTeacher: {id: 'fixture-teacher', name: 'Fixture teacher'},
    assignments: [], papers: [], studentFeedbackMessages: [],
    newAssignTitle: '保持する課題', newAssignDeadline: '2027-04-02', newAssignDesc: '保持する説明', newAssignAttachment: file, editingAssignmentId: null,
    teacherPaperTitle: '保持する論文', teacherPaperAuthor: '架空著者', teacherPaperAbstract: '保持する要旨', teacherPaperFile: file, teacherPaperField: '化学', editingPaper: null,
    teacherBatchPaperFiles: [file], manualFeedbackDrafts: {'42:student-a': '保持するコメント', '43:student-b': '別の下書き'}, manualFeedbackStatus: {},
    assignmentPending: {current: false}, assignmentDraftId: {current: null}, uploadedAssignmentFiles: {current: new WeakMap()},
    teacherPaperPending: {current: false}, teacherPaperDraftId: {current: null}, uploadedTeacherPapers: {current: new WeakMap()}, teacherBatchDraftIds: {current: new WeakMap()},
    feedbackPending: {current: new Set()}, feedbackDraftIds: {current: new Map()}, sentAiReviewIds: {current: new Set()},
    nextTeacherRecordId: () => ++state.assignedIds,
    confirm: () => true,
    uploadPdf: async selected => {state.uploads.push(selected); return upload(selected);},
    updateAiReviewItem: (_id, patch) => Object.assign(state.ai, patch),
  };
  for (const name of ['AssignmentSubmitting', 'AssignMessage', 'AssignError', 'AssignmentUploadProgress', 'EditingAssignmentId', 'NewAssignTitle', 'NewAssignDeadline', 'NewAssignDesc', 'NewAssignAttachment', 'TeacherPaperSubmitting', 'TeacherApplyMessage', 'TeacherApplyError', 'EditingPaper', 'TeacherPaperTitle', 'TeacherPaperAuthor', 'TeacherPaperAbstract', 'TeacherPaperFile', 'TeacherBatchSubmitting', 'TeacherBatchProgress', 'TeacherBatchPaperFiles', 'ManualFeedbackDrafts', 'ManualFeedbackStatus']) {
    const key = name[0].toLowerCase() + name.slice(1);
    context['set' + name] = value => { context[key] = typeof value === 'function' ? value(context[key]) : value; };
  }
  for (const [method, kind] of [['saveAssignments', 'assignments'], ['savePapers', 'papers'], ['saveStudentFeedbackMessages', 'feedback']]) {
    context[method] = async value => {state.writes.push({kind, value}); return save(value, kind);};
  }
  vm.createContext(context);
  for (const [name, source] of callbacks) vm.runInContext(ts.transpileModule(`globalThis.${name} = ${source};`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText, context);
  return {context, state, file};
}

for (const method of ['handleCreateOrUpdateAssignment', 'handleTeacherSubmitPaper']) {
  const ack = deferred();
  const f = fixture({save: () => ack.promise});
  const isAssignment = method === 'handleCreateOrUpdateAssignment';
  const title = isAssignment ? 'newAssignTitle' : 'teacherPaperTitle';
  const file = isAssignment ? 'newAssignAttachment' : 'teacherPaperFile';
  const busy = isAssignment ? 'assignmentSubmitting' : 'teacherPaperSubmitting';
  const success = isAssignment ? 'assignMessage' : 'teacherApplyMessage';
  const inputEvent = event();
  const first = f.context[method](inputEvent);
  await flush();
  await f.context[method](event());
  assert.equal(f.state.writes.length, 1, `${method}: duplicate clicks cannot create a second write`);
  assert.equal(f.state.uploads.length, 1);
  assert.ok(f.context[title]);
  assert.equal(f.context[file], f.file);
  assert.equal(f.context[success], '', 'no success before acknowledgement');
  assert.equal(f.context[busy], true);
  assert.equal(inputEvent.currentTarget.resets, 0, 'native selected file stays until confirmed');
  ack.resolve({ok: true, refreshed: true});
  await first;
  assert.equal(f.context[title], '');
  assert.equal(f.context[file], null);
  assert.equal(f.context[busy], false);
  assert.match(f.context[success], /配信|送信/);
  assert.equal(inputEvent.currentTarget.resets, 1, 'confirmed success clears the native file selection for the next draft');
}

for (const method of ['handleCreateOrUpdateAssignment', 'handleTeacherSubmitPaper']) {
  let attempts = 0;
  const f = fixture({save: async () => ++attempts === 1 ? {ok: false, error: 'fixture conflict'} : {ok: true, refreshed: false}});
  const isAssignment = method === 'handleCreateOrUpdateAssignment';
  const title = isAssignment ? 'newAssignTitle' : 'teacherPaperTitle';
  const file = isAssignment ? 'newAssignAttachment' : 'teacherPaperFile';
  const error = isAssignment ? 'assignError' : 'teacherApplyError';
  const success = isAssignment ? 'assignMessage' : 'teacherApplyMessage';
  const originalTitle = f.context[title];
  await f.context[method](event());
  assert.equal(f.context[title], originalTitle);
  assert.equal(f.context[file], f.file);
  assert.match(f.context[error], /fixture conflict/);
  assert.equal(f.context[success], '');
  await f.context[method](event());
  assert.equal(f.state.uploads.length, 1, 'retry reuses successful upload');
  assert.equal(f.state.writes[0].value[0].id, f.state.writes[1].value[0].id, 'retry keeps the draft record ID');
  assert.equal(f.context[title], '');
  assert.match(f.context[success], /再送信せず/);
  assert.equal(f.context[error], '');
}

for (const method of ['handleCreateOrUpdateAssignment', 'handleTeacherSubmitPaper']) {
  const f = fixture({upload: async () => {throw new Error('upload failed');}});
  await f.context[method](event());
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.context.newAssignAttachment, f.file);
  assert.equal(f.context.teacherPaperFile, f.file);
  assert.equal(f.context.assignmentPending.current, false);
  assert.equal(f.context.teacherPaperPending.current, false);
}

{
  const f = fixture();
  const original = {id: 42, schoolId: 'fixture-school', title: '元課題', status: '未提出', attachmentPath: 'fixture/original.pdf', submissions: {'student-a': {submittedText: '既存提出を保持'}}};
  f.context.editingAssignmentId = 42; f.context.assignments = [original]; f.context.newAssignAttachment = null;
  await f.context.handleCreateOrUpdateAssignment(event());
  assert.equal(f.state.writes[0].value[0].id, 42);
  assert.equal(f.state.writes[0].value[0].submissions, original.submissions);
  assert.equal(f.state.writes[0].value[0].attachmentPath, 'fixture/original.pdf');
  assert.equal(original.title, '元課題', 'editing never mutates existing records before save');
}

{
  const ack = deferred();
  const f = fixture({save: () => ack.promise});
  const draft = {id: 42, submissions: {}};
  f.context.assignments = [draft]; f.context.editingAssignmentId = 42;
  const first = f.context.handleDeleteAssignment(42);
  await f.context.handleDeleteAssignment(42);
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.context.editingAssignmentId, 42);
  ack.resolve({ok: false, error: 'not deleted'}); await first;
  assert.equal(f.context.editingAssignmentId, 42);
  assert.equal(f.context.newAssignTitle, '保持する課題');
  assert.equal(f.context.assignments[0], draft);
}

{
  const transfer = deferred(), ack = deferred();
  const f = fixture({upload: () => transfer.promise, save: () => ack.promise});
  const first = f.context.handleTeacherBatchSubmitPapers();
  await f.context.handleTeacherBatchSubmitPapers();
  await f.context.handleTeacherSubmitPaper(event());
  assert.equal(f.state.uploads.length, 1, 'batch and regular publication share a pending guard');
  transfer.resolve('fixture/uploaded.pdf'); await flush();
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.context.teacherBatchPaperFiles[0], f.file);
  assert.equal(f.context.teacherBatchSubmitting, true);
  assert.doesNotMatch(f.context.teacherApplyMessage, /送信しました/);
  ack.resolve({ok: false, error: 'batch DB failure'}); await first;
  assert.equal(f.context.teacherBatchPaperFiles[0], f.file);
  assert.match(f.context.teacherApplyError, /batch DB failure/);
  assert.equal(f.context.teacherBatchSubmitting, false);
  f.context.savePapers = async value => {f.state.writes.push({kind: 'papers', value}); return {ok: true, refreshed: true};};
  await f.context.handleTeacherBatchSubmitPapers();
  assert.equal(f.state.uploads.length, 1);
  assert.equal(f.state.writes[0].value[0].id, f.state.writes[1].value[0].id);
  assert.equal(f.context.teacherBatchPaperFiles.length, 0);
  assert.match(f.context.teacherApplyMessage, /1件.*送信しました/);
}

{
  const rejectedFile = {name: 'bad.docx', size: 22, lastModified: 2};
  const f = fixture({upload: async file => {if (file === rejectedFile) throw new Error('broken file'); return 'fixture/good.pdf';}});
  f.context.teacherBatchPaperFiles = [f.file, rejectedFile];
  await f.context.handleTeacherBatchSubmitPapers();
  assert.equal(f.state.writes[0].value.length, 1);
  assert.equal(f.context.teacherBatchPaperFiles.length, 1);
  assert.equal(f.context.teacherBatchPaperFiles[0], rejectedFile, 'only unsubmitted files remain after partial upload success');
  assert.match(f.context.teacherApplyError, /broken file/);
}

const review = () => ({id: 'review-a', studentId: 'student-a', paperTitle: '架空論文', fileName: 'fixture.pdf', note: '保持する付記', sent: false, result: {corrections: ['保持する添削'], advice: [], nextExperiments: []}});
{
  const ack = deferred(); const f = fixture({save: () => ack.promise}); const item = review();
  const first = f.context.handleSendAiReviewToStudent(item);
  await f.context.handleSendAiReviewToStudent(item);
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.ai.sent, false);
  assert.equal(f.state.ai.sending, true);
  ack.resolve({ok: false, error: 'feedback DB failure'}); await first;
  assert.equal(f.state.ai.sent, false);
  assert.equal(f.state.ai.sending, false);
  assert.match(f.state.ai.sendError, /feedback DB failure/);
  assert.equal(item.studentId, 'student-a'); assert.equal(item.note, '保持する付記'); assert.equal(item.result.corrections[0], '保持する添削');
  f.context.saveStudentFeedbackMessages = async value => {f.state.writes.push({kind: 'feedback', value}); return {ok: true, refreshed: false};};
  await f.context.handleSendAiReviewToStudent(item);
  assert.equal(f.state.writes[0].value[0].id, f.state.writes[1].value[0].id);
  assert.equal(f.state.writes[1].value[0].source, 'ai');
  assert.equal(f.state.ai.sent, true); assert.match(f.state.ai.sendNotice, /再送信せず/);
  await f.context.handleSendAiReviewToStudent(item);
  assert.equal(f.state.writes.length, 2, 'an acknowledged review is not sent twice even by an older callback');
}

{
  let attempts = 0; const ack = deferred();
  const f = fixture({save: () => ++attempts === 1 ? ack.promise : Promise.resolve({ok: true, refreshed: true})});
  const assignment = {id: 42, title: '課題A'};
  const first = f.context.handleSendManualFeedback(assignment, 'student-a', 'fixture.pdf');
  await f.context.handleSendManualFeedback(assignment, 'student-a', 'fixture.pdf');
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.context.manualFeedbackDrafts['42:student-a'], '保持するコメント');
  assert.equal(f.context.manualFeedbackStatus['42:student-a'].pending, true);
  ack.resolve({ok: false, error: 'manual DB failure'}); await first;
  assert.equal(f.context.manualFeedbackDrafts['42:student-a'], '保持するコメント');
  assert.match(f.context.manualFeedbackStatus['42:student-a'].error, /manual DB failure/);
  await f.context.handleSendManualFeedback(assignment, 'student-a', 'fixture.pdf');
  assert.equal(f.state.writes[0].value[0].id, f.state.writes[1].value[0].id);
  assert.equal(f.state.writes[1].value[0].source, 'manual');
  assert.equal(f.state.writes[1].value[0].assignmentId, '42');
  assert.equal(f.context.manualFeedbackDrafts['42:student-a'], '');
  assert.equal(f.context.manualFeedbackDrafts['43:student-b'], '別の下書き');
  assert.match(f.context.manualFeedbackStatus['42:student-a'].success, /送信しました/);
  await f.context.handleSendManualFeedback(assignment, 'student-a', 'fixture.pdf');
  assert.equal(f.state.writes.length, 2, 'empty acknowledged draft cannot be sent again');
}

{
  const f = fixture();
  const safe = f.context.reviewFailureDetails({code: 'anthropic_401', requestId: 'req_fixture_123'});
  assert.equal(safe.errorCode, 'anthropic_401'); assert.equal(safe.requestId, 'req_fixture_123');
  const rejected = f.context.reviewFailureDetails({code: 'secret\nraw provider body', requestId: 'Bearer secret-token'});
  assert.equal(rejected.errorCode, undefined); assert.equal(rejected.requestId, undefined);
  assert.equal(f.context.reviewFailureDetails(null).errorCode, undefined);
}

console.log('Teacher save acknowledgement, draft retention, attachment retry and duplicate-submit regressions passed');
