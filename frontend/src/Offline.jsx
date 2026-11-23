import React, {useEffect,useRef,useState} from 'react';
import {useLocale} from './locale';
import {useApp} from './context';
import {api,BASE} from './api';

const format = n => Number.isFinite(n) ? `${(n / 1024**3).toFixed(2)} GB` : '—';
const store = () => import(/* @vite-ignore */ window.location.origin + '/offline-store.js');
export async function saveOffline(src, details, onProgress = () => {}) {
  const {downloadOfflineVideo} = await store();
  return downloadOfflineVideo({src,...details,onProgress});
}
export default function Offline(){
  const {profile,notify} = useApp(), {t} = useLocale();
  const [items,setItems] = useState([]), [local,setLocal] = useState([]), [pending,setPending] = useState([]);
  const [status,setStatus] = useState(''), [busy,setBusy] = useState(null), [storage,setStorage] = useState(null);
  const [budget,setBudget] = useState(10);
  const controller = useRef(null);
  const refresh = async () => {
    const [library,media,m] = await Promise.all([
      api('/api/library').catch(()=>({items:[]})),api('/api/local-media').catch(()=>({items:[]})),store()
    ]);
    const [saved,partial,summary] = await Promise.all([m.listOfflineVideos(),m.listOfflinePending(),m.offlineStorageSummary()]);
    setItems([...(library.items||[]).map(x=>({...x,kind:'library'})),
      ...(media.items||media.media||[]).map(x=>({...x,kind:'media'}))]);
    setLocal(saved.filter(x=>x.profileId===profile.id));
    setPending(partial.filter(x=>x.profileId===profile.id));
    setStorage(summary);setBudget(summary.budgetGb);
  };
  useEffect(()=>{refresh().catch(e=>setStatus(e.message));return()=>controller.current?.abort();},[profile?.id]);
  const runDownload = async ({src,title,id}) => {
    const abort = new AbortController();controller.current = abort;
    setBusy(id);setStatus(t('Preparing offline download…'));
    try {
      await saveOffline(src,{title,profileId:profile.id,profileName:profile.name,signal:abort.signal},
        ({downloaded,total,resumed})=>setStatus(`${resumed?t('Resuming'):t('Downloading…')} · ${format(downloaded)} / ${format(total)}`));
      notify(t('Video saved for offline playback.'));
    } catch(e) {
      if (abort.signal.aborted) notify(t('Download paused. Resume it from Offline Downloads.'));
      else notify(e.message);
    } finally {
      controller.current=null;setBusy(null);setStatus('');await refresh().catch(()=>{});
    }
  };
  const save = item => runDownload({id:`${item.kind}:${item.id}`,
    src:`${BASE}/api/${item.kind==='media'?'local-media':'library'}/stream/${item.id}`,
    title:item.title||item.fileName});
  const changeBudget = async n => {
    try {const m=await store();await m.setOfflineBudget(Number(n));await refresh();}
    catch(e){notify(e.message);}
  };
  const deletePartial = async id => {
    if (!window.confirm(t('Delete this incomplete download?'))) return;
    try {const m=await store();await m.removeOfflineVideo(id);await refresh();}
    catch(e){notify(e.message);}
  };
  return <main className="mx-auto max-w-5xl px-4 py-8 text-white sm:px-8">
    <h1 className="mb-3 text-3xl font-bold">{t('Offline downloads')}</h1>
    <p className="mb-4 text-sm text-white/65">{t('Offline videos stay on this device. Downloads are resumable when the server supports Range requests. Keep this tab open until a download finishes or is paused.')}</p>
    <p className="mb-5 text-xs text-amber-200">{t('Offline files are not encrypted or protected by your StreamHub password. Do not save private videos on a shared device.')}</p>
    <a className="mb-5 inline-block rounded bg-white px-4 py-2 font-bold text-black" href="/offline.html">{t('Open offline player')}</a>
    {storage&&<section className="mb-7 rounded-lg border border-white/20 p-4" aria-label={t('Device storage')}>
      <div className="mb-2 text-sm">{t('Saved')}: {format(storage.completeBytes)} · {t('Incomplete')}: {format(storage.partialBytes)}</div>
      <label className="flex items-center gap-3 text-sm">{t('Device storage budget')}
        <select value={budget} onChange={e=>changeBudget(e.target.value)} className="rounded bg-zinc-800 p-2 text-white">
          {[2,5,10,20,40].map(n=><option value={n} key={n}>{n} GB</option>)}
        </select>
      </label>
      {storage.deviceQuota&&<p className="mt-2 text-xs text-white/60">{t('Browser space remaining')}: {format(Math.max(0,storage.deviceQuota-(storage.deviceUsage||0)))}</p>}
    </section>}
    {status&&<p role="status" className="my-3 text-sm">{status}</p>}
    {busy&&<button className="mb-5 rounded bg-amber-200 px-4 py-2 text-black" onClick={()=>controller.current?.abort()}>{t('Pause download')}</button>}
    <h2 className="mb-3 mt-5 text-xl font-bold">{t('On this device')} ({local.length})</h2>
    <div className="mb-7 space-y-2">{local.map(x=><div key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white/10 p-3"><span>{x.title} · {format(x.bytes)}</span><a href="/offline.html" className="underline">{t('Play offline')}</a></div>)}</div>
    <h2 className="mb-3 text-xl font-bold">{t('Incomplete downloads')} ({pending.length})</h2>
    <div className="mb-7 space-y-2">{pending.map(x=><div key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white/10 p-3">
      <span className="min-w-0 break-words">{x.title} · {format(x.bytes)}{x.expected?` / ${format(x.expected)}`:''}</span>
      <span className="flex gap-2"><button disabled={Boolean(busy)} onClick={()=>runDownload({src:x.src,title:x.title,id:x.id})} className="rounded bg-white px-3 py-2 text-sm text-black disabled:opacity-50">{t('Resume download')}</button>
      <button disabled={Boolean(busy)} onClick={()=>deletePartial(x.id)} className="rounded border border-white/50 px-3 py-2 text-sm disabled:opacity-50">{t('Delete')}</button></span>
    </div>)}</div>
    <h2 className="mb-3 text-xl font-bold">{t('Available to download')} ({items.length})</h2>
    <div className="space-y-2">{items.map(x=><div key={`${x.kind}:${x.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white/10 p-3">
      <span className="min-w-0 break-words">{x.title||x.fileName||'Video'}</span>
      <button disabled={Boolean(busy)} onClick={()=>save(x)} className="rounded bg-white px-3 py-2 text-sm font-bold text-black disabled:opacity-50">{busy===`${x.kind}:${x.id}`?t('Downloading…'):t('Save offline')}</button>
    </div>)}</div>
    {!items.length&&<p className="mt-4 text-white/60">{t('Save media to the server or scan the local folder first.')}</p>}
  </main>;
}
