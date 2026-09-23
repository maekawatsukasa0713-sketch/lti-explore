export const RESEARCH_CONCURRENCY=5;
export type BatchProgress={total:number;started:number;active:number;saved:number;inputFailed:number;failed:number;stopReason:string;retryAt:number};
export async function runResearchBatch(ids:number[],analyze:(id:number)=>Promise<unknown>,shouldStop:()=>boolean,onProgress:(progress:BatchProgress)=>void,clock={now:()=>Date.now(),sleep:(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))}){
 const queue=[...new Set(ids)];let cursor=0,consecutiveFailures=0;
 const state:BatchProgress={total:queue.length,started:0,active:0,saved:0,inputFailed:0,failed:0,stopReason:'',retryAt:0};
 const report=()=>onProgress({...state});
 async function waitForCapacity(){
  while(clock.now()<state.retryAt){if(shouldStop()||state.stopReason)return false;await clock.sleep(Math.min(250,state.retryAt-clock.now()));}
  return !shouldStop()&&!state.stopReason;
 }
 async function worker(){
  while(cursor<queue.length){
   if(!await waitForCapacity())break;
   if(cursor>=queue.length)break;
   const id=queue[cursor++];state.started++;state.active++;report();
   try{
    for(let retry=0;;retry++){
     try{await analyze(id);state.saved++;consecutiveFailures=0;break;}
     catch(error){
      const reason=error instanceof Error?error.message:'';
      // Retry only a definitive provider rejection, never an ambiguous timeout or pending job.
      if(!/anthropic_429/.test(reason)||retry>=2)throw error;
      state.retryAt=Math.max(state.retryAt,clock.now()+60000*(retry+1));report();
      if(!await waitForCapacity())throw error;
     }
    }
   }catch(error){
    if((error as {inputError?:boolean})?.inputError){state.inputFailed++;}
    else{
     state.failed++;consecutiveFailures++;
     const reason=error instanceof Error?error.message:'AI解析に失敗しました。';
     if(/利用上限|（quota）|anthropic_429|再ログイン|ログインしてください|認証期限|開始済み|サーバー側で処理を続け/.test(reason))state.stopReason=reason;
     else if(consecutiveFailures>=3&&!state.stopReason)state.stopReason='AI解析が連続3件失敗したため停止しました。';
    }
   }finally{state.active--;report();}
  }
 }
 report();await Promise.all(Array.from({length:Math.min(RESEARCH_CONCURRENCY,queue.length)},()=>worker()));
 if(shouldStop()&&!state.stopReason)state.stopReason='停止の指示により、残りの処理を停止しました。';
 report();return {...state};
}
