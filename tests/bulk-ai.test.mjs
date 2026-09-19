import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
const dir=await mkdtemp(path.resolve('.bulk-ai-test-'));
try{
 await build({entryPoints:['supabase/functions/research-ai/index.ts'],outfile:path.join(dir,'ai.mjs'),bundle:true,platform:'node',format:'esm'});
 let handler,role='admin',calls=0;let row={data:{id:1,status:'承認待ち',storagePath:'file.pdf',classificationMode:'ai'},version:1};
 globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://test':k.includes('KEY')?'test-key':undefined},serve:f=>handler=f};
 await import(path.join(dir,'ai.mjs'));
 const result={title:'観測',summary:['記録を比較'],suggestions:[],corrections:[],advice:[],nextExperiments:[],classification:{field:'地学・宇宙',reason:'天体の観測データの比較'}};
 globalThis.fetch=async(url,opts)=>{url=String(url);if(url.includes('/auth/v1/user'))return Response.json({id:'admin-test'});if(url.includes('lti_profiles'))return Response.json([{role,active:true}]);if(url.includes('lti_consume_ai_quota'))return Response.json(true);if(url.includes('lti_save_records')){const op=JSON.parse(opts.body).ops[0];if(row.version!==op.version)return new Response('',{status:409});row={data:op.data,version:row.version+1};return Response.json(null);}if(url.includes('lti_records?'))return Response.json([row]);
 assert(url.startsWith('https://api.anthropic.com/'));const body=JSON.parse(opts.body);assert(body.tools[0].input_schema.required.includes('classification'));calls++;return Response.json({stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_analysis',input:result}]});};
 const request=()=>new Request('https://function',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({mode:'register',paperId:'1',text:'天体の位置を記録した観測データを分析する研究です。'.repeat(5)})});
 role='teacher';assert.equal((await handler(request())).status,403);assert.equal(calls,0);role='admin';
 const response=await handler(request());assert.equal(response.status,200);assert.equal(row.data.field,'地学・宇宙');assert.equal(row.data.status,'承認待ち');assert.equal(row.data.bulkReviewed,false);assert.equal(row.data.aiAnalysis.summary[0],'記録を比較');
 assert.equal((await handler(request())).status,200);assert.equal(calls,1,'saved classification and summary reused without another model call');
 console.log('PASS: admin-only classification, one provider call, persisted result, still unpublished');
}finally{await rm(dir,{recursive:true,force:true});}
