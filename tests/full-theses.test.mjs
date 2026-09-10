import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
const dir=await mkdtemp(path.resolve('.thesis-test-'));
try {
 await build({entryPoints:['ThesisSearch.tsx','full-theses.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},packages:'external'});
 const {ThesisSearch}=await import(path.join(dir,'ThesisSearch.mjs'));
 const {fullTheses}=await import(path.join(dir,'full-theses.mjs'));
 assert(fullTheses.length>0);
 assert.equal(new Set(fullTheses.map(p=>p.key)).size,fullTheses.length);
 assert(fullTheses.every(p=>p.access==='full'&&new URL(p.documentUrl).protocol==='https:'));
 const html=renderToStaticMarkup(React.createElement(ThesisSearch,{savedKeys:[],onSave(){}}));
 assert.equal((html.match(/<article /g)||[]).length,Math.min(20,fullTheses.length));
 assert.equal((html.match(/本文PDFを開く/g)||[]).length,Math.min(20,fullTheses.length));
 assert(!html.includes('google.com'));
 console.log('PASS: every default result has a full PDF link; catalog identities are unique');
}finally{await rm(dir,{recursive:true,force:true});}
