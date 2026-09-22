import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
const dir=await mkdtemp(path.resolve('.ai-test-'));
try{
 await build({entryPoints:['supabase/functions/research-ai/index.ts'],outfile:path.join(dir,'ai.mjs'),bundle:true,platform:'node',format:'esm'});
 let handler;let configured=false;let role='teacher';let active=true;let modelCalls=0;let stopReason='tool_use';
 globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://test.example':k==='SUPABASE_ANON_KEY'?'test-key':k==='ANTHROPIC_API_KEY'?(configured?'test-ai-key':undefined):undefined},serve:fn=>handler=fn};
 const {validResult}=await import(path.join(dir,'ai.mjs'));
 const evaluation={items:Array.from({length:5},()=>({score:null,reason:'本文による確認が必要',evidence:'根拠未確認',nextStep:'本文を確認する'}))};
 const result={evaluation,title:'試験用の研究',summary:['入力内容の要約'],suggestions:[{title:'追加の分析',description:'データの比較',tags:['分析']}],corrections:['方法を明記'],advice:['図の説明を追加'],nextExperiments:['既存データの比較']};
 globalThis.fetch=async url=>{if(String(url).includes('/rpc/lti_feature_enabled')||String(url).includes('/rpc/lti_consume_ai_quota'))return Response.json(true);if(String(url).includes('/auth/v1/user'))return Response.json({id:'test-user'});if(String(url).includes('/rest/v1/lti_profiles'))return Response.json([{role,active}]);modelCalls++;return Response.json({stop_reason:stopReason,content:[{type:'tool_use',name:'submit_analysis',input:result}],usage:{output_tokens:100}});};
 const request=body=>new Request('https://function.example',{method:'POST',headers:{authorization:'Bearer test-user-token','content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handler(new Request('https://function.example',{method:'POST'}))).status,401);
 assert.deepEqual(await (await handler(request({mode:'status'}))).json(),{configured:false});
 assert.equal((await handler(request({mode:'review',text:'研究内容'.repeat(30)}))).status,503);assert.equal(modelCalls,0);
 configured=true;role='student';assert.equal((await handler(request({mode:'review',text:'研究内容'.repeat(30)}))).status,403);
 active=false;assert.equal((await handler(request({mode:'analyze',text:'研究内容'.repeat(30)}))).status,403);active=true;
 role='teacher';const body={mode:'review',text:'観測されたデータを比較する研究。'.repeat(20),basis:'概要のみ'};
 const r=await handler(request(body));assert.equal(r.status,200);assert.equal((await r.json()).basis,'概要のみ');await handler(request(body));assert.equal(modelCalls,1,'identical repeat uses user-scoped cache');
 assert(!validResult({...result,summary:['x',2]}));assert.equal((await handler(request({mode:'review',pdf:'not-a-pdf'}))).status,400);
 stopReason='max_tokens';const truncated=await handler(request({...body,force:true}));assert.equal(truncated.status,502);assert.match((await truncated.json()).error,/途中/);
 console.log('PASS: authentication, permissions, output schema, truncation handling and cache');
}finally{await rm(dir,{recursive:true,force:true});}
