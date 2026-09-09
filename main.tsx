import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
class AppBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<main className="min-h-screen bg-gray-50 flex items-center justify-center p-6"><section className="bg-white border rounded-2xl max-w-md p-8 space-y-4"><h1 className="text-xl font-bold">画面を表示できませんでした</h1><p className="text-sm">表示処理でエラーが発生しました。再読み込みしても続く場合は、この画面をLTI運営へお知らせください。</p><button className="bg-emerald-600 text-white rounded-xl px-4 py-3" onClick={()=>window.location.reload()}>再読み込み</button></section></main>:this.props.children;}
}
createRoot(document.getElementById('root')!).render(<AppBoundary><App/></AppBoundary>);
