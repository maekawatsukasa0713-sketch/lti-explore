import {supabase} from './client';
import {analysisInput,invokeResearchAI, type ResearchAnalysis} from './research-ai';
export async function readResearch(id:number){const {data,error}=await supabase.from('lti_records').select('data,version').eq('kind','papers').eq('id',String(id)).single();if(error)throw error;return data;}
export async function prepareResearch(id:number){
 const row=await readResearch(id);const paper=row.data;
 if(paper.aiAnalysis)return paper.aiAnalysis as ResearchAnalysis;
 if(paper.aiState)throw new Error('AI解析は開始済みです。重複課金を防ぐため再実行しません。結果が保存されていない場合は運営で確認してください。');
 if(!paper.storagePath)throw new Error('解析対象のPDFまたはWordファイルがありません。');
 const {data:file,error}=await supabase.storage.from('lti-documents').download(paper.storagePath);if(error)throw error;
 return invokeResearchAI({mode:'register',paperId:String(id),title:paper.title,...await analysisInput(file,paper.storagePath)});
}
export async function saveResearchInsight(id:number,analysis:ResearchAnalysis,version:number,publish:boolean){
 const row=await readResearch(id);if(row.version!==version)throw new Error('別の操作で更新されています。閉じて開き直してください。');
 if(!row.data.aiAnalysis)throw new Error('保存済みのAI解析がありません。');
 const paper={...row.data,aiAnalysis:analysis,aiReviewedAt:new Date().toISOString(),...(publish?{status:'公開中',publishedDate:new Date().toISOString().slice(0,10)}:{})};
 const {error}=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),data:paper,version}]});if(error)throw error;
}
