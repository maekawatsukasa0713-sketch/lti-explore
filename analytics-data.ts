export type AnalyticsPaper={id:number;schoolId:string;schoolName:string;field:string;status:string;submittedDate:string;withdrawalRequested?:boolean};
export function paperDate(value:string):string|null {
 const match=/^(\d{4})[-/](\d{2})[-/](\d{2})(?:$|T| )/.exec(value||'');if(!match)return null;
 const date=`${match[1]}-${match[2]}-${match[3]}`;const d=new Date(date+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date?date:null;
}
export function selectPapers(papers:AnalyticsPaper[],school:string,from:string,to:string){return papers.filter(p=>{
 if(school&&p.schoolId!==school)return false;const date=paperDate(p.submittedDate);
 return (!from&&!to)||!!date&&(!from||date>=from)&&(!to||date<=to);
});}
export function distribution(papers:AnalyticsPaper[],key:'field'|'status'){
 const counts=new Map<string,number>();for(const p of papers){const label=p[key]?.trim()||'未分類';counts.set(label,(counts.get(label)||0)+1);}
 return [...counts].map(([label,count])=>({label,count,percent:papers.length?count/papers.length*100:0})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ja'));
}
export const rate=(part:number,total:number)=>total?`${(100*part/total).toFixed(1)}%`:'—';
