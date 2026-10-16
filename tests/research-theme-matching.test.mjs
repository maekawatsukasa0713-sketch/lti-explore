import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';

const dir=await mkdtemp(path.resolve('.theme-matching-test-'));
try{
  await build({entryPoints:['research-theme-matching.ts'],outfile:path.join(dir,'matching.mjs'),bundle:true,platform:'node',format:'esm'});
  const {rankResearchPapers:rank,pickDiverseRecommendations:pick}=await import(path.join(dir,'matching.mjs'));
  const paper=(id,field,title,extra={})=>({id,field,title,schoolName:'試験校',author:'研究者',status:'公開中',...extra});
  const option=(fields=[],keywords=[])=>({label:'回答',note:'',fields,keywords});
  const preferences=(answers=[],freeText='',feedback={})=>({answers,freeText,feedback});
  const analysis=(suggestions=[])=>({title:'解析結果',summary:[],suggestions,corrections:[],advice:[],nextExperiments:[],generatedAt:'2026-10-16',basis:'試験用'});

  // The old finder silently excluded real taxonomy values and humanities.
  const fields=['地学','物作り','社会科学','生命倫理','文学・歴史','独自分野'];
  const allFields=fields.map((field,index)=>paper(index+1,field,`${field}の公開論文`));
  assert.deepEqual(new Set(rank(allFields,preferences()).map(row=>row.paper.field)),new Set(fields));
  const notPublic=paper(100,'物理','非公開論文',{status:'審査中'});
  assert(!rank([...allFields,notPublic],preferences()).some(row=>row.paper.id===100));
  assert.equal(rank([...allFields,allFields[0]],preferences()).length,fields.length);
  for(const source of allFields){
    const result=rank(allFields,preferences([option([source.field])]))[0];
    assert.strictEqual(result.paper,source,'the result retains the exact source object, school, author and id');
    assert.equal(result.matchKind,'related');
    assert(result.reasons.some(reason=>reason.includes(`「${source.field}」`)));
  }

  const candidates=[
    paper(1,'社会科学','地域の祭りと住民の交流'),
    paper(2,'情報・工学','AIと教育',{abstract:'人工知能を授業に導入する'}),
    paper(3,'物理','光による植物の研究'),
    paper(4,'生物','植物と土壌'),
    paper(5,'情報・工学','Brain science'),
  ];
  assert.equal(rank(candidates,preferences([],'祭り'))[0].paper.id,1);
  const ai=rank(candidates,preferences([],'ＡＩ，教育'));
  assert.equal(ai[0].paper.id,2);
  assert.deepEqual(new Set(ai[0].matchedTerms),new Set(['AI','教育']));
  assert.equal(ai.find(row=>row.paper.id===5).matchKind,'explore','AI does not match the interior of Brain');
  assert(ai[0].reasons.every(reason=>!reason.includes('学習')&&!reason.includes('適性')));
  const generic=rank(candidates,preferences([option([],['光','力','水','研究'])]));
  assert(generic.every(row=>row.score===0&&row.matchKind==='explore'),'generic one-character matches never dominate');
  const singleCharacterSources=[paper(60,'物作り','漆の乾燥を調べる'),paper(61,'物理','光の反射'),paper(62,'環境','水の流れ')];
  for(const [term,id] of [['漆',60],['光',61],['水',62]]){
    const result=rank(singleCharacterSources,preferences([],term));
    assert.equal(result[0].paper.id,id,'a deliberately entered single Han character remains searchable');
    assert.equal(result[0].matchKind,'related');
    assert.deepEqual(result[0].matchedTerms,[term]);
    assert(result[0].score>0&&result[0].score<=2,'ambiguous single-character evidence has a small cap');
    assert(result[0].reasons.some(reason=>reason.includes('タイトル')));
  }
  assert(rank(singleCharacterSources,preferences([], 'a の')).every(row=>row.matchKind==='explore'),'single Latin letters and particles are not search evidence');
  const unknown=rank(candidates,preferences([],'見つからない固有キーワード'));
  assert(unknown.every(row=>row.score===0&&row.matchKind==='explore'&&row.matchedTerms.length===0));
  assert(unknown.every(row=>row.reasons.some(reason=>reason.includes('直接の一致がない'))));

  // A suggestion is grounded separately; merely having AI analysis adds no points.
  const ungrounded=paper(10,'社会科学','地域の文化',{aiAnalysis:analysis([{title:'無関係な新材料',description:'材料の温度を変える',tags:['材料']}])});
  const noAnalysis=paper(11,'社会科学','地域の文化');
  const unrelatedAnalysis=rank([ungrounded,noAnalysis],preferences([option(['社会科学'])]));
  assert.equal(unrelatedAnalysis[0].score,unrelatedAnalysis[1].score);
  assert.equal(unrelatedAnalysis[0].suggestion,undefined);
  const groundedSuggestion={title:'地域の祭りを比較する',description:'地域ごとの祭りと交流を調べる',tags:['祭り']};
  const grounded=paper(12,'社会科学','地域の文化',{aiAnalysis:analysis([groundedSuggestion])});
  const groundedResult=rank([grounded],preferences([],'祭り'))[0];
  assert.strictEqual(groundedResult.suggestion,groundedSuggestion);
  assert(groundedResult.reasons.some(reason=>reason.includes('関連テーマ案')),'AI-only evidence is labelled as such');
  const rewrittenTitle=paper(13,'社会科学','地域の文化',{aiAnalysis:{...analysis(),title:'祭りの継承'}});
  const aiTitleResult=rank([rewrittenTitle],preferences([],'祭り'))[0];
  assert(aiTitleResult.reasons.some(reason=>reason.includes('AI要約')),'AI-rewritten title evidence does not claim to be the original title');
  assert(!aiTitleResult.reasons.some(reason=>reason.includes('タイトル')));
  assert.equal(aiTitleResult.paper.title,'地域の文化');

  const feedbackPapers=[paper(20,'物理','振動の測定'),paper(21,'社会科学','地域の交流'),paper(22,'社会科学','文化の継承'),paper(23,'生物','植物の成長')];
  const baseline=rank(feedbackPapers,preferences());
  const interested=rank(feedbackPapers,preferences([], '',{21:'interested'}));
  assert.equal(interested[0].paper.id,21);
  assert(interested.find(row=>row.paper.id===22).score>baseline.find(row=>row.paper.id===22).score);
  assert(interested.find(row=>row.paper.id===22).reasons.some(reason=>reason.includes('同じ「社会科学」')));
  const dismissed=rank(feedbackPapers,preferences([], '',{21:'dismissed'}));
  assert(!dismissed.some(row=>row.paper.id===21));
  assert.deepEqual(rank(feedbackPapers,preferences()),baseline,'removing feedback restores the previous ranking');
  assert.deepEqual(rank(feedbackPapers,preferences([], '',{999:'interested',1000:'dismissed'})),baseline,'unknown source feedback is ignored');
  const manyLikes=Array.from({length:80},(_,index)=>paper(1000+index,'社会科学',`地域事例${index}`));
  const likedFeedback=Object.fromEntries(manyLikes.map(value=>[value.id,'interested']));
  const bounded=rank([...manyLikes,paper(9999,'社会科学','別の地域事例')],preferences([], '',likedFeedback)).find(row=>row.paper.id===9999);
  assert.equal(bounded.score,3,'many likes cannot create runaway field scores');

  const relevant=Array.from({length:8},(_,index)=>paper(index+30,'社会科学',`祭りの調査${index}`));
  const broad=[...relevant,paper(50,'物理','振動の研究'),paper(51,'生物','植物の研究')];
  const focused=pick(rank(broad,preferences([],'祭り')));
  assert.equal(focused.length,6);
  assert(focused.every(row=>row.matchKind==='related'),'diversity does not force unrelated work above strong evidence');
  const neutral=pick(rank(broad,preferences()));
  assert.equal(new Set(neutral.slice(0,3).map(row=>row.paper.field)).size,3,'near-ties reveal different fields');
  assert.equal(new Set(neutral.map(row=>row.paper.id)).size,6);
  assert.deepEqual(pick(rank([...broad].reverse(),preferences())),neutral,'ties are stable across input order');
  assert.equal(pick([...neutral,...neutral]).length,6,'duplicate ids are never displayed twice');
  assert.deepEqual(pick(neutral,0),[]);
  assert.deepEqual(pick([],6),[]);
  assert.equal(pick(neutral,2).length,2);
  assert.equal(pick(neutral,Infinity).length,0);
  console.log('PASS: public taxonomy coverage, exact sources, free text normalization, honest evidence, reversible bounded feedback, and relevant diversity');
}finally{await rm(dir,{recursive:true,force:true});}
