import {supabase} from './client';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config';
export const MAX_DOCUMENT_BYTES=50*1024*1024;
export async function uploadDocument(file:File,onProgress?:(percent:number)=>void):Promise<string>{
 const ext=file.name.split('.').pop()?.toLowerCase();const types:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 if(!ext||!types[ext]||!file.size||file.size>MAX_DOCUMENT_BYTES)throw new Error('PDF・Word（.docx、50MB以内）を選んでください。');
 const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('ログインしてください。');
 const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
 if(file.size<=6*1024*1024){const {error}=await supabase.storage.from('lti-documents').upload(path,file,{contentType:types[ext],upsert:false});if(error)throw error;onProgress?.(100);return path;}
 const {Upload}=await import('tus-js-client');const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('再ログインしてください。');
 const endpoint=SUPABASE_URL.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable';
 await new Promise<void>((resolve,reject)=>{const upload=new Upload(file,{endpoint,headers:{authorization:`Bearer ${session.access_token}`,apikey:SUPABASE_PUBLISHABLE_KEY},chunkSize:6*1024*1024,retryDelays:[0,3000,5000,10000],uploadDataDuringCreation:true,storeFingerprintForResuming:false,metadata:{bucketName:'lti-documents',objectName:path,contentType:types[ext],cacheControl:'3600'},onBeforeRequest:async req=>{const {data:{session:current}}=await supabase.auth.getSession();if(current)req.setHeader('authorization',`Bearer ${current.access_token}`);},onProgress:(sent,total)=>onProgress?.(Math.round(sent/total*100)),onError:reject,onSuccess:()=>resolve()});upload.start();});
 return path;
}
