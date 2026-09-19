import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
const dir=await mkdtemp(path.resolve('.bulk-test-'));
try{
 await build({entryPoints:['research-fields.ts'],outfile:path.join(dir,'bulk.mjs'),bundle:true,platform:'node',format:'esm'});
 const {publicationOps,classificationPatch}=await import(path.join(dir,'bulk.mjs'));
 const paper={title:'観測研究',field:'物理',status:'承認待ち',bulkImport:true,bulkReviewed:true,storagePath:'test.pdf'};
 const rows=[{id:'1',version:3,data:paper},{id:'2',version:7,data:{...paper,field:'生物',aiAnalysis:{summary:['test']},aiReviewedAt:'2026-09-19'}}];
 const ops=publicationOps(rows,{'1':3,'2':7});assert.equal(ops.length,2);assert(ops.every(x=>x.data.status==='公開中'));assert.equal(paper.status,'承認待ち');
 assert.throws(()=>publicationOps(rows,{'1':2}));assert.throws(()=>publicationOps(rows,{'3':1}));assert.throws(()=>publicationOps(rows,{}));
 for(const patch of [{bulkReviewed:false},{field:'未分類'},{storagePath:''},{title:''},{status:'公開中'},{aiAnalysis:{summary:[]},aiReviewedAt:undefined}])assert.throws(()=>publicationOps([{id:'1',version:3,data:{...paper,...patch}}],{'1':3}));
 const result={classification:{field:'地学・宇宙',reason:'天体の観測データを扱う'}};
 assert.deepEqual(classificationPatch({classificationMode:'manual',field:'物理'},result),{});
 assert.deepEqual(classificationPatch({classificationMode:'ai'},result),{field:'地学・宇宙',classificationReason:result.classification.reason,bulkReviewed:false});
 console.log('PASS: reviewed-only bulk publication, stale versions rejected, AI review required, manual category preserved');
}finally{await rm(dir,{recursive:true,force:true});}
