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
 const a=harness([1,2,3,4,5,1]);assert.deepEqual(a.calls,[1,2,3]);
 a.jobs.get(2).resolve();await tick();assert.deepEqual(a.calls,[1,2,3,4]);
 a.jobs.get(4).resolve();await tick();assert.deepEqual(a.calls,[1,2,3,4,5]);
 for(const id of [5,3,1])a.jobs.get(id).resolve();
 const ar=await a.promise;assert.equal(ar.saved,5);assert.equal(ar.total,5);assert.equal(ar.active,0);assert.ok(a.progress.every(p=>p.active<=3&&p.active>=0));
 const b=harness([1,2,3,4,5]);b.stop();b.jobs.get(1).resolve();await tick();assert.equal(b.finished(),false);assert.equal(b.calls.length,3);
 b.jobs.get(2).resolve();b.jobs.get(3).resolve();const br=await b.promise;assert.equal(br.saved,3);assert.equal(br.started,3);assert.match(br.stopReason,/停止の指示/);
 for(const message of ['利用上限です','サーバー側で処理を続けています']){
  const c=harness([1,2,3,4]);c.jobs.get(1).reject(new Error(message));await tick();assert.equal(c.finished(),false);assert.equal(c.calls.length,3);
  c.jobs.get(2).resolve();c.jobs.get(3).resolve();const cr=await c.promise;assert.equal(cr.saved,2);assert.equal(cr.failed,1);assert.equal(cr.stopReason,message);
 }
 const d=await runResearchBatch([1,2,3,4],async id=>{if(id===1)throw Object.assign(new Error('extract'),{inputError:true});},()=>false,()=>{});
 assert.equal(d.saved,3);assert.equal(d.inputFailed,1);assert.equal(d.failed,0);assert.equal(d.stopReason,'');
 const e=harness([1,2,3,4,5,6,7]);
 for(const id of [1,2,3]){e.jobs.get(id).reject(new Error('invalid_response'));await tick();}
 assert.deepEqual(e.calls,[1,2,3,4,5]);e.jobs.get(4).resolve();e.jobs.get(5).resolve();const er=await e.promise;
 assert.equal(er.saved,2);assert.equal(er.failed,3);assert.match(er.stopReason,/連続3件/);assert.equal(er.started,5);
 const empty=await runResearchBatch([],async()=>assert.fail('empty queue invoked'),()=>false,()=>{});assert.equal(empty.total,0);
 console.log('PASS: three-worker ceiling, immediate refill, deduplication, graceful stop, quota/pending stop, input failures, repeated failures, empty batch');
}finally{await rm(dir,{recursive:true,force:true});}
