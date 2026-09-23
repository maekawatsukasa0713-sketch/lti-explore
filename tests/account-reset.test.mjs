import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
const dir=await mkdtemp(path.resolve('.account-reset-test-'));
try{
 let handler,admin=true,active=true,updates=0,passwordChanges=0;
 globalThis.Deno={env:{get:()=> 'test'},serve:fn=>handler=fn};
 globalThis.accountTestClient={auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null}),admin:{updateUserById:async()=>{passwordChanges++;return {error:null};}}},rpc:async()=>({data:admin?'admin':'teacher'}),from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'student',login_id:'s001',school_id:'test',role:'student',active},error:null})})}),update:()=>({eq:async()=>{updates++;return {error:null};}})})};
 await build({entryPoints:['supabase/functions/lti-accounts/index.ts'],outfile:path.join(dir,'edge.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'mock-sdk',setup(b){b.onResolve({filter:/^npm:/},()=>({path:'sdk',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.accountTestClient;'}));}}]});
 await import(path.join(dir,'edge.mjs'));
 for(const origin of ['https://lti-explore-six.vercel.app','https://lti-explore-lab-to-impact.vercel.app','https://lti-explore.vercel.app']){
  const preflight=await handler(new Request('https://test',{method:'OPTIONS',headers:{Origin:origin}}));assert.equal(preflight.status,200);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  const response=await handler(new Request('https://test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test'},body:JSON.stringify({action:'reset-password',userId:'student'})}));
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);const data=await response.json();assert.equal(data.credentials[0].loginId,'s001');assert.equal(data.credentials[0].initialPassword.length,10);
 }
 const post=()=>handler(new Request('https://test',{method:'POST',headers:{Origin:'https://lti-explore-six.vercel.app'},body:JSON.stringify({action:'reset-password',userId:'student'})}));
 admin=false;assert.equal((await post()).status,403);admin=true;active=false;assert.equal((await post()).status,400);
 assert.equal(passwordChanges,3);assert.equal(updates,3);
 assert.equal((await handler(new Request('https://test',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}}))).status,403);
 console.log('PASS: allowed origins, preflight and reset responses, admin gate, inactive-account rejection');
}finally{await rm(dir,{recursive:true,force:true});}
