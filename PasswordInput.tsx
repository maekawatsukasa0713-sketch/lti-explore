import React,{useState} from 'react';
export function PasswordInput(props:React.InputHTMLAttributes<HTMLInputElement>){
 const [visible,setVisible]=useState(false);
 return <span className="block"><input {...props} type={visible?'text':'password'}/><button type="button" aria-pressed={visible} onClick={()=>setVisible(v=>!v)} className="mt-1 text-xs underline">{visible?'パスワードを隠す':'パスワードを表示'}</button></span>;
}
