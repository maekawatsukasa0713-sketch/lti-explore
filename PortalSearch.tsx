import React, {useState} from 'react';
import {Search} from 'lucide-react';

export function PortalSearch({enabled,onSearch}:{enabled:boolean;onSearch:(query:string)=>void}) {
  const [query,setQuery]=useState('');
  if(!enabled)return null;
  return <form role="search" className="relative w-full flex items-center" onSubmit={event=>{event.preventDefault();onSearch(query.trim());}}>
    <input aria-label="公開論文を検索" value={query} onChange={event=>setQuery(event.target.value)} maxLength={500} placeholder="公開論文を検索…" className="w-full pl-3 pr-10 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm"/>
    <button type="submit" aria-label="公開論文の検索を実行" className="absolute right-2 p-1 text-gray-500 hover:text-emerald-700"><Search className="w-4 h-4"/></button>
  </form>;
}
