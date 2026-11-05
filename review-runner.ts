export const sections=['corrections','advice','nextExperiments'] as const;
export type ReviewKey=typeof sections[number];
type Result=Record<ReviewKey,string[]>&{title?:string;basis?:string;generatedAt?:string};
type State={input?:Record<string,unknown>;split:boolean;parts:Partial<Record<ReviewKey,string[]>>;result?:Result;pending?:Promise<Result>;retryAt?:number;lastError?:unknown};
const sessions=new WeakMap<object,Map<string,State>>();
const labels={corrections:'修正点',advice:'助言',nextExperiments:'追加研究案'};
export function runReview(file:object,scope:string,prepare:()=>Promise<Record<string,unknown>>,invoke:(input:Record<string,unknown>,section?:ReviewKey)=>Promise<Result>,progress:(text:string,partial?:Partial<Result>)=>void,force=false):Promise<Result>{
 let users=sessions.get(file);if(!users){users=new Map();sessions.set(file,users);}let state=users.get(scope);
 if(state?.pending)return state.pending;
 if(state?.retryAt&&Date.now()<state.retryAt)return Promise.reject(state.lastError);
 if(!state||force){state={split:false,parts:{}};users.set(scope,state);}const current=state;
 if(current.result)return Promise.resolve(current.result);
 const task=async()=>{
  if(!current.input){progress('原稿を読み取っています');current.input=await prepare();}
  if(!current.split){
   progress('修正点・助言・追加研究案を解析しています');
   try{current.result=await invoke(current.input);return current.result;}
   catch(e){const failure=e as {retryable?:boolean;code?:string;retryAfterMs?:number};if(!failure?.retryable||['anthropic_429','rate_limited'].includes(failure.code||'')||(failure.retryAfterMs??0)>0)throw e;current.split=true;}
  }
  for(const key of sections){
   if(current.parts[key])continue;
   progress(`項目別に解析中：${labels[key]}（完了 ${Object.keys(current.parts).length}/3）`,current.parts);
   // Each section has its own request deadline. Complete sections survive retry in this screen.
   const result=await invoke(current.input,key);
   current.parts[key]=result[key];progress(`${labels[key]}を保持しました（完了 ${Object.keys(current.parts).length}/3）`,current.parts);
  }
  current.result={corrections:current.parts.corrections!,advice:current.parts.advice!,nextExperiments:current.parts.nextExperiments!,basis:String(current.input.basis||''),generatedAt:new Date().toISOString()};
  return current.result;
 };
 current.pending=task().catch(error=>{const delay=(error as {retryAfterMs?:number})?.retryAfterMs;if(typeof delay==='number'&&Number.isFinite(delay)&&delay>0){current.retryAt=Date.now()+Math.min(delay,86400000);current.lastError=error;}throw error;}).finally(()=>{current.pending=undefined;});return current.pending;
}
