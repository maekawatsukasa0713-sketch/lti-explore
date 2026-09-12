import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
const dir=await mkdtemp(path.resolve('.registration-test-'));
try{
 await build({entryPoints:['supabase/functions/research-ai/registration.ts'],outfile:path.join(dir,'claim.mjs'),bundle:true,platform:'node',format:'esm'});
 const {claimPaper}=await import(path.join(dir,'claim.mjs'));
 let row={data:{id:1,status:'公開中',storagePath:'test/file.pdf'},version:1};
 globalThis.fetch=async(url,opts)=>{if(String(url).includes('/rpc/')){const op=JSON.parse(opts.body).ops[0];if(op.version!==row.version)return new Response('',{status:409});row={data:op.data,version:row.version+1};return Response.json(null);}return Response.json([structuredClone(row)]);};
 const claims=await Promise.allSettled([claimPaper('https://test',{},'1'),claimPaper('https://test',{},'1')]);assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);
 const winner=claims.find(c=>c.status==='fulfilled').value;await assert.rejects(()=>claimPaper('https://test',{},'1'),'interrupted claim cannot run again');
 await winner.finish({summary:['保存済み'],suggestions:[]});
 const again=await claimPaper('https://test',{},'1');assert.deepEqual(again.result.summary,['保存済み']);assert.equal(again.finish,undefined);
 row={data:{id:2,status:'承認待ち'},version:1};await assert.rejects(()=>claimPaper('https://test',{},'2'));
 console.log('PASS: one claim under concurrency, interrupted claim lock, saved result reuse, approval required');
}finally{await rm(dir,{recursive:true,force:true});}
