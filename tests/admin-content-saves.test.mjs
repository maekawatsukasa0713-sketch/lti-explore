import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

// Execute the actual App callbacks against synthetic data and deferred IO.
// This test does not load the production client or perform any network calls.
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['resetContestForm', 'handleStartEditContest', 'handleCreateContest', 'handleDeleteContest', 'resetNoticeForm', 'handleStartEditNotice', 'handleSaveNotice', 'handleDeleteNotice', 'openPaperPreview', 'openRejectPaper', 'handleConfirmRejectPaper', 'handleSendPaperMessage', 'PaperPreviewModal', 'RejectPaperModal'];
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) callbacks.set(node.name.text, node.initializer.getText(app));
  ts.forEachChild(node, visit);
}
visit(app);
assert.equal(callbacks.size, names.length);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const event = () => ({preventDefault() {}});
const ok = {ok: true, refreshed: true};

function fixture({save = async () => ok, upload = async () => 'fixture-school/brochure.pdf', confirmed = true} = {}) {
  const existingContest = {id: 10, title: '既存コンテスト', category: '既存分野', date: '2026/12', description: '既存説明', targetType: 'all', brochurePath: 'fixture/previous.pdf', brochureName: 'previous.pdf', extra: 'preserved'};
  const existingNotice = {id: 11, title: '既存お知らせ', content: '既存内容', date: '2026/11/01', targetType: 'all', extra: 'preserved'};
  const existingPaper = {id: 12, schoolId: 'fixture-school', title: '既存論文', status: '承認待ち', messages: [{id: 1, sender: 'teacher', text: '既存返信'}]};
  const unrelatedPaper = {id: 13, schoolId: 'other-fixture-school', title: '変更しない論文', messages: []};
  const state = {calls: [], uploads: [], confirmations: 0, scrolls: 0}; let nextId = 100;
  const c = {
    Error, React, Send: () => null, PdfView: () => null, window: {scrollTo: () => {state.scrolls++;}},
    contests: [existingContest], notices: [existingNotice], papers: [existingPaper, unrelatedPaper],
    newContestTitle: '保持する大会名', newContestCategory: '探究', newContestDate: '2026/12/01', newContestDeadlineDate: '2026-11-30', newContestDesc: '保持する大会説明', newContestUrl: 'https://example.com/contest',
    newContestBrochureFile: {name: 'new.pdf'}, contestBrochureUploadProgress: null, newContestTargetType: 'specific', newContestTargetSchools: ['fixture-school'], editingContestId: null, contestMessage: '', contestError: '', contestSaving: false,
    contestPending: {current: false}, contestDraftId: {current: null}, uploadedContestBrochures: {current: new WeakMap()}, contestFileInput: {current: {value: 'selected.pdf'}},
    newNoticeTitle: '保持するお知らせ名', newNoticeContent: '保持するお知らせ本文', newNoticeTargetType: 'specific', newNoticeTargetSchools: ['fixture-school'], editingNoticeId: null, noticeMessage: '', noticeError: '', noticeSaving: false,
    noticePending: {current: false}, noticeDraftId: {current: null},
    paperReplyDraft: '保持する返信', rejectMessageDraft: '保持する差し戻し理由', rejectTargetPaper: existingPaper, previewPaper: existingPaper,
    paperMessageSaving: false, paperMessageError: '', paperMessageSuccess: '', rejectPaperError: '', publicationMessage: '', paperMessagePending: {current: false}, paperMessageDraftIds: {current: new Map()},
    step: 'lti-admin', ltiAdminUsers: [{id: 'fixture-admin', name: 'Fixture Admin'}], currentLtiAdminId: 'fixture-admin', teachersList: [{id: 'fixture-teacher', schoolId: 'fixture-school', name: 'Fixture Teacher'}], currentTeacherId: 'fixture-teacher', schoolId: 'fixture-school',
    nextTeacherRecordId: () => ++nextId, nowJpString: () => '2026/11/05 12:00', safeExternalUrl: value => value,
    confirm: () => {state.confirmations++; return confirmed;},
    uploadPdf: async (...args) => {state.uploads.push(args); return upload(...args);},
  };
  for (const [kind, name] of [['contests', 'saveContests'], ['notices', 'saveNotices'], ['papers', 'savePapers']]) c[name] = async value => {state.calls.push({kind, value}); return save(value, kind);};
  for (const key of Object.keys(c)) {
    if (typeof c[key] === 'function' || key.endsWith('Pending') || key.endsWith('DraftId')) continue;
    c['set' + key[0].toUpperCase() + key.slice(1)] = value => {c[key] = typeof value === 'function' ? value(c[key]) : value;};
  }
  vm.createContext(c);
  for (const [name, source] of callbacks) vm.runInContext(ts.transpileModule(`globalThis.${name} = ${source};`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React}}).outputText, c);
  return {c, state, existingContest, existingNotice, existingPaper, unrelatedPaper};
}

for (const kind of ['contest', 'notice']) {
  const cap = kind[0].toUpperCase() + kind.slice(1), handler = kind === 'contest' ? 'handleCreateContest' : 'handleSaveNotice';
  // Delayed acknowledgement: preserve edit context and block save/delete/edit races.
  {
    const ack = deferred(), f = fixture({save: () => ack.promise});
    if (kind === 'contest') f.c.newContestBrochureFile = null;
    const pending = f.c[handler](event());
    await f.c[handler](event()); await f.c['handleDelete' + cap](kind === 'contest' ? 10 : 11);
    f.c['handleStartEdit' + cap](f['existing' + cap]);
    assert.equal(f.state.calls.length, 1); assert.equal(f.state.confirmations, 0); assert.equal(f.state.scrolls, 0);
    assert.equal(f.c[kind + 'Saving'], true); assert.equal(f.c[kind + 'Message'], '');
    assert.match(f.c['new' + cap + 'Title'], /保持する/); assert.equal(f.c['editing' + cap + 'Id'], null);
    ack.resolve(ok); await pending;
    assert.equal(f.c['new' + cap + 'Title'], ''); assert.equal(f.c[kind + 'Pending'].current, false); assert.equal(f.c[kind + 'Saving'], false);
    assert.match(f.c[kind + 'Message'], /配信しました/);
    if (kind === 'notice') assert.match(f.c.noticeMessage, /指定した学校/);
  }
  // A failed save can be retried with the same ID and all audience/body/file fields.
  for (const throws of [false, true]) {
    let attempts = 0;
    const f = fixture({save: async () => {if (++attempts === 1) {if (throws) throw new Error('fixture network failure'); return {ok: false, error: 'fixture denied'};} return {ok: true, refreshed: false};}});
    const file = f.c.newContestBrochureFile;
    await f.c[handler](event());
    assert.match(f.c['new' + cap + 'Title'], /保持する/); assert.match(f.c[kind + 'Error'], /fixture/); assert.equal(f.c[kind + 'Message'], '');
    assert.equal(f.c['new' + cap + 'TargetType'], 'specific'); assert.equal(f.c['new' + cap + 'TargetSchools'][0], 'fixture-school');
    if (kind === 'contest') {assert.equal(f.c.newContestBrochureFile, file); assert.equal(f.c.contestFileInput.current.value, 'selected.pdf'); assert.equal(f.c.newContestDesc, '保持する大会説明');}
    else assert.equal(f.c.newNoticeContent, '保持するお知らせ本文');
    const id = f.state.calls[0].value[0].id;
    await f.c[handler](event());
    assert.equal(f.state.calls[1].value[0].id, id); assert.equal(f.c[kind + 'DraftId'].current, null);
    assert.match(f.c[kind + 'Message'], /再送信せず/); assert.equal(f.c[kind + 'Error'], '');
    assert.equal(f.c['new' + cap + 'Title'], '');
    if (kind === 'contest') {assert.equal(f.state.uploads.length, 1, 'successful brochure upload is reused after record-save failure'); assert.equal(f.c.contestFileInput.current.value, '');}
  }
  // Editing never creates another ID or loses existing unrelated fields / notice date.
  {
    let attempts = 0;
    const f = fixture({save: async () => ++attempts === 1 ? {ok: false, error: 'fixture response lost'} : ok});
    await f.c[handler](event());
    f.c[kind === 'contest' ? 'contests' : 'notices'] = f.state.calls[0].value;
    f.c['new' + cap + 'Title'] = '再試行時の修正内容';
    await f.c[handler](event());
    const records = f.state.calls[1].value;
    assert.equal(records.length, 2, 'a discovered committed draft must not be duplicated in the retry snapshot');
    assert.equal(new Set(records.map(r => r.id)).size, 2);
    assert.equal(records[0].title, '再試行時の修正内容', 'previously committed values must not shadow the retry');
  }
  {
    const f = fixture(); f.c['editing' + cap + 'Id'] = f['existing' + cap].id;
    if (kind === 'contest') f.c.newContestBrochureFile = null;
    await f.c[handler](event()); const record = f.state.calls[0].value[0];
    assert.equal(record.id, f['existing' + cap].id); assert.equal(record.extra, 'preserved'); assert.equal(f.state.calls[0].value.length, 1);
    if (kind === 'contest') assert.equal(record.brochurePath, f.existingContest.brochurePath);
    else assert.equal(record.date, f.existingNotice.date);
  }
  // Unknown edited IDs and empty specific audience never produce a false success.
  for (const issue of ['missing', 'audience']) {
    const f = fixture();
    if (issue === 'missing') f.c['editing' + cap + 'Id'] = 999;
    else f.c['new' + cap + 'TargetSchools'] = [];
    await f.c[handler](event()); assert.equal(f.state.calls.length, 0); assert.equal(f.state.uploads.length, 0);
    assert.match(f.c['new' + cap + 'Title'], /保持する/); assert.ok(f.c[kind + 'Error']); assert.equal(f.c[kind + 'Message'], '');
  }
  // Failed delete must keep the current edit and must not race another operation.
  {
    const ack = deferred(), f = fixture({save: () => ack.promise}); f.c['editing' + cap + 'Id'] = f['existing' + cap].id;
    const pending = f.c['handleDelete' + cap](f['existing' + cap].id);
    await f.c['handleDelete' + cap](f['existing' + cap].id); await f.c[handler](event());
    assert.equal(f.state.calls.length, 1); assert.equal(f.state.confirmations, 1); assert.match(f.c['new' + cap + 'Title'], /保持する/);
    ack.resolve({ok: false, error: 'fixture delete denied'}); await pending;
    assert.match(f.c['new' + cap + 'Title'], /保持する/); assert.equal(f.c['editing' + cap + 'Id'], f['existing' + cap].id);
    assert.match(f.c[kind + 'Error'], /fixture delete denied/); assert.equal(f.c[kind + 'Saving'], false);
  }
  for (const sameEdit of [false, true]) {
    const f = fixture({save: async () => ({ok: true, refreshed: false})}); f.c['editing' + cap + 'Id'] = sameEdit ? f['existing' + cap].id : 999;
    await f.c['handleDelete' + cap](f['existing' + cap].id); assert.match(f.c[kind + 'Message'], /削除は完了/);
    assert.equal(f.c['new' + cap + 'Title'] === '', sameEdit, 'deleting another item must preserve the draft being edited');
  }
  {
    const f = fixture({confirmed: false}); await f.c['handleDelete' + cap](f['existing' + cap].id);
    assert.equal(f.state.calls.length, 0); assert.equal(f.c[kind + 'Pending'].current, false);
  }
}

// File upload itself also holds the duplicate guard, keeps the selected file on
// failure, and only proceeds to the record save when storage acknowledges it.
{
  const uploadAck = deferred(), f = fixture({upload: () => uploadAck.promise});
  const selected = f.c.newContestBrochureFile, pending = f.c.handleCreateContest(event());
  await f.c.handleCreateContest(event()); await f.c.handleDeleteContest(10);
  assert.equal(f.state.uploads.length, 1); assert.equal(f.state.calls.length, 0);
  assert.equal(f.c.contestSaving, true); assert.equal(f.c.contestMessage, '');
  uploadAck.reject(new Error('fixture upload failure')); await pending;
  assert.equal(f.c.newContestBrochureFile, selected); assert.match(f.c.contestError, /fixture upload failure/);
  assert.equal(f.c.contestPending.current, false); assert.equal(f.c.contestBrochureUploadProgress, null);
}

for (const kind of ['reply', 'reject']) {
  const run = c => kind === 'reply' ? c.handleSendPaperMessage(12, c.paperReplyDraft) : c.handleConfirmRejectPaper();
  const draft = kind === 'reply' ? 'paperReplyDraft' : 'rejectMessageDraft', error = kind === 'reply' ? 'paperMessageError' : 'rejectPaperError';
  {
    const ack = deferred(), f = fixture({save: () => ack.promise}), pending = run(f.c);
    await run(f.c); await f.c.handleSendPaperMessage(12, 'duplicate'); await f.c.handleConfirmRejectPaper();
    f.c.openPaperPreview(f.unrelatedPaper); f.c.openRejectPaper(f.unrelatedPaper);
    assert.equal(f.state.calls.length, 1); assert.equal(f.c.previewPaper, f.existingPaper); assert.equal(f.c.rejectTargetPaper, f.existingPaper);
    assert.match(f.c[draft], /保持する/); assert.equal(f.c.paperMessageSuccess, ''); assert.equal(f.c.paperMessageSaving, true);
    assert.equal(f.state.calls[0].value[1], f.unrelatedPaper); assert.equal(f.state.calls[0].value[0].messages[0], f.existingPaper.messages[0]);
    ack.resolve({ok: false, error: 'fixture message failure'}); await pending;
    assert.match(f.c[draft], /保持する/); assert.match(f.c[error], /fixture message failure/); assert.equal(f.c.paperMessageSaving, false);
    assert.equal(f.c.rejectTargetPaper, f.existingPaper); assert.equal(f.c.previewPaper, f.existingPaper);
  }
  // A lost response followed by a reload must not append the same draft twice.
  {
    let attempts = 0;
    const f = fixture({save: async () => ++attempts === 1 ? {ok: false, error: 'fixture uncertain response'} : {ok: true, refreshed: false}});
    await run(f.c); const first = f.state.calls[0].value[0], id = first.messages.at(-1).id;
    f.c.papers = f.state.calls[0].value; // simulate discovering the original write on reload
    await run(f.c); const second = f.state.calls[1].value[0];
    assert.equal(second.messages.at(-1).id, id); assert.equal(second.messages.length, 2);
    assert.equal(f.c[draft], ''); assert.equal(f.c.paperMessageDraftIds.current.size, 0);
    assert.match(kind === 'reply' ? f.c.paperMessageSuccess : f.c.publicationMessage, /再送信せず/);
    if (kind === 'reply') assert.equal(f.c.previewPaper.messages.length, 2);
    else {assert.equal(second.status, '差し戻し'); assert.equal(f.c.rejectTargetPaper, null);}
  }
  {
    const f = fixture({save: async () => {throw new Error('fixture exception');}});
    await run(f.c); assert.match(f.c[draft], /保持する/); assert.match(f.c[error], /fixture exception/); assert.equal(f.c.paperMessagePending.current, false);
  }
}

{
  const f = fixture(); f.c.step = 'teacher'; await f.c.handleSendPaperMessage(12, f.c.paperReplyDraft);
  const message = f.state.calls[0].value[0].messages.at(-1);
  assert.equal(message.sender, 'teacher'); assert.equal(message.senderName, 'Fixture Teacher');
  assert.equal(f.c.previewPaper.messages.at(-1).text, '保持する返信');
  assert.match(f.c.paperMessageSuccess, /送信しました/);
}
{
  const f = fixture(); f.c.rejectMessageDraft = ''; await f.c.handleConfirmRejectPaper();
  assert.equal(f.state.calls[0].value[0].messages.length, 1, 'an optional blank rejection reason must not append an empty message');
}

console.log('PASS: actual contest/notice/rejection/reply callbacks wait for ACK, preserve failed drafts, block duplicates, reuse IDs/uploads, and recover after refresh failure');

function elements(root, type) {
  const result = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === type) result.push(node);
    visit(node.props?.children);
  };
  visit(root); return result;
}

// Use the modal's own handlers: both explicit close buttons cancel the draft,
// and neither is enabled while the server acknowledgement is still pending.
for (const closeIndex of [0, 1]) {
  const f = fixture(), tree = f.c.PaperPreviewModal(f.c);
  const closes = elements(tree, 'button').filter(button => typeof button.props.children === 'string' && button.props.children.includes('閉じる'));
  assert.equal(closes.length, 2); assert.equal(closes[closeIndex].props.disabled, false);
  closes[closeIndex].props.onClick();
  assert.equal(f.c.previewPaper, null); assert.equal(f.c.paperReplyDraft, '');
  f.c.openPaperPreview(f.unrelatedPaper);
  const reopened = elements(f.c.PaperPreviewModal(f.c), 'textarea');
  assert.equal(reopened[0].props.value, '', 'a cancelled reply must not appear on another paper');
  assert.equal(f.state.calls.length, 0, 'closing or opening a preview never sends the cancelled draft');
}
{
  const ack = deferred(), f = fixture({save: () => ack.promise});
  const pending = f.c.handleSendPaperMessage(12, f.c.paperReplyDraft);
  const tree = f.c.PaperPreviewModal(f.c), buttons = elements(tree, 'button');
  assert.equal(buttons.length, 3); assert.ok(buttons.every(button => button.props.disabled));
  assert.equal(elements(tree, 'textarea')[0].props.disabled, true);
  assert.equal(f.c.paperReplyDraft, '保持する返信');
  ack.resolve({ok: false, error: 'fixture delayed failure'}); await pending;
  const recovered = f.c.PaperPreviewModal(f.c);
  assert.equal(elements(recovered, 'textarea')[0].props.value, '保持する返信');
  assert.ok(elements(recovered, 'button').every(button => button.props.disabled === false));
}

console.log('PASS: preview close callbacks cancel drafts consistently and keep close/edit disabled until ACK');

// If a response is lost after the server saved it, cancelling and starting a
// new operation on the same paper must allocate a new ID, not replace history.
for (const kind of ['reply', 'reject']) {
  for (const closeIndex of [0, 1]) {
    let attempts = 0;
    const f = fixture({save: async () => ++attempts === 1 ? {ok: false, error: 'fixture response lost'} : ok});
    const run = () => kind === 'reply' ? f.c.handleSendPaperMessage(12, f.c.paperReplyDraft) : f.c.handleConfirmRejectPaper();
    const draft = kind === 'reply' ? 'paperReplyDraft' : 'rejectMessageDraft';
    const modal = kind === 'reply' ? 'PaperPreviewModal' : 'RejectPaperModal';
    await run();
    const first = f.state.calls[0].value[0], savedMessage = first.messages.at(-1);
    f.c.papers = f.state.calls[0].value;
    const cancelButtons = elements(f.c[modal](f.c), 'button').filter(button => typeof button.props.children === 'string' && /閉じる|キャンセル/.test(button.props.children));
    assert.equal(cancelButtons.length, 2); cancelButtons[closeIndex].props.onClick();
    assert.equal(f.c[draft], '');
    if (kind === 'reply') f.c.openPaperPreview(first); else f.c.openRejectPaper(first);
    assert.equal(f.c.paperMessageDraftIds.current.has(`${kind}:12`), false);
    f.c[draft] = 'キャンセル後に始めた新しい文面'; await run();
    const finalMessages = f.state.calls[1].value[0].messages;
    assert.equal(finalMessages.length, 3); assert.equal(finalMessages[1], savedMessage);
    assert.equal(finalMessages[1].text, savedMessage.text);
    assert.notEqual(finalMessages[2].id, savedMessage.id);
    assert.equal(finalMessages[2].text, 'キャンセル後に始めた新しい文面');
  }
}

console.log('PASS: cancelling and reopening reply/rejection creates a new operation without overwriting previously saved messages');
