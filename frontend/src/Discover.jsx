import React, {useEffect,useState} from 'react';
import {api} from './api';
import {useApp} from './context';
import {useLocale} from './locale';
import Card from './Card';

const GENRES = [
 ['28','Action'],['12','Adventure'],['16','Animation'],['35','Comedy'],['80','Crime'],
 ['99','Documentary'],['18','Drama'],['10751','Family'],['14','Fantasy'],['27','Horror'],
 ['9648','Mystery'],['10749','Romance'],['878','Science Fiction'],['53','Thriller'],['10762','Kids'],
];
const BASE_FILTERS={type:'movie',genre:'',year:'',minRating:'0',sort:'popularity.desc'};
export default function Discover(){
 const {t}=useLocale();const {profile,openTitle,playTitle}=useApp();
 const [filters,setFilters]=useState(BASE_FILTERS);
 const [state,setState]=useState({loading:true,items:[]});
 const change=(key,value)=>setFilters(v=>({...v,[key]:value}));
 useEffect(()=>{
  let alive=true;
  const params=new URLSearchParams(filters);
  setState(v=>({...v,loading:true,error:null}));
  api(`/api/discover?${params}`).then(d=>alive&&setState({items:d.items,loading:false})).catch(e=>alive&&setState({items:[],loading:false,error:e.message}));
  return()=>{alive=false;};
 },[filters,profile.id]);
 const input='w-full rounded border border-white/20 bg-[#222] px-3 py-2 text-white outline-none focus:border-white sm:w-auto';
 return <div className="px-[4%] pb-28 pt-28 animate-fadeIn">
  <h1 className="text-3xl font-bold">{t('Discover')}</h1>
  <p className="mt-2 text-sm text-white/60">{t('Explore titles by genre, release year and rating.')}</p>
  <div className="mt-6 flex flex-wrap gap-3 rounded-xl bg-white/5 p-4">
   <label className="flex flex-col gap-1 text-xs text-white/65">{t('Type')}<select className={input} value={filters.type} onChange={e=>change('type',e.target.value)}><option value="movie">{t('Movies')}</option><option value="tv">{t('TV Shows')}</option></select></label>
   <label className="flex flex-col gap-1 text-xs text-white/65">{t('Genre')}<select className={input} value={filters.genre} onChange={e=>change('genre',e.target.value)}><option value="">{t('All genres')}</option>{GENRES.map(([id,label])=><option key={id} value={id}>{t(label)}</option>)}</select></label>
   <label className="flex flex-col gap-1 text-xs text-white/65">{t('Year')}<input className={input} type="number" min="1900" max={new Date().getFullYear()+2} value={filters.year} placeholder={t('Any year')} onChange={e=>change('year',e.target.value)} /></label>
   <label className="flex flex-col gap-1 text-xs text-white/65">{t('Minimum rating')}<select className={input} value={filters.minRating} onChange={e=>change('minRating',e.target.value)}>{['0','6','7','8'].map(v=><option key={v} value={v}>{v==='0'?t('Any rating'):`${v} / 10 +`}</option>)}</select></label>
   <label className="flex flex-col gap-1 text-xs text-white/65">{t('Sort by')}<select className={input} value={filters.sort} onChange={e=>change('sort',e.target.value)}><option value="popularity.desc">{t('Popularity')}</option><option value="vote_average.desc">{t('Rating')}</option><option value="primary_release_date.desc">{t('Newest')}</option></select></label>
   <button className="self-end rounded border border-white/25 px-4 py-2 text-sm hover:bg-white/15" onClick={()=>setFilters(BASE_FILTERS)}>{t('Reset filters')}</button>
  </div>
  {state.error&&<p role="alert" className="mt-8 text-rose-300">{t(state.error)}</p>}
  {state.loading?<p className="mt-8 text-white/60">{t('Loading…')}</p>:state.items?.length?
   <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">{state.items.map(item=><Card key={`${item.type}-${item.id}`} item={item} fluid onOpen={()=>openTitle(item)} onPlay={()=>playTitle(item)} />)}</div>
   :!state.error&&<p className="mt-8 text-white/60">{t('No results match these filters.')}</p>}
  {profile.maxAge<18&&<p className="mt-6 text-xs text-white/50">{t('Only titles within this profile’s age limit are available.')}</p>}
 </div>;
}
