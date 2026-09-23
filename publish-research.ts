import {supabase} from './client';
import {analysisInput,invokeResearchAI, type ResearchAnalysis} from './research-ai';
export async function readResearch(id:number){const {data,error}=await supabase.from('lti_records').select('data,version').eq('kind','papers').eq('id',String(id)).single();if(error)throw error;return data;}
export async function prepareResearch(id:number){
 let row=await readResearch(id);let paper=row.data;const needsEvaluation=!!paper.aiAnalysis&&!paper.aiAnalysis.evaluation;
 if(paper.aiAnalysis&&!needsEvaluation)return paper.aiAnalysis as ResearchAnalysis;
 if(paper.aiState?.state==='processing'&&Date.now()-Date.parse(paper.aiState.startedAt||'')>165000){
  const stale={...paper,aiState:{...paper.aiState,state:'failed',reason:'worker_timeout',failedAt:new Date().toISOString()}};
  const {error}=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),version:row.version,data:stale}]});
  if(error)throw error;
  row=await readResearch(id);paper=row.data;
 }
 // Failed jobs may be retried explicitly. Processing and completed jobs stay locked to avoid duplicate billing.
 if(paper.aiState&&paper.aiState.state!=='failed'&&!(needsEvaluation&&paper.aiState.state==='ready'))throw new Error('AI解析は開始済みです。処理中の再実行は重複課金の恐れがあります。結果が保存されていない場合は運営で確認してください。');
 if(!paper.storagePath)throw new Error('解析対象のPDFまたはWordファイルがありません。');
 const {data:file,error}=await supabase.storage.from('lti-documents').download(paper.storagePath);if(error)throw error;
 let input;try{input=await analysisInput(file,paper.storagePath);}catch(e){const message=e instanceof Error?e.message:'本文抽出に失敗しました。';const current=await readResearch(id);if(current.version===row.version){await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),version:row.version,data:{...paper,aiInputError:message}}]});}throw Object.assign(new Error(message),{inputError:true});}
 const accepted=await invokeResearchAI({mode:'register',paperId:String(id),title:paper.title,refreshEvaluation:needsEvaluation,...input});
 if(!('accepted' in accepted))return accepted;
 const deadline=Date.now()+200000;
 while(Date.now()<deadline){
  await new Promise(resolve=>window.setTimeout(resolve,2000));
  const current=await readResearch(id);
  if(current.data.aiAnalysis&&(!needsEvaluation||current.data.aiAnalysis.evaluation))return current.data.aiAnalysis as ResearchAnalysis;
  if(current.data.aiState?.state==='failed'){const reason=current.data.aiState.reason||'原因不明';if(reason==='quota')throw new Error('AI解析の利用上限に達しました。時間をおいてから解析してください。');throw new Error(`AI解析に失敗しました（${reason}）。保存済みの原稿から再解析できます。`);}
  if(current.data.aiState?.state==='processing'&&Date.now()-Date.parse(current.data.aiState.startedAt||'')>165000){
   const stale={...current.data,aiState:{...current.data.aiState,state:'failed',reason:'worker_timeout',failedAt:new Date().toISOString()}};
   const {error}=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),version:current.version,data:stale}]});
   if(error)throw error;
   throw new Error('AI解析の実行時間上限に達したため停止しました。保存済みの原稿から再解析できます。');
  }
 }
 throw new Error('解析依頼は受け付けられ、サーバー側で処理を続けています。いったん画面を閉じても大丈夫です。しばらくしてから一覧を更新してください。');
}
export async function saveResearchInsight(id:number,analysis:ResearchAnalysis,version:number,publish:boolean){
 const row=await readResearch(id);if(row.version!==version)throw new Error('別の操作で更新されています。閉じて開き直してください。');
 if(!row.data.aiAnalysis)throw new Error('保存済みのAI解析がありません。');
 const paper={...row.data,aiAnalysis:analysis,aiReviewedAt:new Date().toISOString(),...(publish?{status:'公開中',publishedDate:new Date().toISOString().slice(0,10)}:{})};
 const {error}=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),data:paper,version}]});if(error)throw error;
}
