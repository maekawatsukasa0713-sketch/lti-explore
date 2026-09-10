export type Paper = { doi:string; catalogId?:string; title:string; authors:string; year:string; journal:string; sourceUrl:string; documentUrl?:string; providers:string[]; language?:string; paperType?:string };
export function safeUrl(value:unknown): string|undefined { try { const u=new URL(String(value));return ['https:','http:'].includes(u.protocol)?u.href:undefined; } catch { return undefined; } }
export const doiKey=(v:unknown)=>String(v||'').replace(/^https?:\/\/(dx\.)?doi\.org\//i,'').trim().toLowerCase();
const plain=(v:unknown)=>String(v||'').replace(/<[^>]*>/g,'').trim();
export function fromCrossref(p:any):Paper|null {
 const doi=doiKey(p.DOI);if(!doi||!p.title?.[0])return null;
 return {doi,title:plain(p.title[0]),authors:(p.author||[]).map((a:any)=>[a.given,a.family].filter(Boolean).join(' ')||a.name||'').filter(Boolean).join(', '),year:String(p.published?.['date-parts']?.[0]?.[0]||p.issued?.['date-parts']?.[0]?.[0]||''),journal:plain(p['container-title']?.[0]),sourceUrl:'https://doi.org/'+doi,providers:['Crossref'],language:p.language,paperType:p.type};
}
export function fromCore(p:any):Paper|null {
 if(!p.id||!p.title)return null;
 const doi=doiKey(p.doi);
 return {doi,...(!doi?{catalogId:'core:'+p.id}:{}),title:plain(p.title),authors:(p.authors||[]).map((a:any)=>plain(a.name)).filter(Boolean).join(', '),year:String(p.yearPublished||p.publishedDate?.slice(0,4)||''),journal:plain(p.publisher||p.dataProviders?.[0]?.name),sourceUrl:doi?'https://doi.org/'+doi:'https://core.ac.uk/works/'+p.id,documentUrl:safeUrl(p.downloadUrl),providers:['CORE'],language:p.language?.code,paperType:p.documentType};
}
export function mergePapers(lists:Paper[][]):Paper[] {
 const seen=new Map<string,Paper>();
 // Interleave each provider's relevance ranking, retaining first occurrence.
 for(let rank=0;rank<Math.max(0,...lists.map(l=>l.length));rank++)for(const list of lists){
  const p=list[rank];if(!p)continue;const key=p.doi||p.catalogId!;const old=seen.get(key);
  seen.set(key,old?{...old,documentUrl:old.documentUrl||p.documentUrl,providers:Array.from(new Set([...old.providers,...p.providers]))}:p);
 }
 return [...seen.values()];
}
export async function runSearch(query:string,page:number,fetcher:typeof fetch=fetch){
 const limit=20;
 const definitions=[{name:'Crossref',url:'https://api.crossref.org/works?'+new URLSearchParams({'query.bibliographic':query,rows:String(limit),offset:String(page*limit),filter:'type:journal-article'}),parse:(d:any)=>{if(!Array.isArray(d.message?.items))throw new Error('Invalid Crossref response');return {items:d.message.items.map(fromCrossref).filter(Boolean) as Paper[],more:(page+1)*limit<d.message['total-results']};}},
 {name:'CORE',url:'https://api.core.ac.uk/v3/search/works/?'+new URLSearchParams({q:query,limit:String(limit),offset:String(page*limit)}),parse:(d:any)=>{if(!Array.isArray(d.results))throw new Error('Invalid CORE response');return {items:d.results.map(fromCore).filter(Boolean) as Paper[],more:(page+1)*limit<d.totalHits};}}];
 const settled=await Promise.allSettled(definitions.map(async source=>{const r=await fetcher(source.url,{signal:AbortSignal.timeout(18000),headers:{Accept:'application/json'}});if(!r.ok)throw new Error(r.status===429?'検索回数制限中':'接続できません');return source.parse(await r.json());}));
 const warnings:string[]=[];const lists:Paper[][]=[];let hasMore=false;
 settled.forEach((s,i)=>{if(s.status==='fulfilled'){lists.push(s.value.items);hasMore ||= s.value.more;}else warnings.push(definitions[i].name+'：'+(s.reason?.message||'取得できませんでした'));});
 return {items:mergePapers(lists),warnings,hasMore,page,failed:lists.length===0};
}
