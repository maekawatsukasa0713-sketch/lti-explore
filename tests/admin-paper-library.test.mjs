import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';

const result=await build({entryPoints:['ResearchLibrary.tsx'],bundle:true,platform:'node',format:'esm',write:false,external:['react','react-dom','lucide-react']});
const path=new URL('../.admin-paper-library-test.mjs',import.meta.url);
writeFileSync(path,result.outputFiles[0].text);
try{
 const {ResearchLibrary}=await import(path.href);
 const makePaper=(id,status)=>({id,title:`研究論文${id}`,schoolName:'登録学校名',schoolNameOverride:id===1?'運営が編集した学校名':null,author:'研究者',field:'物理',publishedDate:'',submittedDate:'2026-09-21',submittedByTeacherName:'先生',status});
 const papers=[makePaper(1,'公開中'),makePaper(2,'承認待ち'),makePaper(3,'公開停止')];
 const publicHtml=renderToStaticMarkup(React.createElement(ResearchLibrary,{papers,onOpen:()=>{}}));
 assert.match(publicHtml,/1件の公開論文/);
 assert.match(publicHtml,/研究論文1/);
 assert.doesNotMatch(publicHtml,/研究論文2|研究論文3/);
 assert.match(publicHtml,/運営が編集した学校名/);
 const adminHtml=renderToStaticMarkup(React.createElement(ResearchLibrary,{papers,onOpen:()=>{},includeUnpublished:true}));
 assert.match(adminHtml,/3件の論文/);
 assert.match(adminHtml,/研究論文2/);
 assert.match(adminHtml,/研究論文3/);
 assert.match(adminHtml,/承認待ち/);
 assert.match(adminHtml,/公開停止/);
 const adminSource=readFileSync(new URL('../AdminResearchLibrary.tsx',import.meta.url),'utf8');
 assert.match(adminSource,/const rows=cloud\.rows\.filter\(r=>r\.kind==='papers'\)/);
 assert.match(adminSource,/schoolNameOverride:/);
 assert.match(adminSource,/version,data/);
 assert.match(adminSource,/showEvaluation/);
 const detailSource=readFileSync(new URL('../ResearchDetail.tsx',import.meta.url),'utf8');
 assert.match(detailSource,/ResearchEvaluation/);
 assert.match(detailSource,/showEvaluation&&result\?\.evaluation/);
 console.log('PASS: admin can browse all statuses; public library only shows published papers and honors school-name overrides');
}finally{unlinkSync(path);}
