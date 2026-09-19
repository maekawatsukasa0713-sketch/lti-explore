import {useEffect,useRef,useState} from 'react';
import {useCloud,uploadPdf,PdfView,supabase} from './cloud';
import {prepareResearch} from './publish-research';
import {RESEARCH_FIELDS,publicationOps} from './research-fields';

type Item={id:number;hash:string;file:File;title:string;path?:string;saved?:boolean;message:string};
const input='block w-full border border-slate-200 rounded-lg p-2 mt-1 bg-white text-sm';
const button='rounded-lg border px-4 py-2 text-sm disabled:opacity-40';
export function BulkImport(){
 const cloud=useCloud();const [items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [school,setSchool]=useState(''),[field,setField]=useState('物理'),[mode,setMode]=useState('manual'),[ai,setAi]=useState(true),[filter,setFilter]=useState('すべて');
 const [dirty,setDirty]=useState<Record<string,boolean>>({});const [selected,setSelected]=useState<Record<string,number>>({});const lock=useRef(false),stop=useRef(false),paths=useRef<Record<string,string>>({});
 const pending=cloud.rows.filter(r=>r.kind==='papers'&&r.data.bulkImport&&r.data.status==='承認待ち');
 const visible=pending.filter(r=>filter==='すべて'||r.data.field===filter);
 const patch=(id:number,value:Partial<Item>)=>setItems(old=>old.map(d=>d.id===id?{...d,...value}:d));
 useEffect(()=>{if(!busy)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[busy]);
 async function run(task:()=>Promise<void>){if(lock.current)return;lock.current=true;stop.current=false;setBusy(true);setMessage('');try{await task();}catch(e){setMessage((e as Error).message);}finally{try{await cloud.reload();}catch(e){setMessage('保存状況の再取得に失敗しました。再読み込みしてください。');}lock.current=false;setBusy(false);}}
 async function add(files:FileList|null){if(!files)return;await run(async()=>{const next=[...items];let skipped=0;for(const file of Array.from(files)){if(next.length>=50){skipped++;continue;}if(!/\.(pdf|docx)$/i.test(file.name)||!file.size||file.size>8*1024*1024){skipped++;continue;}
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(next.some(d=>d.hash===hash)||cloud.rows.some(r=>r.kind==='papers'&&r.data.sourceHash===hash)){skipped++;continue;}
 next.push({id:parseInt(hash.slice(0,13),16),hash,file,title:file.name.replace(/\.[^.]+$/,''),message:'未登録'});}
 setItems(next);setMessage(`${next.length}件を選択しました。${skipped?`${skipped}件は重複・形式・サイズ・件数上限により除外しました。`:''}`);});}
 async function analyze(ids:number[]){let done=0;for(const id of ids){if(stop.current)break;setMessage(`AI解析中：${done+1} / ${ids.length}件。画面を閉じずにお待ちください。`);try{await prepareResearch(id);done++;}catch(e){setMessage(`${done}件のAI解析を保存しました。処理を止めました：${(e as Error).message} 未解析分は下の一覧に残っています。`);return;}}
 setMessage(`${done}件のAI分類・要約・継続提案を保存しました。内容を確認してから公開してください。${stop.current?'残りの処理は停止しました。':''}`);}
 async function register(){await run(async()=>{const saved:number[]=[];let failed=0;for(const d of items.filter(x=>!x.saved)){if(stop.current)break;try{
 if(!d.title.trim())throw new Error('タイトルを入力してください。');patch(d.id,{message:'保存中…'});
 const existing=await supabase.from('lti_records').select('id,data').eq('kind','papers').eq('id',String(d.id)).maybeSingle();if(existing.error)throw existing.error;
 if(existing.data){if(existing.data.data.sourceHash!==d.hash)throw new Error('識別番号が重複しました。運営で確認してください。');patch(d.id,{saved:true,message:'登録済み（重複登録しません）'});continue;}
 const path=paths.current[d.hash]||await uploadPdf(d.file);paths.current[d.hash]=path;
 const data={id:d.id,title:d.title.trim(),author:'著者名非公開',schoolName:school.trim()||'学校名未登録',schoolId:'',field:mode==='ai'?'未分類':field,classificationMode:mode,sourceHash:d.hash,bulkImport:true,bulkReviewed:false,storagePath:path,fileName:d.file.name,status:'承認待ち',submittedDate:new Date().toISOString().slice(0,10),publishedDate:'',submittedByTeacherId:cloud.profile.id,submittedByTeacherName:cloud.profile.name,abstract:'',views:0};
 const result=await supabase.rpc('lti_save_records',{ops:[{action:'insert',kind:'papers',id:String(d.id),data}]});if(result.error)throw result.error;
 patch(d.id,{saved:true,message:'保存済み・非公開'});saved.push(d.id);
 }catch(e){failed++;patch(d.id,{message:'登録失敗：'+(e as Error).message});}}
 await cloud.reload();if((ai||mode==='ai')&&saved.length&&!stop.current)await analyze(saved);else setMessage(`${saved.length}件を非公開で保存しました。${failed}件の登録失敗。下の一覧で内容を確認してください。`);
 });}
 async function publish(){if(!Object.keys(selected).length)return;if(!confirm(`選択した${Object.keys(selected).length}件を「みんなの論文」に公開しますか？`))return;await run(async()=>{const fresh=await supabase.from('lti_records').select('id,version,data').eq('kind','papers').in('id',Object.keys(selected));if(fresh.error)throw fresh.error;const ops=publicationOps(fresh.data,selected);const result=await supabase.rpc('lti_save_records',{ops});if(result.error)throw result.error;setSelected({});setMessage(`${ops.length}件を「みんなの論文」に公開しました。`);});}
 if(cloud.profile.role!=='admin')return <p>この機能はLTI運営専用です。</p>;
 return <section className="space-y-6"><header><h1 className="text-2xl font-bold">論文の一括登録・公開</h1><p className="mt-2 text-sm text-slate-500">ファイルをまとめて保存 → 分野・内容を確認 → 選択した論文を一括公開</p></header>
 <fieldset disabled={busy} className="bg-white border rounded-2xl p-5 space-y-4"><h2 className="font-bold">1. ファイルと分類方法</h2><div className="grid md:grid-cols-2 gap-4"><label className="text-sm">共通の学校名（任意）<input className={input} value={school} onChange={e=>setSchool(e.target.value)} placeholder="例：〇〇高等学校"/></label><label className="text-sm">分野の決め方<select className={input} value={mode} onChange={e=>setMode(e.target.value)}><option value="manual">分野をまとめて指定</option><option value="ai">AIが本文から自動分類</option></select></label></div>
 {mode==='manual'&&<label className="block text-sm">今回登録する論文の共通分野<select className={input} value={field} onChange={e=>setField(e.target.value)}>{RESEARCH_FIELDS.filter(f=>f!=='未分類').map(f=><option key={f}>{f}</option>)}</select></label>}
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={mode==='ai'||ai} disabled={mode==='ai'} onChange={e=>setAi(e.target.checked)}/>登録後、Claudeで要約・継続提案を一度だけ生成する（AI分類も同じ解析で行います）</label>
 <p className="text-xs text-slate-500">PDF／Word（.docx）を1ファイル1論文として登録。最大50件、各8MB。AIは既存の上限（1時間20件・全体1日200件）内で処理します。公開用ファイルを選んでください。著者名は初期状態では非公開です。ファイル本文の氏名は自動削除されません。</p>
 <input aria-label="論文ファイルを複数選択" type="file" multiple accept=".pdf,.docx" onChange={e=>{void add(e.target.files);e.target.value='';}}/>
 {items.length>0&&<div className="space-y-2">{items.map(d=><div key={d.id} className="border rounded-lg p-3"><p className="text-xs text-slate-500 break-all">{d.file.name} — {d.message}</p><label className="text-xs">タイトル<input className={input} value={d.title} disabled={d.saved} onChange={e=>patch(d.id,{title:e.target.value})}/></label>{!d.saved&&<button className="text-xs underline mt-2" onClick={()=>setItems(old=>old.filter(x=>x.id!==d.id))}>除外</button>}</div>)}</div>}
 <div className="flex gap-3"><button className={button+' bg-indigo-600 text-white'} disabled={!items.some(d=>!d.saved)} onClick={()=>void register()}>一括登録して確認へ</button><button className={button} onClick={()=>setItems(old=>old.filter(d=>!d.saved))}>登録済みを選択欄から外す</button></div></fieldset>
 <p role="status" className="text-sm bg-indigo-50 rounded-xl p-4 whitespace-pre-wrap">{message||'登録した論文は、確認して公開するまで非公開です。'}</p>{busy&&<button className={button} onClick={()=>{stop.current=true;setMessage('現在の1件が終わったら停止します。');}}>残りの処理を停止</button>}
 <div className="space-y-4"><h2 className="font-bold text-lg">2. 登録済みの論文を確認・編集（{pending.length}件）</h2><p className="text-sm text-slate-500">保存済みの原稿・分類・AI結果は、画面を開き直しても残ります。「確認済みとして保存」した論文を選択して公開できます。</p>
 <div className="flex flex-wrap items-center gap-3"><label className="text-sm">分野で表示<select className={input} value={filter} disabled={busy} onChange={e=>{setFilter(e.target.value);setSelected({});}}>{['すべて',...new Set(pending.map(r=>r.data.field||'未分類'))].map(f=><option key={f}>{f}</option>)}</select></label>
 <button disabled={busy||!visible.some(r=>!r.data.aiAnalysis&&!r.data.aiState)} className={button} onClick={()=>void run(()=>analyze(visible.filter(r=>!r.data.aiAnalysis&&!r.data.aiState).slice(0,50).map(r=>Number(r.id))))}>表示中の未解析分をAI解析</button>
 <button disabled={busy} className={button} onClick={()=>setSelected(Object.fromEntries(visible.filter(r=>r.data.bulkReviewed&&!dirty[r.id]).slice(0,50).map(r=>[r.id,r.version])))}>表示中の確認済みを選択（最大50件）</button><button disabled={busy} className={button} onClick={()=>setSelected({})}>選択解除</button></div>
 {visible.map(r=><div key={r.id+':'+r.version} className="bg-white border rounded-xl p-4"><label className="flex gap-2 items-center text-sm mb-3"><input type="checkbox" disabled={busy||!r.data.bulkReviewed||dirty[r.id]} checked={selected[r.id]===r.version} onChange={e=>setSelected(old=>{const next={...old};if(e.target.checked)next[r.id]=r.version;else delete next[r.id];return next;})}/>公開対象に選択 — {r.data.bulkReviewed?'確認済み':'未確認'} / {r.data.field}</label><BulkReview row={r} disabled={busy} onDirty={()=>{setDirty(old=>({...old,[r.id]:true}));setSelected(old=>{const n={...old};delete n[r.id];return n;});}} onSave={async()=>{setDirty(old=>({...old,[r.id]:false}));setSelected(old=>{const n={...old};delete n[r.id];return n;});await cloud.reload();}}/></div>)}
 {!visible.length&&<p className="text-sm text-slate-500 p-6 border rounded-xl">この条件の承認待ち論文はありません。</p>}
 <button className={button+' bg-emerald-600 text-white'} disabled={busy||!Object.keys(selected).length} onClick={()=>void publish()}>選択した{Object.keys(selected).length}件を一括公開</button></div></section>;
}

function BulkReview({row,disabled,onSave,onDirty}:{row:{id:string;version:number;data:any};disabled:boolean;onSave:()=>Promise<void>;onDirty:()=>void}){
 const [draft,setDraft]=useState(row.data),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[original,setOriginal]=useState(false);
 const update=(patch:Record<string,unknown>)=>{onDirty();setDraft((d:any)=>({...d,...patch}));};
 async function save(){if(!draft.title?.trim()||!draft.field||draft.field==='未分類'){setMessage('タイトルと分野を確認してください。');return;}setBusy(true);try{
 const data={...draft,author:draft.author?.trim()||'著者名非公開',schoolName:draft.schoolName?.trim()||'学校名未登録',bulkReviewed:true,...(draft.aiAnalysis?{aiReviewedAt:new Date().toISOString()}:{})};
 const {error}=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:row.id,version:row.version,data}]});if(error)throw error;await onSave();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <details><summary className="font-bold cursor-pointer">{row.data.title} <span className="font-normal text-xs text-slate-500">— 原稿・分類・AI結果を確認／編集</span></summary><fieldset disabled={busy||disabled} className="mt-4 space-y-4">
 <div className="grid md:grid-cols-2 gap-3">{(['title','author','schoolName'] as const).map((k,i)=><label key={k} className="text-xs">{['タイトル','公開する著者名（空欄は非公開）','学校名'][i]}<input className={input} value={draft[k]||''} onChange={e=>update({[k]:e.target.value})}/></label>)}<label className="text-xs">分野<select className={input} value={draft.field||'未分類'} onChange={e=>update({field:e.target.value,classificationMode:'manual'})}>{[...new Set([...RESEARCH_FIELDS,draft.field].filter(Boolean))].map(f=><option key={f}>{f}</option>)}</select></label></div>
 {draft.classificationReason&&<p className="text-xs text-violet-700">AIの分類根拠：{draft.classificationReason}（分野は上で修正できます）</p>}
 <label className="block text-xs">著者の要旨（任意・AI要約とは別）<textarea className={input} rows={3} value={draft.abstract||''} onChange={e=>update({abstract:e.target.value})}/></label>
 <button className={button} onClick={()=>setOriginal(!original)}>{original?'原稿を閉じる':'著者の研究成果（原稿）を開く'}</button>{original&&<PdfView path={draft.storagePath}/>}
 {draft.aiAnalysis?<div className="bg-violet-50 rounded-xl p-4 space-y-3"><h3 className="font-bold text-violet-800">✨ AI Research Insight｜LTIのAIによる参考情報</h3><p className="text-xs">著者の成果・見解とは別の参考情報です。内容を編集してもAIの再実行はありません。</p><label className="block text-sm">研究の要点（1行1項目）<textarea className={input} rows={6} value={draft.aiAnalysis.summary.join('\n')} onChange={e=>update({aiAnalysis:{...draft.aiAnalysis,summary:e.target.value.split('\n')}})}/></label>
 {draft.aiAnalysis.suggestions.map((s:any,i:number)=><div key={i} className="border-t pt-3 space-y-2"><label className="block text-xs">継続提案のタイトル<input className={input} value={s.title} onChange={e=>update({aiAnalysis:{...draft.aiAnalysis,suggestions:draft.aiAnalysis.suggestions.map((x:any,j:number)=>i===j?{...x,title:e.target.value}:x)}})}/></label><label className="block text-xs">提案内容<textarea className={input} rows={3} value={s.description} onChange={e=>update({aiAnalysis:{...draft.aiAnalysis,suggestions:draft.aiAnalysis.suggestions.map((x:any,j:number)=>i===j?{...x,description:e.target.value}:x)}})}/></label><button className="text-xs underline" onClick={()=>update({aiAnalysis:{...draft.aiAnalysis,suggestions:draft.aiAnalysis.suggestions.filter((_:any,j:number)=>i!==j)}})}>この提案を削除</button></div>)}</div>:<p className="text-sm bg-amber-50 p-3 rounded-lg">{draft.aiState?'解析開始済みですが結果が保存されていません。重複課金防止のため再解析しません。':'AI結果はまだありません。'} 手動で分野を指定し、AI参考情報なしで公開することもできます。</p>}
 <p className="text-xs text-slate-500">原稿・著者表記・分野と、AI結果がある場合はその内容を確認して保存してください。</p><button className={button+' bg-indigo-600 text-white'} onClick={()=>void save()}>確認済みとして保存（まだ公開しない）</button><p role="status" className="text-sm">{message}</p></fieldset></details>;
}
