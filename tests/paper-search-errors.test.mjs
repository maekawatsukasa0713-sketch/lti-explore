import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(path.resolve('.search-errors-'));
const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
const privateText='private-query-token-provider-body';
try{
 for(const [entry,name] of [['search.ts','search'],['index.ts','edge']])await build({entryPoints:['supabase/functions/paper-search/'+entry],outfile:path.join(dir,name+'.mjs'),bundle:true,platform:'node',format:'esm'});
 const {createSearchRunner,retryAfterMilliseconds}=await import(pathToFileURL(path.join(dir,'search.mjs')).href);
 const crossref=()=>Response.json({message:{items:[{DOI:'10.1/fixture',title:['Fixture paper']}],'total-results':50}});
 const core=()=>Response.json({results:[],totalHits:0});
 const healthy=url=>String(url).includes('crossref')?crossref():core();
 const safe=result=>assert(!JSON.stringify(result).includes(privateText),'raw provider or network details must not escape');
 const now=Date.parse('2026-11-05T12:00:00Z');
 assert.equal(retryAfterMilliseconds('2',now),2000);
 assert.equal(retryAfterMilliseconds(' 1.5 ',now),1500);
 assert.equal(retryAfterMilliseconds(new Date(now+3000).toUTCString(),now),3000);
 for(const value of [null,'','invalid','Infinity','-1'])assert.equal(retryAfterMilliseconds(value,now),undefined);

 for(const [expected,fetcher] of [
  ['timeout',async()=>{throw new DOMException(privateText,'TimeoutError');}],
  ['connection',async()=>{throw new TypeError(privateText);}],
  ['request_failed',async()=>{throw new Error(privateText);}],
  ['invalid_response',async()=>new Response(privateText)],
  ['invalid_response',async()=>Response.json({privateText})],
  ['invalid_response',async()=>Response.json(null)],
  ['invalid_response',async()=>Response.json({message:{items:[{DOI:'10.1/fixture',title:['Fixture'],author:{invalid:true}}]},results:[{id:1,title:'Fixture',authors:{invalid:true}}]})],
  ['connection',async()=>{const response=new Response();response.json=async()=>{throw new TypeError(privateText);};return response;}],
 ]){
  let calls=0;const result=await createSearchRunner()('fixture',0,async(...args)=>{calls++;return fetcher(...args);});
  assert.equal(calls,2,'one attempt per provider, no automatic retries');assert(result.failed);assert.deepEqual(result.failures.map(f=>f.code),[expected,expected]);safe(result);
  if(expected!=='timeout')assert(!result.warnings.some(w=>w.includes('タイムアウト')));
 }
 for(const [status,code,delay] of [[400,'rejected',undefined],[429,'rate_limited',60000],[500,'unavailable',10000],[503,'unavailable',10000],[529,'unavailable',10000]]){
  let calls=0;const search=createSearchRunner(()=>now);
  const fetcher=async()=>{calls++;return new Response(privateText,{status});};
  const result=await search('fixture',0,fetcher);assert.equal(calls,2);assert(result.failed);assert.deepEqual(result.failures.map(f=>f.code),[code,code]);assert.equal(result.retryAfterMs,delay);safe(result);
  if(delay){await search('another query',1,fetcher);assert.equal(calls,2,'backoff is provider-wide, not reset by changing queries');}
 }

 let clock=now,coreCalls=0,crossrefCalls=0;const partialSearch=createSearchRunner(()=>clock);
 const partialFetch=async url=>{
  if(String(url).includes('crossref')){crossrefCalls++;return crossref();}
  coreCalls++;return coreCalls===1?new Response(privateText,{status:429,headers:{'Retry-After':'2'}}):core();
 };
 const first=await partialSearch('fixture',0,partialFetch);assert(!first.failed);assert.equal(first.items.length,1);assert(first.hasMore);assert.equal(first.retryAfterMs,2000);safe(first);
 clock+=1000;const cooling=await partialSearch('fixture',1,partialFetch);assert(!cooling.failed);assert.equal(coreCalls,1);assert.equal(crossrefCalls,2);assert.equal(cooling.failures[0].retryAfterMs,1000);
 clock+=1001;const recovered=await partialSearch('fixture',0,partialFetch);assert(!recovered.failed);assert.equal(coreCalls,2);assert.equal(recovered.warnings.length,0);

 clock=now;let calls=0;const unavailableSearch=createSearchRunner(()=>clock);
 const unavailable=async()=>{calls++;return new Response(privateText,{status:503,headers:{'Retry-After':new Date(now+3000).toUTCString()}});};
 assert.equal((await unavailableSearch('fixture',0,unavailable)).retryAfterMs,3000);
 clock+=2000;await unavailableSearch('fixture',0,unavailable);assert.equal(calls,2);
 clock+=1001;await unavailableSearch('fixture',0,healthy);assert.equal(calls,2);
 const empty=await createSearchRunner()('fixture',0,async url=>String(url).includes('crossref')?Response.json({message:{items:[],'total-results':0}}):core());assert(!empty.failed);assert.equal(empty.items.length,0);assert.equal(empty.warnings.length,0);

 let sequence=0;
 async function edge({auth,permission,provider=healthy}={}){
  let handler;const counts={auth:0,permission:0,provider:0};
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://fixture-db',SUPABASE_ANON_KEY:'fixture-anon'})[name]},serve:fn=>handler=fn};
  globalThis.fetch=async(url,init)=>{
   if(String(url).includes('/auth/v1/user')){counts.auth++;return auth?auth():Response.json({id:'fixture-user'});}
   if(String(url).includes('/rpc/lti_feature_enabled')){counts.permission++;return permission?permission():Response.json(true);}
   counts.provider++;return provider(url,init);
  };
  await import(pathToFileURL(path.join(dir,'edge.mjs')).href+'?case='+sequence++);
  return {handler,counts};
 }
 const request=(body={query:'fixture',page:0})=>new Request('https://fixture-edge',{method:'POST',headers:{Authorization:'Bearer fixture-user','Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const [stage,dependency,expected,status] of [
  ['auth',async()=>{throw new TypeError(privateText);},'connection',502],
  ['auth',async()=>{throw new DOMException(privateText,'TimeoutError');},'timeout',504],
  ['auth',async()=>new Response(privateText),'invalid_response',502],
  ['auth',async()=>new Response(privateText,{status:503}),'unavailable',503],
  ['permission',async()=>{throw new TypeError(privateText);},'connection',502],
  ['permission',async()=>{throw new DOMException(privateText,'TimeoutError');},'timeout',504],
  ['permission',async()=>new Response(privateText),'invalid_response',502],
  ['permission',async()=>new Response(privateText,{status:503}),'unavailable',503],
 ]){
  const {handler,counts}=await edge({[stage]:dependency});const response=await handler(request());const body=await response.json();
  assert.equal(response.status,status);assert.equal(body.code,stage+'_'+expected);assert.equal(body.stage,stage);assert.equal(counts.provider,0,'failed auth/permission must never reach providers');safe(body);
  if(expected!=='timeout')assert(!body.error.includes('タイムアウト'));
 }
 {
  const {handler,counts}=await edge();assert.equal((await handler(new Request('https://fixture-edge',{method:'POST'}))).status,401);assert.equal(counts.auth,0);
  for(const invalid of [null,[],true])assert.equal((await handler(request(invalid))).status,400);assert.equal(counts.provider,0);
  const unreadable=request();Object.defineProperty(unreadable,'text',{value:async()=>{throw new Error(privateText);}});
  const response=await handler(unreadable);const body=await response.json();assert.equal(response.status,500);assert.equal(body.code,'request_request_failed');assert(!body.error.includes('タイムアウト'));safe(body);
 }
 for(const overrides of [{auth:async()=>new Response('',{status:401})},{permission:async()=>Response.json(false)}]){
  const {handler,counts}=await edge(overrides);assert.equal((await handler(request())).status,overrides.auth?401:403);assert.equal(counts.provider,0);
 }
 {
  const {handler,counts}=await edge();assert.equal((await handler(request())).status,200);assert.equal((await handler(request())).status,200);assert.equal(counts.provider,2,'successful provider result retains the existing cache');assert.equal(counts.auth,2,'cache access still authenticates');assert.equal(counts.permission,2);
 }
 {
  const {handler,counts}=await edge({provider:async url=>String(url).includes('crossref')?crossref():new Response(privateText,{status:429,headers:{'Retry-After':'4'}})});
  const response=await handler(request());const body=await response.json();assert.equal(response.status,200);assert.equal(body.items.length,1);assert.equal(body.failures[0].code,'rate_limited');safe(body);
  await handler(request());assert.equal(counts.provider,3,'only the healthy provider is fetched during partial-result cooldown');
 }
 for(const [provider,status,code] of [
  [async()=>new Response(privateText,{status:429,headers:{'Retry-After':'4'}}),429,'search_rate_limited'],
  [async()=>{throw new DOMException(privateText,'TimeoutError');},504,'search_timeout'],
  [async()=>{throw new TypeError(privateText);},502,'search_unavailable'],
 ]){
  const {handler}=await edge({provider});const response=await handler(request());const body=await response.json();assert.equal(response.status,status);assert.equal(body.code,code);safe(body);
  if(status===429){assert.equal(response.headers.get('Retry-After'),'4');assert.equal(body.retryAfterMs,4000);}
 }
 console.log('PASS: safe provider failure classification, Retry-After/backoff without retries, partial recovery, authenticated handler stages and success cache');
}finally{
 globalThis.fetch=oldFetch;globalThis.Deno=oldDeno;
 await rm(dir,{recursive:true,force:true});
}
