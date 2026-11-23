import {setQualityPref} from './compat';
import React,{useCallback,useEffect,useState} from 'react';
import {api,BASE} from './api';
import {useApp} from './context';
import {useLocale} from './locale';
import {localDeviceId} from './device';

const button='rounded border border-white/35 px-3 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-40';
const input='rounded bg-white/10 p-2 text-white outline-none focus:ring-2 focus:ring-white/60';
const panel='rounded-xl border border-white/15 bg-[#191919] p-4 sm:p-6';
const formatBytes=n=>!Number.isFinite(Number(n))?'—':(Number(n)/1024**3).toFixed(2)+' GB';

export function HandoffPanel({onPlay,compact=false}){
  const {t}=useLocale();const {notify}=useApp();const [items,setItems]=useState([]);const [busy,setBusy]=useState(null);
  const load=useCallback(()=>api(`/api/playback/devices?deviceId=${encodeURIComponent(localDeviceId())}`).then(d=>setItems(d.devices||[])).catch(()=>setItems([])),[]);
  useEffect(()=>{load();const id=setInterval(load,12000);return()=>clearInterval(id);},[load]);
  const takeOver=async(item)=>{
    setBusy(item.deviceId);
    try{
      const d=await api('/api/playback/claim',{method:'POST',body:{sourceDevice:item.deviceId,targetDevice:localDeviceId()}});
      onPlay({type:d.session.type,tmdbId:d.session.tmdbId,title:d.session.title,season:d.session.season,episode:d.session.episode,
        magnet:d.session.magnet,poster:d.session.poster,year:d.session.year,contentKey:d.session.contentKey,
        resumeAt:d.session.positionSeconds});
      notify(t('Continuing on this device.'));
    }catch(e){notify(e.message);}finally{setBusy(null);}
  };
  return <section className={panel}>
    <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">{t('Continue on another device')}</h2><button className={button} onClick={load}>{t('Refresh')}</button></div>
    <p className="mt-2 text-sm text-white/55">{t('Active sessions for this profile. Taking over pauses the other device.')}</p>
    <div className="mt-3 space-y-2">{items.length?items.map(item=><div key={item.deviceId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/5 p-3">
      <div><strong>{item.title}</strong><div className="text-xs text-white/60">{item.deviceName} · {Math.floor(item.positionSeconds/60)} {t('minutes watched')}</div></div>
      <button disabled={busy===item.deviceId} className={button} onClick={()=>takeOver(item)}>{t('Continue here')}</button>
    </div>):<p className="py-4 text-sm text-white/55">{t('No other active devices for this profile.')}</p>}</div>
  </section>;
}

export function LibraryPage(){
  const {t}=useLocale();const {play,notify}=useApp();const [jobs,setJobs]=useState([]);const [loading,setLoading]=useState(true);
  const load=useCallback(()=>api('/api/downloads/queue').then(d=>{setJobs(d.jobs||[]);setLoading(false);}).catch(e=>{setLoading(false);notify(e.message);}),[notify]);
  useEffect(()=>{load();const id=setInterval(load,3000);return()=>clearInterval(id);},[load]);
  const action=async(job,action)=>{
    if(action==='delete'&&!window.confirm(t('Delete this saved file and its queue entry?')))return;
    try{await api(`/api/downloads/queue/${job.id}`,{method:'POST',body:{action}});load();}catch(e){notify(e.message);}
  };
  const playLocal=job=>play({localId:job.id,type:job.media_type,title:job.title,contentKey:job.content_key,
    tmdbId:job.tmdb_id,season:job.season,episode:job.episode,fileName:job.file_name});
  return <main className="mx-auto max-w-6xl space-y-5 px-[4%] pb-24 pt-28">
    <div><h1 className="text-3xl font-bold">{t('Local library and downloads')}</h1><p className="mt-2 text-sm text-white/60">{t('Saved on the StreamHub server, not on this device. One download runs at a time.')}</p></div>
    <HandoffPanel onPlay={play}/>
    <section className={panel}><h2 className="mb-4 text-xl font-bold">{t('Server download queue')}</h2>
      {loading?<p>{t('Loading…')}</p>:jobs.length===0?<p className="text-white/60">{t('Nothing saved yet. Use Save on server while watching a video.')}</p>:<div className="space-y-3">
        {jobs.map(job=><div key={job.id} className="rounded-lg border border-white/10 bg-black/20 p-3 sm:p-4">
          <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{job.title}</p><p className="mt-1 break-words text-xs text-white/55">{job.file_name} · {t(job.status)} · {formatBytes(job.downloaded_bytes)} / {formatBytes(job.total_bytes)}</p>
            <div className="mt-2 h-1.5 rounded bg-white/15"><div className="h-full rounded bg-red-600" style={{width:`${job.total_bytes?Math.min(100,(job.downloaded_bytes/job.total_bytes)*100):0}%`}} /></div>
            {job.error&&<p className="mt-2 text-xs text-amber-300">{job.error}</p>}</div>
            <div className="flex flex-wrap items-center gap-2">{job.status==='ready'&&<button className={button} onClick={()=>playLocal(job)}>{t('Play')}</button>}
              {['running','queued'].includes(job.status)&&<button className={button} onClick={()=>action(job,'pause')}>{t('Pause')}</button>}
              {['paused','failed'].includes(job.status)&&<button className={button} onClick={()=>action(job,'resume')}>{t('Resume')}</button>}
              <button className={button} onClick={()=>action(job,'delete')}>{t('Delete')}</button>
            </div></div>
        </div>)}</div>}
    </section>
  </main>;
}

export function PlaybackSettings(){
  const {t}=useLocale();const {profile,notify,play}=useApp();const [settings,setSettings]=useState({quality:'auto',bandwidthMbps:0});const [busy,setBusy]=useState(false);
  useEffect(()=>{api('/api/playback/settings').then(d=>{setSettings(d.settings);setQualityPref(d.settings.quality);}).catch(e=>notify(e.message));},[profile.id,notify]);
  const save=async e=>{e.preventDefault();setBusy(true);try{await api('/api/playback/settings',{method:'PUT',body:settings});setQualityPref(settings.quality);notify(t('Playback preferences saved.'));}catch(err){notify(err.message);}finally{setBusy(false);}};
  return <main className="mx-auto max-w-4xl space-y-5 px-[4%] pb-24 pt-28">
    <h1 className="text-3xl font-bold">{t('Streaming preferences')}</h1>
    <form className={`${panel} space-y-4`} onSubmit={save}>
      <label className="block"><span className="mb-2 block text-sm font-semibold">{t('Maximum preferred video quality')}</span><select className={input} value={settings.quality} onChange={e=>setSettings({...settings,quality:e.target.value})}>{['auto','480p','720p','1080p','2160p'].map(v=><option key={v} value={v}>{v==='auto'?t('Automatic'):v}</option>)}</select></label>
      <label className="block"><span className="mb-2 block text-sm font-semibold">{t('Streaming bandwidth limit')}</span><select className={input} value={settings.bandwidthMbps} onChange={e=>setSettings({...settings,bandwidthMbps:Number(e.target.value)})}>{[0,2,5,10,20,40].map(v=><option key={v} value={v}>{v===0?t('No limit'):`${v} Mbps`}</option>)}</select></label>
      <p className="text-sm text-white/60">{t('Quality affects automatic source ranking, not resolution of manually chosen files. The bandwidth cap applies to direct streaming through Nginx.')}</p>
      <button disabled={busy} className="rounded bg-white px-5 py-2 font-bold text-black">{t('Save')}</button>
    </form>
    <HandoffPanel onPlay={play}/>
  </main>;
}

export function AdvancedAdmin(){
  const {t}=useLocale();const {notify}=useApp();const [state,setState]=useState(null);const [saving,setSaving]=useState(false);const [options,setOptions]=useState(null);
  const load=useCallback(()=>api('/api/admin/advanced').then(d=>{setState(d);setOptions(prev=>prev||d.options);}).catch(e=>notify(e.message)),[notify]);
  useEffect(()=>{load();const id=setInterval(load,10000);return()=>clearInterval(id);},[load]);
  const save=async e=>{e.preventDefault();setSaving(true);try{await api('/api/admin/advanced',{method:'PUT',body:options});notify(t('Server settings saved.'));load();}catch(err){notify(err.message);}finally{setSaving(false);}};
  const backup=async()=>{setSaving(true);try{await api('/api/admin/backups',{method:'POST'});notify(t('Database backup created.'));load();}catch(e){notify(e.message);}finally{setSaving(false);}};
  return <section className={`${panel} mt-6`}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">{t('Advanced streaming and backups')}</h2><button className={button} onClick={load}>{t('Refresh')}</button></div>
    {state&&<div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded bg-white/5 p-3">{t('Saved media')}<strong className="mt-1 block text-lg">{formatBytes(state.metrics.libraryBytes)}</strong></div>
      <div className="rounded bg-white/5 p-3">{t('Active devices')}<strong className="mt-1 block text-lg">{state.metrics.activeDevices}</strong></div>
      <div className="rounded bg-white/5 p-3">{t('Disk space free')}<strong className="mt-1 block text-lg">{state.runtime.disk?formatBytes(state.runtime.disk.freeBytes):'—'}</strong></div>
      <div className="rounded bg-white/5 p-3">{t('FFmpeg video conversion')}<strong className="mt-1 block text-lg">{state.runtime.converting?t('Busy'):t('Idle')}</strong></div>
      <div className="rounded bg-white/5 p-3 sm:col-span-2">{t('Last 24 hours')}<p className="mt-2 text-white/60">{state.metrics.events.map(v=>`${v.type}: ${v.count}`).join(' · ')||t('No events yet')}</p></div>
      <div className="rounded bg-white/5 p-3 sm:col-span-2">{t('Queue status')}<p className="mt-2 text-white/60">{state.metrics.jobs.map(v=>`${v.status}: ${v.count}`).join(' · ')||t('Empty')}</p></div>
    </div>}
    {options&&<form className="mt-5 grid gap-3 sm:grid-cols-3" onSubmit={save}>
      <label className="text-sm">{t('Library storage quota')}<select className={`${input} mt-2 block w-full`} value={options.libraryQuotaGb} onChange={e=>setOptions({...options,libraryQuotaGb:Number(e.target.value)})}>{[10,25,50,100,200].map(v=><option key={v} value={v}>{v} GB</option>)}</select></label>
      <label className="text-sm">{t('Download speed limit')}<select className={`${input} mt-2 block w-full`} value={options.downloadMbps} onChange={e=>setOptions({...options,downloadMbps:Number(e.target.value)})}>{[0,2,5,10,20,40].map(v=><option key={v} value={v}>{v?`${v} Mbps`:t('No limit')}</option>)}</select></label>
      <label className="text-sm">{t('Automatic database backup')}<select className={`${input} mt-2 block w-full`} value={options.backupIntervalHours} onChange={e=>setOptions({...options,backupIntervalHours:Number(e.target.value)})}>{[0,12,24,48,168].map(v=><option key={v} value={v}>{v?`${v} h`:t('Disabled')}</option>)}</select></label>
      <button disabled={saving} className="rounded bg-white px-4 py-2 font-bold text-black sm:col-span-3">{t('Save server settings')}</button>
    </form>}
    <div className="mt-5 flex flex-wrap items-center gap-3"><button disabled={saving} className={button} onClick={backup}>{t('Create a database backup now')}</button><p className="text-xs text-white/50">{t('Backups cover StreamHub SQLite only, not other containers or media files. Download them off-server.')}</p></div>
    {state?.backups?.length>0&&<div className="mt-3 space-y-2">{state.backups.map(item=><div key={item.name} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/5 px-3 py-2 text-xs"><span className="break-all">{item.name} · {formatBytes(item.sizeBytes)}</span><a className={button} href={`${BASE}/api/admin/backups/${encodeURIComponent(item.name)}`}>{t('Download backup')}</a></div>)}</div>}
  </section>;
}
