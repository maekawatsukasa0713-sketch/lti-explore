export async function issueAccountBatches(count:number,issue:(count:number,requestId:string)=>Promise<{credentials:any[];failures?:any[]}>,progress:(credentials:any[],done:number,failures:any[])=>void,stopped:()=>boolean){
 if(!Number.isInteger(count)||count<1||count>1000)throw new Error('発行人数は1〜1,000人です。');
 const credentials:any[]=[],failures:any[]=[];let done=0;
 while(done<count&&!stopped()){
  const amount=Math.min(10,count-done);
  // Never automatically retry an uncertain response: the server may already have issued these IDs.
  const response=await issue(amount,crypto.randomUUID());
  credentials.push(...response.credentials);failures.push(...(response.failures||[]));done+=amount;
  progress([...credentials],done,[...failures]);
  if(response.failures?.length)break;
 }
 return {credentials,failures,done};
}
