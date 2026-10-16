import type {ResearchAnalysis} from './research-ai';

export type FinderPaper={
  id:number;
  title:string;
  schoolName:string;
  schoolNameOverride?:string|null;
  author:string;
  field:string;
  abstract?:string;
  status:string;
  aiAnalysis?:ResearchAnalysis;
};

export type FinderOption={label:string;note:string;fields:string[];keywords:string[]};
export type FinderFeedback=Record<number,'interested'|'dismissed'>;
export type Recommendation<T extends FinderPaper>={
  paper:T;
  score:number;
  suggestion?:ResearchAnalysis['suggestions'][number];
  reasons:string[];
  matchKind:'related'|'explore';
  matchedTerms:string[];
};

const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().trim();
const fieldKey=(paper:FinderPaper)=>normalize(paper.field);
// Single characters such as 力 / 光 / 水 occur in many unrelated compound words.
// Generic research vocabulary is not evidence of a particular interest either.
const genericTerms=new Set(['研究','探究','テーマ','興味','内容','結果','方法']);
const usefulTerm=(value:string)=>Array.from(value).length>=2&&!genericTerms.has(value)&&/[\p{L}]/u.test(value);
const singleHanTerm=(value:string)=>Array.from(value).length===1&&/\p{Script=Han}/u.test(value);
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const hasTerm=(text:string,term:string)=>/^[a-z\d -]+$/i.test(term)
  ?new RegExp(`(^|[^a-z\\d])${escapeRegex(term)}($|[^a-z\\d])`,'i').test(text)
  :text.includes(term);

type Evidence={text:string;label:string;weight:number};
function evidenceFor(paper:FinderPaper):Evidence[]{
  const ai=paper.aiAnalysis;
  return [
    {text:normalize(paper.title),label:'タイトル',weight:3},
    {text:normalize(paper.field),label:'分野',weight:2.5},
    {text:normalize(paper.abstract||''),label:'概要',weight:2},
    {text:normalize([ai?.title||'',...(ai?.summary||[])].join(' ')),label:'AI要約',weight:1.5},
    {text:normalize((ai?.suggestions||[]).flatMap(value=>[value.title,value.description,...(value.tags||[])]).join(' ')),label:'関連テーマ案',weight:0.8},
  ];
}

/** Rank the public papers already supplied to the finder. No requests or writes. */
export function rankResearchPapers<T extends FinderPaper>(papers:T[],options:{answers:FinderOption[];freeText:string;feedback:FinderFeedback}):Recommendation<T>[] {
  const {answers,freeText,feedback}=options;
  const seen=new Set<number>();
  const published=papers.filter(paper=>{
    if(paper.status!=='公開中'||seen.has(paper.id))return false;
    seen.add(paper.id);
    return true;
  });
  const indexed=published.map(paper=>({paper,evidence:evidenceFor(paper)}));
  const terms=new Map<string,{display:string;explicit:boolean;singleHan:boolean}>();
  for(const term of answers.flatMap(answer=>answer.keywords)){
    const key=normalize(term);
    if(usefulTerm(key)&&terms.size<120)terms.set(key,{display:term.normalize('NFKC').trim(),explicit:false,singleHan:false});
  }
  for(const term of freeText.split(/[\s,、，;；]+/u).filter(Boolean).slice(0,40)){
    const key=normalize(term);
    // A deliberate query such as 漆 is meaningful even though it is one Han
    // character. Its contribution is capped below multi-character evidence.
    if(usefulTerm(key)||singleHanTerm(key))terms.set(key,{display:term.normalize('NFKC').trim(),explicit:true,singleHan:singleHanTerm(key)});
  }
  const frequencies=new Map<string,number>();
  for(const term of terms.keys())frequencies.set(term,indexed.filter(row=>row.evidence.some(value=>hasTerm(value.text,term))).length);

  const fieldWeights=new Map<string,number[]>();
  for(const answer of answers){
    const fields=[...new Set(answer.fields.map(normalize).filter(Boolean))];
    for(const field of fields)fieldWeights.set(field,[...(fieldWeights.get(field)||[]),5/Math.sqrt(fields.length)]);
  }
  const interested=published.filter(paper=>feedback[paper.id]==='interested');
  const dismissed=published.filter(paper=>feedback[paper.id]==='dismissed');
  const hasPreferences=answers.length>0||Boolean(freeText.trim())||interested.length>0;

  return indexed.filter(({paper})=>feedback[paper.id]!=='dismissed').map(({paper,evidence})=>{
    const reasons:string[]=[];
    const weights=fieldWeights.get(fieldKey(paper))||[];
    const strongestField=weights.length?Math.max(...weights):0;
    // Broad method/goal choices cannot swamp one more specific field choice.
    const fieldScore=strongestField+Math.min(3,(weights.reduce((sum,value)=>sum+value,0)-strongestField)*0.4);
    const matches=[...terms].flatMap(([term,details])=>{
      const source=evidence.find(value=>hasTerm(value.text,term));
      if(!source)return [];
      const rarity=Math.min(2.5,1+Math.log((published.length+1)/((frequencies.get(term)||0)+1)));
      const score=source.weight*rarity*(details.explicit?2:0.75);
      return [{term,...details,source,score:details.singleHan?Math.min(2,score):score}];
    }).sort((a,b)=>Number(b.explicit)-Number(a.explicit)||b.score-a.score||a.term.localeCompare(b.term,'ja'));
    const keywordScore=Math.min(24,matches.reduce((sum,value)=>sum+value.score,0));
    const likedField=interested.filter(value=>fieldKey(value)===fieldKey(paper)).length;
    const dismissedField=dismissed.filter(value=>fieldKey(value)===fieldKey(paper)).length;
    const selfInterested=feedback[paper.id]==='interested';
    // Repeated feedback is averaged and bounded; it never multiplies the score.
    const feedbackScore=(interested.length?3*likedField/interested.length:0)+(selfInterested?2:0)-(dismissed.length?1.25*dismissedField/dismissed.length:0);
    if(fieldScore)reasons.push(`回答で選んだ「${paper.field}」分野の公開論文です。`);
    for(const match of matches.slice(0,2))reasons.push(`「${match.display}」が${match.source.label}に含まれます。`);
    if(selfInterested)reasons.push('「気になる」に選んだ論文です。');
    else if(likedField)reasons.push(`「気になる」に選んだ論文と同じ「${paper.field}」分野です。`);
    const related=fieldScore>0||matches.length>0||selfInterested||likedField>0;
    if(!related)reasons.push(hasPreferences
      ?'回答や入力キーワードとの直接の一致がないため、別の視点の候補として表示しています。'
      :'関心を広げるため、公開論文から表示しています。');

    // A continuation idea must itself contain matched evidence. An arbitrary AI
    // suggestion is not a match, and having AI analysis earns no ranking bonus.
    const suggestion=paper.aiAnalysis?.suggestions?.map((value,index)=>{
      const text=normalize([value.title,value.description,...(value.tags||[])].join(' '));
      const score=matches.reduce((sum,match)=>sum+(hasTerm(text,match.term)?(match.explicit?2:1):0),0);
      return {value,score,index};
    }).filter(value=>value.score>0).sort((a,b)=>b.score-a.score||a.index-b.index)[0]?.value;
    return {
      paper,
      score:Math.max(0,fieldScore+keywordScore+feedbackScore),
      suggestion,
      reasons:reasons.slice(0,3),
      matchKind:related?'related' as const:'explore' as const,
      matchedTerms:matches.map(value=>value.display),
    };
  }).sort((a,b)=>b.score-a.score||a.paper.id-b.paper.id);
}

/** Diversify near-ties while keeping a clearly relevant paper ahead of a gap. */
export function pickDiverseRecommendations<T extends FinderPaper>(ranked:Recommendation<T>[],limit=6):Recommendation<T>[] {
  if(!Number.isFinite(limit)||limit<=0)return [];
  const pool:Recommendation<T>[]=[];
  const seen=new Set<number>();
  for(const row of [...ranked].sort((a,b)=>b.score-a.score||a.paper.id-b.paper.id)){
    if(seen.has(row.paper.id))continue;
    seen.add(row.paper.id);
    pool.push(row);
  }
  const picked:Recommendation<T>[]=[];
  const fields=new Map<string,number>();
  while(pool.length&&picked.length<Math.floor(limit)){
    const bestScore=pool[0].score;
    const threshold=bestScore-Math.max(2,bestScore*0.2);
    let chosen=0;
    let bestAdjusted=-Infinity;
    for(let index=0;index<pool.length;index++){
      const row=pool[index];
      if(row.score<threshold)break;
      const adjusted=row.score-3*(fields.get(fieldKey(row.paper))||0);
      if(adjusted>bestAdjusted){chosen=index;bestAdjusted=adjusted;}
    }
    const [row]=pool.splice(chosen,1);
    picked.push(row);
    fields.set(fieldKey(row.paper),(fields.get(fieldKey(row.paper))||0)+1);
  }
  return picked;
}
