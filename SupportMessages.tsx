import React, {useCallback, useEffect, useRef, useState} from 'react';
import {MessageSquare, Send, RefreshCw, Inbox} from 'lucide-react';
import {supabase} from './client';
import {useCloud} from './cloud';

type Message = {id:string; sender_id:string; school_name:string; sender_name:string; sender_role:string; category:string; subject:string; body:string; status:string; reply:string; created_at:string; updated_at:string};
const statuses=['未対応','対応中','対応済み'];
const field='w-full rounded-xl border border-gray-300 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const button='rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-40';
const date=(s:string)=>new Date(s).toLocaleString('ja-JP');
export function SupportMessages(){
 const {profile}=useCloud(); const admin=profile.role==='admin';
 const [items,setItems]=useState<Message[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[filter,setFilter]=useState('すべて');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [category,setCategory]=useState('機能追加の希望'),[subject,setSubject]=useState(''),[body,setBody]=useState('');
 const [selected,setSelected]=useState<Message|null>(null),[reply,setReply]=useState(''),[status,setStatus]=useState('未対応');
 const requestId=useRef(crypto.randomUUID()),lock=useRef(false),generation=useRef(0);
 const load=useCallback(async()=>{
  const current=++generation.current;setLoading(true);setError('');
  try{
   let q=supabase.from('lti_support_messages').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id').range(page*20,page*20+19);
   if(!admin)q=q.eq('sender_id',profile.id);
   if(admin&&filter!=='すべて')q=q.eq('status',filter);
   const result=await q;
   if(current!==generation.current)return;
   if(result.error)throw result.error;
   setItems(result.data||[]);setTotal(result.count||0);
   if(!admin)setSelected(previous=>previous?(result.data||[]).find(m=>m.id===previous.id)||null:null);
  }catch{if(current===generation.current)setError('メッセージを読み込めませんでした。「更新」で再度お試しください。');}
  finally{if(current===generation.current)setLoading(false);}
 },[admin,profile.id,page,filter]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 const send=async(e:React.FormEvent)=>{
  e.preventDefault();if(lock.current||!subject.trim()||!body.trim())return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const {error:err}=await supabase.from('lti_support_messages').insert({id:requestId.current,category,subject:subject.trim(),body:body.trim()});
   if(err){
    // A lost success response can be retried safely with the same UUID.
    if(err.code==='23505'){
     const prior=await supabase.from('lti_support_messages').select('id').eq('id',requestId.current).eq('sender_id',profile.id).maybeSingle();
     if(prior.error||!prior.data)throw err;
    }else throw err;
   }
   requestId.current=crypto.randomUUID();setSubject('');setBody('');setNotice('LTI運営へ送信しました。返信や対応状況は下の送信履歴で確認できます。');
   if(page===0)await load();else setPage(0);
  }catch(err){const msg=(err as {message?:string}).message||'';setError(msg.includes('1時間')?msg:'送信を確認できませんでした。入力内容は残っています。更新で履歴を確認するか、もう一度送信してください。');}
  finally{lock.current=false;setBusy(false);}
 };
 const save=async()=>{
  if(!selected||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const {data,error:err}=await supabase.from('lti_support_messages').update({status,reply:reply.trim()}).eq('id',selected.id).eq('updated_at',selected.updated_at).select('*').single();
   if(err||!data)throw err;setSelected(data);setNotice('対応状況と返信を保存しました。');await load();
  }catch{setError('保存できませんでした。他の運営者が更新した可能性があります。一覧を更新し、メッセージを選び直してください。');}
  finally{lock.current=false;setBusy(false);}
 };
 return <section className="max-w-5xl mx-auto space-y-5 pb-20">
  <div className="rounded-2xl border bg-white p-6"><h2 className="text-xl font-bold flex items-center gap-2">{admin?<Inbox className="text-indigo-600"/>:<MessageSquare className="text-emerald-600"/>}{admin?'LTI受信ボックス':'LTI運営にメッセージ'}</h2><p className="mt-2 text-sm text-gray-600">{admin?'先生・生徒から届いた機能追加の希望や修正依頼を確認できます。':'「こんな機能がほしい」「ここがうまく動かない」など、気づいたことを教えてください。内容はあなたとLTI運営だけが確認できます。'}</p></div>
  {error&&<p role="alert" className="rounded-xl bg-red-50 text-red-800 p-4">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 text-emerald-800 p-4">{notice}</p>}
  {!admin&&<form onSubmit={send} className="rounded-2xl border bg-white p-6 space-y-4">
   <label className="block text-sm font-bold">相談の種類<select className={field+' mt-2'} value={category} disabled={busy} onChange={e=>setCategory(e.target.value)}>{['機能追加の希望','不具合・修正依頼','その他'].map(c=><option key={c}>{c}</option>)}</select></label>
   <label className="block text-sm font-bold">件名<input required maxLength={120} disabled={busy} value={subject} onChange={e=>setSubject(e.target.value)} className={field+' mt-2'} placeholder="例：提出したファイルを確認できません"/></label>
   <label className="block text-sm font-bold">内容<textarea required maxLength={5000} rows={6} disabled={busy} value={body} onChange={e=>setBody(e.target.value)} className={field+' mt-2'} placeholder="どの画面で、何をしたときに困りましたか？ 機能の希望も気軽に書いてください。"/></label>
   <div className="flex flex-wrap justify-between items-center gap-3"><p className="text-xs text-gray-500">{body.length} / 5,000文字 · パスワードや認証コードは書かないでください。</p><button disabled={busy||!subject.trim()||!body.trim()} className={button+' bg-indigo-600 text-white flex gap-2 items-center'}><Send size={16}/>{busy?'送信中…':'LTI運営へ送信'}</button></div>
  </form>}
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{admin?'受信メッセージ':'送信履歴'}（{total}件）</h3><div className="flex gap-2">{admin&&<select aria-label="対応状況で絞り込み" className={field} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);setSelected(null);}}><option>すべて</option>{statuses.map(s=><option key={s}>{s}</option>)}</select>}<button type="button" disabled={loading||busy} onClick={()=>void load()} className={button+' flex gap-2 items-center whitespace-nowrap'}><RefreshCw size={16}/>更新</button></div></div>
  {loading?<p role="status" className="p-8 text-center">読み込み中…</p>:items.length===0?<p className="rounded-2xl border bg-white p-8 text-gray-500">{admin?'この条件のメッセージはありません。':'まだ送信したメッセージはありません。'}</p>:<div className="grid md:grid-cols-2 gap-4 items-start"><div className="space-y-3">{items.map(m=><button key={m.id} type="button" disabled={busy} onClick={()=>{setSelected(m);setStatus(m.status);setReply(m.reply);setNotice('');}} className={'w-full text-left rounded-2xl border p-4 bg-white hover:border-indigo-400 '+(selected?.id===m.id?'ring-2 ring-indigo-400':'')}><div className="flex flex-wrap gap-2 items-center text-xs"><span className={'rounded-full px-2 py-1 '+(m.status==='未対応'?'bg-amber-100 text-amber-900':'bg-indigo-50 text-indigo-700')}>{m.status}</span><span className="text-gray-500">{m.category}</span></div><p className="mt-2 font-bold break-words">{m.subject}</p>{admin&&<p className="mt-2 text-sm text-gray-600 break-words">{m.school_name} · {m.sender_name}（{m.sender_role==='teacher'?'先生':'生徒'}）</p>}<p className="mt-2 text-xs text-gray-500">{date(m.created_at)}{m.reply?' · 運営からの返信あり':''}</p></button>)}</div>
   {selected?<article className="rounded-2xl border bg-white p-5 space-y-4 min-w-0"><h3 className="font-bold break-words">{selected.subject}</h3><p className="whitespace-pre-wrap break-words text-sm leading-7">{selected.body}</p><p className="text-xs text-gray-500">送信：{date(selected.created_at)}</p>{admin?<><label className="block text-sm font-bold">対応状況<select className={field+' mt-2'} disabled={busy} value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label className="block text-sm font-bold">送信者への返信<textarea rows={5} maxLength={5000} disabled={busy} className={field+' mt-2'} value={reply} onChange={e=>setReply(e.target.value)} placeholder="確認結果や対応予定を入力してください。"/></label><button disabled={busy} onClick={()=>void save()} className={button+' bg-indigo-600 text-white'}>{busy?'保存中…':'対応状況・返信を保存'}</button></>:<div className="rounded-xl bg-indigo-50 p-4"><h4 className="font-bold text-sm text-indigo-900">LTI運営からの返信</h4><p className="whitespace-pre-wrap break-words text-sm mt-2 leading-7">{selected.reply||'まだ返信はありません。'}</p></div>}</article>:<p className="p-6 text-sm text-gray-500">メッセージを選ぶと内容を確認できます。</p>}
  </div>}
  <div className="flex items-center justify-center gap-4"><button className={button} disabled={page===0||loading||busy} onClick={()=>{setPage(p=>p-1);setSelected(null);}}>前へ</button><span className="text-sm">{page+1} / {Math.max(1,Math.ceil(total/20))}</span><button className={button} disabled={(page+1)*20>=total||loading||busy} onClick={()=>{setPage(p=>p+1);setSelected(null);}}>次へ</button></div>
 </section>;
}
