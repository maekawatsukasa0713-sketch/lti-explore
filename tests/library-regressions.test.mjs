import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleFrom(path,require=()=>{throw new Error('Unexpected import');}){
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const context={exports:{},require};vm.createContext(context);vm.runInContext(code,context);return context.exports;
}
const calls=[];let failAt='';
const rpc=async(name,{paper_ids})=>{
 calls.push({name,ids:paper_ids});assert(paper_ids.length<=500);
 if(paper_ids.includes(failAt))return {error:new Error('batch unavailable')};
 return {data:name==='lti_my_paper_bookmarks'?paper_ids.filter(id=>['500','501','1001'].includes(id)).map(paper_id=>({paper_id})):paper_ids.map(paper_id=>({paper_id,views:Number(paper_id),bookmarks:1,citations:0})),error:null};
};
const {loadPaperEngagement}=moduleFrom('paper-engagement.ts',()=>({supabase:{rpc}}));
{
 const result=await loadPaperEngagement([]);assert.equal(calls.length,0);assert.equal(result.bookmarked.size,0);
}
{
 const result=await loadPaperEngagement([...Array.from({length:1001},(_,i)=>i+1),'501',501]);
 assert.equal(calls.length,6,'two RPCs for every batch, including tail');
 assert.equal(Object.keys(result.metrics).length,1001);
 assert.deepEqual([...result.bookmarked],['500','501','1001']);
 assert.equal(result.metrics['501'].views,501);assert.equal(result.metrics['1001'].views,1001);
 assert.equal(calls.filter(call=>call.name==='lti_my_paper_bookmarks').flatMap(call=>[...call.ids]).filter(id=>id==='501').length,1,'duplicate IDs do not consume extra requests');
}
failAt='501';
await assert.rejects(()=>loadPaperEngagement(Array.from({length:501},(_,i)=>i+1)),/batch unavailable/);
const {searchFailureMessage}=moduleFrom('search-error.ts');
assert.match(await searchFailureMessage({context:Response.json({code:401,message:'Invalid JWT'},{status:401})}),/ログインし直して/);
assert.match(await searchFailureMessage({context:new Response('gateway HTML',{status:429})}),/利用回数制限/);
assert.match(await searchFailureMessage({context:new Response('',{status:504})}),/タイムアウト/);
assert.match(await searchFailureMessage({context:Response.json({warnings:['CORE：検索回数制限中']},{status:502})}),/CORE/);
assert.match(await searchFailureMessage({}),/通信状態/);
console.log('PASS: 1001-paper engagement batches, tail bookmarks, deduplication, failure propagation and search gateway diagnostics');
