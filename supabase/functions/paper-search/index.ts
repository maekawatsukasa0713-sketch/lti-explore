import { runSearch, isTimeout, retryAfterMilliseconds } from './search.ts';
const cors={'Access-Control-Allow-Origin':'https://lti-explore.vercel.app','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};

const cache=new Map<string,{time:number;data:Awaited<ReturnType<typeof runSearch>>}>();
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('Origin')||'';
 const allowedOrigins=['https://lti-explore-six.vercel.app','https://lti-explore-lab-to-impact.vercel.app','https://lti-explore.vercel.app','https://explore.labtoimpact.com'];
 const requestCors={...cors,'Access-Control-Allow-Origin':allowedOrigins.includes(origin)?origin:allowedOrigins[0]};
 const reply=(body:unknown,status=200,retryAfterMs?:number)=>new Response(JSON.stringify(body),{status,headers:{...requestCors,'Content-Type':'application/json','Cache-Control':'no-store',...(retryAfterMs?{'Retry-After':String(Math.ceil(retryAfterMs/1000))}:{})}});
 if(origin&&!allowedOrigins.includes(origin))return reply({error:'このURLからは利用できません。'},403);
 if(req.method==='OPTIONS')return new Response('ok',{headers:requestCors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 // Validate the user's JWT with Auth; never trust a decoded token or anon key as a user.
 const token=req.headers.get('Authorization');
 if(!token?.startsWith('Bearer '))return reply({error:'再ログインしてください。'},401);
 let stage:'auth'|'permission'|'request'|'search'='auth';let operation:'fetch'|'decode'|'read'|'search'='fetch';
 const unavailable=(response:Response)=>{
  const retryAfterMs=retryAfterMilliseconds(response.headers.get('retry-after'));
  return reply({error:'ログイン情報または利用権限を確認できませんでした。時間をおいて再検索してください。',code:stage+'_unavailable',stage,retryable:true,...(retryAfterMs?{retryAfterMs}:{})},503,retryAfterMs);
 };
 try{
  const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{Authorization:token,apikey:Deno.env.get('SUPABASE_ANON_KEY')!},signal:AbortSignal.timeout(8000)});
  if(!auth.ok)return [401,403].includes(auth.status)?reply({error:'再ログインしてください。'},401):unavailable(auth);
  operation='decode';const user=await auth.json();if(typeof user?.id!=='string'||!user.id)return reply({error:'再ログインしてください。'},401);
  stage='permission';operation='fetch';
  const permission=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/lti_feature_enabled',{method:'POST',headers:{Authorization:token,apikey:Deno.env.get('SUPABASE_ANON_KEY')!,'content-type':'application/json'},body:JSON.stringify({tab_name:'学術論文の検索'}),signal:AbortSignal.timeout(8000)});
  if(!permission.ok)return [401,403].includes(permission.status)?reply({error:'この学校では学術論文検索を利用できません。'},403):unavailable(permission);
  operation='decode';if(await permission.json()!==true)return reply({error:'この学校では学術論文検索を利用できません。'},403);
  stage='request';operation='read';
  const text=await req.text();if(text.length>3000)return reply({error:'検索語が長すぎます。'},400);
  let body;try{body=JSON.parse(text);}catch{return reply({error:'検索条件を読み取れません。'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'検索条件を読み取れません。'},400);
  const query=typeof body.query==='string'?body.query.trim():'';const page=body.page??0;
  if(!query||query.length>500||!Number.isInteger(page)||page<0||page>49)return reply({error:'検索語・ページを確認してください。'},400);
  const key=JSON.stringify([query,page]);const now=Date.now();
  for(const [k,v] of cache)if(now-v.time>300000)cache.delete(k);
  const cached=cache.get(key);if(cached)return reply(cached.data);
  stage='search';operation='search';const result=await runSearch(query,page);
  if(!result.failed&&!result.warnings.length){if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{time:now,data:result});}
  return reply(result,result.failed?(result.code==='search_rate_limited'?429:result.code==='search_timeout'?504:502):200,result.retryAfterMs);
 }catch(error){
  const kind=isTimeout(error)?'timeout':operation==='fetch'?'connection':operation==='decode'?'invalid_response':'request_failed';
  const target=stage==='auth'?'ログイン情報の確認':stage==='permission'?'利用権限の確認':stage==='request'?'検索条件の読み取り':'検索処理';
  const message=kind==='timeout'?target+'がタイムアウトしました。時間をおいて再検索してください。':kind==='connection'?target+'のサービスに接続できませんでした。時間をおいて再検索してください。':kind==='invalid_response'?target+'の応答を読み取れませんでした。時間をおいて再検索してください。':target+'に失敗しました。再検索してください。';
  return reply({error:message,code:stage+'_'+kind,stage,retryable:kind!=='request_failed'},kind==='timeout'?504:kind==='request_failed'?500:502);
 }
});
