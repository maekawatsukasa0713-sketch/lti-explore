// Edge gateways may return {code,message} instead of the search function's {error,warnings}.
// Classify those responses without showing raw gateway bodies or losing partial results.
export async function searchFailureMessage(failure:{context?:Response}):Promise<string>{
  const status=failure.context?.status;
  let body:any;
  try{body=await failure.context?.json();}catch{}
  if(status===401||body?.code==='INVALID_JWT'||body?.code==='JWT_EXPIRED')return 'ログインの有効期限が切れた可能性があります。ログインし直して検索してください。';
  if(status===403)return 'この学校またはアカウントでは学術論文検索を利用できません。';
  if(status===429)return '検索の利用回数制限に達しました。時間をおいて再検索してください。';
  if(typeof body?.error==='string'&&body.error.trim())return body.error.slice(0,300);
  if(Array.isArray(body?.warnings)&&body.warnings.some((value:unknown)=>typeof value==='string'))return body.warnings.filter((value:unknown)=>typeof value==='string').slice(0,4).join(' / ').slice(0,500);
  if(status===504)return '検索処理がタイムアウトしました。時間をおいて再検索してください。';
  if(status&&status>=500)return '検索サービスが一時的に応答できません。時間をおいて再検索してください。';
  return '検索先に接続できませんでした。通信状態を確認して再検索してください。';
}
