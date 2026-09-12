import { runSearch } from './search.ts';
const cors={'Access-Control-Allow-Origin':'https://maekawatsukasa0713-sketch.github.io','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const cache=new Map<string,{time:number;data:Awaited<ReturnType<typeof runSearch>>}>();
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 // Validate the user's JWT with Auth; never trust a decoded token or anon key as a user.
 const token=req.headers.get('Authorization');
 if(!token?.startsWith('Bearer '))return reply({error:'再ログインしてください。'},401);
 try{
  const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{Authorization:token,apikey:Deno.env.get('SUPABASE_ANON_KEY')!},signal:AbortSignal.timeout(8000)});
  if(!auth.ok)return reply({error:'再ログインしてください。'},401);
  const user=await auth.json();if(!user.id)return reply({error:'再ログインしてください。'},401);
  const permission=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/lti_feature_enabled',{method:'POST',headers:{Authorization:token,apikey:Deno.env.get('SUPABASE_ANON_KEY')!,'content-type':'application/json'},body:JSON.stringify({tab_name:'学術論文の検索'}),signal:AbortSignal.timeout(8000)});if(!permission.ok||await permission.json()!==true)return reply({error:'この学校では学術論文検索を利用できません。'},403);
  const text=await req.text();if(text.length>3000)return reply({error:'検索語が長すぎます。'},400);
  let body;try{body=JSON.parse(text);}catch{return reply({error:'検索条件を読み取れません。'},400);}
  const query=typeof body.query==='string'?body.query.trim():'';const page=body.page??0;
  if(!query||query.length>500||!Number.isInteger(page)||page<0||page>49)return reply({error:'検索語・ページを確認してください。'},400);
  const key=JSON.stringify([query,page]);const now=Date.now();
  for(const [k,v] of cache)if(now-v.time>300000)cache.delete(k);
  const cached=cache.get(key);if(cached)return reply(cached.data);
  const result=await runSearch(query,page);
  if(!result.failed&&!result.warnings.length){if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{time:now,data:result});}
  return reply(result,result.failed?502:200);
 }catch{return reply({error:'検索先への接続がタイムアウトしました。再検索してください。'},502);}
});
