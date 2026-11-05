export type Paper = { doi:string; catalogId?:string; title:string; authors:string; year:string; journal:string; sourceUrl:string; documentUrl?:string; providers:string[]; language?:string; paperType?:string };
export function safeUrl(value:unknown): string|undefined { try { const u=new URL(String(value));return ['https:','http:'].includes(u.protocol)?u.href:undefined; } catch { return undefined; } }
export function japaneseRank(p:Pick<Paper,'language'|'title'>):number {
 const language=(p.language||'').toLowerCase().split('-')[0];
 if(language==='ja'||language==='jpn')return 2;
 if(language&&language!=='und')return 0;
 return /[\u3040-\u30ff]/.test(p.title)?1:0;
}
export function paperLanguageLabel(p:Pick<Paper,'language'|'title'>):string {
 const language=(p.language||'').toLowerCase().split('-')[0];
 if(language==='ja'||language==='jpn')return '日本語（登録情報）';
 if(language==='en'||language==='eng')return '英語（登録情報）';
 if(japaneseRank(p)===1)return '日本語タイトル・本文言語未確認';
 return language&&language!=='und'?'登録言語：'+language:'本文言語未登録';
}
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
type ProviderName='Crossref'|'CORE';
type FailureCode='timeout'|'connection'|'rate_limited'|'unavailable'|'rejected'|'invalid_response'|'request_failed';
export type SearchFailure={provider:ProviderName;code:FailureCode;status?:number;retryAfterMs?:number};
export function retryAfterMilliseconds(value:string|null,now=Date.now()):number|undefined {
 if(!value?.trim())return undefined;
 const raw=value.trim();const delay=/^\d+(?:\.\d+)?$/.test(raw)?Number(raw)*1000:Date.parse(raw)-now;
 return Number.isFinite(delay)&&delay>=0&&delay<=Number.MAX_SAFE_INTEGER-now?Math.ceil(delay):undefined;
}
export function isTimeout(error:unknown){return error instanceof Error&&['TimeoutError','AbortError'].includes(error.name);}
function warningFor(failure:SearchFailure){
 const messages:Record<FailureCode,string>={timeout:'接続がタイムアウトしました',connection:'接続できませんでした',rate_limited:'検索回数制限中',unavailable:'検索サービスが一時的に応答できません',rejected:'検索要求を受け付けられませんでした',invalid_response:'検索結果の形式を読み取れませんでした',request_failed:'検索処理に失敗しました'};
 return failure.provider+'：'+messages[failure.code]+(failure.retryAfterMs?`（約${Math.ceil(failure.retryAfterMs/1000)}秒後に再試行できます）`:'');
}
export function createSearchRunner(now:()=>number=Date.now){
 // Instance-local backoff protects an unavailable provider without blocking results from the other.
 // There are no automatic retries; a fresh instance still relies on the provider's own limits.
 const cooldowns=new Map<ProviderName,{until:number;failure:SearchFailure}>();
 return async function runSearch(query:string,page:number,fetcher:typeof fetch=fetch){
 const limit=20;
 const definitions=[{name:'Crossref' as const,url:'https://api.crossref.org/works?'+new URLSearchParams({'query.bibliographic':query,rows:String(limit),offset:String(page*limit),filter:'type:journal-article'}),parse:(d:any)=>{if(!Array.isArray(d?.message?.items))throw new Error('Invalid Crossref response');return {items:d.message.items.map(fromCrossref).filter(Boolean) as Paper[],more:(page+1)*limit<d.message['total-results']};}},
 {name:'CORE' as const,url:'https://api.core.ac.uk/v3/search/works/?'+new URLSearchParams({q:query,limit:String(limit),offset:String(page*limit)}),parse:(d:any)=>{if(!Array.isArray(d?.results))throw new Error('Invalid CORE response');return {items:d.results.map(fromCore).filter(Boolean) as Paper[],more:(page+1)*limit<d.totalHits};}}];
 const settled=await Promise.all(definitions.map(async source=>{
  const cooling=cooldowns.get(source.name),startedAt=now();if(cooling&&cooling.until>startedAt)return {failure:{...cooling.failure,retryAfterMs:cooling.until-startedAt}};
  cooldowns.delete(source.name);
  let response:Response;
  try{response=await fetcher(source.url,{signal:AbortSignal.timeout(18000),headers:{Accept:'application/json'}});}
  catch(error){return {failure:{provider:source.name,code:isTimeout(error)?'timeout':error instanceof TypeError?'connection':'request_failed'} as SearchFailure};}
  if(!response.ok){
   const code:FailureCode=response.status===429?'rate_limited':response.status>=500?'unavailable':'rejected';
   const retryAfterMs=code==='rate_limited'||code==='unavailable'?Math.max(1000,retryAfterMilliseconds(response.headers.get('retry-after'),now())??(code==='rate_limited'?60000:10000)):undefined;
   const failure:SearchFailure={provider:source.name,code,status:response.status,...(retryAfterMs?{retryAfterMs}:{})};
   if(retryAfterMs)cooldowns.set(source.name,{until:now()+retryAfterMs,failure});
   try{await response.body?.cancel();}catch{}
   return {failure};
  }
  let payload:unknown;
  try{payload=await response.json();}
  catch(error){return {failure:{provider:source.name,code:isTimeout(error)?'timeout':error instanceof TypeError?'connection':'invalid_response'} as SearchFailure};}
  try{return {result:source.parse(payload)};}
  catch{return {failure:{provider:source.name,code:'invalid_response'} as SearchFailure};}
 }));
 const failures:SearchFailure[]=[];const lists:Paper[][]=[];let hasMore=false;
 for(const entry of settled){if(entry.result){lists.push(entry.result.items);hasMore ||= entry.result.more;}else if(entry.failure)failures.push(entry.failure);}
 const failed=lists.length===0;const retryAfterMs=Math.max(0,...failures.map(f=>f.retryAfterMs||0));
 const code=failed?(failures.every(f=>f.code==='rate_limited')?'search_rate_limited':failures.every(f=>f.code==='timeout')?'search_timeout':'search_unavailable'):undefined;
 return {items:mergePapers(lists),warnings:failures.map(warningFor),hasMore,page,failed,failures,...(code?{code}:{}),...(retryAfterMs?{retryAfterMs}:{})};
 };
}
export const runSearch=createSearchRunner();
