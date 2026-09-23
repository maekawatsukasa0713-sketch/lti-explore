import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
const dir=await mkdtemp(path.resolve('.ai-test-'));
try{
 await build({entryPoints:['supabase/functions/research-ai/index.ts'],outfile:path.join(dir,'ai.mjs'),bundle:true,platform:'node',format:'esm'});
 let handler;let configured=false;let role='teacher';let active=true;let modelCalls=0;
 globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://test.example':k==='SUPABASE_ANON_KEY'?'test-key':k==='ANTHROPIC_API_KEY'?(configured?'test-ai-key':undefined):undefined},serve:fn=>handler=fn};
 const {validResult,registrationSchema,normalizeRegistrationResult}=await import(path.join(dir,'ai.mjs'));
 assert.equal(registrationSchema.properties.summary.minItems,1);assert.equal(registrationSchema.properties.summary.maxItems,undefined);assert.equal(registrationSchema.properties.suggestions.minItems,1);assert.equal(registrationSchema.properties.suggestions.maxItems,undefined);assert(registrationSchema.required.includes('evaluation'));assert.deepEqual(registrationSchema.properties.evaluation.required,['scores','reasons','evidence','nextSteps']);assert.deepEqual(registrationSchema.properties.evaluation.properties.scores.items.enum,[0,1,2,3,4]);assert(registrationSchema.properties.suggestions.items.required.includes('tags'));
 const result={evaluation:{items:Array.from({length:5},(_,i)=>({score:3,reason:`参考理由${i}`,evidence:`本文の根拠${i}`,nextStep:`次の一歩${i}`}))},title:'試験用の研究',summary:['入力内容の要約'],suggestions:[{title:'追加の分析',description:'データの比較',tags:['分析']}],corrections:['方法を明記'],advice:['図の説明を追加'],nextExperiments:['既存データの比較']};
 const registrationEvaluation={scores:[3,2,3,3,4],reasons:['着眼点','再現性','手法','論理','発展'],evidence:['序論','方法','実験','考察','展望'],nextSteps:['比較する','反復する','条件を追加','対応を確認','次条件を試す']};
 const normalized=normalizeRegistrationResult({title:'登録研究',summary:['要約'],suggestions:[{title:'次研究',description:'比較する',tags:[]}],classification:{field:'物理',reason:'物理現象'},evaluation:registrationEvaluation});assert.equal(normalized.issue,null);assert.equal(normalized.result.evaluation.items.length,5);assert.equal(normalized.result.evaluation.items[4].score,4);const held=normalizeRegistrationResult({title:'登録研究',summary:['要約'],suggestions:[{title:'次研究',description:'比較する',tags:[]}],classification:{field:'物理',reason:'物理現象'},evaluation:{...registrationEvaluation,scores:[0,2,3,3,4]}});assert.equal(held.result.evaluation.items[0].score,null);
 globalThis.fetch=async url=>{if(String(url).includes('/rpc/lti_feature_enabled')||String(url).includes('/rpc/lti_consume_ai_quota'))return Response.json(true);if(String(url).includes('/auth/v1/user'))return Response.json({id:'test-user'});if(String(url).includes('/rest/v1/lti_profiles'))return Response.json([{role,active}]);modelCalls++;return Response.json({stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_analysis',input:result}]});};
 const request=body=>new Request('https://function.example',{method:'POST',headers:{authorization:'Bearer test-user-token','content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handler(new Request('https://function.example',{method:'POST'}))).status,401);
 assert.deepEqual(await (await handler(request({mode:'status'}))).json(),{configured:false});
 assert.equal((await handler(request({mode:'review',text:'研究内容'.repeat(30)}))).status,503);assert.equal(modelCalls,0);
 configured=true;role='student';assert.equal((await handler(request({mode:'review',text:'研究内容'.repeat(30)}))).status,403);
 active=false;assert.equal((await handler(request({mode:'analyze',text:'研究内容'.repeat(30)}))).status,403);active=true;
 role='teacher';const body={mode:'review',text:'観測されたデータを比較する研究。'.repeat(20),basis:'概要のみ'};
 const r=await handler(request(body));assert.equal(r.status,200);assert.equal((await r.json()).basis,'概要のみ');await handler(request(body));assert.equal(modelCalls,1,'identical repeat uses user-scoped cache');
 assert(!validResult({...result,summary:['x',2]}));assert.equal((await handler(request({mode:'review',pdf:'not-a-pdf'}))).status,400);
 console.log('PASS: authentication, active account, teacher review permission, missing key, payload validation, result validation, repeat cache');
}finally{await rm(dir,{recursive:true,force:true});}
