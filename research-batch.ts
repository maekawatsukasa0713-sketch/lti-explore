export type BatchProgress={total:number;started:number;active:number;saved:number;inputFailed:number;failed:number;stopReason:string};
export async function runResearchBatch(ids:number[],analyze:(id:number)=>Promise<unknown>,shouldStop:()=>boolean,onProgress:(progress:BatchProgress)=>void){
 const queue=[...new Set(ids)];let cursor=0,consecutiveFailures=0;
 const state:BatchProgress={total:queue.length,started:0,active:0,saved:0,inputFailed:0,failed:0,stopReason:''};
 const report=()=>onProgress({...state});
 async function worker(){
  while(cursor<queue.length){
   if(shouldStop()||state.stopReason)break;
   const id=queue[cursor++];state.started++;state.active++;report();
   try{await analyze(id);state.saved++;consecutiveFailures=0;}
   catch(error){
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
 report();await Promise.all(Array.from({length:Math.min(3,queue.length)},()=>worker()));
 if(shouldStop()&&!state.stopReason)state.stopReason='停止の指示により、残りの処理を停止しました。';
 report();return {...state};
}
