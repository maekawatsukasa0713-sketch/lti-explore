import {supabase} from './client';
import type {Evaluation} from './ResearchEvaluation';
export type ResearchAnalysis={evaluation?:Evaluation;classification?:{field:string;reason:string};title:string;summary:string[];suggestions:{title:string;description:string;tags:string[]}[];corrections:string[];advice:string[];nextExperiments:string[];generatedAt:string;basis:string};
export type ResearchAccepted={accepted:true;state:'processing'};
export function invokeResearchAI(body:Record<string,unknown>&{mode:'review'},signal?:AbortSignal):Promise<ResearchAnalysis>;
export function invokeResearchAI(body:Record<string,unknown>&{mode:'register'},signal?:AbortSignal):Promise<ResearchAnalysis|ResearchAccepted>;
export async function invokeResearchAI(body:Record<string,unknown>,signal?:AbortSignal):Promise<ResearchAnalysis|ResearchAccepted>{
 const {data,error}=await supabase.functions.invoke('research-ai',{body,signal:signal||(body.mode==='review'?AbortSignal.timeout(145000):undefined)});
 if(error){
  let code=error.context?.status===429?'rate_limited':'connection_failed',retryable=body.mode==='review'&&(error.name==='FunctionsFetchError'||[429,502,503,504].includes(error.context?.status));
  let message=error.context?.status===429?'AI解析の利用制限です。時間をおいて再試行してください。':'AI解析に接続できませんでした。時間をおいて再試行してください。';
  let requestId:string|undefined,retryAfterMs:number|undefined;
  try{const result=await error.context?.json();
   if(typeof result?.error==='string')message=result.error;
   if(typeof result?.code==='string'&&/^[a-z0-9_]{1,80}$/.test(result.code))code=result.code;
   retryable=typeof result?.retryable==='boolean'?result.retryable:retryable;
   if(typeof result?.requestId==='string'&&/^req[_-][A-Za-z0-9_-]{1,120}$/.test(result.requestId))requestId=result.requestId;
   if(typeof result?.retryAfterMs==='number'&&Number.isFinite(result.retryAfterMs)&&result.retryAfterMs>=0)retryAfterMs=Math.min(result.retryAfterMs,86400000);
  }catch{}
  throw Object.assign(new Error(message),{code,retryable,requestId,retryAfterMs});
 }
 if(data?.accepted===true&&data?.state==='processing')return data as ResearchAccepted;
 if(!Array.isArray(data?.summary)||!Array.isArray(data?.corrections))throw new Error('AIの回答を読み取れませんでした。再試行してください。');return data;
}
export async function analysisInput(file:Blob,name:string){
 if(/\.pdf$/i.test(name)&&file.size>8*1024*1024){const {extractLargePdf}=await import('./pdf-text');return extractLargePdf(file);}
 if(/\.docx$/i.test(name)){const mammoth=await import('mammoth');const {value}=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});if(value.trim().length<40)throw new Error('Wordから十分な本文を読み取れませんでした。');if(value.length>80000)throw new Error('原稿が長すぎます。8万文字以内に分けてください。');return {text:value,basis:'Word本文（図表・画像は解析対象外）'};}
 if(/\.pdf$/i.test(name)){const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('PDFファイルを読み取れませんでした。');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {pdf:btoa(binary),basis:'PDF原稿'};}
 throw new Error('PDFまたはWord（.docx）を選択してください。');
}
