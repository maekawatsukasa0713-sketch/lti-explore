import {supabase} from './client';
export type ResearchAnalysis={title:string;summary:string[];suggestions:{title:string;description:string;tags:string[]}[];corrections:string[];advice:string[];nextExperiments:string[];generatedAt:string;basis:string};
export async function invokeResearchAI(body:Record<string,unknown>,signal?:AbortSignal):Promise<ResearchAnalysis>{
 const {data,error}=await supabase.functions.invoke('research-ai',{body,signal});
 if(error){let message='AI解析に接続できませんでした。時間をおいて再試行してください。';try{const result=await error.context?.json();message=result?.error||message;}catch{}throw new Error(message);}
 if(!Array.isArray(data?.summary)||!Array.isArray(data?.corrections))throw new Error('AIの回答を読み取れませんでした。再試行してください。');return data;
}
export async function analysisInput(file:Blob,name:string){
 if(file.size>8*1024*1024)throw new Error('AI解析は8MB以下の原稿に対応しています。');
 if(/\.docx$/i.test(name)){const mammoth=await import('mammoth');const {value}=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});if(value.trim().length<40)throw new Error('Wordから十分な本文を読み取れませんでした。');if(value.length>80000)throw new Error('原稿が長すぎます。8万文字以内に分けてください。');return {text:value,basis:'Word本文（図表・画像は解析対象外）'};}
 if(/\.pdf$/i.test(name)){const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('PDFファイルを読み取れませんでした。');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {pdf:btoa(binary),basis:'PDF原稿'};}
 throw new Error('PDFまたはWord（.docx）を選択してください。');
}
