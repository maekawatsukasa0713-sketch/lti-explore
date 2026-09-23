import {supabase} from './cloud';

export type PaperEngagement={views:number;citations:number;bookmarks:number};

const empty:PaperEngagement={views:0,citations:0,bookmarks:0};
const ids=(paperIds:(number|string)[])=>[...new Set(paperIds.map(String).filter(Boolean))].slice(0,500);

export async function loadPaperEngagement(paperIds:(number|string)[]){
 const paper_ids=ids(paperIds);
 if(!paper_ids.length)return {metrics:{} as Record<string,PaperEngagement>,bookmarked:new Set<string>()};
 const [countResult,bookmarkResult]=await Promise.all([
  supabase.rpc('lti_paper_engagement_counts',{paper_ids}),
  supabase.rpc('lti_my_paper_bookmarks',{paper_ids})
 ]);
 if(countResult.error)throw countResult.error;
 if(bookmarkResult.error)throw bookmarkResult.error;
 const metrics:Record<string,PaperEngagement>={};
 for(const id of paper_ids)metrics[id]={...empty};
 for(const row of countResult.data||[])metrics[String(row.paper_id)]={views:Number(row.views||0),citations:Number(row.citations||0),bookmarks:Number(row.bookmarks||0)};
 return {metrics,bookmarked:new Set<string>((bookmarkResult.data||[]).map((row:any)=>String(row.paper_id)))};
}

export async function togglePaperBookmark(paperId:number|string){
 const {data,error}=await supabase.rpc('lti_toggle_paper_bookmark',{target_paper_id:String(paperId)});
 if(error)throw error;
 return data===true;
}

export async function recordPaperView(paperId:number|string){
 const {data,error}=await supabase.rpc('lti_record_paper_view',{target_paper_id:String(paperId)});
 if(error)throw error;
 return Number(data||0);
}

export async function recordPaperCitation(paperId:number|string){
 const {data,error}=await supabase.rpc('lti_record_paper_citation',{target_paper_id:String(paperId)});
 if(error)throw error;
 return Number(data||0);
}

export function formatPaperCitation(paper:{title:string;author:string;schoolName:string;schoolNameOverride?:string|null;publishedDate?:string;submittedDate?:string}){
 const year=String(paper.publishedDate||paper.submittedDate||'').slice(0,4)||'公開年不明';
 const school=paper.schoolNameOverride?.trim()||paper.schoolName||'学校名未登録';
 const author=paper.author?.trim()||'著者名非公開';
 return `${author}（${year}）「${paper.title}」LTI Explore（${school}）`;
}

export async function copyText(text:string){
 if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
 if(typeof document==='undefined')throw new Error('コピー機能を利用できません。');
 const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
 const ok=document.execCommand('copy');document.body.removeChild(area);if(!ok)throw new Error('コピーできませんでした。');
}
