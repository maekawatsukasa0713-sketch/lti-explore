import {build} from 'esbuild';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {renderToString} from 'react-dom/server';
import React from 'react';
import assert from 'node:assert/strict';
const mock=`import React from 'react';export const useCloud=()=>({schools:[],profiles:[],rows:[]});export const useCloudList=(key)=>[[],()=>{}];export const saveMyProfile=async()=>{};export const uploadPdf=async()=>'';export const PdfView=()=>null;export const CloudGate=()=>null;`;
const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8').replace('function ConnectedApp(', 'export function ConnectedApp(');
const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,external:['react','react-dom','react-dom/server','lucide-react'],plugins:[{name:'empty-cloud',setup(b){b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock,loader:'js'}));}}]});
const path=new URL('../.startup-test.mjs',import.meta.url);writeFileSync(path,result.outputFiles[0].text);
try{const {ConnectedApp}=await import(path.href);const html=renderToString(React.createElement(ConnectedApp,{profile:{id:'test-admin',name:'運営テスト',role:'admin',active:true,school_id:null},signOut:async()=>{}}));assert.ok(html.includes('LTI管理ダッシュボード'));assert.ok(html.includes('運営テスト'));console.log('PASS: restored admin renders safely before lists load');}finally{unlinkSync(path);}
