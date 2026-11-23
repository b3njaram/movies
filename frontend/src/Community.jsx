import React,{useCallback,useEffect,useState} from 'react';
import {api} from './api';
import {useApp} from './context';
import {useLocale} from './locale';
import {img} from './utils';
const btn='rounded-md border border-white/35 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-50';
const field='rounded-md border border-white/20 bg-[#222] px-3 py-2 text-white outline-none focus:border-white/70';
const card='rounded-xl border border-white/15 bg-[#181818] p-4 sm:p-6';

function CatalogPicker({onSelect}){
  const {t}=useLocale(),{notify}=useApp();
  const [query,setQuery]=useState('');const [results,setResults]=useState([]);const [busy,setBusy]=useState(false);
  const search=async e=>{e.preventDefault();if(query.trim().length<2)return;setBusy(true);
    try{const d=await api(`/api/search?q=${encodeURIComponent(query.trim())}`);setResults(d.results||[]);}
    catch(e){notify(e.message);}finally{setBusy(false);}};
  return <div className="space-y-3"><form onSubmit={search} className="flex flex-wrap gap-2">
    <input className={`${field} min-w-[180px] flex-1`} value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('Search movies or series')} aria-label={t('Search movies or series')}/>
    <button className={btn} disabled={busy}>{busy?t('Searching…'):t('Search')}</button></form>
    {results.length>0&&<div className="max-h-64 space-y-1 overflow-y-auto">
      {results.slice(0,15).map(item=><button key={`${item.type}:${item.id}`} className="flex w-full items-center gap-3 rounded bg-white/5 p-2 text-left hover:bg-white/15" onClick={()=>onSelect(item)}>
        {item.poster?<img src={img(item.poster,'w92')} alt="" className="h-12 w-8 rounded object-cover"/>:<div className="h-12 w-8 bg-white/10"/>}
        <span className="flex-1"><strong>{item.title}</strong><small className="ml-2 text-white/50">{item.year||''} · {t(item.type==='tv'?'TV Shows':'Movies')}</small></span>
        <span className="text-xs">{t('Select')}</span>
      </button>)}</div>}
  </div>;
}

function Collections(){
  const {t}=useLocale(),{notify,playTitle}=useApp();const [items,setItems]=useState([]),[name,setName]=useState(''),[selected,setSelected]=useState(null),[target,setTarget]=useState('');
  const load=useCallback(()=>api('/api/community/collections').then(d=>setItems(d.collections||[])).catch(e=>notify(e.message)),[notify]);
  useEffect(()=>{load();},[load]);
  const create=async e=>{e.preventDefault();try{await api('/api/community/collections',{method:'POST',body:{name}});setName('');load();}catch(err){notify(err.message);}};
  const remove=async collection=>{if(!window.confirm(t('Delete this collection?')))return;
    try{await api(`/api/community/collections/${collection.id}`,{method:'DELETE'});load();}catch(e){notify(e.message);}};
  const add=async()=>{if(!selected||!target)return;
    try{await api(`/api/community/collections/${target}/items`,{method:'POST',body:{type:selected.type,id:selected.id,title:selected.title,poster:selected.poster}});
      setSelected(null);load();notify(t('Added to collection.'));}catch(e){notify(e.message);}};
  const drop=async(c,item)=>{try{await api(`/api/community/collections/${c.id}/items`,{method:'DELETE',body:{type:item.type,id:item.id}});load();}catch(e){notify(e.message);}};
  return <div className="space-y-4">
    <section className={card}><h2 className="mb-3 text-xl font-bold">{t('Your collections')}</h2>
      <form onSubmit={create} className="flex flex-wrap gap-2"><input className={`${field} flex-1`} maxLength={60} required value={name} onChange={e=>setName(e.target.value)} placeholder={t('New collection name')}/><button className={btn}>{t('Create')}</button></form>
      {items.length>0&&<div className="mt-4 space-y-3">
        {items.map(c=><div key={c.id} className="rounded-lg border border-white/10 p-3">
          <div className="mb-3 flex justify-between gap-2"><h3 className="font-semibold">{c.name} <small className="text-white/50">({c.items.length})</small></h3><button className={btn} onClick={()=>remove(c)}>{t('Delete')}</button></div>
          {c.items.length===0?<p className="text-sm text-white/50">{t('No titles in this collection.')}</p>:<div className="flex flex-wrap gap-3">
            {c.items.map(i=><div key={`${i.type}:${i.id}`} className="w-28 space-y-1">
              <button className="w-full text-left" onClick={()=>playTitle(i)}>{i.poster?<img src={img(i.poster,'w185')} alt="" className="h-36 w-full rounded object-cover"/>:<div className="h-36 rounded bg-white/10"/>}
                <p className="line-clamp-2 text-xs">{i.title}</p></button>
              <button className="text-xs text-rose-300 hover:underline" onClick={()=>drop(c,i)}>{t('Remove')}</button>
            </div>)}</div>}</div>)}
      </div>}
    </section>
    {items.length>0&&<section className={card}><h2 className="mb-3 text-lg font-semibold">{t('Add a title to a collection')}</h2>
      <CatalogPicker onSelect={setSelected}/>
      {selected&&<div className="mt-3 flex flex-wrap items-center gap-2"><span className="font-semibold">{selected.title}</span>
        <select className={field} value={target} onChange={e=>setTarget(e.target.value)}><option value="">{t('Choose collection')}</option>{items.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className={btn} disabled={!target} onClick={add}>{t('Add')}</button></div>}</section>}
  </div>;
}

function Requests({isAdmin}) {
  const {t}=useLocale(),{notify}=useApp();const [requests,setRequests]=useState([]),[all,setAll]=useState([]);
  const [title,setTitle]=useState(''),[type,setType]=useState('movie'),[tmdbId,setTmdbId]=useState(''),[chosen,setChosen]=useState(null);
  const load=useCallback(()=>Promise.all([api('/api/community/requests'),...(isAdmin?[api('/api/admin/community/requests')]:[])]).then(([a,b])=>{setRequests(a.requests||[]);setAll(b?.requests||[]);}).catch(e=>notify(e.message)),[isAdmin,notify]);
  useEffect(()=>{load();},[load]);
  const submit=async e=>{e.preventDefault();try{await api('/api/community/requests',{method:'POST',body:{title,type,tmdbId:tmdbId||null}});
    setTitle('');setTmdbId('');setChosen(null);load();notify(t('Request submitted.'));}catch(e){notify(e.message);}};
  const status=async(id,value)=>{try{await api(`/api/admin/community/requests/${id}`,{method:'PATCH',body:{status:value}});load();}catch(e){notify(e.message);}};
  const row=(item,admin=false)=><div key={item.id} className="flex flex-wrap justify-between gap-3 rounded border border-white/10 bg-white/5 p-3 text-sm">
    <span><strong>{item.title}</strong><span className="text-white/55"> · {t(item.type==='tv'?'TV Shows':'Movies')} · {t(item.status)}</span>
      {admin&&<small className="block text-white/50">{item.username} / {item.profileName}</small>}</span>
    {admin&&<select className={field} value={item.status} onChange={e=>status(item.id,e.target.value)}>
      {['pending','approved','available','declined'].map(v=><option key={v} value={v}>{t(v)}</option>)}
    </select>}
  </div>;
  return <div className="space-y-4"><section className={card}><h2 className="mb-3 text-xl font-bold">{t('Request a movie or series')}</h2>
    <p className="mb-3 text-sm text-white/60">{t('Requests notify the administrator; they do not automatically download anything.')}</p>
    <CatalogPicker onSelect={item=>{setChosen(item);setTitle(item.title);setType(item.type);setTmdbId(String(item.id));}}/>
    <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={submit}>
      <input required maxLength={180} className={`${field} flex-1`} placeholder={t('Title')} value={title} onChange={e=>{setTitle(e.target.value);setChosen(null);setTmdbId('');}}/>
      <select className={field} value={type} onChange={e=>setType(e.target.value)}><option value="movie">{t('Movies')}</option><option value="tv">{t('TV Shows')}</option></select>
      <button className={btn}>{t('Submit request')}</button>
    </form>{chosen&&<p className="mt-2 text-sm text-emerald-300">{t('Selected catalog title')}: {chosen.title}</p>}
    <h3 className="mb-2 mt-6 text-lg font-semibold">{t('Your requests')}</h3><div className="space-y-2">{requests.map(i=>row(i))}{requests.length===0&&<p className="text-sm text-white/50">{t('No requests yet.')}</p>}</div>
  </section>{isAdmin&&<section className={card}><h2 className="mb-3 text-xl font-bold">{t('Manage requests')}</h2><div className="max-h-[500px] space-y-2 overflow-y-auto">{all.map(i=>row(i,true))}</div></section>}</div>;
}

function Parties(){
  const {t}=useLocale(),{notify,play}=useApp();const [choice,setChoice]=useState(null),[season,setSeason]=useState(1),[episode,setEpisode]=useState(1),[code,setCode]=useState(''),[busy,setBusy]=useState(false);
  const launch=party=>play({type:party.type,tmdbId:party.tmdbId,title:party.title,season:party.season,episode:party.episode,partyCode:party.code,partyHost:party.isHost});
  const create=async()=>{if(!choice)return;setBusy(true);try{
    const d=await api('/api/community/parties',{method:'POST',body:{type:choice.type,tmdbId:choice.id,title:choice.title,season,episode}});
    setCode(d.party.code);launch(d.party);notify(t('Share the party code with other users.'));
  }catch(e){notify(e.message);}finally{setBusy(false);}};
  const join=async e=>{e.preventDefault();setBusy(true);try{
    const d=await api(`/api/community/parties/${code.trim().toUpperCase()}/join`,{method:'POST'});launch(d.party);
  }catch(e){notify(e.message);}finally{setBusy(false);}};
  return <div className="space-y-4"><section className={card}><h2 className="mb-3 text-xl font-bold">{t('Start a watch party')}</h2>
    <p className="mb-3 text-sm text-white/60">{t('Everyone streams on their own device. The host controls play, pause and position.')}</p>
    <CatalogPicker onSelect={setChoice}/>
    {choice&&<div className="mt-3 flex flex-wrap items-center gap-2"><strong>{choice.title}</strong>
      {choice.type==='tv'&&<><label className="text-sm">{t('Season')} <input className={`${field} w-20`} type="number" min="0" max="100" value={season} onChange={e=>setSeason(Number(e.target.value))}/></label>
        <label className="text-sm">{t('Episode')} <input className={`${field} w-20`} type="number" min="1" max="1000" value={episode} onChange={e=>setEpisode(Number(e.target.value))}/></label></>}
      <button disabled={busy} className={btn} onClick={create}>{t('Create party')}</button></div>}
  </section><section className={card}><h2 className="mb-3 text-xl font-bold">{t('Join a watch party')}</h2>
    <form onSubmit={join} className="flex flex-wrap gap-2"><input className={`${field} min-w-[180px] flex-1 uppercase`} maxLength={12} required placeholder={t('12-character room code')} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/>
      <button disabled={busy} className={btn}>{t('Join party')}</button></form>
    <p className="mt-2 text-xs text-white/45">{t('Room codes expire after eight hours; the host must remain connected for sync.')}</p>
  </section></div>;
}

function Media({isAdmin}) {
  const {t}=useLocale(),{notify,play}=useApp();
  const [items,setItems]=useState([]),[q,setQ]=useState(''),[busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(null),[candidates,setCandidates]=useState([]);
  const load=useCallback(()=>api('/api/local-media').then(d=>setItems(d.items||[])).catch(e=>notify(e.message)),[notify]);
  useEffect(()=>{load();},[load]);
  const scan=async()=>{setBusy(true);try{const d=await api('/api/admin/local-media/scan',{method:'POST'});notify(`${d.found} ${t('files indexed')}`);await load();}catch(e){notify(e.message);}finally{setBusy(false);}};
  const autoMatch=async()=>{setBusy(true);try{const d=await api('/api/admin/local-media/auto-match',{method:'POST'});
    notify(`${d.matched} ${t('automatically matched')}; ${d.review} ${t('need review')}${d.failed?`; ${d.failed} ${t('failed')}`:''}`);await load();
  }catch(e){notify(e.message);}finally{setBusy(false);}};
  const editMatch=async item=>{setEditing(item);setCandidates([]);
    try{const d=await api(`/api/admin/local-media/${item.id}/candidates`);setCandidates(d.candidates||[]);}catch(e){notify(e.message);}};
  const saveMatch=async item=>{if(!editing)return;
    setBusy(true);try{await api(`/api/admin/local-media/${editing.id}/match`,{method:'PUT',body:{id:item?.id,type:item?.type,clear:!item}});
      setEditing(null);setCandidates([]);await load();notify(t('Metadata saved.'));
    }catch(e){notify(e.message);}finally{setBusy(false);}};
  const filtered=items.filter(i=>i.title.toLowerCase().includes(q.toLowerCase()));
  return <section className={card}><h2 className="text-xl font-bold">{t('Local media on this server')}</h2>
    <p className="my-3 text-sm text-white/60">{t('Copy owned video files into data/app/media on the host and scan the folder. No separate Docker mount is required.')}</p>
    {isAdmin&&<div className="mb-4 flex flex-wrap gap-2">
      <button className={btn} onClick={scan} disabled={busy}>{t('Scan media folder')}</button>
      <button className={btn} onClick={autoMatch} disabled={busy||!items.some(i=>!i.tmdbId)}>{t('Match up to 6 titles automatically')}</button>
    </div>}
    <input className={`${field} mb-4 w-full`} value={q} onChange={e=>setQ(e.target.value)} placeholder={t('Filter local files')}/>
    {isAdmin&&editing&&<div className="mb-4 rounded-lg border border-sky-400/40 bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t('Match metadata')}: {editing.title}</h3>
        <button className={btn} onClick={()=>setEditing(null)}>{t('Close')}</button></div>
      <p className="text-sm text-white/60">{t('Choose a verified catalog title; ambiguous titles are never matched automatically.')}</p>
      {candidates.length>0&&<div className="max-h-48 space-y-1 overflow-y-auto">{candidates.map(c=><button key={`${c.type}:${c.id}`} className="w-full rounded bg-white/5 p-2 text-left text-sm hover:bg-white/15" onClick={()=>saveMatch(c)} disabled={busy}>
        {c.title} ({c.year||'?'}) · {Math.round(c.confidence*100)}% {t('confidence')}
      </button>)}</div>}
      <CatalogPicker onSelect={item=>item.type===editing.type?saveMatch(item):notify(t('Choose the same media type as the file.'))}/>
      <button className={btn} onClick={()=>saveMatch(null)} disabled={busy}>{t('Clear metadata match')}</button>
    </div>}
    <div className="max-h-[600px] space-y-2 overflow-y-auto">{filtered.map(i=><div key={i.id} className="flex items-center gap-3 rounded bg-white/5 p-3">
      {i.poster?<img className="h-20 w-14 shrink-0 rounded object-cover" src={img(i.poster,'w92')} alt=""/>:<div className="h-20 w-14 shrink-0 rounded bg-white/10"/>}
      <div className="min-w-0 flex-1"><strong className="block truncate">{i.title}</strong>
        <span className="text-xs text-white/50">{i.season!=null&&`S${i.season} E${i.episode} · `}{(i.sizeBytes/1024**3).toFixed(2)} GB</span>
        <span className="block text-xs text-white/50">{i.tmdbId?`${t('TMDB matched')} · ${i.matchState}`:t('Metadata not matched')}</span></div>
      <div className="flex flex-wrap gap-2">{isAdmin&&<button className={btn} onClick={()=>editMatch(i)}>{t('Match')}</button>}
        <button className={btn} onClick={()=>play({type:'raw',title:i.title,localMediaId:i.id,poster:i.poster,
          contentKey:`raw:local:${i.id}`,season:i.season,episode:i.episode})}>{t('Play')}</button></div></div>)}
      {filtered.length===0&&<p className="text-white/50">{t('No local videos indexed yet.')}</p>}
    </div>
  </section>;
}

export default function Community({isAdmin=false}){
  const {t}=useLocale();const {profile}=useApp();const [tab,setTab]=useState('collections');
  const tabs=[['collections','Collections'],['requests','Requests'],['parties','Watch parties'],...(profile.maxAge>=18?[['media','Local media']]:[])];
  return <main className="mx-auto max-w-6xl space-y-5 px-[4%] pb-24 pt-28 text-white">
    <div><h1 className="text-3xl font-bold">{t('Community')}</h1><p className="mt-2 text-sm text-white/60">{t('Organize titles, request content, and watch together.')}</p></div>
    <div className="flex flex-wrap gap-2" role="tablist">{tabs.map(([id,label])=><button key={id} className={`${btn} ${tab===id?'bg-white font-bold !text-black':''}`} onClick={()=>setTab(id)} role="tab" aria-selected={tab===id}>{t(label)}</button>)}</div>
    {tab==='collections'?<Collections/>:tab==='requests'?<Requests isAdmin={isAdmin}/>:tab==='parties'?<Parties/>:<Media isAdmin={isAdmin}/>}
  </main>;
}
