import React,{useMemo,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,CheckCircle2,FlaskConical,Lightbulb,RotateCcw,Search} from 'lucide-react';
import type {ResearchAnalysis} from './research-ai';

type FinderPaper={
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

type Option={
  label:string;
  note:string;
  fields:string[];
  keywords:string[];
};

type Question={
  title:string;
  lead:string;
  options:Option[];
};

const questions:Question[]=[
  {
    title:'どんな自然現象や技術に一番ワクワクしますか？',
    lead:'得意科目ではなく、「もっと知りたい」と思うものを選んでください。',
    options:[
      {label:'生き物・生命',note:'動物、植物、微生物、生態、進化',fields:['生物','医療・健康'],keywords:['生物','植物','動物','微生物','生命','生態','進化','発生','細胞']},
      {label:'地球・宇宙・気象',note:'地震、岩石、海、天気、宇宙',fields:['地学・宇宙','環境'],keywords:['地学','宇宙','地震','岩石','鉱物','海','気象','地球','火山']},
      {label:'力・音・光・磁気',note:'動き、波、電気、磁石、流体',fields:['物理'],keywords:['物理','力','振動','音','光','電気','磁','流体','波','運動']},
      {label:'化学・物質・材料',note:'反応、溶液、色、分子、新素材',fields:['化学','環境'],keywords:['化学','反応','物質','pH','溶液','分子','材料','触媒','結晶']},
      {label:'機械・電子・ロボット',note:'装置、センサー、制御、ものづくり',fields:['情報・工学','物理'],keywords:['機械','ロボット','装置','センサー','制御','電子','工学','設計','製作']},
      {label:'数理・データ・情報',note:'数式、プログラム、予測、画像解析',fields:['数学','情報・工学'],keywords:['数学','データ','解析','予測','数値','モデル','プログラム','画像解析','シミュレーション']},
      {label:'環境・エネルギー',note:'水、気候、資源、再エネ、環境問題',fields:['環境','化学','地学・宇宙'],keywords:['環境','水','気候','エネルギー','資源','汚染','再生可能','炭素','海洋']},
    ],
  },
  {
    title:'どんな研究の進め方をやってみたいですか？',
    lead:'実際に手を動かす場面を想像して選んでください。',
    options:[
      {label:'顕微鏡や観察で変化を追う',note:'形や動き、生態をじっくり記録する',fields:['生物','地学・宇宙'],keywords:['観察','顕微鏡','形状','発生','生態','記録','時系列']},
      {label:'条件を変えて実験する',note:'温度、濃度、磁場などを変えて比較する',fields:['物理','化学','生物'],keywords:['実験','条件','温度','濃度','pH','磁場','比較','測定']},
      {label:'装置や仕組みを作って試す',note:'工作、電子回路、ロボット、センサー',fields:['情報・工学','物理'],keywords:['装置','開発','改良','設計','ロボット','センサー','製作','回路']},
      {label:'データを解析して法則を探す',note:'グラフ、統計、画像、公開データを使う',fields:['数学','情報・工学','地学・宇宙'],keywords:['データ','解析','相関','分布','グラフ','統計','画像解析','予測']},
      {label:'野外で採集・測定する',note:'川、海、山、空、地域の自然を調べる',fields:['環境','地学・宇宙','生物'],keywords:['野外','採集','海','河川','環境','測定','フィールド','試料']},
    ],
  },
  {
    title:'どんなタイプの「問い」を追いかけたいですか？',
    lead:'研究のゴールに一番近いものを選んでください。',
    options:[
      {label:'なぜ、この現象が起きる？',note:'原因やメカニズムを解明したい',fields:['物理','化学','生物','地学・宇宙'],keywords:['原因','機構','メカニズム','形成','しくみ','解明']},
      {label:'どんな条件で変化する？',note:'閾値や条件と結果の関係を探したい',fields:['物理','化学','生物','環境'],keywords:['条件','影響','関係','依存','変化','閾値','濃度','温度']},
      {label:'どうすれば性能を上げられる？',note:'装置・材料・方法を改善したい',fields:['情報・工学','物理','化学'],keywords:['改良','性能','最適','効率','精度','改善','設計']},
      {label:'まだ誰も詳しく知らないことを見つけたい',note:'未解明の現象や未知のパターンを追いたい',fields:['生物','地学・宇宙','物理','化学'],keywords:['未解明','未知','発見','生活環','過程','新規','解明']},
      {label:'科学技術として役立てたい',note:'環境・医療・産業などの応用につなげたい',fields:['環境','医療・健康','情報・工学','化学'],keywords:['応用','活用','環境','医療','産業','技術','実装','材料']},
    ],
  },
  {
    title:'使ってみたい道具や場所はどれですか？',
    lead:'今すぐ使えるかは気にせず、興味があるものを選んでください。',
    options:[
      {label:'顕微鏡・生物試料',note:'細胞、生物、微細な構造を観察したい',fields:['生物','医療・健康'],keywords:['顕微鏡','細胞','試料','観察','生物','微生物']},
      {label:'センサー・測定器・実験装置',note:'数値を測って現象を確かめたい',fields:['物理','化学','地学・宇宙'],keywords:['測定','センサー','装置','磁束','温度','圧力','電圧','分析']},
      {label:'工作・電子回路・ロボット',note:'自分で装置を作って改良したい',fields:['情報・工学','物理'],keywords:['工作','回路','ロボット','装置','制御','センサー','製作']},
      {label:'PC・プログラム・画像解析',note:'コードやデータで研究したい',fields:['情報・工学','数学'],keywords:['プログラム','画像解析','データ','シミュレーション','モデル','解析']},
      {label:'海・川・山などのフィールド',note:'自然の中で採集や測定をしたい',fields:['環境','地学・宇宙','生物'],keywords:['海','河川','山','野外','採集','環境','フィールド','地質']},
      {label:'化学実験・材料づくり',note:'試薬や材料を扱って性質を調べたい',fields:['化学','環境'],keywords:['化学','試薬','材料','反応','溶液','合成','結晶','pH']},
    ],
  },
]

const normalize=(v:string)=>v.normalize('NFKC').toLowerCase();

function compactDescription(text?:string){
  if(!text)return '';
  const cleaned=text
    .replace(/【[^】]+】/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  if(!cleaned)return '';
  const first=cleaned.split(/(?<=[。！？])/)[0]||cleaned;
  return first.length>105?first.slice(0,105)+'…':first;
}

function paperText(p:FinderPaper){
  const ai=p.aiAnalysis;
  return normalize([
    p.title,p.field,p.abstract||'',ai?.title||'',
    ...(ai?.summary||[]),
    ...(ai?.suggestions||[]).flatMap(s=>[s.title,s.description,...(s.tags||[])])
  ].join(' '));
}

export function ResearchThemeFinder<T extends FinderPaper>({papers,onOpen}:{papers:T[];onOpen:(paper:T)=>void}){
  const [step,setStep]=useState(0);
  const [answers,setAnswers]=useState<Option[]>([]);
  const [showResults,setShowResults]=useState(false);

  const scienceFields=new Set(['物理','化学','生物','地学・宇宙','環境','数学','情報・工学','医療・健康']);
  const published=useMemo(()=>papers.filter(p=>p.status==='公開中'&&scienceFields.has(p.field)),[papers]);

  const fieldScores=useMemo(()=>{
    const map=new Map<string,number>();
    for(const answer of answers)for(const field of answer.fields)map.set(field,(map.get(field)||0)+1);
    return [...map.entries()].sort((a,b)=>b[1]-a[1]);
  },[answers]);

  const recommendations=useMemo(()=>{
    if(!showResults)return [];
    const keywords=[...new Set(answers.flatMap(a=>a.keywords).map(normalize))];
    const scored=published.map(p=>{
      const text=paperText(p);
      const fieldScore=answers.reduce((sum,a)=>sum+(a.fields.includes(p.field)?6:0),0);
      const keywordScore=keywords.reduce((sum,k)=>sum+(text.includes(k)?1.4:0),0);
      const suggestion=p.aiAnalysis?.suggestions?.map(s=>{
        const suggestionText=normalize([s.title,s.description,...(s.tags||[])].join(' '));
        const match=keywords.reduce((sum,k)=>sum+(suggestionText.includes(k)?1:0),0);
        return {value:s,match};
      }).sort((a,b)=>b.match-a.match)[0]?.value;
      return {paper:p,score:fieldScore+keywordScore+(suggestion?1.5:0),suggestion};
    }).sort((a,b)=>b.score-a.score);

    const picked:typeof scored=[];
    for(const row of scored){
      if(picked.some(x=>x.paper.id===row.paper.id))continue;
      picked.push(row);
      if(picked.length===3)break;
    }
    return picked;
  },[answers,published,showResults]);

  const select=(option:Option)=>{
    const next=[...answers.slice(0,step),option];
    setAnswers(next);
    if(step===questions.length-1){
      setShowResults(true);
    }else{
      setStep(step+1);
    }
  };

  const back=()=>{
    if(showResults){setShowResults(false);setStep(questions.length-1);return;}
    if(step>0)setStep(step-1);
  };

  const reset=()=>{setStep(0);setAnswers([]);setShowResults(false);};

  if(showResults){
    const topFields=fieldScores.slice(0,3).map(([field])=>field);
    return <section className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-700 text-white shadow-sm">
        <div className="p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold tracking-[.18em] text-emerald-200">RESEARCH MATCH</p>
              <h2 className="mt-2 text-2xl md:text-3xl font-extrabold">あなたの興味から、研究テーマを見つけました。</h2>
            </div>
            <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-xs font-bold hover:bg-white/15"><RotateCcw className="h-4 w-4"/>もう一度診断</button>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-emerald-50">LTI Exploreの「みんなの論文」にある公開研究を学習元として、あなたの回答と近い研究・継続研究の候補を表示しています。</p>
          <div className="mt-5 flex flex-wrap gap-2">{answers.map((a,i)=><span key={i} className="rounded-full bg-white/12 px-3 py-1.5 text-xs font-bold">{a.label}</span>)}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="text-xs font-bold text-slate-400">興味が近そうな分野</p>
          <div className="mt-2 flex flex-wrap gap-2">{topFields.map(field=><span key={field} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">{field}</span>)}</div>
        </div>
        <p className="text-xs leading-6 text-slate-500">これは適性検査ではなく、研究の入口を見つけるための提案です。</p>
      </div>

      {recommendations.length?<div className="grid grid-cols-1 xl:grid-cols-3 gap-4">{recommendations.map((row,index)=>{
        const sourceTitle=row.paper.aiAnalysis?.title||row.paper.title;
        const themeTitle=row.suggestion?.title||sourceTitle;
        const description=compactDescription(row.suggestion?.description)||'この公開研究を出発点に、条件や対象を変えながら自分なりの問いへ発展させてみましょう。';
        return <article key={row.paper.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-br from-emerald-50 to-white p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-extrabold text-white">{index+1}</span>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-100">{row.paper.field}</span>
            </div>
            <p className="mt-4 text-[11px] font-bold tracking-wide text-emerald-700">おすすめ研究テーマ</p>
            <h3 className="mt-1 text-base font-extrabold leading-7 text-slate-900">{themeTitle}</h3>
            <p className="mt-3 text-xs leading-6 text-slate-600">{description}</p>
            {row.suggestion?.tags?.length?<div className="mt-3 flex flex-wrap gap-1.5">{row.suggestion.tags.slice(0,4).map(tag=><span key={tag} className="rounded-md bg-emerald-100/70 px-2 py-1 text-[10px] font-bold text-emerald-800">{tag}</span>)}</div>:null}
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><BookOpen className="h-4 w-4"/>このテーマの学習元</div>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-800">{sourceTitle}</p>
            <p className="mt-1 text-xs text-slate-500">{row.paper.schoolNameOverride?.trim()||row.paper.schoolName} / {row.paper.author}</p>
            <button type="button" onClick={()=>onOpen(row.paper)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700">元論文を読んでみる <ArrowRight className="h-4 w-4"/></button>
          </div>
        </article>;
      })}</div>:<div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">公開論文から候補を作成できませんでした。</div>}

      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
        <div className="flex gap-3">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-violet-600"/>
          <div>
            <p className="text-sm font-bold text-violet-950">テーマをそのままコピーする必要はありません。</p>
            <p className="mt-1 text-xs leading-6 text-violet-800">まず学習元の論文で「問い・方法・結果」を確認し、対象・条件・測り方を少し変えて、自分だけの問いにしていく使い方を想定しています。</p>
          </div>
        </div>
      </div>
    </section>;
  }

  const q=questions[step];
  const progress=Math.round(((step+1)/questions.length)*100);
  return <section className="mx-auto max-w-5xl space-y-6">
    <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-700 p-6 md:p-8 text-white">
        <p className="text-xs font-bold tracking-[.18em] text-emerald-200">RESEARCH MATCH</p>
        <h2 className="mt-2 text-2xl md:text-3xl font-extrabold">自分に合いそうな理系研究を見つける</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-emerald-50">4つの理系質問に答えると、「みんなの論文」の自然科学・工学系研究をもとに、興味が近そうな研究テーマを提案します。</p>
      </div>
      <div className="p-5 md:p-8">
        <div className="flex items-center justify-between text-xs font-bold text-slate-400"><span>QUESTION {step+1} / {questions.length}</span><span>{progress}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{width:progress+'%'}}/></div>
        <div className="mt-7">
          <h3 className="text-xl md:text-2xl font-extrabold text-slate-900">{q.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">{q.lead}</p>
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          {q.options.map((option,i)=><button type="button" key={option.label} onClick={()=>select(option)} className="group min-h-[104px] rounded-2xl border border-slate-200 bg-slate-50/50 p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-extrabold text-slate-400 ring-1 ring-slate-200 group-hover:text-emerald-700 group-hover:ring-emerald-200">{String.fromCharCode(65+i)}</span>
              <div><p className="font-extrabold text-slate-900">{option.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{option.note}</p></div>
            </div>
          </button>)}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button type="button" disabled={step===0} onClick={back} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:invisible"><ArrowLeft className="h-4 w-4"/>前の質問</button>
          <div className="flex items-center gap-2 text-xs text-slate-400"><Search className="h-4 w-4"/>理系の公開論文 {published.length}件から探します</div>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-2xl border bg-white p-4"><BookOpen className="h-5 w-5 text-emerald-600"/><p className="mt-2 text-sm font-bold">学習元は「みんなの論文」</p><p className="mt-1 text-xs leading-5 text-slate-500">実際に公開されている高校生の理系研究を出発点にします。</p></div>
      <div className="rounded-2xl border bg-white p-4"><FlaskConical className="h-5 w-5 text-blue-600"/><p className="mt-2 text-sm font-bold">興味 × 研究方法で探す</p><p className="mt-1 text-xs leading-5 text-slate-500">分野だけでなく、観察・実験・分析などの好みも使います。</p></div>
      <div className="rounded-2xl border bg-white p-4"><CheckCircle2 className="h-5 w-5 text-violet-600"/><p className="mt-2 text-sm font-bold">元論文までたどれる</p><p className="mt-1 text-xs leading-5 text-slate-500">候補だけで終わらず、根拠になった研究本文を読めます。</p></div>
    </div>
  </section>;
}
