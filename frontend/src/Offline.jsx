import React,{useEffect,useState} from 'react';
import {useLocale} from './locale';
import {useApp} from './context';
import {api,BASE} from './api';

const format=n=>n>0?`${(n/1024**3).toFixed(2)} GB`:'—';
export async function saveOffline(src,details,onProgress=()=>{}){
  const {downloadOfflineVideo}=await import(/* @vite-ignore */ window.location.origin + '/offline-store.js');
  return downloadOfflineVideo({src, ...details, onProgress});
}
export default function Offline(){
  const {profile,notify}=useApp();const {t}=useLocale();
  const [items,setItems]=useState([]);const [local,setLocal]=useState([]);const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(null);
  const refresh=async()=>{
    const [library,media,store]=await Promise.all([api('/api/library').catch(()=>({items:[]})),api('/api/local-media').catch(()=>({items:[]})),import(/* @vite-ignore */ window.location.origin + '/offline-store.js').then(m=>m.listOfflineVideos()).catch(()=>[])]);
    setItems([...(library.items||[]).map(x=>({...x,kind:'library'})),...(media.items||media.media||[]).map(x=>({...x,kind:'media'}))]);setLocal(store);
  };
  useEffect(()=>{refresh().catch(()=>{});},[profile?.id]);
  const save=async item=>{
    const id=item.id, src=`${BASE}/api/${item.kind==='media'?'local-media':'library'}/stream/${id}`;
    setBusy(`${item.kind}:${id}`);setStatus(t('Preparing offline download…'));
    try {await saveOffline(src,{title:item.title||item.fileName,profileId:profile.id,profileName:profile.name},({downloaded,total})=>setStatus(`${format(downloaded)} / ${format(total)}`));notify(t('Video saved for offline playback.'));await refresh();}
    catch(e){notify(e.message);}finally{setBusy(null);setStatus('');}
  };
  return <main className="mx-auto max-w-5xl px-4 py-8 text-white sm:px-8"><h1 className="mb-3 text-3xl font-bold">{t('Offline downloads')}</h1>
    <p className="mb-5 text-sm text-white/65">{t('Save a video to this device while online. Open the offline player to watch without Wi-Fi. Large downloads need free phone storage and can be removed by the browser.')}</p>
    <a className="mb-6 inline-block rounded bg-white px-4 py-2 font-bold text-black" href="/offline.html">{t('Open offline player')}</a>
    {status&&<p role="status" className="my-3 text-sm">{status}</p>}
    <h2 className="mb-3 mt-5 text-xl font-bold">{t('On this device')} ({local.length})</h2>
    <div className="mb-7 space-y-2">{local.map(x=><div key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white/10 p-3"><span>{x.title} · {format(x.bytes)}</span><a href="/offline.html" className="underline">{t('Play offline')}</a></div>)}</div>
    <h2 className="mb-3 text-xl font-bold">{t('Available to download')} ({items.length})</h2>
    <div className="space-y-2">{items.map(x=><div key={`${x.kind}:${x.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white/10 p-3"><span className="min-w-0 break-words">{x.title||x.fileName||'Video'}</span><button disabled={Boolean(busy)} onClick={()=>save(x)} className="rounded bg-white px-3 py-2 text-sm font-bold text-black disabled:opacity-50">{busy===`${x.kind}:${x.id}`?t('Downloading…'):t('Save offline')}</button></div>)}</div>
    {!items.length&&<p className="mt-4 text-white/60">{t('Save media to the server or scan the local folder first.')}</p>}
  </main>;
}
