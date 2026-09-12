import {supabase} from './client';
import {analysisInput,invokeResearchAI} from './research-ai';
export async function publishResearch(id:number){
 const {data:row,error}=await supabase.from('lti_records').select('data,version').eq('kind','papers').eq('id',String(id)).single();if(error)throw error;
 let paper=row.data;
 if(paper.status!=='公開中'){paper={...paper,status:'公開中',publishedDate:new Date().toISOString().slice(0,10)};const saved=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),data:paper,version:row.version}]});if(saved.error)throw saved.error;}
 if(paper.aiAnalysis)return '公開済みです。保存されたAI情報を表示します。';
 if(paper.aiState)return '公開済みです。AIは解析開始済みのため再実行しません。';
 try{let input:Record<string,unknown>;if(paper.storagePath){const downloaded=await supabase.storage.from('lti-documents').download(paper.storagePath);if(downloaded.error||!downloaded.data)throw new Error('公開用ファイルを取得できませんでした。');input=await analysisInput(downloaded.data,paper.fileName||paper.storagePath);}else{input={text:paper.abstract||'',basis:'著者が登録した概要のみ（本文未解析）'};}
 await invokeResearchAI({mode:'register',paperId:String(id),title:paper.title,...input});
 return '公開しました。AIの要点まとめ・継続研究の参考情報も保存しました。';
 }catch(e){return '研究成果は公開済みです。AI結果は未保存：'+(e as Error).message;}
}
