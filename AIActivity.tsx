import {useEffect,useState,type ReactNode} from 'react';
import {Sparkles} from 'lucide-react';

export function AIActivity({saved=false}:{saved?:boolean}){
 return <div role="status" className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-5">
  <div className="flex items-center gap-3">
   <div aria-hidden="true" className="relative flex h-12 w-12 shrink-0 items-center justify-center">
    <span className="absolute inset-0 rounded-full border-2 border-violet-200 border-t-violet-600 motion-safe:animate-spin"/>
    <span className="text-violet-600 motion-safe:animate-pulse"><Sparkles className="h-5 w-5"/></span>
   </div>
   <div><p className="text-sm font-bold text-violet-900">{saved?'保存済みのAI結果を表示しています':'AIが研究内容を解析しています'}</p>
   <p className="mt-1 text-xs leading-relaxed text-slate-500">{saved?'表示の演出です。AIの再解析・追加呼び出しはありません。':'完了までこの画面を開いてお待ちください。'}</p></div>
  </div>
  <div aria-hidden="true" className="mt-4 space-y-2 motion-safe:animate-pulse"><div className="h-2 w-full rounded-full bg-violet-100"/><div className="h-2 w-4/5 rounded-full bg-indigo-100"/><div className="h-2 w-3/5 rounded-full bg-violet-100"/></div>
 </div>;
}

export function SavedInsightReveal({enabled,children}:{enabled:boolean;children:ReactNode}){
 const [revealing,setRevealing]=useState(()=>enabled&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const finish=()=>setRevealing(false);
  const onChange=()=>{if(preference.matches)finish();};
  const timer=window.setTimeout(finish,850);
  preference.addEventListener('change',onChange);
  return()=>{window.clearTimeout(timer);preference.removeEventListener('change',onChange);};
 },[]);
 if(enabled&&revealing)return <div className="space-y-3"><AIActivity saved/><button type="button" onClick={()=>setRevealing(false)} className="text-xs text-violet-700 underline">結果をすぐに表示</button></div>;
 return <div className="space-y-4">{children}</div>;
}
