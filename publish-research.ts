import {supabase} from './client';
export async function publishResearch(id:number){
 const {data:row,error}=await supabase.from('lti_records').select('data,version').eq('kind','papers').eq('id',String(id)).single();if(error)throw error;
 let paper=row.data;
 if(paper.status!=='公開中'){paper={...paper,status:'公開中',publishedDate:new Date().toISOString().slice(0,10)};const saved=await supabase.rpc('lti_save_records',{ops:[{action:'update',kind:'papers',id:String(id),data:paper,version:row.version}]});if(saved.error)throw saved.error;}
 return '公開しました。AI解析機能は配備準備中です。';
}
