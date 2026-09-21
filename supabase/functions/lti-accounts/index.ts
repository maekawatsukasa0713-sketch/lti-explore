import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Access-Control-Allow-Origin':'https://lti-explore-lab-to-impact.vercel.app','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const password=()=>{const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';let value='';while(value.length<10){const bytes=crypto.getRandomValues(new Uint8Array(20));for(const b of bytes){if(b<256-256%alphabet.length)value+=alphabet[b%alphabet.length];if(value.length===10)break;}}return value;};
async function loginEmail(school:string,id:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${school.toLowerCase()}\0${id.toLowerCase()}`));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')+'@accounts.lti.invalid';}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 if(Number(req.headers.get('content-length')||0)>10000)return respond({error:'Request too large'},413);
 const bearer=req.headers.get('Authorization')||'';const jwt=bearer.replace(/^Bearer\s+/i,'');
 const {data:{user},error:authError}=await service.auth.getUser(jwt);
 if(authError||!user)return respond({error:'ログインしてください'},401);
 const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
 try {
  const raw=await req.text();if(raw.length>10000)return respond({error:'Request too large'},413);const body=JSON.parse(raw);
  const {data:profile,error:pe}=await service.from('lti_profiles').select('*').eq('id',user.id).single();if(pe||!profile)return respond({error:'利用者情報がありません'},403);
  if(body.action==='change-password'){
   if(!profile.active)return respond({error:'利用許可が必要です'},403);
   if(profile.initial_password_expires_at&&new Date(profile.initial_password_expires_at)<new Date())return respond({error:'初期パスワードの期限切れです。LTIに再発行を依頼してください'},403);
   if((!profile.must_change_password&&typeof body.currentPassword!=='string')||typeof body.newPassword!=='string'||body.newPassword.length<12||body.newPassword.length>128||body.newPassword===body.currentPassword)return respond({error:'新しいパスワードは現在と異なる12〜128文字にしてください'},400);
   // getUser above verifies the token; AAL is read only after this verification.
   const claims=JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
   const {data:factors,error:fe}=await service.auth.admin.mfa.listFactors({userId:user.id});if(fe)throw fe;
   if((profile.role==='admin'||factors.factors.some(f=>f.status==='verified'))&&claims.aal!=='aal2')return respond({error:'二段階認証を完了してください'},403);
   if(profile.must_change_password){
    // Only a recent password sign-in after issuance/reset can complete initial setup.
    // Token refresh and MFA alone must not revive a session from before a reset.
    const passwordAuth=Array.isArray(claims.amr)?claims.amr.find((a:{method:string;timestamp:number})=>a.method==='password'):null;
    const signedAt=Number(passwordAuth?.timestamp)*1000;
    const cutoff=profile.session_valid_after==='-infinity'?0:Date.parse(profile.session_valid_after);
    if(!Number.isFinite(signedAt)||!Number.isFinite(cutoff)||signedAt<cutoff||signedAt>Date.now()+60000||Date.now()-signedAt>30*60*1000)return respond({error:'初期・仮パスワードでもう一度ログインしてから設定してください'},403);
   }else{
   // Reauthenticate current password without retaining the resulting session.
   const verifier=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
   const verify=await verifier.auth.signInWithPassword({email:user.email!,password:body.currentPassword});
   if(verify.error||verify.data.user?.id!==user.id)return respond({error:'現在のパスワードを確認してください'},403);
   await verifier.auth.signOut({scope:'local'});
   }
   const block=await service.from('lti_profiles').update({must_change_password:true,session_valid_after:new Date().toISOString()}).eq('id',user.id);if(block.error)throw block.error;
   const changed=await service.auth.admin.updateUserById(user.id,{password:body.newPassword});if(changed.error)throw changed.error;
   const done=await service.from('lti_profiles').update({must_change_password:false,initial_password_expires_at:null,session_valid_after:new Date().toISOString()}).eq('id',user.id);if(done.error)throw done.error;
   return respond({ok:true,requiresLogin:true});
  }
  // All issuance/reset actions require a currently authorized LTI administrator + MFA, enforced in SQL.
  const {data:role,error:roleError}=await caller.rpc('lti_role');if(roleError||role!=='admin')return respond({error:'LTI管理者の二段階認証が必要です'},403);
  if(body.action==='retire-account'||body.action==='retire-school'){
   const r=await service.rpc('lti_retire',{target_user:body.action==='retire-account'?String(body.userId):null,target_school:body.action==='retire-school'?String(body.schoolId):null,actor:user.id});
   if(r.error)throw r.error;return respond({ok:true,count:r.data});
  }
  if(body.action==='set-attendance'){
   const n=Number(body.number);if(!Number.isInteger(n)||n<1||n>999)return respond({error:'出席番号は1〜999で指定してください'},400);
   const r=await service.from('lti_profiles').update({attendance_number:n,class:String(body.class||'').slice(0,50)}).eq('id',String(body.userId)).eq('role','student').is('deleted_at',null);if(r.error)throw r.error;return respond({ok:true});
  }
  if(body.action==='create-school'){
   const name=String(body.name||'').trim();if(!name||name.length>100)return respond({error:'学校名を確認してください'},400);
   const schoolId=String(body.schoolId||'').trim().toLowerCase();
   if(!/^[a-z0-9][a-z0-9-]{1,29}$/.test(schoolId))return respond({error:'学校IDは半角英数字・ハイフンの2〜30文字で指定してください'},400);
   const r=await service.from('lti_schools').insert({id:schoolId,name}).select('id,name').single();if(r.error)throw r.error;return respond({school:r.data});
  }
  if(body.action==='create-accounts'){
   const count=Number(body.count);const school=String(body.schoolId||'');const accountRole=body.role;
   if(!Number.isInteger(count)||count<1||count>20||!['teacher','student'].includes(accountRole)||! /^[0-9a-f-]{36}$/i.test(String(body.requestId||'')))return respond({error:'発行数は1〜20人、権限は生徒か教員を指定してください'},400);
   const schoolState=await service.from('lti_schools').select('deleted_at').eq('id',school).single();if(schoolState.error||schoolState.data.deleted_at)return respond({error:'利用中の学校を選択してください'},400);
   const reserve=await service.rpc('lti_reserve_accounts',{request_id:body.requestId,school,account_role:accountRole,amount:count,actor:user.id});
   if(reserve.error)return respond({error:'発行予約に失敗しました。同じ処理の再送の場合は利用者一覧を確認してください'},409);
   const credentials:unknown[]=[];const failures:unknown[]=[];
   for(let i=0;i<count;i++){
    const loginId=(accountRole==='student'?'s':'t')+String(reserve.data+i).padStart(3,'0');const initialPassword=password();
    const email=await loginEmail(school,loginId);
    const created=await service.auth.admin.createUser({email,password:initialPassword,email_confirm:true});
    if(created.error||!created.data.user){failures.push({loginId,error:'Authアカウント作成に失敗'});continue;}
    const expiresAt=new Date(Date.now()+7*86400000).toISOString();
    const saved=await service.from('lti_profiles').update({school_id:school,login_id:loginId,role:accountRole,active:true,name:accountRole==='student'?`生徒 ${loginId}`:`教員 ${loginId}`,must_change_password:true,initial_password_expires_at:expiresAt,session_valid_after:new Date().toISOString()}).eq('id',created.data.user.id);
    if(saved.error){const cleanup=await service.auth.admin.deleteUser(created.data.user.id);failures.push({loginId,error:cleanup.error?'初期設定失敗。未承認アカウントが残っています。運営で確認してください':'初期設定に失敗（未使用アカウントを削除済み）'});continue;}
    credentials.push({schoolId:school,loginId,initialPassword,expiresAt});
   }
   return respond({credentials,failures,notice:'初期パスワードはこの応答でのみ表示します。紛失時は再発行してください。'});
  }
  if(body.action==='reset-password'){
   const target=await service.from('lti_profiles').select('*').eq('id',String(body.userId||'')).single();
   if(target.error||!target.data?.login_id||target.data.role==='admin')return respond({error:'学校用の生徒・教員アカウントを選択してください'},400);
   if(target.data.id===user.id)return respond({error:'自分のパスワードは本人用の変更画面を使用してください'},400);
   const initialPassword=password();const expiresAt=new Date(Date.now()+7*86400000).toISOString();
   const block=await service.from('lti_profiles').update({must_change_password:true,initial_password_expires_at:expiresAt,session_valid_after:new Date().toISOString()}).eq('id',target.data.id);if(block.error)throw block.error;
   const changed=await service.auth.admin.updateUserById(target.data.id,{password:initialPassword});if(changed.error)throw changed.error;
   return respond({credentials:[{schoolId:target.data.school_id,loginId:target.data.login_id,initialPassword,expiresAt}]});
  }
  return respond({error:'不明な操作です'},400);
 }catch{return respond({error:'処理を完了できませんでした。保存状況を確認してから再操作してください'},500);}
});
