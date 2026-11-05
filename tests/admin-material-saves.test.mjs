import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Use the real callbacks with synthetic state and deferred IO. No production
// client, user credentials, filesystem mutations or network calls are involved.
const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['handleUploadMaterial', 'handleDeleteMaterial', 'handleAddMaterialSlideImage', 'updateDraftSlideCaption', 'removeDraftSlide', 'moveDraftSlide', 'AdminSystemGuide'];
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) callbacks.set(node.name.text, node.initializer.getText(app));
  ts.forEachChild(node, visit);
}
visit(app);
assert.equal(callbacks.size, names.length);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const event = () => ({preventDefault() {}});

function fixture({save = async () => ({ok: true, refreshed: true}), confirmed = true, fileReadThrows = false} = {}) {
  const slides = [{id: 'draft-one', imageUrl: 'data:image/png;base64,fixture-one', caption: '保持する説明'}, {id: 'draft-two', imageUrl: 'data:image/png;base64,fixture-two', caption: '二枚目'}];
  const existing = {id: 12, schoolId: 'other-fixture-school', title: '既存教材', slides: [{id: 'existing-slide', imageUrl: 'data:image/png;base64,existing'}]};
  const state = {calls: [], confirmations: 0, readers: []};
  const context = {
    Error, React,
    cloud: {schools: [{id: 'fixture-school'}, {id: 'other-fixture-school'}]},
    materialSchoolId: 'fixture-school', newMaterialTitle: '保持するタイトル', newMaterialDesc: '保持する本文', draftSlides: slides,
    teachingMaterials: [existing], materialMessage: '', materialError: '', materialSaving: false, materialReadingImages: false,
    materialPending: {current: false}, materialDraftId: {current: null}, materialImageReads: {current: 0},
    saveTeachingMaterials: async value => {state.calls.push(value); return save(value);},
    confirm: () => {state.confirmations++; return confirmed;},
    FileReader: class {
      constructor() {state.readers.push(this);}
      readAsDataURL(file) {this.file = file; if (fileReadThrows) throw new Error('fixture read failure');}
    },
  };
  for (const name of ['MaterialSchoolId', 'NewMaterialTitle', 'NewMaterialDesc', 'DraftSlides', 'MaterialMessage', 'MaterialError', 'MaterialSaving', 'MaterialReadingImages']) {
    const key = name[0].toLowerCase() + name.slice(1);
    context['set' + name] = value => {context[key] = typeof value === 'function' ? value(context[key]) : value;};
  }
  vm.createContext(context);
  for (const [name, source] of callbacks) vm.runInContext(ts.transpileModule(`globalThis.${name} = ${source};`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React}}).outputText, context);
  return {state, context, slides, existing};
}

{
  const ack = deferred(), f = fixture({save: () => ack.promise});
  const pending = f.context.handleUploadMaterial(event());
  await f.context.handleUploadMaterial(event());
  await f.context.handleDeleteMaterial(12);
  f.context.handleAddMaterialSlideImage({name: 'not-added.png'});
  f.context.updateDraftSlideCaption('draft-one', 'not changed');
  f.context.removeDraftSlide('draft-one');
  f.context.moveDraftSlide('draft-one', 'down');
  assert.equal(f.state.calls.length, 1, 'upload and deletion cannot race or duplicate a pending write');
  assert.equal(f.state.confirmations, 0);
  assert.equal(f.state.readers.length, 0);
  assert.equal(f.context.materialSaving, true);
  assert.equal(f.context.newMaterialTitle, '保持するタイトル');
  assert.equal(f.context.newMaterialDesc, '保持する本文');
  assert.equal(f.context.materialSchoolId, 'fixture-school');
  assert.equal(f.context.draftSlides, f.slides);
  assert.equal(f.context.materialMessage, '', 'no success before database acknowledgement');
  assert.equal(f.state.calls[0][1], f.existing, 'existing material data is unchanged');
  ack.resolve({ok: true, refreshed: true}); await pending;
  assert.equal(f.context.newMaterialTitle, '');
  assert.equal(f.context.newMaterialDesc, '');
  assert.equal(f.context.draftSlides.length, 0);
  assert.equal(f.context.materialSchoolId, 'fixture-school');
  assert.equal(f.context.materialSaving, false);
  assert.equal(f.context.materialPending.current, false);
  assert.match(f.context.materialMessage, /保存・配信しました/);
}

{
  let attempts = 0;
  const f = fixture({save: async () => ++attempts === 1 ? {ok: false, error: 'fixture version conflict'} : {ok: true, refreshed: false}});
  await f.context.handleUploadMaterial(event());
  assert.equal(f.context.newMaterialTitle, '保持するタイトル');
  assert.equal(f.context.newMaterialDesc, '保持する本文');
  assert.equal(f.context.materialSchoolId, 'fixture-school');
  assert.equal(f.context.draftSlides, f.slides);
  assert.equal(f.context.materialSaving, false);
  assert.equal(f.context.materialMessage, '');
  assert.match(f.context.materialError, /fixture version conflict/);
  const reserved = f.context.materialDraftId.current;
  await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls.length, 2);
  assert.equal(f.state.calls[0][0].id, reserved);
  assert.equal(f.state.calls[1][0].id, reserved, 'retry must not create a second record ID');
  assert.equal(f.context.materialDraftId.current, null);
  assert.equal(f.context.draftSlides.length, 0, 'a confirmed save is final even when the subsequent refresh fails');
  assert.match(f.context.materialMessage, /再送信せず/);
  assert.equal(f.context.materialError, '');
  await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls.length, 2, 'cleared draft cannot be sent again');
}

{
  const f = fixture({save: async () => {throw new Error('fixture disconnected');}});
  await f.context.handleUploadMaterial(event());
  assert.equal(f.context.draftSlides, f.slides);
  assert.equal(f.context.newMaterialTitle, '保持するタイトル');
  assert.equal(f.context.materialPending.current, false);
  assert.equal(f.context.materialSaving, false);
  assert.match(f.context.materialError, /fixture disconnected/);
}

{
  const f = fixture(); f.context.materialSchoolId = '';
  await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls.length, 0); assert.equal(f.context.draftSlides, f.slides);
  assert.match(f.context.materialError, /学校を選択/);
  f.context.materialSchoolId = 'missing-school';
  await f.context.handleUploadMaterial(event()); assert.equal(f.state.calls.length, 0);
  f.context.materialSchoolId = 'fixture-school'; f.context.newMaterialTitle = '  ';
  await f.context.handleUploadMaterial(event()); assert.equal(f.state.calls.length, 0);
  f.context.newMaterialTitle = 'Title'; f.context.draftSlides = [];
  await f.context.handleUploadMaterial(event()); assert.equal(f.state.calls.length, 0);
}

{
  const ack = deferred(), f = fixture({save: () => ack.promise});
  const pending = f.context.handleDeleteMaterial(12);
  await f.context.handleDeleteMaterial(12); await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.confirmations, 1);
  assert.equal(f.state.calls[0].length, 0);
  assert.equal(f.context.teachingMaterials[0], f.existing, 'do not mutate the displayed collection while deletion is pending');
  assert.equal(f.context.materialMessage, '');
  ack.resolve({ok: false, error: 'fixture delete denied'}); await pending;
  assert.equal(f.context.teachingMaterials[0], f.existing);
  assert.equal(f.context.draftSlides, f.slides, 'deletion does not discard a new unsaved material');
  assert.equal(f.context.newMaterialTitle, '保持するタイトル');
  assert.equal(f.context.materialPending.current, false);
  assert.match(f.context.materialError, /fixture delete denied/);
}

{
  const f = fixture({save: async () => ({ok: true, refreshed: false})});
  await f.context.handleDeleteMaterial(12);
  assert.match(f.context.materialMessage, /削除は完了/);
  assert.equal(f.context.draftSlides, f.slides); assert.equal(f.context.materialSaving, false);
  const cancelled = fixture({confirmed: false});
  await cancelled.context.handleDeleteMaterial(12);
  assert.equal(cancelled.state.calls.length, 0); assert.equal(cancelled.context.materialSaving, false);
}

{
  const f = fixture();
  f.context.handleAddMaterialSlideImage({name: 'loading.png'});
  assert.equal(f.context.materialReadingImages, true);
  await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls.length, 0, 'a pending image read must finish before a save snapshot is built');
  const reader = f.state.readers[0]; reader.result = 'data:image/png;base64,loaded'; reader.onload(); reader.onloadend();
  assert.equal(f.context.materialReadingImages, false); assert.equal(f.context.materialImageReads.current, 0);
  assert.equal(f.context.draftSlides.length, 3);
  await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls[0][0].slides.length, 3);
  assert.equal(f.state.calls[0][0].slides[2].imageUrl, 'data:image/png;base64,loaded');
}

for (const synchronous of [false, true]) {
  const f = fixture({fileReadThrows: synchronous}); f.context.handleAddMaterialSlideImage({name: 'broken.png'});
  if (!synchronous) {f.state.readers[0].onerror(); f.state.readers[0].onloadend();}
  assert.equal(f.context.draftSlides, f.slides);
  assert.equal(f.context.materialReadingImages, false); assert.equal(f.context.materialImageReads.current, 0);
  assert.match(f.context.materialError, /画像を読み込めません/);
}

// A retry after discovering a committed write must not create duplicate IDs or
// let the previous record override edits made after the failed response.
{
  let attempts = 0;
  const f = fixture({save: async () => ++attempts === 1 ? {ok: false, error: 'fixture response lost'} : {ok: true, refreshed: true}});
  await f.context.handleUploadMaterial(event());
  f.context.teachingMaterials = f.state.calls[0];
  f.context.newMaterialTitle = '再試行時の修正内容';
  await f.context.handleUploadMaterial(event());
  assert.equal(f.state.calls[1].length, 2);
  assert.equal(new Set(f.state.calls[1].map(m => m.id)).size, 2);
  assert.equal(f.state.calls[1][0].title, '再試行時の修正内容');
}

// These replacement admin pages are navigation and documentation only. They
// must use existing destinations rather than exposing a fictional permission API.
{
  const f = fixture();
  const destinations = new Set(['学校・利用者管理', '運営者管理', '教材管理', '公開申請一覧', 'LTI受信ボックス']);
  for (const tab of ['設定', '権限管理', 'ヘルプ']) {
    const selected = [], page = f.context.AdminSystemGuide({tab, onNavigate: target => selected.push(target)});
    const html = renderToStaticMarkup(page);
    assert.ok(html.includes(tab)); assert.doesNotMatch(html, /<(?:input|form|select)\b/);
    const inspect = node => {if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(inspect); if (node.type === 'button') node.props.onClick(); inspect(node.props?.children);};
    inspect(page); assert.ok(selected.length > 0); assert.ok(selected.every(target => destinations.has(target)));
  }
}

console.log('PASS: admin material ACK, draft retention, stable retry IDs, duplicate guards, image-read ordering, delete recovery and admin guide navigation');
