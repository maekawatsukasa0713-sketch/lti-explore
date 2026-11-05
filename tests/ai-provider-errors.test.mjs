import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(path.resolve('.provider-errors-'));
const oldFetch=globalThis.fetch,oldTimer=globalThis.setTimeout,oldNow=Date.now;
const oldWarn=console.warn,oldError=console.error;
try{
 for(const [entry,name] of [['supabase/functions/research-ai/review.ts','review'],['supabase/functions/research-ai/index.ts','edge'],['review-runner.ts','runner']]){
  await build({entryPoints:[entry],outfile:path.join(dir,name+'.mjs'),bundle:true,format:'esm',platform:'node'});
 }
 await build({entryPoints:['research-ai.ts'],outfile:path.join(dir,'client.mjs'),bundle:true,format:'esm',platform:'node',external:['mammoth','./pdf-text'],plugins:[{name:'mock-client',setup(b){b.onResolve({filter:/^\.\/client$/},()=>({path:'client',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const supabase = globalThis.__testSupabase;'}));}}]});
 const load=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href);
 const {generateReview,providerFailure}=await load('review');
 const {runReview}=await load('runner');
 const input={key:'fixture-key',model:'fixture-model',content:[{type:'text',text:'synthetic manuscript'}]};
 const valid={corrections:['根拠'],advice:['助言'],nextExperiments:['公開資料の比較']};
 const success=()=>Response.json({stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_review',input:valid}]});
 const privateText='never-log-this-manuscript-or-credential';
 let calls=0;
 for(const status of [400,401,402,403,404,413]){
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{type:'authentication_error',message:privateText},request_id:'req_fixture_1'},{status});};
  await assert.rejects(()=>generateReview(input),e=>{
   assert.equal(e.code,'anthropic_'+status);assert.equal(e.retryable,false);assert.equal(e.details.providerStatus,status);assert.equal(e.details.requestId,'req_fixture_1');assert(!e.message.includes(privateText));
   if(status===401)assert.match(e.message,/認証に失敗/);return true;
  });assert.equal(calls,1,'permanent provider errors must not generate duplicate requests');
 }
 calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{type:'rate_limit_error',message:privateText}},{status:429,headers:{'retry-after':'2','request-id':'req_fixture_limit'}});};
 await assert.rejects(()=>generateReview(input),e=>e.code==='anthropic_429'&&e.retryable&&e.details.retryAfterMs===2000);assert.equal(calls,1,'429 does not trigger an immediate retry storm');

 // Eliminate wall-clock waits while exercising the real bounded retry loop.
 globalThis.setTimeout=(fn)=>{queueMicrotask(fn);return 0;};
 calls=0;globalThis.fetch=async()=>{calls++;return calls<3?Response.json({error:{type:'timeout_error',message:privateText}},{status:504}):success();};
 assert.deepEqual(await generateReview(input),valid);assert.equal(calls,3,'504 recovers within the retry budget');
 for(const status of [500,502,503,504,529]){
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{type:'overloaded_error',message:privateText}},{status,headers:{'request-id':'req_last_attempt'}});};
  await assert.rejects(()=>generateReview(input),e=>e.code==='anthropic_'+status&&e.retryable&&e.details.requestId==='req_last_attempt');assert.equal(calls,3,'provider retries remain bounded');
 }
 calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{type:'overloaded_error'}},{status:503,headers:{'retry-after':'30'}});};
 await assert.rejects(()=>generateReview(input),e=>e.retryable&&e.details.retryAfterMs===30000);assert.equal(calls,1,'long Retry-After is handed back without an early retry');
 globalThis.setTimeout=oldTimer;
 globalThis.fetch=async()=>{throw new DOMException('private timeout detail','TimeoutError');};
 await assert.rejects(()=>generateReview(input),e=>e.code==='review_timeout'&&e.retryable&&!e.message.includes('private timeout'));
 globalThis.fetch=async()=>{throw new TypeError('private network detail');};
 await assert.rejects(()=>generateReview(input),e=>e.code==='review_connection'&&e.retryable&&!e.message.includes('private network'));
 const unsafe=await providerFailure(Response.json({error:{type:privateText,message:privateText},request_id:privateText},{status:401,headers:{'request-id':privateText}}));
 assert.equal(unsafe.details.providerType,undefined);assert.equal(unsafe.details.requestId,undefined);assert(!JSON.stringify(unsafe).includes(privateText));

 let now=oldNow();Date.now=()=>now;const file={};let prepared=0,invoked=0;
 const limited=Object.assign(new Error('try later'),{code:'anthropic_429',retryable:true,retryAfterMs:2000});
 const prepare=async()=>{prepared++;return {text:'unchanged synthetic manuscript'};};
 const invoke=async(_,section)=>{invoked++;assert.equal(section,undefined,'rate limit must not split into three fresh calls');if(invoked===1)throw limited;return valid;};
 await assert.rejects(()=>runReview(file,'teacher',prepare,invoke,()=>{}),e=>e===limited);
 await assert.rejects(()=>runReview(file,'teacher',prepare,invoke,()=>{}),e=>e===limited);assert.equal(invoked,1);
 now+=2001;assert.deepEqual(await runReview(file,'teacher',prepare,invoke,()=>{}),valid);assert.equal(prepared,1);assert.equal(invoked,2);Date.now=oldNow;

 let handler,refunds=0;const logs=[];console.warn=(...args)=>logs.push(args);console.error=(...args)=>logs.push(args);
 globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://fixture-db',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-server',ANTHROPIC_API_KEY:'  fixture-key\r\n',ANTHROPIC_MODEL:'  fixture-model  '})[k]},serve:fn=>handler=fn};
 await load('edge');
 globalThis.fetch=async(url,init={})=>{
  url=String(url);
  if(url.includes('/auth/v1/user'))return Response.json({id:'fixture-teacher'});
  if(url.includes('lti_profiles'))return Response.json([{role:'teacher',active:true}]);
  if(url.includes('lti_feature_enabled'))return Response.json(true);
  if(url.includes('lti_claim_ai_quota'))return Response.json(1);
  if(url.includes('lti_refund_ai_quota')){refunds++;return Response.json(true);}
  assert.equal(init.headers['x-api-key'],'fixture-key');assert.equal(JSON.parse(init.body).model,'fixture-model');
  return Response.json({error:{type:'authentication_error',message:privateText}},{status:401,headers:{'request-id':'req_fixture_auth'}});
 };
 const response=await handler(new Request('https://fixture-edge',{method:'POST',headers:{authorization:'Bearer fixture-user','content-type':'application/json'},body:JSON.stringify({mode:'review',text:'架空のソフトウェアテスト用原稿です。'.repeat(5)})}));
 assert.equal(response.status,502);const errorBody=await response.json();assert.equal(errorBody.code,'anthropic_401');assert.equal(errorBody.requestId,'req_fixture_auth');assert.equal(errorBody.providerType,'authentication_error');assert.equal(errorBody.retryable,false);assert.equal(refunds,1);assert(!JSON.stringify(errorBody).includes(privateText));assert(!JSON.stringify(logs).includes(privateText));

 globalThis.__testSupabase={functions:{invoke:async()=>({error:{name:'FunctionsHttpError',context:Response.json(errorBody,{status:502})}})}};
 const {invokeResearchAI}=await load('client');
 await assert.rejects(()=>invokeResearchAI({mode:'review'}),e=>e.code==='anthropic_401'&&e.requestId==='req_fixture_auth'&&!e.retryable);
 globalThis.__testSupabase.functions.invoke=async()=>({error:{name:'FunctionsHttpError',context:Response.json({...errorBody,requestId:privateText,code:privateText+' ',retryAfterMs:Infinity},{status:502})}});
 await assert.rejects(()=>invokeResearchAI({mode:'review'}),e=>e.code==='connection_failed'&&e.requestId===undefined&&e.retryAfterMs===undefined);
 globalThis.__testSupabase.functions.invoke=async()=>({error:{name:'FunctionsHttpError',context:new Response('non-JSON rate-limit response',{status:429})}});
 await assert.rejects(()=>invokeResearchAI({mode:'review'}),e=>e.code==='rate_limited'&&e.retryable);
 let limitedCalls=0;await assert.rejects(()=>runReview({},'teacher',prepare,async()=>{limitedCalls++;return invokeResearchAI({mode:'review'});},()=>{}),e=>e.code==='rate_limited');assert.equal(limitedCalls,1,'gateway rate limits also do not trigger section requests');
 console.log('PASS: provider auth diagnosis, bounded 5xx/504 retries, 429 cooldown without split, safe diagnostics, key whitespace, quota refund, client propagation');
}finally{
 globalThis.fetch=oldFetch;globalThis.setTimeout=oldTimer;Date.now=oldNow;console.warn=oldWarn;console.error=oldError;delete globalThis.__testSupabase;
 await rm(dir,{recursive:true,force:true});
}
