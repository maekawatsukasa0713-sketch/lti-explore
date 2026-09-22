import {useRef,useState} from 'react';
import {useCloud,supabase} from './cloud';
import {ResearchLibrary,type LibraryPaper} from './ResearchLibrary';
import {ResearchDetail} from './ResearchDetail';
import {InsightApproval} from './InsightApproval';
import {RESEARCH_FIELDS} from './research-fields';
import type {ResearchAnalysis} from './research-ai';

type Paper=LibraryPaper & {aiAnalysis?:ResearchAnalysis};
type Metadata={title:string;field:string;schoolName:string;author:string};
const input='block w-full mt-1 border border-slate-300 rounded-xl p-3 bg-white text-sm';
export function AdminResearchLibrary({onOpen}:{onOpen:()=>void}){
 const cloud=useCloud();
 const [selected,setSelected]=useState<string|null>(null);
 const [editing,setEditing]=useState(false),[insight,setInsight]=useState(false);
 const [draft,setDraft]=useState<Metadata>({title:'',field:'',schoolName:'',author:''});
 const [version,setVersion]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false);
 const rows=cloud.rows.filter(r=>r.kind==='papers'&&r.data.status==='公開中');
 const row=rows.find(r=>r.id===selected);
 const papers=rows.map(r=>({...r.data,id:Number(r.id)}) as Paper);
 const paper=row?({...row.data,id:Number(row.id)} as Paper):null;
 function beginEdit(){if(!paper||!row)return;setDraft({title:paper.title||'',field:paper.field||'未分類',schoolName:paper.schoolName||'',author:paper.author||''});setVersion(row.version);setMessage('');setEditing(true);}
 async function save(){
  if(lock.current||!row||cloud.profile.role!=='admin')return;
  if(!draft.title.trim()||!draft.field||draft.field==='未分類'){setMessage('タイトルと分野を入力してください。');return;}
  if(!window.confirm('編集内容を公開中の論文に反映しますか？'))return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   const fresh=await supabase.from('lti_records').select('data,version').eq('kind','papers').eq('id',row.id).single();
   if(fresh.error)throw fresh.error;
   if(fresh.data.version!==version)throw new Error('別の操作で更新されています。入力内容を控えてから、キャンセルして編集を開き直してください。');
   const data={...fresh.data.data,title:draft.title.trim(),field:draft.field,schoolName:draft.schoolName.trim()||'学校名未登録',author:draft.author.trim()||'著者名非公開',classificationMode:'manual'};
   const result=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:row.id,version,data}]});
   if(result.error)throw result.error;
   setEditing(false);setMessage('変更を保存しました。公開内容に反映されます。');
   await cloud.reload();
  }catch(e){setMessage(e instanceof Error?e.message:(e as {message?:string}).message||'保存に失敗しました。');}
  finally{lock.current=false;setBusy(false);}
 }
 if(cloud.profile.role!=='admin')return <p>この画面はLTI運営専用です。</p>;
 return <div className="space-y-5">
 <div className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">LTI運営用：公開論文を開くと、学校名・著者名・分野やAI参考情報を編集できます。手動編集ではAIを再実行しません。</div>
 {message&&<p role="status" className="rounded-xl border p-4 whitespace-pre-wrap">{message}</p>}
 <div className={paper?'hidden':''}><ResearchLibrary papers={papers} onOpen={p=>{setSelected(String(p.id));setEditing(false);setInsight(false);setMessage('');onOpen();}}/></div>
 {selected&&!paper&&<p role="status">この論文は公開停止または削除されています。</p>}
 {paper&&<>
 <div className="flex flex-wrap gap-3"><button type="button" disabled={editing||busy||insight} onClick={beginEdit} className="rounded-xl bg-indigo-600 px-4 py-3 text-white disabled:opacity-40">タイトル・分野・学校名・著者名を編集</button><button type="button" disabled={editing||busy||insight} onClick={()=>setInsight(true)} className="rounded-xl bg-violet-600 px-4 py-3 text-white disabled:opacity-40">AIの要約・継続提案を編集</button></div>
 {editing&&<section aria-label="論文情報の編集" className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="font-bold text-lg">公開する論文情報</h2><p className="text-xs text-slate-500">学校名は表示用の名称です。所属学校IDや元のPDF、AI解析結果は変更しません。</p><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-4">{(['title','schoolName','author'] as const).map((key,i)=><label key={key} className="text-sm">{['タイトル','学校名','著者名'][i]}<input className={input} value={draft[key]} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/></label>)}<label className="text-sm">分野<select className={input} value={draft.field} onChange={e=>setDraft(d=>({...d,field:e.target.value}))}>{[...new Set([...RESEARCH_FIELDS,draft.field].filter(Boolean))].map(f=><option key={f}>{f}</option>)}</select></label></fieldset><div className="flex gap-3"><button type="button" disabled={busy} onClick={()=>void save()} className="rounded-xl bg-indigo-600 px-4 py-2 text-white disabled:opacity-40">{busy?'保存中…':'保存して公開内容に反映'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)} className="rounded-xl border px-4 py-2">キャンセル</button></div></section>}
 <ResearchDetail paper={paper} onBack={()=>{if(busy)return;if(editing&&!window.confirm('未保存の編集を破棄して一覧に戻りますか？'))return;setSelected(null);setEditing(false);setMessage('');}}/>
 {insight&&<InsightApproval key={paper.id} id={paper.id} onClose={()=>setInsight(false)} onSaved={async text=>{setMessage(text);await cloud.reload();}}/>}
 </>}
 </div>;
}
