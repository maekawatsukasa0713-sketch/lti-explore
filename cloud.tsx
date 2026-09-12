import {PasswordInput} from './PasswordInput';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {Building2,ShieldCheck,ChevronRight,ArrowLeft,User,Lock} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import {supabase} from './client';
import {schoolLoginEmail,PasswordChange,MfaSetup,AccountManagement} from './accounts';
export {supabase} from './client';
export type Profile = { deleted_at?:string|null; attendance_number?:number|null; login_id?:string|null; must_change_password?:boolean; initial_password_expires_at?:string|null; session_valid_after?:string; id:string; school_id:string|null; role:'admin'|'teacher'|'student'; active:boolean; name:string; class:string; dept:string; theme:string };
type Row = { kind:string; id:string; owner_id:string; data:any; version:number };
type School = {id:string;name:string;deleted_at?:string|null};
type Store = { profile:Profile; profiles:Profile[]; schools:School[]; rows:Row[]; save:(kind:string, before:any[], next:any[])=>Promise<void>; reload:()=>Promise<void>; signOut:()=>Promise<void> };
const Cloud = createContext<Store|null>(null);
export function useCloud(){const c=useContext(Cloud);if(!c)throw new Error('ログインが必要です');return c;}
const kinds:Record<string,string> = {lti_papers:'papers',lti_assignments:'assignments',lti_teaching_materials:'materials',lti_contests:'contests',lti_notices:'notices',lti_student_feedback_messages:'feedback',lti_academic_references:'references'};
function values(store:Store,key:string):any[] {
 if(key==='lti_registered_school_ids')return store.schools.map(s=>s.id);
 if(['lti_teachers_list','lti_students_list','lti_admin_users'].includes(key)) {
  const role=key==='lti_teachers_list'?'teacher':key==='lti_students_list'?'student':'admin';
  return store.profiles.filter(p=>p.role===role && p.active).map(p=>({...p,schoolId:p.school_id||'',pass:'',email:'',name:p.name||p.id}));
 }
 const kind=kinds[key];
 const items=store.rows.filter(r=>r.kind===kind).map(r=>r.data);
 if(kind==='papers')return items.map(p=>({...p,schoolName:store.schools.find(s=>s.id===p.schoolId)?.name||(p.schoolName&&p.schoolName!==p.schoolId?p.schoolName:'学校名未登録'),messages:store.rows.find(r=>r.kind==='paper_threads'&&r.id===String(p.id))?.data.messages||[]}));
 if(kind==='assignments')return items.map(a=>({...a,submissions:Object.fromEntries(store.rows.filter(r=>r.kind==='submissions' && String(r.data.assignmentId)===String(a.id)).map(r=>[r.data.studentId,r.data]))}));
 return items;
}
export function useCloudList<T>(key:string,_initialValue:T):[T,React.Dispatch<React.SetStateAction<T>>] {
 const store=useCloud(); const current=values(store,key) as T;
 const set:React.Dispatch<React.SetStateAction<T>>=(action)=>{
  const next=typeof action==='function'?(action as (v:T)=>T)(current):action;
  void store.save(kinds[key]||key,current as any[],next as any[]);
 };
 return [current,set];
}
export async function saveMyProfile(name:string,password:string) {
 const {data:{user}}=await supabase.auth.getUser(); if(!user)throw new Error('再ログインしてください');
 if(password)throw new Error('パスワード変更は画面右下の「パスワード変更」から行ってください。');
 const {error}=await supabase.from('lti_profiles').update({name:name.trim()}).eq('id',user.id);if(error)throw error;
}
export async function uploadPdf(file:File):Promise<string> {
 const ext=file.name.split('.').pop()?.toLowerCase();
 const types:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 if(!ext||!types[ext]||file.size>10*1024*1024)throw new Error('PDF・Word（.docx、10MB以内）を選んでください');
 const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('ログインしてください');
 const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
 const {error}=await supabase.storage.from('lti-documents').upload(path,file,{contentType:types[ext],upsert:false});if(error)throw error;return path;
}
export function PdfView({path}:{path?:string}) {
 const [url,setUrl]=useState('');const [text,setText]=useState('');const [error,setError]=useState('');const [full,setFull]=useState(false);
 useEffect(()=>{let alive=true;let objectUrl='';setUrl('');setText('');setError('');if(path)(async()=>{try{const {data,error}=await supabase.storage.from('lti-documents').download(path);if(error)throw error;objectUrl=URL.createObjectURL(data);if(path.endsWith('.docx')){const mammoth=await import('mammoth');const result=await mammoth.extractRawText({arrayBuffer:await data.arrayBuffer()});if(alive)setText(result.value);}if(alive)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);}catch{if(alive)setError('添付を取得できませんでした。通信と閲覧権限を確認してください。');}})();return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[path]);
 if(!path)return null;
 return <section className={full?'fixed inset-0 z-[110] bg-white p-4 overflow-auto':'space-y-2'}><div className="flex gap-4 p-2"><button type="button" onClick={()=>setFull(!full)} className="text-sm underline">{full?'全画面を閉じる':'全画面表示'}</button>{url&&<a href={url} download={path.endsWith('.docx')?'document.docx':'document.pdf'} className="text-sm underline">ダウンロード</a>}</div>{error?<p role="alert">{error}</p>:!url?<p>添付を読み込み中…</p>:path.endsWith('.docx')?<><p className="text-xs text-gray-500">Wordの本文表示です。図表・書式はダウンロードした原稿で確認してください。</p><pre className="whitespace-pre-wrap font-sans p-6 text-sm">{text||'抽出できる本文がありません。原稿をダウンロードしてください。'}</pre></>:<iframe src={url} title="添付PDF" className={`w-full border rounded-xl ${full?'h-[88vh]':'h-[75vh] min-h-[600px]'}`}/>}</section>;
}
export function CloudGate({children}:{children:(p:Profile,logout:()=>Promise<void>)=>React.ReactNode}) {
 const [session,setSession]=useState<Session|null>(null);const [initial,setInitial]=useState(true);
 const [profile,setProfile]=useState<Profile|null>(null);const [profiles,setProfiles]=useState<Profile[]>([]);const [schools,setSchools]=useState<School[]>([]);const [rows,setRows]=useState<Row[]>([]);
 const [dataReady,setDataReady]=useState(false);const [slow,setSlow]=useState(false);
 const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [authError,setAuthError]=useState('');
 const [entry,setEntry]=useState(false);const [loginType,setLoginType]=useState<'school'|'email'>('school');const [loginSchool,setLoginSchool]=useState(()=>{try{return localStorage.getItem('lti-login-school')||'';}catch{return '';}});const [loginId,setLoginId]=useState('');const [aal,setAal]=useState<string|null>(null);const [nextAal,setNextAal]=useState<string|null>(null);const [showMfa,setShowMfa]=useState(false);const [showPassword,setShowPassword]=useState(false);
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [mode,setMode]=useState<'login'|'signup'|'reset'>('login');const [recovery,setRecovery]=useState(false);
 const ref=useRef<Row[]>([]);const lock=useRef(false);const generation=useRef(0);
 useEffect(()=>{let alive=true;const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{if(!alive)return;setSession(next);setInitial(false);if(event==='PASSWORD_RECOVERY')setRecovery(true);});supabase.auth.getSession().then(({data,error})=>{if(alive){if(error)setAuthError(error.message);setSession(data.session);setInitial(false);}});return()=>{alive=false;subscription.unsubscribe();};},[]);
 const userId=session?.user.id;
 const waiting=initial||!!session&&(!profile||!aal||loading);
 useEffect(()=>{setSlow(false);if(!waiting)return;const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[waiting,userId]);
 useEffect(()=>{let alive=true;setAal(null);setNextAal(null);if(session)supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({data,error})=>{if(alive){if(error)setError(error.message);else{setAal(data.currentLevel);setNextAal(data.nextLevel);}}});return()=>{alive=false;};},[session?.access_token]);
 const reload=async()=>{
  const token=++generation.current;
  if(!userId){setProfile(null);setRows([]);ref.current=[];setProfiles([]);setSchools([]);return;}
  setLoading(true);
  try {
   const {data:p,error:pe}=await supabase.from('lti_profiles').select('*').eq('id',userId).single();if(pe)throw pe;
   if(token!==generation.current)return;setProfile(p);
   if(!p.active){setRows([]);ref.current=[];setProfiles([]);setSchools([]);return;}
   const [pr,sc]=await Promise.all([supabase.from('lti_profiles').select('*'),supabase.from('lti_schools').select('*')]);if(pr.error)throw pr.error;if(sc.error)throw sc.error;
   const all:Row[]=[];for(let offset=0;;offset+=500){const r=await supabase.from('lti_records').select('*').order('kind').order('id').range(offset,offset+499);if(r.error)throw r.error;all.push(...r.data);if(r.data.length<500)break;}
   if(token!==generation.current)return;setProfiles(pr.data.filter(p=>!p.deleted_at));setSchools(sc.data.filter(s=>!s.deleted_at));setRows(all);ref.current=all;setDataReady(true);setError('');
  }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'データを取得できませんでした');}finally{if(token===generation.current)setLoading(false);}
 };
 useEffect(()=>{setDataReady(false);setProfile(null);setRows([]);ref.current=[];setError('');void reload();return()=>{generation.current++;};},[userId]);
 const signOut=async()=>{generation.current++;const {error}=await supabase.auth.signOut();if(error){setError(error.message);return;}setSession(null);setProfile(null);setPassword('');setRows([]);ref.current=[];setRecovery(false);};
 const save=async(kind:string,before:any[],next:any[])=>{
  if(lock.current){setError('別の保存が処理中です。完了後にもう一度操作してください。');return;}
  lock.current=true;setBusy(true);setError('');
  try {
   if(!Object.values(kinds).includes(kind))throw new Error('アカウント管理は画面上部の「学校・利用者管理」を使用してください。パスワードは本人が変更します。');
   const ops:any[]=[];
   const diff=(k:string,old:any[],now:any[])=>{
    const oldMap=new Map(old.map(d=>[String(d.id),d]));const nowMap=new Map(now.map(d=>[String(d.id),d]));
    for(const [id,d] of nowMap){const prev=oldMap.get(id);if(JSON.stringify(prev)===JSON.stringify(d))continue;const row=ref.current.find(r=>r.kind===k&&r.id===id);ops.push({action:prev?'update':'insert',kind:k,id,data:d,version:row?.version});}
    for(const [id] of oldMap)if(!nowMap.has(id)){const row=ref.current.find(r=>r.kind===k&&r.id===id);ops.push({action:'delete',kind:k,id,version:row?.version});}
   };
   if(kind==='assignments'){
    if(before.some(a=>!next.some(b=>String(b.id)===String(a.id)) && Object.keys(a.submissions||{}).length))throw new Error('提出物がある課題は削除できません。内容の編集を利用してください。');
    const strip=(a:any)=>{const {submissions,...rest}=a;return rest;};
    diff(kind,before.map(strip),next.map(strip));
    const subs=(items:any[])=>items.flatMap(a=>Object.entries(a.submissions||{}).map(([studentId,sub]:[string,any])=>({...sub,id:`${a.id}:${studentId}`,assignmentId:String(a.id),studentId,schoolId:a.schoolId})));
    diff('submissions',subs(before),subs(next));
   }else if(kind==='papers'){
    const strip=(p:any)=>{const {messages,...rest}=p;return rest;};
    diff(kind,before.map(strip),next.map(strip));
    const threads=(items:any[])=>items.filter(p=>p.messages?.length).map(p=>({id:String(p.id),schoolId:p.schoolId,messages:p.messages}));
    diff('paper_threads',threads(before),threads(next));
   }else diff(kind,before,next);
   if(ops.length){const {error}=await supabase.rpc('lti_save_records',{ops});if(error)throw error;await reload();}
  }catch(e){setError(e instanceof Error?e.message:(e as any)?.message||'保存できませんでした');}
  finally{lock.current=false;setBusy(false);}
 };
 const auth=async(e:React.FormEvent)=>{e.preventDefault();setAuthError('');setMessage('');setBusy(true);try{
  if(mode==='reset'){const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});if(error)throw error;setMessage('登録済みの場合、再設定メールが届きます。');}
  else if(mode==='signup'){const {error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname}});if(error)throw error;setMessage('登録を受け付けました。確認メールが届いた場合は認証後にログインしてください。利用開始には運営の承認が必要です。');}
  else {const authEmail=loginType==='school'?await schoolLoginEmail(loginSchool,loginId):email;const {error}=await supabase.auth.signInWithPassword({email:authEmail,password});if(error)throw error;if(loginType==='school'){try{localStorage.setItem('lti-login-school',loginSchool.trim().toLowerCase());}catch{}}}
  setPassword('');
 }catch(e){setAuthError((e as any)?.message||'認証に失敗しました');}finally{setBusy(false);}};
 const waitingScreen=(label:string)=><div className="max-w-lg mx-auto p-10 space-y-4" role="status"><h1 className="text-xl font-bold">LTI Explore</h1><p>{label}</p>{(slow||error||authError)&&<><p className="text-sm text-red-700">{error||authError||'読み込みに時間がかかっています。通信状態を確認して再読み込みしてください。'}</p><button className="p-3 bg-emerald-100 rounded-xl" onClick={()=>window.location.reload()}>再読み込み</button></>}</div>;
 if(initial)return waitingScreen('ログイン状態を確認中…');
 if(!session&&!entry)return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl mx-auto flex items-center justify-center text-white font-bold text-xl shadow-sm">L</div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">LTI Explore</h1>
            <p className="text-xs font-semibold text-gray-500">高校の自然科学探究活動支援サービス</p>
          </div>

          <div className="space-y-4 pt-2">
            <button
              onClick={()=>{setLoginType('school');setEntry(true);}}
              className="w-full text-left p-5 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/20 transition-all shadow-sm group space-y-1 bg-white"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 group-hover:text-emerald-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" /> 学校ログイン
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-emerald-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 pl-6">学校の先生・生徒はこちらからログイン</p>
            </button>

            <button
              onClick={()=>{setLoginType('email');setEntry(true);}}
              className="w-full text-left p-5 rounded-xl border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/20 transition-all shadow-sm group space-y-1 bg-white"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 group-hover:text-indigo-700 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" /> LTI運営ログイン
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 pl-6">LTI事務局・管理者はこちらからログイン</p>
            </button>
          </div>
        </div>
      </div>
);
 if(!session)return <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900"><div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6"><div className="flex items-center justify-between"><button onClick={()=>setEntry(false)} className="text-xs font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1"><ArrowLeft className="w-4 h-4"/>戻る</button><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${loginType==='email'?'bg-indigo-50 text-indigo-700':'bg-emerald-50 text-emerald-700'}`}>{loginType==='email'?'LTI運営ログイン':'学校ログイン'}</span></div><div className="text-center space-y-2">{loginType==='school'&&<div className="w-12 h-12 bg-emerald-600 rounded-xl mx-auto flex items-center justify-center text-white font-bold text-xl shadow-sm">L</div>}<h1 className="text-xl font-bold text-gray-900">{mode==='login'?(loginType==='email'?'管理者認証':'学校ログイン'):mode==='signup'?'利用者登録':'パスワード再設定'}</h1><p className="text-xs font-medium text-gray-500">{loginType==='email'?'LTI事務局アカウントでログインしてください':'学校IDと配布されたログインIDでログインしてください'}</p></div><form onSubmit={auth} className="space-y-4">{mode==='login'&&loginType==='school'?<><label className="block text-xs font-bold text-gray-700">学校ID<input required value={loginSchool} onChange={e=>setLoginSchool(e.target.value)} autoCapitalize="none" className="w-full mt-1 px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"/></label><label className="block text-xs font-bold text-gray-700">ログインID<input required value={loginId} onChange={e=>setLoginId(e.target.value)} autoCapitalize="none" autoComplete="username" className="w-full mt-1 px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"/></label></>:<label className="block text-xs font-bold text-gray-700">メールアドレス<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full mt-1 px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600" /></label>}{mode!=='reset'&&<label className="block text-xs font-bold text-gray-700">パスワード<PasswordInput required minLength={mode==='signup'?12:1} autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} className="w-full mt-1 px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600" /></label>}<button disabled={busy} className={`w-full py-3 px-4 text-white font-semibold rounded-xl transition-colors shadow-sm text-sm disabled:opacity-50 ${loginType==='email'?'bg-indigo-600 hover:bg-indigo-700':'bg-emerald-600 hover:bg-emerald-700'}`}>{busy?'処理中…':mode==='login'?(loginType==='email'?'LTI管理画面へログイン':'ログインする'):mode==='signup'?'登録する':'再設定メールを送る'}</button></form>{authError&&<p role="alert" className="text-red-700 text-sm">{authError}</p>}{message&&<p role="status" className="text-sm">{message}</p>}<div className="flex flex-wrap gap-3 text-sm"><p className="text-xs">ログイン状態はこのブラウザで維持されます。共有PCでは使い終わったらログアウトしてください。学校用アカウントのパスワードを忘れた場合は、担当の先生を通じてLTIへ再発行を依頼してください。</p>{(['login','signup','reset'] as const).filter(m=>m!==mode).map(m=><button key={m} onClick={()=>{setMode(m);setAuthError('');setMessage('');}} className="underline">{m==='login'?'ログインへ':m==='signup'?'新規登録':'パスワードを忘れた場合'}</button>)}</div></div></div>;
 if(recovery)return <div className="max-w-md mx-auto p-8 space-y-4"><h1>新しいパスワード</h1><form onSubmit={async e=>{e.preventDefault();setBusy(true);const {error}=await supabase.auth.updateUser({password});setBusy(false);if(error)setAuthError(error.message);else{setPassword('');setRecovery(false);setAuthError('');}}}><PasswordInput aria-label="新しいパスワード" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} className="border p-3"/><button disabled={busy} className="p-3">変更する</button></form><p role="alert">{authError}</p></div>;
 if(!profile)return <div className="p-10 space-y-3"><p>{error||'利用者情報を確認中…'}</p><button onClick={()=>void reload()}>再読み込み</button><button onClick={()=>void signOut()}>ログアウト</button></div>;
 if(!aal)return waitingScreen('認証状態を確認中…');
 if((profile.role==='admin'||nextAal==='aal2'||showMfa)&&aal!=='aal2')return <div className="min-h-screen bg-gray-50 p-8"><MfaSetup onDone={()=>{setShowMfa(false);void reload();}} onCancel={()=>void signOut()}/></div>;
 if(profile.must_change_password||showPassword)return <div className="min-h-screen bg-gray-50 p-8">{profile.initial_password_expires_at&&new Date(profile.initial_password_expires_at)<new Date()?<div className="p-8"><p>初期パスワードの期限が切れています。LTIに再発行を依頼してください。</p><button onClick={()=>void signOut()}>ログアウト</button></div>:<PasswordChange onDone={()=>{setShowPassword(false);setMessage('パスワードを変更しました。');void reload();}} onCancel={profile.must_change_password?()=>void signOut():()=>setShowPassword(false)}/>}</div>;
 if(profile.deleted_at)return <div className="max-w-lg mx-auto p-8 space-y-4"><h1 className="text-xl font-bold">このアカウントの利用は終了しました</h1><p>卒業・契約終了などにより利用が停止されています。必要な場合は学校の担当者へ確認してください。</p><button onClick={()=>void signOut()}>ログアウト</button></div>;
 if(!profile.active)return <div className="max-w-lg mx-auto p-8 space-y-4"><h1 className="text-xl font-bold">利用開始の承認待ちです</h1><p>学校と権限が設定されると利用できます。次の利用者IDをLTI運営に伝えてください。</p><code className="block break-all">{profile.id}</code><button onClick={()=>void reload()} className="p-3 bg-emerald-100 rounded-xl">承認状態を確認</button><button onClick={()=>void signOut()} className="p-3">ログアウト</button></div>;
 if(!dataReady)return waitingScreen('学校・利用者データを読み込み中…');
 const store:Store={profile,profiles,schools,rows,save,reload,signOut};
 return <Cloud.Provider value={store}><div className="fixed bottom-3 right-3 z-[80] flex gap-2 items-center rounded-xl border bg-white p-2 shadow text-xs"><span>{busy?'保存中…':loading?'読込中…':'Supabase接続'}</span><button disabled={busy||loading} onClick={()=>void reload()} className="underline">更新</button><button onClick={()=>setShowPassword(true)} className="underline">パスワード変更</button>{profile.role!=='admin'&&aal!=='aal2'&&<button onClick={()=>setShowMfa(true)} className="underline">二段階認証を設定</button>}{profile.role==='admin'&&<AccountManagement profiles={profiles} schools={schools} profile={profile} reload={reload}/>}</div>{children(profile,signOut)}{busy&&<div className="fixed inset-0 bg-white/40 z-[90] flex items-center justify-center" role="status">保存中…</div>}{error&&<div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-5"><div className="bg-white p-6 rounded-xl max-w-lg space-y-3"><h2 className="font-bold">操作を完了できませんでした</h2><p role="alert">{error}</p><p className="text-sm">画面内に完了メッセージがあっても、このエラーが出た操作は保存を確認できていません。</p><button onClick={()=>void reload()} className="bg-emerald-100 p-3 rounded-xl">保存済みデータを再読み込み</button></div></div>}</Cloud.Provider>;
}
