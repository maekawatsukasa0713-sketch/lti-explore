import {SavedInsightReveal} from './AIActivity';
import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,FileText,Lightbulb,Eye,Bookmark,Quote,Check,Maximize2,X} from 'lucide-react';
import {PdfView} from './cloud';
import {ResearchEvaluation} from './ResearchEvaluation';
import type {ResearchAnalysis} from './research-ai';
import type {LibraryPaper} from './ResearchLibrary';
import {copyText,formatPaperCitation,loadPaperEngagement,recordPaperCitation,recordPaperView,togglePaperBookmark,type PaperEngagement} from './paper-engagement';

export function ResearchDetail({
 paper,
 onBack,
 showEvaluation=false,
 trackView=true
}:{
 paper:LibraryPaper & {aiAnalysis?:ResearchAnalysis};
 onBack:()=>void;
 showEvaluation?:boolean;
 trackView?:boolean;
}){
 const result=paper.aiAnalysis;
 const [engagement,setEngagement]=useState<PaperEngagement>({views:0,citations:0,bookmarks:0});
 const [bookmarked,setBookmarked]=useState(false);
 const [engagementMessage,setEngagementMessage]=useState('');
 const [engagementBusy,setEngagementBusy]=useState(false);
 const [insightExpanded,setInsightExpanded]=useState(false);

 useEffect(()=>{let active=true;setEngagementMessage('');void (async()=>{try{if(trackView)await recordPaperView(paper.id);const loaded=await loadPaperEngagement([paper.id]);if(!active)return;setEngagement(loaded.metrics[String(paper.id)]||{views:0,citations:0,bookmarks:0});setBookmarked(loaded.bookmarked.has(String(paper.id)));}catch{}})();return()=>{active=false;};},[paper.id,trackView]);
 useEffect(()=>{if(!insightExpanded)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setInsightExpanded(false);};window.addEventListener('keydown',close);return()=>{window.removeEventListener('keydown',close);document.body.style.overflow=previous;};},[insightExpanded]);

 async function toggleBookmark(){if(engagementBusy)return;setEngagementBusy(true);setEngagementMessage('');try{const before=bookmarked;const next=await togglePaperBookmark(paper.id);setBookmarked(next);if(next!==before)setEngagement(v=>({...v,bookmarks:Math.max(0,v.bookmarks+(next?1:-1))}));setEngagementMessage(next?'ブックマークに保存しました。':'ブックマークを解除しました。');}catch{setEngagementMessage('ブックマークを更新できませんでした。');}finally{setEngagementBusy(false);}}
 async function cite(){if(engagementBusy)return;setEngagementBusy(true);setEngagementMessage('');try{await copyText(formatPaperCitation(paper));const citations=await recordPaperCitation(paper.id);setEngagement(v=>({...v,citations}));setEngagementMessage('引用情報をクリップボードにコピーしました。');}catch{setEngagementMessage('引用情報をコピーできませんでした。');}finally{setEngagementBusy(false);}}

 function InsightBody({expanded=false}:{expanded?:boolean}){
  const cardClass=expanded?'bg-white border border-slate-200 rounded-2xl p-5 md:p-6 space-y-3':'bg-white border border-slate-200 rounded-xl p-4 space-y-3';
  const bodyText=expanded?'text-[15px] leading-7 text-slate-700':'text-xs leading-relaxed text-slate-600';
  const itemText=expanded?'text-[15px] leading-7 text-slate-700':'text-xs leading-relaxed text-slate-600';
  return <SavedInsightReveal key={String(paper.id)} enabled={!!result}>
   <section className={cardClass}>
    <h3 className={`font-bold flex gap-2 items-center ${expanded?'text-lg':'text-sm'}`}><Lightbulb className={`${expanded?'w-5 h-5':'w-4 h-4'} text-amber-500`}/>この研究の着眼点<span className="ml-auto text-[10px] bg-amber-50 text-amber-700 rounded-full px-2 py-1">AI整理</span></h3>
    {result?.summary.length?<p className={bodyText}>{result.summary[0]}</p>:<p className={expanded?'text-base text-slate-400':'text-xs text-slate-400'}>着眼点はまだ整理されていません。</p>}
   </section>
   <section className={cardClass}>
    <h3 className={`font-bold flex gap-2 items-center ${expanded?'text-lg':'text-sm'}`}><FileText className={`${expanded?'w-5 h-5':'w-4 h-4'} text-emerald-600`}/>研究から分かったこと<span className="ml-auto text-[10px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-1">AI要約</span></h3>
    {result?.summary.length?<ul className={expanded?'space-y-3':'space-y-2'}>{result.summary.slice(1).map((s,i)=><li key={i} className={`flex gap-2 ${itemText}`}><span className="text-emerald-600">●</span><span>{s}</span></li>)}</ul>:<p className={expanded?'text-base text-slate-400':'text-xs text-slate-400'}>内容はまだ整理されていません。</p>}
   </section>
   <section className={cardClass}>
    <h3 className={`font-bold flex gap-2 items-center ${expanded?'text-lg':'text-sm'}`}><Lightbulb className={`${expanded?'w-5 h-5':'w-4 h-4'} text-violet-600`}/>次につながる問い</h3>
    <p className={expanded?'text-sm text-slate-500':'text-[11px] text-slate-500'}>未検証のアイデアです。準備物や代替案を確認し、指導者と相談して計画しましょう。</p>
    {result?result.suggestions.map((s,i)=><div key={i} className={`${expanded?'text-[15px] space-y-2.5':'text-xs space-y-2'} border-t border-slate-100 pt-3`}><h4 className="font-bold text-emerald-800">{s.title}</h4><p className={`${expanded?'leading-7':'leading-relaxed'} text-slate-600 whitespace-pre-wrap`}>{s.description}</p><div className="flex flex-wrap gap-1">{s.tags.map(t=><span key={t} className={`${expanded?'text-xs':'text-[10px]'} bg-emerald-50 text-emerald-700 rounded px-2 py-1`}>{t}</span>)}</div></div>):<p className={expanded?'text-base text-slate-400':'text-xs text-slate-400'}>提案はまだ保存されていません。</p>}
   </section>
   {result?.evaluation&&<div className={expanded?'pt-2':'pt-1'}><ResearchEvaluation value={result.evaluation} showChart={showEvaluation} showScores={showEvaluation}/></div>}
   {result&&<div className={`${expanded?'text-sm':'text-[11px]'} text-slate-500 space-y-1`}><p>解析範囲：{result.basis}</p><p>生成日時：{new Date(result.generatedAt).toLocaleString('ja-JP')}</p></div>}
  </SavedInsightReveal>;
 }

 return <section className="space-y-5">
  <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm text-slate-500 font-bold"><ArrowLeft className="w-4 h-4"/>論文一覧に戻る</button>
  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.8fr)] gap-5 items-start">
   <article aria-label="著者の研究成果" className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
    <div className="bg-slate-100 px-6 py-3 font-bold text-slate-800">著者の研究成果</div>
    <header className="p-6 border-b space-y-4">
     <span className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded px-2 py-1">{paper.field}</span>
     <h2 className="text-2xl font-bold text-slate-900 leading-relaxed">{paper.title}</h2>
     <div className="text-xs text-slate-500 space-y-1">
      <p>学校：{paper.schoolNameOverride?.trim()||paper.schoolName}</p>
      <p>著者：{paper.author} / 担当：{paper.submittedByTeacherName||'未登録'}</p>
      <p>公開日：{paper.publishedDate||paper.submittedDate} / {paper.fileName||'添付ファイルなし'}</p>
     </div>
     <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600"><Eye className="w-4 h-4"/>{engagement.views} ビュー</span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600"><Bookmark className="w-4 h-4"/>{engagement.bookmarks} ブックマーク</span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600"><Quote className="w-4 h-4"/>{engagement.citations} 引用</span>
      <button type="button" disabled={engagementBusy} onClick={()=>void toggleBookmark()} className={`rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-50 ${bookmarked?'border-emerald-600 bg-emerald-600 text-white':'border-slate-200 bg-white text-slate-700 hover:border-emerald-400'}`}>{bookmarked?<span className="inline-flex items-center gap-1"><Check className="w-4 h-4"/>保存済み</span>:<span className="inline-flex items-center gap-1"><Bookmark className="w-4 h-4"/>ブックマーク</span>}</button>
      <button type="button" disabled={engagementBusy} onClick={()=>void cite()} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-violet-400 disabled:opacity-50"><span className="inline-flex items-center gap-1"><Quote className="w-4 h-4"/>引用をコピー</span></button>
     </div>
     {engagementMessage&&<p role="status" className="text-xs font-medium text-emerald-700">{engagementMessage}</p>}
    </header>
    <div className="p-4">
     {paper.storagePath?<PdfView path={paper.storagePath} label={paper.fileName||paper.title}/>:<p className="p-6 text-sm text-slate-500">本文ファイルは未登録です。</p>}
     {paper.abstract&&<details className="p-4 text-sm" open={!paper.storagePath}><summary className="font-bold cursor-pointer">著者による概要</summary><p className="mt-3 whitespace-pre-wrap leading-relaxed text-slate-600">{paper.abstract}</p></details>}
    </div>
   </article>

   <aside aria-label="LTIのAIによる参考情報" className="space-y-3 xl:sticky xl:top-4 bg-violet-50 border border-violet-200 rounded-2xl p-3 md:p-4">
    <div className="flex items-start justify-between gap-3">
     <div className="space-y-1">
      <h2 className="text-sm font-bold text-violet-900">✨ AI Research Insight｜LTIのAIによる参考情報</h2>
      <p className="text-[11px] leading-relaxed text-violet-800">以下はLTIのAIが生成した参考情報です。原論文の一部や著者の見解ではありません。要約は本文と照合し、継続研究の提案は未検証のアイデアとして扱ってください。</p>
     </div>
     <button type="button" onClick={()=>setInsightExpanded(true)} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-2.5 py-2 text-[11px] font-bold text-white hover:bg-violet-800"><Maximize2 className="w-3.5 h-3.5"/>大きく表示</button>
    </div>
    <p className="text-[11px] text-slate-500">保存済みの解析結果を表示します。閲覧時のAI解析は行いません。</p>
    <InsightBody expanded={false}/>
   </aside>
  </div>

  {insightExpanded&&typeof document!=='undefined'&&createPortal(
   <div className="fixed inset-0 z-[9999] bg-violet-50" role="dialog" aria-modal="true" aria-label="AI Research Insight フルスクリーン表示">
    <div className="flex h-full w-full flex-col overflow-hidden bg-violet-50">
     <div className="shrink-0 flex items-center justify-between gap-4 border-b border-violet-200 bg-white px-5 md:px-8 py-4 shadow-sm">
      <div className="min-w-0">
       <p className="text-[11px] font-bold tracking-widest text-violet-500">LTI AI RESEARCH INSIGHT</p>
       <h2 className="text-xl md:text-2xl font-extrabold text-violet-950">AI Research Insight</h2>
       <p className="text-xs md:text-sm text-slate-500 mt-1 truncate">{paper.title}</p>
      </div>
      <button type="button" onClick={()=>setInsightExpanded(false)} className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-violet-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800"><X className="w-5 h-5"/>閉じる</button>
     </div>
     <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-4">
       <p className="rounded-2xl border border-violet-200 bg-white p-4 text-sm leading-6 text-violet-900">LTIのAIが生成した参考情報です。要約・評価理由・継続研究の提案は、原論文と照らし合わせながら確認してください。</p>
       <InsightBody expanded/>
      </div>
     </div>
    </div>
   </div>,
   document.body
  )}
 </section>;
}
