import React,{useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Check,CheckCircle2,Compass,Lightbulb,RotateCcw,Search,SlidersHorizontal,ThumbsUp,X} from 'lucide-react';
import {pickDiverseRecommendations,rankResearchPapers,type FinderFeedback,type FinderOption,type FinderPaper} from './research-theme-matching';

type Question={title:string;lead:string;options:FinderOption[]};
const questions:Question[]=[
  {
    title:'どんなことが気になりますか？',
    lead:'好きなものや、日常で不思議に思うものを選んでください。分野をまたいでも大丈夫です。',
    options:[
      {label:'生き物・生命',note:'動物、植物、微生物、生態、進化',fields:['生物'],keywords:['生物','植物','動物','微生物','生態','進化','細胞']},
      {label:'地球・宇宙・天気',note:'地震、岩石、海、気象、天体',fields:['地学','地学・宇宙'],keywords:['地震','岩石','鉱物','海洋','気象','宇宙','火山']},
      {label:'力・音・光・磁気',note:'動き、波、電気、流体のしくみ',fields:['物理'],keywords:['振動','音響','光学','電気','磁気','流体','運動']},
      {label:'化学・物質・材料',note:'色や反応、分子、新しい素材',fields:['化学'],keywords:['化学','反応','溶液','分子','材料','触媒','結晶']},
      {label:'ものづくり・ロボット',note:'装置、センサー、設計、電子工作',fields:['物作り','情報・工学'],keywords:['ロボット','装置','センサー','制御','電子','設計','製作']},
      {label:'数理・データ・情報',note:'数学、AI、プログラム、予測',fields:['数学','情報・工学','物作り'],keywords:['数学','データ','人工知能','プログラム','画像解析','予測']},
      {label:'環境・資源・エネルギー',note:'気候、水、再エネ、地域の自然',fields:['環境'],keywords:['環境','気候','エネルギー','資源','汚染','再生可能','炭素']},
      {label:'からだ・健康・食',note:'運動、栄養、病気、生活習慣',fields:['医療・健康','生物'],keywords:['健康','運動','栄養','医療','睡眠','食品','病気']},
      {label:'心・人との関わり',note:'感情、行動、コミュニケーション',fields:['心理','社会科学'],keywords:['心理','感情','行動','対話','コミュニケーション','認知']},
      {label:'社会・地域・暮らし',note:'まち、経済、制度、身近な困りごと',fields:['社会科学'],keywords:['地域','社会','経済','制度','まちづくり','防災','交通']},
      {label:'文化・歴史・表現',note:'ことば、芸術、伝統、デザイン',fields:['人文','芸術'],keywords:['文化','歴史','言語','芸術','伝統','デザイン','表現']},
      {label:'学び・倫理・よりよい未来',note:'教育、価値観、技術と人の関係',fields:['社会科学','生命倫理'],keywords:['教育','学習','倫理','価値観','生命倫理','合意','権利']},
    ],
  },
  {
    title:'どんな進め方を試してみたいですか？',
    lead:'経験や得意・不得意で決める必要はありません。やってみたい方法を選んでください。',
    options:[
      {label:'観察して変化を追う',note:'形、動き、暮らしをじっくり記録する',fields:[],keywords:['観察','顕微鏡','形状','生態','記録','時系列']},
      {label:'条件を変えて実験する',note:'条件や対象を変えて結果を比べる',fields:[],keywords:['実験','条件','温度','濃度','比較','測定']},
      {label:'つくって試し、改良する',note:'装置、作品、サービス、仕組みをつくる',fields:[],keywords:['開発','改良','設計','製作','試作','デザイン']},
      {label:'データから傾向を探す',note:'統計、グラフ、公開データを使う',fields:[],keywords:['データ','解析','相関','分布','統計','予測']},
      {label:'現地へ行って調べる',note:'自然やまちで採集・調査をする',fields:[],keywords:['野外','採集','河川','地域','フィールド','調査']},
      {label:'人の話や資料から考える',note:'インタビュー、アンケート、文献を読む',fields:[],keywords:['インタビュー','アンケート','聞き取り','文献','史料','意識']},
    ],
  },
  {
    title:'どんな「問い」を追いかけたいですか？',
    lead:'ゴールは途中で変えても大丈夫です。今の気持ちに近いものを選んでください。',
    options:[
      {label:'なぜ起きるのか知りたい',note:'原因やしくみを明らかにする',fields:[],keywords:['原因','機構','メカニズム','形成','しくみ','解明']},
      {label:'違いや変化を確かめたい',note:'条件、時期、対象による違いを比べる',fields:[],keywords:['比較','影響','関係','変化','条件','差異']},
      {label:'もっとよくする方法を探したい',note:'性能、使いやすさ、仕組みを改善する',fields:[],keywords:['改良','性能','効率','精度','改善','最適']},
      {label:'まだ知られていないことを探したい',note:'未知の現象やパターンを見つける',fields:[],keywords:['未解明','未知','発見','新規','探索']},
      {label:'身近な困りごとを解決したい',note:'暮らしや地域、社会に役立てる',fields:[],keywords:['課題','地域','支援','活用','応用','解決']},
      {label:'当たり前を別の視点で考えたい',note:'価値観、表現、制度を問い直す',fields:[],keywords:['価値観','意識','文化','倫理','制度','表現']},
    ],
  },
  {
    title:'どんな道具や場所を使ってみたいですか？',
    lead:'まだ使えなくても構いません。道具が決まっていない場合はスキップできます。',
    options:[
      {label:'観察道具・生物試料',note:'顕微鏡、カメラ、植物や微生物',fields:[],keywords:['顕微鏡','細胞','試料','観察','微生物']},
      {label:'測定器・実験装置',note:'温度、音、光、電気などを測る',fields:[],keywords:['測定','センサー','装置','温度','圧力','電圧']},
      {label:'工作・材料・電子回路',note:'材料の性質を調べたり、装置をつくる',fields:[],keywords:['工作','回路','材料','製作','合成','結晶']},
      {label:'PC・プログラム・公開データ',note:'コード、画像、統計を使う',fields:[],keywords:['プログラム','画像解析','データ','シミュレーション','統計']},
      {label:'自然やまちのフィールド',note:'海、川、山、地域を歩いて調べる',fields:[],keywords:['河川','野外','採集','地域','フィールド','地質']},
      {label:'本・資料・人との対話',note:'図書館、史料、アンケート、聞き取り',fields:[],keywords:['文献','史料','インタビュー','アンケート','聞き取り','対話']},
    ],
  },
];

function compactDescription(text?:string){
  const cleaned=(text||'').replace(/【[^】]+】/g,' ').replace(/\s+/g,' ').trim();
  const first=cleaned.split(/(?<=[。！？])/)[0]||cleaned;
  return first.length>120?first.slice(0,120)+'…':first;
}

const buttonFocus='focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2';

export function ResearchThemeFinder<T extends FinderPaper>({papers,onOpen}:{papers:T[];onOpen:(paper:T)=>void}){
  const [step,setStep]=useState(0);
  const [answers,setAnswers]=useState<FinderOption[][]>(()=>questions.map(()=>[]));
  const [showResults,setShowResults]=useState(false);
  const [freeText,setFreeText]=useState('');
  const [appliedText,setAppliedText]=useState('');
  const [feedback,setFeedback]=useState<FinderFeedback>({});
  const [draftFeedback,setDraftFeedback]=useState<FinderFeedback>({});
  const [refinements,setRefinements]=useState<FinderOption[]>([]);
  const [hiddenIds,setHiddenIds]=useState<number[]>([]);
  const [message,setMessage]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);
  const published=useMemo(()=>papers.filter(p=>p.status==='公開中'),[papers]);
  const selections=useMemo(()=>answers.flat(),[answers]);
  const ranked=useMemo(()=>rankResearchPapers(published,{answers:[...selections,...refinements],freeText:appliedText,feedback}),[published,selections,refinements,appliedText,feedback]);
  const remaining=useMemo(()=>ranked.filter(row=>!hiddenIds.includes(row.paper.id)),[ranked,hiddenIds]);
  const visible=useMemo(()=>pickDiverseRecommendations(remaining,6),[remaining]);
  const inputTerms=appliedText.normalize('NFKC').toLowerCase().split(/[\s,、，;；]+/u).filter(Boolean);
  const hasTextMatch=ranked.some(row=>row.matchedTerms.some(term=>inputTerms.includes(term.normalize('NFKC').toLowerCase())));
  const pendingFeedback=JSON.stringify(feedback)!==JSON.stringify(draftFeedback);
  const interested=published.filter(p=>draftFeedback[p.id]==='interested');
  const dismissedCount=Object.values(draftFeedback).filter(v=>v==='dismissed').length;
  const refinementOptions=useMemo(()=>{
    const likedFields=new Set(published.filter(p=>feedback[p.id]==='interested').map(p=>p.field));
    if(!likedFields.size)return [];
    const social=[...likedFields].some(f=>/社会|倫理|人文|心理|芸術/.test(f));
    const options=questions[1].options;
    return social?[options[5],options[3],options[4]]:[options[1],options[0],options[2],options[3]];
  },[published,feedback]);

  const focusHeading=()=>requestAnimationFrame(()=>heading.current?.focus());
  const toggleAnswer=(option:FinderOption)=>setAnswers(current=>current.map((selected,i)=>i!==step?selected:selected.some(o=>o.label===option.label)?selected.filter(o=>o.label!==option.label):[...selected,option]));
  const showCandidates=()=>{setAppliedText(freeText.trim());setHiddenIds([]);setShowResults(true);setMessage('最初の候補です。気になる・今は違うを選んで、さらに探せます。');focusHeading();};
  const next=()=>{if(step===questions.length-1)showCandidates();else{setStep(n=>n+1);focusHeading();}};
  const skip=()=>{setAnswers(current=>current.map((selected,i)=>i===step?[]:selected));next();};
  const toggleFeedback=(id:number,value:'interested'|'dismissed')=>setDraftFeedback(current=>{
    const next={...current};
    if(next[id]===value)delete next[id];else next[id]=value;
    return next;
  });
  const update=()=>{if(pendingFeedback)setRefinements([]);setFeedback({...draftFeedback});setAppliedText(freeText.trim());setHiddenIds([]);setMessage('選んだ反応とキーワードで候補を更新しました。選び直しもできます。');};
  const clearFeedback=()=>{setFeedback({});setDraftFeedback({});setRefinements([]);setHiddenIds([]);setMessage('候補への反応を取り消しました。最初の回答とキーワードで表示しています。');};
  const reset=()=>{setStep(0);setAnswers(questions.map(()=>[]));setShowResults(false);setFreeText('');setAppliedText('');setFeedback({});setDraftFeedback({});setRefinements([]);setHiddenIds([]);setMessage('');focusHeading();};
  const refine=(option:FinderOption)=>{
    setRefinements(current=>current.some(o=>o.label===option.label)?current.filter(o=>o.label!==option.label):[...current,option]);
    setHiddenIds([]);setMessage('研究方法の希望を反映しました。もう一度押すと取り消せます。');
  };

  if(showResults)return <section className="space-y-6">
    <div className="rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-700 p-6 text-white md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[.18em] text-emerald-200">RESEARCH EXPLORER</p><h2 ref={heading} tabIndex={-1} className="mt-2 text-2xl font-extrabold outline-none md:text-3xl">候補を見ながら、興味を広げよう。</h2></div>
        <button type="button" onClick={()=>{setShowResults(false);setStep(0);focusHeading();}} className={`rounded-xl border border-white/30 px-4 py-2 text-xs font-bold hover:bg-white/10 ${buttonFocus}`}><SlidersHorizontal className="mr-2 inline h-4 w-4"/>回答を編集</button>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-emerald-50">最初の4問は入口です。気になる候補や「今は違う」を選んで、あなたの関心に近づけていきましょう。</p>
      <div className="mt-4 flex flex-wrap gap-2">{selections.length?selections.map(a=><span key={a.label} className="rounded-full bg-white/10 px-3 py-1.5 text-xs">{a.label}</span>):<span className="text-sm text-emerald-100">分野を決めずに、幅広く探しています</span>}</div>
    </div>

    <form onSubmit={event=>{event.preventDefault();update();}} className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
      <label htmlFor="research-interest" className="text-sm font-bold text-slate-900">選択肢になかった興味も教えてください</label>
      <p id="research-interest-help" className="mt-1 text-xs leading-6 text-slate-500">具体的なものや気になる言葉を追加できます。例：漆、磁性流体、睡眠、地域交通</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row"><input id="research-interest" aria-describedby="research-interest-help" value={freeText} maxLength={200} onChange={event=>setFreeText(event.target.value)} placeholder="キーワードを空白や「、」で区切る" className={`min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm ${buttonFocus}`}/><button type="submit" className={`rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 ${buttonFocus}`}>おすすめを更新</button></div>
      {(interested.length>0||dismissedCount>0)?<div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-500">選んだ反応</span>{interested.map(p=><button key={p.id} type="button" onClick={()=>toggleFeedback(p.id,'interested')} className={`inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 ${buttonFocus}`} aria-label={`${p.title}の気になるを取り消す`}><ThumbsUp className="h-3 w-3 shrink-0"/><span className="truncate">{p.title}</span><X className="h-3 w-3 shrink-0"/></button>)}{dismissedCount>0?<span className="text-xs text-slate-500">今は違う：{dismissedCount}件</span>:null}<button type="button" onClick={clearFeedback} className={`ml-auto rounded px-2 py-1 text-xs text-slate-600 underline ${buttonFocus}`}>反応をすべて取り消す</button></div>:null}
      {pendingFeedback?<div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 p-3"><p className="flex-1 text-xs text-emerald-900">反応を選びました。更新すると候補の並びに反映します。</p><button type="button" onClick={update} className={`rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white ${buttonFocus}`}>選んだ反応でおすすめを更新</button></div>:null}
      {refinementOptions.length>0?<fieldset className="mt-5 border-t border-slate-100 pt-4"><legend className="pt-4 text-sm font-bold text-slate-800">気になる研究を、どう進めてみたい？</legend><p className="mt-1 text-xs text-slate-500">選んだ研究分野に合わせた追加の質問です。複数選択・スキップできます。</p><div className="mt-3 flex flex-wrap gap-2">{refinementOptions.map(option=><button key={option.label} type="button" aria-pressed={refinements.some(o=>o.label===option.label)} onClick={()=>refine(option)} className={`rounded-full border px-3 py-2 text-xs font-bold ${buttonFocus} ${refinements.some(o=>o.label===option.label)?'border-emerald-600 bg-emerald-50 text-emerald-800':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{option.label}</button>)}</div></fieldset>:null}
    </form>

    <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-extrabold text-slate-900">今の興味から見つける候補</h3><p className="mt-1 text-xs leading-6 text-slate-500">公開研究 {published.length}件が対象です。分野を限定せず、近い研究と別の入口を探します。</p></div><button type="button" onClick={reset} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-600 underline ${buttonFocus}`}><RotateCcw className="h-3.5 w-3.5"/>最初から探す</button></div>
    <p role="status" aria-live="polite" className="text-sm text-emerald-800">{message}</p>
    {appliedText&&ranked.length>0&&!hasTextMatch?<p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">入力したキーワードに一致する研究は見つかりませんでした。回答に近い研究や別の入口を表示しています。言葉を短くしたり、別の表現でも試せます。</p>:null}

    {visible.length?<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(row=>{
      const sourceTitle=row.paper.title;
      const themeTitle=row.suggestion?.title||row.paper.aiAnalysis?.title||sourceTitle;
      const selected=draftFeedback[row.paper.id];
      return <article key={row.paper.id} className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm ${selected==='interested'?'border-emerald-500 ring-1 ring-emerald-200':selected==='dismissed'?'border-slate-300 bg-slate-50':'border-slate-200'}`}>
        <div className="flex-1 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.matchKind==='related'?'bg-emerald-50 text-emerald-800':'bg-violet-50 text-violet-800'}`}>{row.matchKind==='related'?'回答・反応に近い候補':'視野を広げる候補'}</span><span className="text-xs font-bold text-slate-500">{row.paper.field}</span></div><p className="mt-4 text-[11px] font-bold tracking-wide text-emerald-700">{row.suggestion?'この研究から広げるテーマ':'公開研究からの入口'}</p><h4 className="mt-1 break-words text-base font-extrabold leading-7 text-slate-900">{themeTitle}</h4><p className="mt-3 text-xs leading-6 text-slate-600">{compactDescription(row.suggestion?.description||row.paper.abstract)||'元論文の問い・方法・結果を読み、自分が気になる点を探してみましょう。'}</p><div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-[11px] font-bold text-slate-600">候補に出した理由</p><ul className="mt-1 space-y-1">{row.reasons.slice(0,2).map(reason=><li key={reason} className="text-xs leading-5 text-slate-600">{reason}</li>)}</ul></div></div>
        <div className="border-t border-slate-100 p-5"><p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500"><BookOpen className="h-3.5 w-3.5"/>出発点になった公開研究</p><p className="mt-2 line-clamp-2 text-xs font-bold leading-6 text-slate-800">{sourceTitle}</p><p className="mt-1 text-[11px] text-slate-500">{row.paper.schoolNameOverride?.trim()||row.paper.schoolName} / {row.paper.author}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" aria-pressed={selected==='interested'} onClick={()=>toggleFeedback(row.paper.id,'interested')} className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-bold ${buttonFocus} ${selected==='interested'?'border-emerald-600 bg-emerald-50 text-emerald-800':'border-slate-200 text-slate-600 hover:bg-emerald-50'}`}><ThumbsUp className="h-3.5 w-3.5"/>気になる</button><button type="button" aria-pressed={selected==='dismissed'} onClick={()=>toggleFeedback(row.paper.id,'dismissed')} className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-bold ${buttonFocus} ${selected==='dismissed'?'border-slate-500 bg-slate-100 text-slate-800':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><X className="h-3.5 w-3.5"/>今は違う</button></div><button type="button" onClick={()=>onOpen(row.paper)} className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 ${buttonFocus}`}>元論文を読んでみる<ArrowRight className="h-4 w-4"/></button></div>
      </article>;
    })}</div>:<div className="rounded-2xl border bg-white p-8 text-center"><p className="text-sm text-slate-600">{published.length===0?'公開研究がまだ読み込まれていないか、公開中の研究がありません。':'今の条件で表示できる候補を見終えました。反応を取り消すか、回答を変えて探せます。'}</p>{hiddenIds.length>0?<button type="button" onClick={()=>{setHiddenIds([]);setMessage('候補を最初から表示しています。');}} className={`mt-4 rounded-xl border px-4 py-2 text-sm font-bold ${buttonFocus}`}>候補を最初から表示</button>:null}</div>}
    {visible.length>0?<div className="text-center"><button type="button" disabled={remaining.length<=visible.length} onClick={()=>{setHiddenIds(current=>[...current,...visible.map(row=>row.paper.id)]);setMessage('まだ見ていない候補を表示しました。');}} className={`inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 ${buttonFocus}`}><Compass className="h-4 w-4"/>ほかの候補も見る</button>{hiddenIds.length>0?<button type="button" onClick={()=>{setHiddenIds([]);setMessage('候補を最初から表示しています。');}} className={`ml-3 rounded px-2 py-2 text-xs text-slate-500 underline ${buttonFocus}`}>最初の候補に戻る</button>:null}</div>:null}
    <div className="flex gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-5"><Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-violet-600"/><p className="text-xs leading-6 text-violet-900">これは適性を決める診断ではありません。登録されている公開研究の範囲で提案しています。元論文を読み、対象や条件を変えながら自分の問いに育ててください。反応や回答は、この画面を離れるまでの探索に使います。</p></div>
  </section>;

  const q=questions[step];
  const selected=answers[step];
  return <section className="mx-auto max-w-5xl space-y-6">
    <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-700 p-6 text-white md:p-8"><p className="text-xs font-bold tracking-[.18em] text-emerald-200">RESEARCH EXPLORER</p><h2 className="mt-2 text-2xl font-extrabold md:text-3xl">まだ決まっていない興味から、研究を探そう。</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-emerald-50">まずは4つの質問から。複数選んでも、わからない質問を飛ばしても大丈夫。候補を見てから、さらに絞り込めます。</p></div>
      <div className="p-5 md:p-8"><div className="flex items-center justify-between text-xs font-bold text-slate-500"><span>入口の質問 {step+1} / {questions.length}</span><span>複数選択OK</span></div><div className="mt-3 flex gap-2" aria-hidden="true">{questions.map((_,i)=><div key={i} className={`h-1.5 flex-1 rounded-full ${i<=step?'bg-emerald-500':'bg-slate-100'}`}/>)}</div><h3 ref={heading} tabIndex={-1} className="mt-7 text-xl font-extrabold text-slate-900 outline-none md:text-2xl">{q.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{q.lead}</p><div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">{q.options.map(option=>{
        const checked=selected.some(o=>o.label===option.label);
        return <button type="button" key={option.label} aria-pressed={checked} onClick={()=>toggleAnswer(option)} className={`min-h-[96px] rounded-2xl border p-4 text-left transition ${buttonFocus} ${checked?'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-200':'border-slate-200 bg-slate-50/50 hover:border-emerald-300 hover:bg-emerald-50'}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${checked?'border-emerald-600 bg-emerald-600 text-white':'border-slate-300 bg-white'}`}>{checked?<Check className="h-4 w-4"/>:null}</span><div><p className="font-bold text-slate-900">{option.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{option.note}</p></div></div></button>;
      })}</div>{step===questions.length-1?<div className="mt-6"><label htmlFor="research-keywords-start" className="text-sm font-bold text-slate-800">ほかにも気になる言葉があれば（任意）</label><input id="research-keywords-start" maxLength={200} value={freeText} onChange={event=>setFreeText(event.target.value)} placeholder="例：漆、磁性流体、睡眠、地域交通" className={`mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm ${buttonFocus}`}/></div>:null}<div className="mt-7 flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={step===0} onClick={()=>{setStep(n=>n-1);focusHeading();}} className={`inline-flex items-center gap-1 rounded-xl px-2 py-2 text-xs font-bold text-slate-600 disabled:invisible ${buttonFocus}`}><ArrowLeft className="h-4 w-4"/>前の質問</button><div className="flex flex-wrap gap-2"><button type="button" onClick={skip} className={`rounded-xl px-3 py-3 text-xs font-bold text-slate-500 hover:bg-slate-50 ${buttonFocus}`}>まだ決まっていない・スキップ</button><button type="button" onClick={next} className={`inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 ${buttonFocus}`}>{step===questions.length-1?'候補を見てみる':'次へ'}<ArrowRight className="h-4 w-4"/></button></div></div><p className="mt-5 flex items-center gap-2 text-xs text-slate-500"><Search className="h-4 w-4"/>全分野の公開研究 {published.length}件から探します</p></div>
    </div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{[{icon:BookOpen,title:'分野をまたいで探す',text:'自然科学から社会・文化まで、公開されている研究を対象に。'},{icon:Compass,title:'反応しながら近づける',text:'「気になる」「今は違う」で、おすすめを更新できます。'},{icon:CheckCircle2,title:'元論文までたどれる',text:'候補の理由を確認し、出発点の研究を読めます。'}].map(({icon:Icon,title,text})=><div key={title} className="rounded-2xl border bg-white p-4"><Icon className="h-5 w-5 text-emerald-600"/><p className="mt-2 text-sm font-bold text-slate-900">{title}</p><p className="mt-1 text-xs leading-6 text-slate-500">{text}</p></div>)}</div>
  </section>;
}
