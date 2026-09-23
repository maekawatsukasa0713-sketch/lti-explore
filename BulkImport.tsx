import {AIActivity} from './AIActivity';
import {useEffect,useRef,useState} from 'react';
import {useCloud,uploadPdf,PdfView,supabase} from './cloud';
import {prepareResearch} from './publish-research';
import {RESEARCH_FIELDS,publicationOps} from './research-fields';

type Item={id:number;hash:string;file:File;title:string;path?:string;saved?:boolean;message:string};
const input='block w-full border border-slate-200 rounded-lg p-2 mt-1 bg-white text-sm';
const button='rounded-lg border px-4 py-2 text-sm disabled:opacity-40';
const canAnalyze=(data:any)=>{const missingEvaluation=!!data.aiAnalysis&&!data.aiAnalysis.evaluation;return (!data.aiAnalysis||missingEvaluation)&&(!data.aiState||data.aiState.state==='failed'||(missingEvaluation&&data.aiState.state==='ready')||(data.aiState.state==='processing'&&Date.now()-Date.parse(data.aiState.startedAt||'')>165000))&&!data.aiInputError;};
const canPublish=(data:any,isDirty:boolean)=>!isDirty&&!!data.title?.trim()&&!!data.storagePath&&!!data.field&&data.field!=='未分類'&&(!(data.aiRequested||data.aiState)||!!data.aiAnalysis);
export function BulkImport(){
 const [analyzing,setAnalyzing]=useState(false);
 const cloud=useCloud();const [items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [page,setPage]=useState(1),[query,setQuery]=useState(''),[queueLimit,setQueueLimit]=useState(30);
 const [school,setSchool]=useState(''),[field,setField]=useState('物理'),[mode,setMode]=useState('manual'),[ai,setAi]=useState(true),[filter,setFilter]=useState('すべて');
 const [dirty,setDirty]=useState<Record<string,boolean>>({});const [selected,setSelected]=useState<Record<string,number>>({});const lock=useRef(false),stop=useRef(false),paths=useRef<Record<string,string>>({});
 const pending=cloud.rows.filter(r=>r.kind==='papers'&&r.data.bulkImport&&r.data.status==='承認待ち');
 const visible=pending.filter(r=>(filter==='すべて'||r.data.field===filter)&&[r.data.title,r.data.schoolName,r.data.author].join(' ').includes(query));
 const pages=Math.max(1,Math.ceil(visible.length/20));const shownPage=Math.min(page,pages);
 const patch=(id:number,value:Partial<Item>)=>setItems(old=>old.map(d=>d.id===id?{...d,...value}:d));
 useEffect(()=>{if(!busy)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[busy]);
 async function run(task:()=>Promise<void>){if(lock.current)return;lock.current=true;stop.current=false;setBusy(true);setMessage('');try{await task();}catch(e){setMessage((e as Error).message);}finally{try{await cloud.reload();}catch{setMessage('保存状況の再取得に失敗しました。再読み込みしてください。');}lock.current=false;setBusy(false);}}
 async function add(files:FileList|null){if(!files)return;await run(async()=>{const next=[...items];let skipped=0;for(const file of Array.from(files)){if(next.length>=1000){skipped++;continue;}if(!/\.(pdf|docx)$/i.test(file.name)||!file.size||file.size>50*1024*1024){skipped++;continue;}
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(next.some(d=>d.hash===hash)||cloud.rows.some(r=>r.kind==='papers'&&r.data.sourceHash===hash)){skipped++;continue;}
 next.push({id:parseInt(hash.slice(0,13),16),hash,file,title:file.name.replace(/\.[^.]+$/,''),message:'未登録'});}
 setItems(next);setMessage(`${next.length}件を選択しました。${skipped?`${skipped}件は重複・形式・サイズ・件数上限により除外しました。`:''}`);});}
 async function analyze(ids:number[]){
  setAnalyzing(true);
  try{
   let done=0,skipped=0,failed=0,consecutiveFailures=0;
   for(const id of ids){
    if(stop.current)break;
    setMessage(`AI解析を受付中：${done+skipped+failed+1} / ${ids.length}件。画面を閉じてもサーバーで処理が続きます。`);
    try{
     await prepareResearch(id);done++;consecutiveFailures=0;
    }catch(e){
     if((e as {inputError?:boolean}).inputError){skipped++;continue;}
     const reason=(e as Error).message||'AI解析に失敗しました。';
     if(reason.includes('利用上限')){
      setMessage(`${done}件のAI解析を保存しました。${skipped}件は本文抽出に失敗しました。${failed}件はAI解析に失敗しました。処理を停止：${reason} 未解析・失敗分は一覧から再解析できます。`);return;
     }
     failed++;consecutiveFailures++;
     if(consecutiveFailures>=3){
      setMessage(`${done}件のAI解析を保存しました。${skipped}件は本文抽出に失敗しました。${failed}件はAI解析に失敗しました。AI提供元の障害拡大を避けるため、連続3件の失敗で停止しました。未解析・失敗分は一覧から再解析できます。`);return;
     }
    }
   }
   setMessage(`${done}件のAI分類・要約・継続提案を保存しました。${skipped}件は本文抽出に失敗しました。${failed?`${failed}件はAI解析に失敗しました。失敗分は一覧から再解析できます。`:''}結果を確認してから公開してください。${stop.current?'残りの処理は停止しました。':''}`);
  }finally{setAnalyzing(false);}
 }
 async function register(){await run(async()=>{
 const assurance=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
 if(assurance.error)throw assurance.error;
 if(assurance.data.nextLevel==='aal2'&&assurance.data.currentLevel!=='aal2')throw new Error('運営アカウントの認証期限が切れています。再ログインしてから登録してください。ファイルはまだ送信していません。');
 const saved:number[]=[];let failed=0;const failures:string[]=[];for(const d of items.filter(x=>!x.saved)){if(stop.current)break;try{
 if(!d.title.trim())throw new Error('タイトルを入力してください。');patch(d.id,{message:'保存中…'});
 const existing=await supabase.from('lti_records').select('id,data').eq('kind','papers').eq('id',String(d.id)).maybeSingle();if(existing.error)throw existing.error;
 if(existing.data){if(existing.data.data.sourceHash!==d.hash)throw new Error('識別番号が重複しました。運営で確認してください。');patch(d.id,{saved:true,message:'登録済み（重複登録しません）'});continue;}
 setMessage(`原稿を保存中：${saved.length+failed+1}件目 / ${items.filter(x=>!x.saved).length}件`);const path=paths.current[d.hash]||await uploadPdf(d.file,percent=>patch(d.id,{message:`アップロード ${percent}%`}));paths.current[d.hash]=path;
 const data={id:d.id,title:d.title.trim(),author:'著者名非公開',schoolName:school.trim()||'学校名未登録',schoolId:null,field:mode==='ai'?'未分類':field,classificationMode:mode,sourceHash:d.hash,bulkImport:true,bulkReviewed:false,aiRequested:ai||mode==='ai',storagePath:path,fileName:d.file.name,fileSize:d.file.size,status:'承認待ち',submittedDate:new Date().toISOString().slice(0,10),publishedDate:'',submittedByTeacherId:cloud.profile.id,submittedByTeacherName:cloud.profile.name,abstract:'',views:0};
 const result=await supabase.rpc('lti_save_records',{ops:[{action:'insert',kind:'papers',id:String(d.id),data}]});if(result.error)throw result.error;
 patch(d.id,{saved:true,message:'保存済み・非公開'});saved.push(d.id);
 }catch(e){failed++;const reason=(e as Error).message||'原因不明のエラー';failures.push(`${d.file.name}：${reason}`);patch(d.id,{message:'登録失敗：'+reason});}}
 await cloud.reload();if((ai||mode==='ai')&&saved.length&&!stop.current)await analyze(saved);else setMessage(`${saved.length}件を非公開で保存しました。${failed}件の登録失敗。${failures.length?`\n\n失敗理由：\n${failures.slice(0,5).join('\n')}${failures.length>5?`\nほか${failures.length-5}件`:''}`:''}`);
 });}
 async function publish(target:Record<string,number>=selected){const ids=Object.keys(target);if(!ids.length)return;const one=pending.find(r=>r.id===ids[0]);const prompt=ids.length===1?`「${one?.data.title||'この論文'}」を確認済みとして「みんなの論文」に公開しますか？`:`選択した${ids.length}件を確認済みとして「みんなの論文」に一括公開しますか？`;if(!confirm(prompt))return;await run(async()=>{let done=0;for(let offset=0;offset<ids.length;offset+=50){if(stop.current)break;const chunk=ids.slice(offset,offset+50);const fresh=await supabase.from('lti_records').select('id,version,data').eq('kind','papers').in('id',chunk);if(fresh.error)throw fresh.error;const ops=publicationOps(fresh.data,Object.fromEntries(chunk.map(id=>[id,target[id]])));const result=await supabase.rpc('lti_save_records',{ops});if(result.error)throw result.error;done+=ops.length;setSelected(old=>{const next={...old};chunk.forEach(id=>delete next[id]);return next;});setMessage(`公開済み ${done} / ${ids.length}件`);}setMessage(`${done}件を公開しました。${done<ids.length?'残りは未公開のままです。':''}`);});}
 if(cloud.profile.role!=='admin')return <p>この機能はLTI運営専用です。</p>;
 return <section className="space-y-6"><header><h1 className="text-2xl font-bold">論文の一括登録・公開</h1><p className="mt-2 text-sm text-slate-500">原稿を保存 → AI解析（選択した場合）→ 原稿とAI結果を確認 → 一括公開</p></header>
 <fieldset disabled={busy} className="bg-white border rounded-2xl p-5 space-y-4"><h2 className="font-bold">1. ファイルと分類方法</h2><div className="grid md:grid-cols-2 gap-4"><label className="text-sm">共通の学校名（任意）<input className={input} value={school} onChange={e=>setSchool(e.target.value)} placeholder="例：〇〇高等学校"/></label><label className="text-sm">分野の決め方<select className={input} value={mode} onChange={e=>setMode(e.target.value)}><option value="manual">分野をまとめて指定</option><option value="ai">AIが本文から自動分類</option></select></label></div>
 {mode==='manual'&&<label className="block text-sm">今回登録する論文の共通分野<select className={input} value={field} onChange={e=>setField(e.target.value)}>{RESEARCH_FIELDS.filter(f=>f!=='未分類').map(f=><option key={f}>{f}</option>)}</select></label>}
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={mode==='ai'||ai} disabled={mode==='ai'} onChange={e=>setAi(e.target.checked)}/>登録後、Claudeで要約・継続提案を生成する（AI分類も同じ解析で行います）</label>
 <p className="text-xs text-slate-500">PDF／Word（.docx）を1ファイル1論文として登録。最大1,000件、各50MB。LTI運営の一括AI解析は1時間100件・1日1,000件の上限内で処理します。AIを選んだ論文は解析完了と運営による結果確認まで公開できません。8MB超のPDFはテキスト抽出でAI解析します（図表画像は対象外・300ページ／8万文字まで）。画像のみのPDFはOCRまたは圧縮が必要です。著者名は初期状態では非公開です。ファイル本文の氏名は自動削除されません。</p>
 <input aria-label="論文ファイルを複数選択" type="file" multiple accept=".pdf,.docx" onChange={e=>{void add(e.target.files);e.target.value='';}}/>
 {items.length>0&&<div className="space-y-2">{items.slice(0,queueLimit).map(d=><div key={d.id} className="border rounded-lg p-3"><p className="text-xs text-slate-500 break-all">{d.file.name}（{(d.file.size/1024/1024).toFixed(1)}MB）— {d.message}</p><label className="text-xs">タイトル<input className={input} value={d.title} disabled={d.saved} onChange={e=>patch(d.id,{title:e.target.value})}/></label>{!d.saved&&<button className="text-xs underline mt-2" onClick={()=>setItems(old=>old.filter(x=>x.id!==d.id))}>除外</button>}</div>)}</div>}
 <p className="text-sm font-semibold">選択 {items.length}件・合計 {(items.reduce((sum,d)=>sum+d.file.size,0)/1024/1024/1024).toFixed(2)}GB・保存済み {items.filter(d=>d.saved).length}件</p>{items.length>queueLimit&&<button className={button} onClick={()=>setQueueLimit(n=>n+30)}>選択ファイルをさらに30件表示</button>}<div className="flex gap-3"><button className={button+' bg-indigo-600 text-white'} disabled={!items.some(d=>!d.saved)} onClick={()=>void register()}>一括登録して確認へ</button><button className={button} onClick={()=>setItems(old=>old.filter(d=>!d.saved))}>登録済みを選択欄から外す</button></div></fieldset>
 {analyzing&&<AIActivity/>}
 <p role="status" className="text-sm bg-indigo-50 rounded-xl p-4 whitespace-pre-wrap">{message||'登録した論文は、原稿とAI結果を確認して公開するまで非公開です。'}</p>{busy&&<button className={button} onClick={()=>{stop.current=true;setMessage('現在の1件が終わったら停止します。');}}>残りの処理を停止</button>}
 <div className="space-y-4"><h2 className="font-bold text-lg">2. 登録済みの論文を確認・編集（{pending.length}件）</h2><p className="text-sm text-slate-500">解析に失敗した論文も一覧に残り、再解析できます。AI結果が到着したらもう一度内容を確認して保存してください。</p><p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">AI解析済みで、タイトル・分野・原稿が揃っていれば一括公開のチェックを入れられます。チェックして公開すると、その操作を内容確認済みとして保存します。内容を編集した場合だけ、先に「確認済みとして保存」を押してください。</p>
 <div className="flex flex-wrap items-center gap-3"><input aria-label="登録論文を検索" placeholder="タイトル・学校名・著者で検索" className={input+' max-w-sm'} value={query} onChange={e=>{setQuery(e.target.value);setPage(1);setSelected({});}}/><label className="text-sm">分野で表示<select className={input} value={filter} disabled={busy} onChange={e=>{setFilter(e.target.value);setPage(1);setSelected({});}}>{['すべて',...new Set(pending.map(r=>r.data.field||'未分類'))].map(f=><option key={f}>{f}</option>)}</select></label>
 <button disabled={busy||!visible.some(r=>canAnalyze(r.data))} className={button} onClick={()=>void run(()=>analyze(visible.filter(r=>canAnalyze(r.data)).slice(0,1000).map(r=>Number(r.id))))}>未解析・失敗・五角形未生成分をAI解析（{visible.filter(r=>canAnalyze(r.data)).length}件）</button>
 <button disabled={busy} className={button} onClick={()=>setSelected(Object.fromEntries(visible.filter(r=>canPublish(r.data,!!dirty[r.id])).slice(0,1000).map(r=>[r.id,r.version])))}>絞り込み中の公開できる論文を選択（最大1,000件）</button><button disabled={busy} className={button} onClick={()=>setSelected({})}>選択解除</button></div>
 <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3"><p className="text-sm font-semibold">公開対象：{Object.keys(selected).length}件 <span className="ml-1 font-normal text-slate-600">選択した論文をまとめて公開できます</span></p><button className={button+' bg-emerald-600 text-white'} disabled={busy||!Object.keys(selected).length} onClick={()=>void publish()}>選択した{Object.keys(selected).length}件を一括公開</button></div>
 {visible.slice((shownPage-1)*20,shownPage*20).map(r=><div key={r.id+':'+r.version} className="bg-white border rounded-xl p-4"><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex gap-2 items-center text-sm"><input type="checkbox" disabled={busy||!canPublish(r.data,!!dirty[r.id])} checked={selected[r.id]===r.version} onChange={e=>setSelected(old=>{const next={...old};if(e.target.checked)next[r.id]=r.version;else delete next[r.id];return next;})}/><span>一括公開の対象にする</span><span className="text-slate-500">— {r.data.field} / {r.data.aiAnalysis?(r.data.aiAnalysis.evaluation?'AI保存済み・五角形あり':'AI保存済み・五角形未生成'):r.data.aiState?.state==='failed'?'AI解析失敗':r.data.aiState?.state==='processing'?'AI解析中':r.data.aiRequested?'AI未解析':'AI未使用'} / {r.data.bulkReviewed?'確認済み':'チェックして公開時に確認済み'}</span></label><button className={button+' bg-emerald-600 text-white'} disabled={busy||!canPublish(r.data,!!dirty[r.id])} onClick={()=>void publish({[r.id]:r.version})}>この論文を公開</button></div><BulkReview row={r} disabled={busy} onDirty={()=>{setDirty(old=>({...old,[r.id]:true}));setSelected(old=>{const n={...old};delete n[r.id];return n;});}} onSave={async()=>{setDirty(old=>({...old,[r.id]:false}));setSelected(old=>{const n={...old};delete n[r.id];return n;});await cloud.reload();}}/></div>)}
 <div className="flex gap-4 items-center"><button disabled={busy||shownPage<=1} className={button} onClick={()=>setPage(shownPage-1)}>前へ</button><span>{shownPage} / {pages}ページ・{visible.length}件</span><button disabled={busy||shownPage>=pages} className={button} onClick={()=>setPage(shownPage+1)}>次へ</button></div>{!visible.length&&<p className="text-sm text-slate-500 p-6 border rounded-xl">この条件の承認待ち論文はありません。</p>}
 </div></section>;
}
function BulkReview({row,disabled,onSave,onDirty}:{row:{id:string;version:number;data:any};disabled:boolean;onSave:()=>Promise<void>;onDirty:()=>void}){
 const [draft,setDraft]=useState(row.data),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[original,setOriginal]=useState(false);
 const update=(patch:Record<string,unknown>)=>{onDirty();setDraft((d:any)=>({...d,...patch}));};
 async function save(){if(!draft.title?.trim()||!draft.field||draft.field==='未分類'){setMessage('タイトルと分野を確認してください。');return;}if((draft.aiRequested||draft.aiState)&&!draft.aiAnalysis){setMessage('AI解析が未完了です。先に「未解析・失敗分をAI解析」を実行してください。');return;}setBusy(true);try{
 const data={...draft,author:draft.author?.trim()||'著者名非公開',schoolName:draft.schoolName?.trim()||'学校名未登録',bulkReviewed:true,...(draft.aiAnalysis?{aiReviewedAt:new Date().toISOString()}:{})};
 const {error}=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:row.id,version:row.version,data}]});if(error)throw error;await onSave();setMessage('確認済みとして保存しました。');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <details><summary className="font-bold cursor-pointer">{row.data.title} <span className="font-normal text-xs text-slate-500">— 原稿・分類・AI結果を確認／編集</span></summary><fieldset disabled={busy||disabled} className="mt-4 space-y-4">
 <div className="grid md:grid-cols-2 gap-3">{(['title','author','schoolName'] as const).map((k,i)=><label key={k} className="text-xs">{['タイトル','公開する著者名（空欄は非公開）','学校名'][i]}<input className={input} value={draft[k]||''} onChange={e=>update({[k]:e.target.value})}/></label>)}<label className="text-xs">分野<select className={input} value={draft.field||'未分類'} onChange={e=>update({field:e.target.value,classificationMode:'manual'})}>{[...new Set([...RESEARCH_FIELDS,draft.field].filter(Boolean))].map(f=><option key={f}>{f}</option>)}</select></label></div>
 {draft.classificationReason&&<p className="text-xs text-violet-700">AIの分類根拠：{draft.classificationReason}（分野は上で修正できます）</p>}
 <label className="block text-xs">著者の要旨（任意・AI要約とは別）<textarea className={input} rows={3} value={draft.abstract||''} onChange={e=>update({abstract:e.target.value})}/></label>
 <button className={button} onClick={()=>setOriginal(!original)}>{original?'原稿を閉じる':'著者の研究成果（原稿）を開く'}</button>{original&&<PdfView path={draft.storagePath}/>}
 {draft.aiAnalysis?<div className="bg-violet-50 rounded-xl p-4 space-y-3"><h3 className="font-bold text-violet-800">✨ AI Research Insight｜LTIのAIによる参考情報</h3><p className="text-xs">著者の成果・見解とは別の参考情報です。内容を編集してもAIの再実行はありません。</p><label className="block text-sm">研究の要点（1行1項目）<textarea className={input} rows={6} value={draft.aiAnalysis.summary.join('\n')} onChange={e=>update({aiAnalysis:{...draft.aiAnalysis,summary:e.target.value.split('\n')}})}/></label>
 {draft.aiAnalysis.suggestions.map((s:any,i:number)=><div key={i} className="border-t pt-3 space-y-2"><label className="block text-xs">継続提案のタイトル<input className={input} value={s.title} onChange={e=>update({aiAnalysis:{...draft.aiAnalysis,suggestions:draft.aiAnalysis.suggestions.map((x:any,j:number)=>i===j?{...x,title:e.target.value}:x)}})}/></label><label className="block text-xs">提案内容<textarea className={input} rows={3} value={s.description} onChange={e=>update({aiAnalysis:{...draft.aiAnalysis,suggestions:draft.aiAnalysis.suggestions.map((x:any,j:number)=>i===j?{...x,description:e.target.value}:x)}})}/></label><button className="text-xs underline" onClick={()=>update({aiAnalysis:{...draft.aiAnalysis,suggestions:draft.aiAnalysis.suggestions.filter((_:any,j:number)=>i!==j)}})}>この提案を削除</button></div>)}</div>:<p className="text-sm bg-amber-50 p-3 rounded-lg">{draft.aiInputError?draft.aiInputError:draft.aiState?.state==='failed'?`前回の解析に失敗しました（${draft.aiState.reason||'原因不明'}）。上部から再解析できます。`:draft.aiState?'解析中です。重複課金防止のため再実行しません。':'AI結果はまだありません。'} {draft.aiRequested||draft.aiState?'AI結果を保存・確認するまで公開できません。':'AIを使わずに公開することもできます。'}</p>}
 <p className="text-xs text-slate-500">原稿・著者表記・分野と、AI結果がある場合はその内容を確認して保存してください。</p><button className={button+' bg-indigo-600 text-white'} onClick={()=>void save()}>確認済みとして保存（まだ公開しない）</button><p role="status" className="text-sm">{message}</p></fieldset></details>;
}
