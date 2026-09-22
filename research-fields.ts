export const RESEARCH_FIELDS=['物理','化学','生物','地学・宇宙','環境','数学','情報・工学','医療・健康','社会・人文','その他','未分類'] as const;
export function classificationPatch(paper:any,result:any){
 if(paper.classificationMode!=='ai'||!result.classification)return {};
 return {field:RESEARCH_FIELDS.includes(result.classification.field)?result.classification.field:'未分類',classificationReason:result.classification.reason,bulkReviewed:false};
}
export function publicationOps(rows:{id:string;version:number;data:any}[],selected:Record<string,number>){
 const ids=Object.keys(selected);if(!ids.length||ids.length>50)throw new Error('公開する論文を1〜50件選んでください。');
 return ids.map(id=>{const r=rows.find(x=>x.id===id);if(!r||r.version!==selected[id])throw new Error('選択後に変更された論文があります。再選択してください。');
 const p=r.data;if(p.status!=='承認待ち'||!p.bulkImport||!p.bulkReviewed||!p.title?.trim()||!p.storagePath||!p.field?.trim()||p.field==='未分類')throw new Error('原稿・分野・内容の確認が終わっていない論文があります。');
 if((p.aiRequested||p.aiState)&&!p.aiAnalysis)throw new Error('AI解析が未完了または失敗した論文があります。「未解析・失敗分をAI解析」で再実行し、結果を確認してください。');
 if(p.aiAnalysis&&!p.aiReviewedAt)throw new Error('AI参考情報を確認してください。');
 return {action:'update',kind:'papers',id,version:r.version,data:{...p,status:'公開中',publishedDate:new Date().toISOString().slice(0,10)}};});
}
