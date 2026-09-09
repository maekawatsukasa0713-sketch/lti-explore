import React, { useState } from 'react';
import { theses, type Thesis } from './thesis-catalog';
export const kindLabel = { bachelor: '卒業論文', master: '修士論文', doctoral: '博士論文' };
const accessLabel = { title: '題目のみ', summary: '概要PDF', full: '本文あり' };
export function ThesisSearch({ savedKeys, onSave }: { savedKeys: string[]; onSave: (p: Thesis) => void }) {
  const [query,setQuery]=useState('');
  const [kind,setKind]=useState('bachelor');
  const [university,setUniversity]=useState('');
  const [access,setAccess]=useState('');
  const [limit,setLimit]=useState(20);
  const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase();
  const words=normalize(query).trim().split(/\s+/).filter(Boolean);
  const results=theses.filter(p=>(!kind||p.kind===kind)&&(!university||p.university===university)&&(!access||p.access===access)&&words.every(w=>normalize([p.title,p.authors,p.field,String(p.year)].join(' ')).includes(w))).sort((a,b)=>b.year-a.year||a.title.localeCompare(b.title,'ja'));
  return <section className="space-y-4">
    <div className="bg-emerald-50 rounded-xl p-4 text-sm space-y-2"><h3 className="font-bold">大学の卒論・修論を探す</h3><p>愛媛大学（地学・環境）と早稲田大学の研究室（物理）の公開情報 {theses.length}件を収録。2023〜2025年度、確認日：2026年9月9日。</p><p>全国横断検索ではありません。「題目のみ」は本文・概要を収録していません。PDFは大学の公開元で開きます。</p></div>
    <label className="block text-sm">キーワード・著者・年度<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(20);}} placeholder="例：地震、環境、2025" className="mt-1 w-full border rounded-xl p-3" /></label>
    <div className="flex flex-wrap gap-3">
      <label className="text-sm">論文種別<select value={kind} onChange={e=>{setKind(e.target.value);setLimit(20);}} className="block border rounded-lg p-2"><option value="">すべて</option>{Object.entries(kindLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm">大学<select value={university} onChange={e=>{setUniversity(e.target.value);setLimit(20);}} className="block border rounded-lg p-2"><option value="">すべての収録大学</option>{Array.from(new Set(theses.map(p=>p.university))).map(v=><option key={v}>{v}</option>)}</select></label>
      <label className="text-sm">公開範囲<select value={access} onChange={e=>{setAccess(e.target.value);setLimit(20);}} className="block border rounded-lg p-2"><option value="">すべて</option>{Object.entries(accessLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    </div>
    <p role="status" className="text-sm text-gray-600">{results.length}件（年度の新しい順）</p>
    {!results.length&&<p className="bg-white rounded-xl p-6">収録範囲で一致する文献がありません。条件を変更してください。該当する研究が存在しないことを意味するものではありません。</p>}
    {results.slice(0,limit).map(p=><article key={p.key} className="bg-white border rounded-2xl p-5 space-y-3">
      <div className="flex gap-2 text-xs"><span className="bg-emerald-50 rounded px-2 py-1">{kindLabel[p.kind]}</span><span className="bg-gray-100 rounded px-2 py-1">{accessLabel[p.access]}</span></div>
      <h3 className="font-bold">{p.title}</h3><p className="text-sm text-gray-600">{p.authors} / {p.university} / {p.year}年度 / {p.field}</p>
      <div className="flex flex-wrap gap-4 text-sm text-emerald-700"><a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">大学の掲載情報 ↗</a>{p.documentUrl&&<a href={p.documentUrl} target="_blank" rel="noopener noreferrer" className="underline">{accessLabel[p.access]}を開く ↗</a>}<button type="button" disabled={savedKeys.includes(p.key)} onClick={()=>onSave(p)} className="font-bold disabled:text-gray-400">{savedKeys.includes(p.key)?'保存済み':'参考文献に保存'}</button></div>
    </article>)}
    {results.length>limit&&<button type="button" onClick={()=>setLimit(limit+20)} className="border rounded-xl px-5 py-2">さらに20件表示</button>}
  </section>;
}
