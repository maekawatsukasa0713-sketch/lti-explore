import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
const dir=await mkdtemp(path.resolve('.search-test-'));
try{
 await build({entryPoints:['supabase/functions/paper-search/search.ts'],outfile:path.join(dir,'search.mjs'),bundle:true,platform:'node',format:'esm'});
 const {fromCrossref,fromCore,mergePapers,runSearch,safeUrl}=await import(path.join(dir,'search.mjs'));
 const cr=fromCrossref({DOI:'10.1000/ABC',title:['Paper'],link:[{URL:'https://publisher.example/paid.pdf'}]});
 const core=fromCore({id:1,doi:'https://doi.org/10.1000/abc',title:'Paper',downloadUrl:'https://repository.example/full.pdf'});
 const merged=mergePapers([[cr],[core]]);assert.equal(merged.length,1);assert.equal(merged[0].documentUrl,core.documentUrl);assert.deepEqual(merged[0].providers,['Crossref','CORE']);
 assert(!cr.documentUrl,'Crossref full-text links must not imply free access');assert.equal(safeUrl('javascript:alert(1)'),undefined);
 assert.notEqual(fromCore({id:2,title:'A'}).catalogId,fromCore({id:3,title:'B'}).catalogId);
 let urls=[];const partial=await runSearch('経営',2,async url=>{urls.push(String(url));return String(url).includes('crossref')?Response.json({message:{items:[{DOI:'10.1/a',title:['A']}],'total-results':100}}):new Response('',{status:429});});
 assert.equal(partial.items.length,1);assert.equal(partial.warnings.length,1);assert(!partial.failed);assert(urls.every(u=>new URL(u).searchParams.get('offset')==='40'));
 const failed=await runSearch('x',0,async()=>{throw new Error('offline');});assert(failed.failed);assert.equal(failed.items.length,0);
 console.log('PASS: DOI deduplication, full-text enrichment, safe links, pagination, partial and total failures');
 if(process.env.LIVE_SEARCH==='1')for(const query of ['ferrofluid','corporate governance']){const r=await runSearch(query,0);console.log(query,JSON.stringify({items:r.items.length,readable:r.items.filter(p=>p.documentUrl).length,warnings:r.warnings}));assert(r.items.length>0);}
}finally{await rm(dir,{recursive:true,force:true});}
