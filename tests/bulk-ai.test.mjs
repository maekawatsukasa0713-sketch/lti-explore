import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
const dir=await mkdtemp(path.resolve('.bulk-ai-test-'));
try{
 await build({entryPoints:['supabase/functions/research-ai/index.ts'],outfile:path.join(dir,'ai.mjs'),bundle:true,platform:'node',format:'esm'});
 let handler,role='admin',calls=0;const jobs=[];let row={id:'1',data:{id:1,status:'承認待ち',storagePath:'file.pdf',classificationMode:'ai'},version:1};
 globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://test':k==='SUPABASE_ANON_KEY'?'test-key':k==='ANTHROPIC_API_KEY'?'test-ai-key':undefined},serve:f=>handler=f};
 globalThis.EdgeRuntime={waitUntil:promise=>jobs.push(promise)};
 await import(path.join(dir,'ai.mjs'));
 const result={title:'観測',summary:['問いと着眼点','記録方法','観測結果','結果の補足'],suggestions:[{title:'比較を広げる',description:'別の時期の公開データを同じ方法で比較する。',tags:['公開データ']},{title:'条件を比べる',description:'観測条件を分けて違いを確認する。',tags:['比較']},{title:'資料を調べる',description:'関連する資料を読み、結果の背景を整理する。',tags:['文献'] }],corrections:[],advice:[],nextExperiments:[],classification:{field:'地学・宇宙',reason:'天体の観測データを扱う研究のため'}};
 let providerResult=result;let stopReason='tool_use';
 globalThis.fetch=async(url,opts={})=>{url=String(url);if(url.includes('/auth/v1/user'))return Response.json({id:'admin-test'});if(url.includes('lti_profiles'))return Response.json([{role,active:true}]);if(url.includes('lti_consume_ai_quota'))return Response.json(true);if(url.includes('/rest/v1/lti_records?'))return Response.json([row]);if(url.includes('lti_save_records')){const op=JSON.parse(opts.body).ops[0];if(row.version!==op.version)return new Response('',{status:409});row={...row,data:op.data,version:row.version+1};return Response.json(null);}
  assert(url.startsWith('https://api.anthropic.com/'));const body=JSON.parse(opts.body);assert.equal(body.max_tokens,12000);assert.equal(body.tools[0].input_schema.properties.evaluation,undefined,'bulk registration schema must not request rubric evaluation');assert(body.tools[0].input_schema.required.includes('classification'));assert(!body.tools[0].input_schema.properties.suggestions.items.required.includes('tags'));calls++;return Response.json({stop_reason:stopReason,usage:{output_tokens:1800},content:[{type:'tool_use',name:'submit_analysis',input:providerResult}]});};
 const request=()=>new Request('https://function',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({mode:'register',paperId:'1',text:'天体の位置を記録した観測データを分析する研究です。'.repeat(5)})});
 role='teacher';assert.equal((await handler(request())).status,403);assert.equal(calls,0);role='admin';
 const response=await handler(request());assert.equal(response.status,202,'registration runs in background');await Promise.all(jobs.splice(0));assert.equal(row.data.field,'地学・宇宙');assert.equal(row.data.status,'承認待ち');assert.equal(row.data.bulkReviewed,false);assert.equal(row.data.aiAnalysis.summary[0],'問いと着眼点');assert.deepEqual(row.data.aiAnalysis.corrections,[]);assert.equal(calls,1);
 assert.equal((await handler(request())).status,200);assert.equal(calls,1,'saved classification and summary reused without another model call');

 async function analyzeOutput(output){
  providerResult=output;row={id:'1',data:{id:1,status:'承認待ち',storagePath:'file.pdf',classificationMode:'ai'},version:1};
  assert.equal((await handler(request())).status,202);await Promise.all(jobs.splice(0));return row.data;
 }
 const two=await analyzeOutput({...result,suggestions:[{title:'比較',description:'条件を変えて比べる。'},{title:'確認',description:'公開データで確認する。',tags:null}]});
 assert.equal(two.aiState.state,'ready');assert.equal(two.aiAnalysis.suggestions.length,2);assert.deepEqual(two.aiAnalysis.suggestions.map(s=>s.tags),[[],[]]);
 const longText='説明文。'.repeat(600)+'【注意点】指導者と確認してください。';
 const four=await analyzeOutput({...result,suggestions:[...result.suggestions,{title:'長めの提案',description:longText,tags:'追加案'}]});
 assert.equal(four.aiState.state,'ready');assert.equal(four.aiAnalysis.suggestions.length,4);assert.equal(four.aiAnalysis.suggestions[3].description,longText,'preserve long proposal including final cautions');assert.deepEqual(four.aiAnalysis.suggestions[3].tags,['追加案']);
 const tags=await analyzeOutput({...result,suggestions:[{...result.suggestions[0],tags:['比較','観測','文献','調査',null,2,'比較']}]});
 assert.equal(tags.aiState.state,'ready');assert.deepEqual(tags.aiAnalysis.suggestions[0].tags,['比較','観測','文献','調査']);
 const broken=await analyzeOutput({...result,suggestions:[result.suggestions[0],{title:'本文なし',description:'   '}]});
 assert.equal(broken.aiAnalysis,undefined);assert.equal(broken.aiState.reason,'invalid_suggestion_description_2');
 providerResult=result;assert.equal((await handler(request())).status,202);await Promise.all(jobs.splice(0));assert.equal(row.data.aiState.state,'ready','failed record can be retried explicitly');
 const empty=await analyzeOutput({...result,suggestions:[]});assert.equal(empty.aiState.reason,'invalid_suggestions_count');assert.equal(empty.aiAnalysis,undefined);
 stopReason='max_tokens';const truncated=await analyzeOutput(result);assert.equal(truncated.aiState.reason,'max_tokens');assert.equal(truncated.aiAnalysis,undefined,'never accept truncated output as complete');
 console.log('PASS: async registration, 2/4 proposals, optional tags, full long descriptions, precise incomplete-body failure, explicit retry, truncated-output rejection, cached result reuse');
}finally{await rm(dir,{recursive:true,force:true});}
