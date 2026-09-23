import {AIActivity} from './AIActivity';
import {useEffect,useState} from 'react';
import {ResearchEvaluation} from './ResearchEvaluation';
import {prepareResearch,readResearch,saveResearchInsight} from './publish-research';
import type {ResearchAnalysis} from './research-ai';
export function InsightApproval({id,onClose,onSaved}:{id:number;onClose:()=>void;onSaved:(message:string)=>Promise<void>}){
 const [analyzing,setAnalyzing]=useState(false);
 const [published,setPublished]=useState(false);
 const [draft,setDraft]=useState<ResearchAnalysis|null>(null),[version,setVersion]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[loaded,setLoaded]=useState(false);
 async function load(){const row=await readResearch(id);setPublished(row.data.status==='公開中');setVersion(row.version);setDraft(row.data.aiAnalysis||null);setLoaded(true);}
 useEffect(()=>{load().catch(e=>setMessage(e.message));},[id]);
 async function generate(){setAnalyzing(true);setBusy(true);setMessage('AI解析中です。この時点では公開されません。');try{await prepareResearch(id);await load();setMessage('生成結果を保存しました。内容を確認・編集してください。');}catch(e){setMessage((e as Error).message);}finally{setAnalyzing(false);setBusy(false);}}
 async function save(publish:boolean){if(!draft)return;if(publish&&!window.confirm('原稿とAI参考情報の内容を確認し、公開しますか？'))return;setBusy(true);try{await saveResearchInsight(id,draft,version,publish);await load();await onSaved(publish?'確認済みのAI参考情報と論文を公開しました。':published?'公開中のAI参考情報を更新しました。':'AI参考情報の編集を保存しました。');if(publish)onClose();else setMessage(published?'変更を公開内容に反映しました。':'編集を保存しました。まだ公開していません。');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 const field='w-full border rounded-lg p-3 text-sm bg-white';
 return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-label="AI参考情報の確認・編集" className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4">
 <h2 className="text-xl font-bold">AI参考情報の確認・編集</h2><p className="text-sm text-gray-600">AIの要点まとめと継続研究の提案を確認・編集してください。公開中の論文は保存すると変更が公開内容に反映されます。編集・再表示ではAIを呼び出しません。</p>
 {message&&<p role="status" className="bg-indigo-50 p-3 rounded-lg">{message}</p>}
 {analyzing&&<AIActivity/>}
 {!draft&&loaded&&<button disabled={busy} onClick={generate} className="bg-violet-600 text-white rounded-lg p-3 disabled:opacity-50">原稿をClaudeへ送信して一度だけ解析</button>}
 {draft&&<div className="bg-violet-50 p-4 rounded-xl space-y-4"><p className="font-bold text-violet-800">✨ AI Research Insight｜LTIのAIによる参考情報</p><p className="text-xs">LTI運営が確認・編集する参考情報です。著者の研究成果や見解とは区別して表示します。</p>
 <ResearchEvaluation value={draft.evaluation} disabled={busy} onChange={evaluation=>setDraft({...draft,evaluation})}/>
 <label className="block">研究の要点まとめ（1行に1項目）<textarea className={field} rows={7} value={draft.summary.join('\n')} disabled={busy} onChange={e=>setDraft({...draft,summary:e.target.value.split('\n')})}/></label>
 <h3 className="font-bold">継続研究の方向性</h3>{draft.suggestions.map((s,i)=><div key={i} className="space-y-2 border-t pt-3">{(['title','description'] as const).map(k=><label className="block" key={k}>{k==='title'?'提案タイトル':'提案内容'}<textarea rows={k==='title'?1:4} className={field} value={s[k]} disabled={busy} onChange={e=>setDraft({...draft,suggestions:draft.suggestions.map((v,j)=>j===i?{...v,[k]:e.target.value}:v)})}/></label>)}<label className="block">キーワード（カンマ区切り）<input className={field} value={s.tags.join(',')} disabled={busy} onChange={e=>setDraft({...draft,suggestions:draft.suggestions.map((v,j)=>j===i?{...v,tags:e.target.value.split(',')}:v)})}/></label><button disabled={busy} onClick={()=>setDraft({...draft,suggestions:draft.suggestions.filter((_,j)=>j!==i)})}>この提案を削除</button></div>)}
 <button disabled={busy} onClick={()=>setDraft({...draft,suggestions:[...draft.suggestions,{title:'',description:'',tags:[]}]})}>＋提案を追加</button>
 <div className="flex gap-3"><button disabled={busy} onClick={()=>save(false)} className="border rounded-lg p-3">{published?'変更を公開内容に反映':'編集を保存（非公開のまま）'}</button>{!published&&<button disabled={busy} onClick={()=>save(true)} className="bg-emerald-600 text-white rounded-lg p-3">確認して公開</button>}</div></div>}
 <button disabled={busy} onClick={onClose} className="border rounded-lg px-4 py-2">閉じる</button></section></div>;
}
