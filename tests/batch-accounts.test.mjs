import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';
const dir=await mkdtemp(path.resolve('.account-batch-test-'));
try{await build({entryPoints:['batch-accounts.ts'],outfile:path.join(dir,'batch.mjs'),bundle:true,platform:'node',format:'esm'});const {issueAccountBatches}=await import(path.join(dir,'batch.mjs'));
 let calls=0;const ids=new Set();const r=await issueAccountBatches(523,async(n,id)=>{assert(n<=10);assert(!ids.has(id));ids.add(id);calls++;return {credentials:Array.from({length:n},(_,i)=>({loginId:`${calls}-${i}`}))};},()=>{},()=>false);assert.equal(r.credentials.length,523);assert.equal(calls,53);
 let saved=[],stop=false;const stopped=await issueAccountBatches(50,async n=>({credentials:Array(n).fill({loginId:'test'})}),(cards)=>{saved=cards;stop=true;},()=>stop);assert.equal(stopped.done,10);assert.equal(saved.length,10);
 calls=0;saved=[];await assert.rejects(()=>issueAccountBatches(30,async n=>{calls++;if(calls===2)throw new Error('uncertain network response');return {credentials:Array(n).fill({loginId:'test'})};},cards=>saved=cards,()=>false));assert.equal(calls,2);assert.equal(saved.length,10);
 await assert.rejects(()=>issueAccountBatches(1001,async()=>({credentials:[]}),()=>{},()=>false));console.log('PASS: 523 IDs, unique request IDs, 10-person requests, cancellation, preserves partial credentials without retries');
}finally{await rm(dir,{recursive:true,force:true});}
