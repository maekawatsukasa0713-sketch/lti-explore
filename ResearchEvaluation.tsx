export const criteria=['問い・着眼点','再現性','手法の妥当性','論理の一貫性','発展性'] as const;
export type EvaluationItem={score:1|2|3|4|null;reason:string;evidence:string;nextStep:string};
export type Evaluation={items:EvaluationItem[]};
export const levels=['','これから整理','基礎が見える','十分に示される','丁寧に深められている'];
export function ResearchEvaluation({value,onChange,disabled=false}:{value?:Evaluation;onChange?:(v:Evaluation)=>void;disabled?:boolean}){
 const items=criteria.map((_,i)=>value?.items[i]||{score:null,reason:'',evidence:'',nextStep:''});
 const point=(i:number,r:number)=>{const a=-Math.PI/2+i*Math.PI*2/5;return [150+Math.cos(a)*r,140+Math.sin(a)*r];};
 const points=(r:number)=>criteria.map((_,i)=>point(i,r).join(',')).join(' ');
 const complete=items.every(x=>x.score!==null);
 function update(i:number,patch:Partial<EvaluationItem>){onChange?.({items:items.map((v,j)=>j===i?{...v,...patch}:v)});}
 return <section className="bg-white border border-violet-200 rounded-2xl p-4 space-y-4">
 <h3 className="font-bold text-violet-900">研究の5つの観点</h3>
 <p className="text-xs text-slate-600 leading-relaxed">本文に基づく4段階の参考評価です。研究や著者の優劣・成績を決めるものではありません。着眼点の価値と、データが支える結論の範囲を分けて確認します。</p>
 <svg viewBox="0 0 300 275" role="img" aria-label="研究の5観点チャート。各評価は下の一覧にも記載しています。" className="w-full max-w-sm mx-auto">
 {[1,2,3,4].map(n=><polygon key={n} points={points(n*24)} fill="none" stroke="#ddd6fe"/>)}
 {criteria.map((name,i)=>{const [x,y]=point(i,96);const [tx,ty]=point(i,119);return <g key={name}><line x1="150" y1="140" x2={x} y2={y} stroke="#ddd6fe"/><text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#5b21b6">{name}</text></g>;})}
 {complete&&<polygon points={items.map((v,i)=>point(i,v.score!*24).join(',')).join(' ')} fill="#8b5cf633" stroke="#7c3aed" strokeWidth="2"/>}
 {items.map((v,i)=>v.score!==null&&<circle key={i} cx={point(i,v.score*24)[0]} cy={point(i,v.score*24)[1]} r="4" fill="#7c3aed"/>)}
 </svg>
 {!complete&&<p className="text-xs text-slate-500">未評価・判断保留の項目は点を表示しません。全5項目が揃うと五角形で表示します。</p>}
 <p className="text-xs text-slate-500">1：これから整理 ／ 2：基礎が見える ／ 3：十分に示される ／ 4：丁寧に深められている</p>
 {items.map((v,i)=><div key={criteria[i]} className="border-t pt-3 space-y-2 text-sm">
 <div className="flex justify-between gap-2 items-center"><h4 className="font-bold">{i+1}. {criteria[i]}</h4>{onChange?<select aria-label={criteria[i]+'の評価'} disabled={disabled} value={v.score??''} onChange={e=>update(i,{score:e.target.value?Number(e.target.value) as EvaluationItem['score']:null})} className="border rounded p-2"><option value="">判断保留</option>{[1,2,3,4].map(n=><option key={n} value={n}>{n}：{levels[n]}</option>)}</select>:<span className="text-violet-700 font-bold">{v.score? v.score+'/4':'未評価・判断保留'}</span>}</div>
 {onChange&&(['reason','evidence','nextStep'] as const).map(k=><div key={k}><label className="text-xs font-bold text-slate-500">{k==='reason'?'評価理由・良い点':k==='evidence'?'本文の根拠（ページ・節など）':'さらに確かめたい点'}{onChange?<textarea disabled={disabled} value={v[k]} onChange={e=>update(i,{[k]:e.target.value})} className="block mt-1 w-full border rounded-lg p-2 text-sm text-slate-800" rows={2}/>:<p className="mt-1 text-sm text-slate-700 font-normal whitespace-pre-wrap">{v[k]||'未記載'}</p>}</label></div>)}
 </div>)}</section>;
}
