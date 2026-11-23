import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {useLocale} from './locale';

const EMPTY={items:[],unread:0};
const routeFor = destination => ['library','community','home'].includes(destination) ? destination : 'home';

export default function NotificationBell({onNavigate}) {
  const {t}=useLocale();
  const [data,setData]=useState(EMPTY);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const root=useRef(null);
  useEffect(()=>{
    let active=true;
    const refresh=()=>{
      if(document.visibilityState==='hidden')return;
      api('/api/notifications').then(x=>{if(active)setData(x);}).catch(()=>{});
    };
    refresh();
    const timer=setInterval(refresh,45000);
    const visibility=()=>refresh();
    document.addEventListener('visibilitychange',visibility);
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  useEffect(()=>{
    if(!open)return undefined;
    const close=e=>{if(root.current&&!root.current.contains(e.target))setOpen(false);};
    const escape=e=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',close);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[open]);
  async function mark(input) {
    try {setError('');setData(await api('/api/notifications/read',{method:'POST',body:input}));}
    catch(e){setError(e.message);}
  }
  const view=async item=>{
    if(!item.readAt)await mark({id:item.id});
    setOpen(false);
    onNavigate(routeFor(item.destination));
  };
  return <div className="relative shrink-0" ref={root}>
    <button type="button" aria-label={t('Notifications')} aria-expanded={open} title={t('Notifications')}
      onClick={()=>setOpen(v=>!v)} className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
      {data.unread>0&&<span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[#e50914] px-0.5 text-center text-[10px] font-bold" aria-label={`${data.unread} ${t('unread')}`}>{data.unread>9?'9+':data.unread}</span>}
    </button>
    {open&&<div className="absolute right-[-95px] top-11 z-[120] w-[min(92vw,370px)] overflow-hidden rounded-lg border border-white/20 bg-[#161616] text-white shadow-2xl sm:right-0" role="region" aria-label={t('Notifications')}>
      <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
        <h2 className="text-base font-semibold">{t('Notifications')}</h2>
        {data.unread>0&&<button type="button" onClick={()=>mark({all:true})} className="text-xs text-[#b3b3b3] hover:text-white">{t('Mark all read')}</button>}
      </div>
      <div className="max-h-[min(65vh,440px)] overflow-y-auto">
        {data.items.length===0?<p className="p-5 text-sm text-white/60">{t('No notifications yet.')}</p>:
        data.items.map(item=><button key={item.id} type="button" onClick={()=>view(item)} className={`block w-full border-b border-white/10 px-4 py-3 text-left transition-colors hover:bg-white/10 ${item.readAt?'opacity-70':'bg-white/[0.06]'}`}>
          <div className="flex items-start gap-2"><span className="flex-1 text-sm font-semibold">{t(item.title)}</span>{!item.readAt&&<span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#e50914]"/>}</div>
          <p className="mt-1 text-xs leading-relaxed text-[#b3b3b3]">{item.message}</p>
          <time className="mt-1 block text-[11px] text-white/45" dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time>
        </button>)}
      </div>
      {error&&<p role="alert" className="px-4 py-2 text-xs text-rose-300">{error}</p>}
    </div>}
  </div>;
}
