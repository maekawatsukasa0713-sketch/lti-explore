import React, { useState, useRef, useEffect } from 'react';
import { supabase } from './client';
import { mergePapers, japaneseRank, paperLanguageLabel, type Paper } from './supabase/functions/paper-search/search';
export function ScholarlySearch({savedKeys,onSave}:{savedKeys:string[];onSave:(p:Paper)=>void}){
 const [query,setQuery]=useState('');const [activeQuery,setActiveQuery]=useState('');
 const [papers,setPapers]=useState<Paper[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [warnings,setWarnings]=useState<string[]>([]);
 const [page,setPage]=useState(-1);const [hasMore,setHasMore]=useState(false);const [onlyReadable,setOnlyReadable]=useState(false);const [order,setOrder]=useState('japanese');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function search(q:string,nextPage=0){
  if(!q.trim())return;request.current?.abort();const controller=new AbortController();request.current=controller;
  const timer=setTimeout(()=>controller.abort(),30000);setLoading(true);setError('');setWarnings([]);
  if(nextPage===0){setPapers([]);setPage(-1);setHasMore(false);setActiveQuery(q.trim());}
  try{
   const {data,error:failure}=await supabase.functions.invoke('paper-search',{body:{query:q.trim(),page:nextPage},signal:controller.signal});
   if(failure){let message='検索先に接続できませんでした。再検索してください。';try{const body=await failure.context?.json();message=body?.error||body?.warnings?.join(' / ')||message;}catch{}throw new Error(message);}
   if(!Array.isArray(data?.items))throw new Error('検索結果を読み取れませんでした。');
   if(request.current!==controller)return;
   setPapers(old=>nextPage===0?data.items:mergePapers([[...old,...data.items]]));setWarnings(data.warnings||[]);setPage(nextPage);setHasMore(data.hasMore&&nextPage<49);
  }catch(e){if(request.current===controller)setError(controller.signal.aborted?'検索がタイムアウトしました。再検索してください。':e instanceof Error?e.message:'検索に失敗しました。');}
  finally{clearTimeout(timer);if(request.current===controller)setLoading(false);}
 }
 let displayed=papers.filter(p=>!onlyReadable||!!p.documentUrl);
 if(order==='japanese')displayed=[...displayed].sort((a,b)=>japaneseRank(b)-japaneseRank(a));
 if(order==='year')displayed=[...displayed].sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0));
 if(order==='readable')displayed=[...displayed].sort((a,b)=>Number(!!b.documentUrl)-Number(!!a.documentUrl));
 return <section className="space-y-4">
  <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void search(query);}}><input aria-label="論文を検索" value={query} onChange={e=>setQuery(e.target.value)} maxLength={500} placeholder="キーワード・論文名・著者名" className="min-w-0 flex-1 border rounded-xl p-3"/><button disabled={!query.trim()} className="rounded-xl px-5 py-3 bg-emerald-600 text-white font-bold">検索</button></form>
  <p className="text-xs text-gray-500">Crossref・COREをまとめて検索します。日本語・英語で入力できます。日本語論文でも英語タイトルで登録されている場合があります。</p>
  <div className="flex flex-wrap items-center gap-4 text-sm"><label className="flex gap-2 items-center"><input type="checkbox" checked={onlyReadable} onChange={e=>setOnlyReadable(e.target.checked)}/>本文リンクありのみ</label><label>並び順 <select className="border rounded-lg p-2" value={order} onChange={e=>setOrder(e.target.value)}><option value="japanese">日本語を優先</option><option value="relevance">関連度</option><option value="readable">本文リンクありを優先</option><option value="year">新しい順</option></select></label></div>
  {warnings.length>0&&<p role="alert" className="text-sm text-amber-800">一部の検索先を取得できませんでした。取得できた結果を表示しています。{warnings.join(' / ')} <button onClick={()=>search(activeQuery)} className="underline">再検索</button></p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error} <button onClick={()=>search(activeQuery,page<0?0:page+1)} className="underline">再試行</button></p>}
  <p role="status" className="text-sm text-gray-600">{loading?'検索中…':activeQuery?`「${activeQuery}」：${displayed.length}件表示（取得済み${papers.length}件・重複除去後）`:'キーワードを入力して論文を探せます。'}</p>
  {activeQuery&&!loading&&!error&&!displayed.length&&<p className="p-6 bg-white rounded-xl">{onlyReadable&&papers.length?'取得済みの結果に本文リンクがありません。条件を外すか、続きの結果を取得してください。':'一致する結果がありません。別のキーワードを試してください。'}</p>}
  {displayed.map(p=><article key={p.doi||p.catalogId} className="bg-white border rounded-2xl p-5 space-y-3"><h3 className="font-bold text-gray-900">{p.title}</h3><p className="text-xs text-gray-600">{p.authors||'著者情報なし'} / {p.year||'年不明'} / {p.journal}</p><p className="text-xs text-gray-500">{paperLanguageLabel(p)} / {p.providers.join('・')}{p.paperType==='thesis'||p.paperType==='dissertation'?' / 学位論文（学位種別は掲載先参照）':''}</p><div className="flex flex-wrap gap-4 text-sm"><a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">掲載情報 ↗</a>{p.documentUrl?<a href={p.documentUrl} target="_blank" rel="noopener noreferrer" className="bg-emerald-50 px-3 py-1 rounded-lg text-emerald-800 font-bold">本文を読む ↗</a>:<span className="text-gray-500">無料本文リンク未取得</span>}<button type="button" onClick={()=>onSave(p)} disabled={savedKeys.includes(p.doi||p.catalogId!)} className="text-emerald-700 font-bold disabled:text-gray-400">{savedKeys.includes(p.doi||p.catalogId!)?'保存済み':'参考文献に保存'}</button></div></article>)}
  {hasMore&&<button type="button" disabled={loading} onClick={()=>search(activeQuery,page+1)} className="border rounded-xl px-5 py-3 disabled:opacity-50">続きの結果を取得</button>}
  {papers.length>0&&<p className="text-xs text-gray-500">本文リンクはCOREの公開情報に基づきます。リンク切れや掲載先のアクセス制限がある場合があります。日本語優先は登録言語、言語未登録の場合はタイトルのかな文字を基準にします。並び替え・絞り込みは取得済みの結果が対象です。</p>}
 </section>;
}
