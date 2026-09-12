export async function claimPaper(base:string,headers:Record<string,string>,id:string){
 const read=async()=>{const r=await fetch(base+'/rest/v1/lti_records?'+new URLSearchParams({kind:'eq.papers',id:'eq.'+id,select:'data,version'}),{headers,signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('研究成果の取得に失敗しました。');return (await r.json())[0];};
 const write=async(data:unknown,version:number)=>{const r=await fetch(base+'/rest/v1/rpc/lti_save_records',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({ops:[{action:'update',kind:'papers',id,data,version}]}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('解析の保存が競合しました。再読み込みしてください。');};
 const row=await read();if(!row||row.data.status!=='公開中')throw new Error('LTIが公開を承認した成果を指定してください。');
 if(row.data.aiAnalysis)return {result:row.data.aiAnalysis};
 if(row.data.aiState)throw new Error('この成果は解析開始済みです。重複課金を防ぐため自動で再実行しません。');
 const claim=crypto.randomUUID();await write({...row.data,aiState:{state:'processing',claim,startedAt:new Date().toISOString()}},row.version);
 return {finish:async(result:unknown)=>{const current=await read();if(!current||current.data.aiState?.claim!==claim||current.data.storagePath!==row.data.storagePath)throw new Error('解析中に原稿が変更されました。');await write({...current.data,aiAnalysis:result,aiState:{state:'ready',claim}},current.version);}};
}
