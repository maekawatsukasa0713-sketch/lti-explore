import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';

const dir=await mkdtemp(path.resolve('.cors-test-'));
const origin='https://explore.labtoimpact.com';
try{
 for(const slug of ['lti-accounts','research-ai','paper-search']){
  let handler;
  globalThis.Deno={env:{get:()=> 'test'},serve:fn=>handler=fn};
  globalThis.corsTestClient={auth:{getUser:async()=>({data:{user:null},error:new Error('unauthenticated')})}};
  const outfile=path.join(dir,slug+'.mjs');
  await build({entryPoints:[`supabase/functions/${slug}/index.ts`],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'mock-sdk',setup(b){b.onResolve({filter:/^npm:/},()=>({path:'sdk',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.corsTestClient;'}));}}]});
  await import(outfile);
  const preflight=await handler(new Request('https://function.example',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type,x-client-info'}}));
  assert.equal(preflight.status,200,slug+' preflight');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin,slug+' exact origin');
  assert.equal(preflight.headers.get('Vary'),'Origin');
  for(const header of ['authorization','apikey','content-type','x-client-info'])assert(preflight.headers.get('Access-Control-Allow-Headers').split(',').map(h=>h.trim()).includes(header),slug+' '+header);
  const unauthenticated=await handler(new Request('https://function.example',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'create-school',schoolId:'test',name:'test'})}));
  assert.equal(unauthenticated.status,401,slug+' keeps authentication');
  assert.equal(unauthenticated.headers.get('Access-Control-Allow-Origin'),origin);
  for(const untrusted of ['https://untrusted.example','https://explore.labtoimpact.com.attacker.example','http://explore.labtoimpact.com']){
   assert.equal((await handler(new Request('https://function.example',{method:'OPTIONS',headers:{Origin:untrusted}}))).status,403,slug+' rejects '+untrusted);
  }
 }
 console.log('PASS: production domain preflight on all three functions, exact-origin matching, authentication retained');
}finally{
 delete globalThis.Deno;delete globalThis.corsTestClient;
 await rm(dir,{recursive:true,force:true});
}
