export const RESEARCH_FIELDS=['物理','化学','生物','地学・宇宙','環境','数学','情報・工学','医療・健康','社会・人文','その他','未分類'] as const;
export function classificationPatch(paper:any,result:any){
 if(paper.classificationMode!=='ai'||!result.classification)return {};
 return {field:RESEARCH_FIELDS.includes(result.classification.field)?result.classification.field:'未分類',classificationReason:result.classification.reason,bulkReviewed:false};
}
export function publicationOps(rows:{id:string;version:number;data:any}[],selected:Record<string,number>){
 const ids=Object.keys(selected);if(!ids.length||ids.length>50)throw new Error('公開する論文を1〜50件選んでください。');
 return ids.map(id=>{const r=rows.find(x=>x.id===id);if(!r||r.version!==selected[id])throw new Error('選択後に変更された論文があります。再選択してください。');
 const p=r.data;if(p.status!=='承認待ち'||!p.bulkImport||!p.title?.trim()||!p.storagePath||!p.field?.trim()||p.field==='未分類')throw new Error('原稿・分野・内容の確認が終わっていない論文があります。');
 const reviewedAt=p.aiAnalysis?(p.aiReviewedAt||new Date().toISOString()):p.aiReviewedAt;
 return {action:'update',kind:'papers',id,version:r.version,data:{...p,bulkReviewed:true,...(reviewedAt?{aiReviewedAt:reviewedAt}:{}),status:'公開中',publishedDate:new Date().toISOString().slice(0,10)}};});
}
