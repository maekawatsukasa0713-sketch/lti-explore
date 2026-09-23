import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
const dir=await mkdtemp(path.resolve('.research-batch-test-'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
try{
 await build({entryPoints:['research-batch.ts'],outfile:path.join(dir,'batch.mjs'),bundle:true,platform:'node',format:'esm'});
 const {runResearchBatch}=await import(path.join(dir,'batch.mjs'));
 function harness(ids){
  let stopped=false,finished=false;const calls=[],jobs=new Map(),progress=[];
  const promise=runResearchBatch(ids,id=>{calls.push(id);return new Promise((resolve,reject)=>jobs.set(id,{resolve,reject}));},()=>stopped,p=>progress.push(p)).then(r=>{finished=true;return r;});
  return {calls,jobs,progress,promise,stop:()=>{stopped=true;},finished:()=>finished};
 }
 const a=harness([1,2,3,4,5,6,7,1]);await tick();assert.deepEqual(a.calls,[1,2,3,4,5]);
 a.jobs.get(2).resolve();await tick();assert.deepEqual(a.calls,[1,2,3,4,5,6]);
 a.jobs.get(6).resolve();await tick();assert.deepEqual(a.calls,[1,2,3,4,5,6,7]);
 for(const id of [7,5,4,3,1])a.jobs.get(id).resolve();
 const ar=await a.promise;assert.equal(ar.saved,7);assert.equal(ar.total,7);assert.equal(ar.active,0);assert.ok(a.progress.every(p=>p.active<=5&&p.active>=0));
 const b=harness([1,2,3,4,5,6]);await tick();b.stop();b.jobs.get(1).resolve();await tick();assert.equal(b.finished(),false);assert.equal(b.calls.length,5);
 for(const id of [2,3,4,5])b.jobs.get(id).resolve();const br=await b.promise;assert.equal(br.saved,5);assert.equal(br.started,5);assert.match(br.stopReason,/停止の指示/);
 for(const message of ['利用上限です','サーバー側で処理を続けています']){
  const c=harness([1,2,3,4,5,6]);await tick();c.jobs.get(1).reject(new Error(message));await tick();assert.equal(c.finished(),false);assert.equal(c.calls.length,5);
  for(const id of [2,3,4,5])c.jobs.get(id).resolve();const cr=await c.promise;assert.equal(cr.saved,4);assert.equal(cr.failed,1);assert.equal(cr.stopReason,message);
 }
 const d=await runResearchBatch([1,2,3,4],async id=>{if(id===1)throw Object.assign(new Error('extract'),{inputError:true});},()=>false,()=>{});
 assert.equal(d.saved,3);assert.equal(d.inputFailed,1);assert.equal(d.failed,0);assert.equal(d.stopReason,'');
 const e=harness([1,2,3,4,5,6,7,8,9]);await tick();
 for(const id of [1,2,3]){e.jobs.get(id).reject(new Error('invalid_response'));await tick();}
 assert.deepEqual(e.calls,[1,2,3,4,5,6,7]);for(const id of [4,5,6,7])e.jobs.get(id).resolve();const er=await e.promise;
 assert.equal(er.saved,4);assert.equal(er.failed,3);assert.match(er.stopReason,/連続3件/);assert.equal(er.started,7);
 let now=0,attempts=0;const clock={now:()=>now,sleep:async ms=>{now+=ms;}};
 const retry=await runResearchBatch([1],async()=>{attempts++;if(attempts<3)throw new Error('anthropic_429');},()=>false,()=>{},clock);
 assert.equal(retry.saved,1);assert.equal(retry.failed,0);assert.equal(attempts,3);assert.equal(now,180000);
 attempts=0;const exhausted=await runResearchBatch([1],async()=>{attempts++;throw new Error('anthropic_429');},()=>false,()=>{},clock);
 assert.equal(attempts,3);assert.equal(exhausted.failed,1);assert.match(exhausted.stopReason,/anthropic_429/);
 let stopped=false;attempts=0;const canceled=await runResearchBatch([1],async()=>{attempts++;throw new Error('anthropic_429');},()=>stopped,()=>{},{now:()=>0,sleep:async()=>{stopped=true;}});
 assert.equal(attempts,1);assert.equal(canceled.saved,0);
 const empty=await runResearchBatch([],async()=>assert.fail('empty queue invoked'),()=>false,()=>{});assert.equal(empty.total,0);
 console.log('PASS: five-worker ceiling and bounded rate-limit retries, immediate refill, deduplication, graceful stop, quota/pending stop, input failures, repeated failures, empty batch');
}finally{await rm(dir,{recursive:true,force:true});}
