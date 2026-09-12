import React,{useEffect,useState} from 'react';
import {supabase} from './client';
export type FeatureMode='enabled'|'hidden'|'planned'|'premium';
export type FeatureSettings=Record<string,FeatureMode>;
export const FEATURE_TABS={teacher:['ホーム','学会・コンテスト','みんなの論文','教材','課題配信','進捗管理','探究論文の公開申請','AI添削','アカウント設定'],student:['ホーム','課題・提出物','教材','学会・コンテスト','みんなの論文','学術論文の検索','先生からのフィードバック','アカウント設定']};
export function featureMode(settings:FeatureSettings|undefined,role:string,tab:string):FeatureMode {return role==='admin'?'enabled':settings?.[role+':'+tab]||'enabled';}
export function FeatureUnavailable({mode}:{mode:FeatureMode}){return <div className="bg-white border rounded-2xl p-8"><h2 className="text-xl font-bold">{mode==='planned'?'今後実装予定':mode==='premium'?'プレミアム機能':'この機能は利用できません'}</h2><p className="mt-3 text-sm text-gray-500">利用については学校の担当者またはLTI運営へお問い合わせください。</p></div>;}
export function FeatureEditor({value,onChange,role}:{value:FeatureSettings;onChange:(v:FeatureSettings)=>void;role:'teacher'|'student'}){
 return <div className="w-full border rounded-xl p-4 space-y-3"><h3 className="font-bold">学校共通の利用タブ（{role==='teacher'?'教員':'生徒'}）</h3><p className="text-xs">既存アカウントにも適用されます。未設定の学校は従来どおり全機能を利用できます。</p>{FEATURE_TABS[role].map(tab=>{const key=role+':'+tab;const mode=value[key]||'enabled';return <div key={tab} className="flex items-center justify-between gap-4 text-sm"><label><input type="checkbox" checked={mode==='enabled'} onChange={e=>onChange({...value,[key]:e.target.checked?'enabled':'hidden'})}/> {tab}</label>{mode!=='enabled'&&<select aria-label={tab+'の表示方法'} value={mode} onChange={e=>onChange({...value,[key]:e.target.value as FeatureMode})}><option value="hidden">表示しない</option><option value="planned">今後実装予定</option><option value="premium">プレミアム</option></select>}</div>;})}</div>;
}
export async function saveFeatures(schoolId:string,settings:FeatureSettings){if(!schoolId)throw new Error('学校を選択してください。');const {data,error}=await supabase.from('lti_schools').update({feature_settings:settings}).eq('id',schoolId).select('id');if(error)throw error;if(!data?.length)throw new Error('学校の機能設定を保存できませんでした。');}
