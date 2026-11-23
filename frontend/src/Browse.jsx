import { Localized, useLocale } from './locale';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useApp } from './context';
import Billboard from './Billboard';
import Card from './Card';
import Row, { RowSkeleton } from './Row';
import {excludeCompletedMovies,uniqueTitles} from './home-personalization';

function historyItem(h) {
  return { id: h.tmdbId, type: h.type, title: h.title, year: h.year, poster: h.poster, backdrop: h.backdrop };
}

export function historySpec(h) {
  return {
    type: h.type,
    tmdbId: h.tmdbId,
    title: h.title,
    year: h.year,
    poster: h.poster,
    backdrop: h.backdrop,
    season: h.season,
    episode: h.episode,
    episodeTitle: h.type === 'tv' ? h.subtitle : null,
    contentKey: h.type === 'raw' ? h.contentKey : undefined,
    // reuse exactly the torrent that was watched before (falls back to a fresh search if it is gone)
    magnet: h.nextUp ? undefined : h.magnet,
    sizeLabel: h.sizeLabel,
    indexer: h.indexer,
  };
}

function SetupCard() {
  return (
    <div className="mx-auto mt-32 max-w-[640px] animate-fadeInUp rounded-lg bg-[#1f1f1f] p-8 shadow-2xl">
      <h2 className="text-2xl font-bold"><Localized text={"Set up your catalog"} /></h2>
      <p className="mt-2 text-[#b3b3b3]">
        <Localized text={"To fill this page with posters, trailers and descriptions, StreamHub uses The Movie Database (TMDB). It's free and takes about a minute."} /></p>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-[#e5e5e5]">
        <li>
          <Localized text={"Create a free account at"} suffix=" " /><span className="font-bold">themoviedb.org</span>.
        </li>
        <li>
          <Localized text={"Open"} suffix=" " /><span className="font-bold">Settings → API</span> <Localized text={"and copy your"} suffix=" " /><span className="font-bold">API Key</span>.
        </li>
        <li>
          <Localized text={"Add this line to the"} suffix=" " /><code className="rounded bg-black/50 px-1.5 py-0.5">.env</code> <Localized text={"file next to your docker-compose.yml:"} /><pre className="mt-2 overflow-x-auto rounded bg-black/60 p-3 text-sm text-[#46d369]">TMDB_API_KEY=your_key_here</pre>
        </li>
        <li>
          <Localized text={"Run"} suffix=" " /><code className="rounded bg-black/50 px-1.5 py-0.5">docker compose up -d</code> <Localized text={"and refresh this page."} /></li>
      </ol>
      <p className="mt-5 text-sm text-[#808080]"><Localized text={"Until then, you can still use the search box to find releases directly from your indexers."} /></p>
    </div>
  );
}

export function ListPage() {
  const { myList, openTitle, playTitle } = useApp();
  const saved = myList;
  return (
    <div className="px-[4%] pb-24 pt-28 animate-fadeIn">
      <h1 className="mb-8 text-3xl font-bold"><Localized text={"My List"} /></h1>
      {myList.length === 0 ? (
        <p className="text-lg text-[#b3b3b3]"><Localized text={"You haven't added any titles to your list yet. Use the + button on any title."} /></p>
      ) : (
        <div className="grid grid-cols-3 gap-x-2 gap-y-10 sm:grid-cols-4 lg:grid-cols-6">
          {saved.map((item) => (
            <Card key={`${item.type}-${item.id}`} item={item} fluid onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Browse({ page, historyVersion, suspended }) {
  const { t } = useLocale();
  const { profile, myList, play, openTitle, playTitle, notify } = useApp();
  const [state, setState] = useState({ loading: true });
  const [history, setHistory] = useState([]);
  const [recommended,setRecommended]=useState([]);
  const [followedShows,setFollowedShows]=useState([]);
  const [home,setHome]=useState({settings:{hideWatched:false},completedMovieIds:[],watchAgain:[]});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    api(`/api/browse/${page}`)
      .then((data) => alive && setState({ loading: false, data }))
      .catch((e) => alive && setState({ loading: false, error: e.message }));
    return () => {
      alive = false;
    };
  }, [page, profile.id, reload]);

  const loadHistory = useCallback(() => {
    api('/api/history')
      .then((d) => setHistory(d.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (page === 'home') loadHistory();
  }, [page, profile.id, historyVersion, loadHistory]);

  useEffect(()=>{
    if(page!=='home'){setFollowedShows([]);return undefined;}
    let alive=true;
    api('/api/followed-shows').then(d=>alive&&setFollowedShows(d.items||[])).catch(()=>alive&&setFollowedShows([]));
    return ()=>{alive=false;};
  },[page,profile.id]);

  useEffect(()=>{
    if(page!=='home'){setRecommended([]);return;}
    let alive=true;
    api('/api/recommendations').then(d=>alive&&setRecommended(d.items||[])).catch(()=>alive&&setRecommended([]));
    return()=>{alive=false;};
  },[page,profile.id,historyVersion]);

  useEffect(()=>{
    if(page!=='home')return undefined;
    let alive=true;
    api('/api/home/preferences').then(d=>{if(alive)setHome(d);}).catch(()=>{});
    return ()=>{alive=false;};
  },[page,profile.id,historyVersion]);
  const hidden=Boolean(home.settings?.hideWatched);
  const completed=home.completedMovieIds||[];
  const picks=useMemo(()=>uniqueTitles(excludeCompletedMovies(recommended,completed,hidden)),[recommended,completed,hidden]);
  const saved=useMemo(()=>excludeCompletedMovies(myList,completed,hidden),[myList,completed,hidden]);
  const toggleWatched=async()=>{
    const previous=home;
    const next=!hidden;
    setHome({...home,settings:{hideWatched:next}});
    try {await api('/api/home/preferences',{method:'PUT',body:{hideWatched:next}});}
    catch(e){setHome(previous);notify(e.message);}
  };
  const data = state.data;
  const showHistory = page === 'home' && history.length > 0;

  if (data && data.configured === false) {
    return (
      <div className="px-[4%] pb-24">
        {showHistory && (
          <div className="pt-24">
            <HistoryRow history={history} play={play} openTitle={openTitle} />
          </div>
        )}
        <SetupCard />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="px-[4%] pt-40 text-center animate-fadeIn">
        <p className="text-xl">{t(state.error)}</p>
        <button onClick={() => setReload((n) => n + 1)} className="btn-white mt-6">
          <Localized text={"Try again"} /></button>
      </div>
    );
  }

  return (
    <div className="pb-24 animate-fadeIn">
      <Billboard data={state.loading ? null : data.billboard} suspended={suspended} />

      <div className="relative z-10 -mt-[11vw] sm:-mt-[9vw]">
        {showHistory && <HistoryRow history={history} play={play} openTitle={openTitle} />}
        {page==='home'&&<div className="flex justify-end px-[4%] pb-3">
          <button type="button" onClick={toggleWatched} aria-pressed={hidden} className="rounded border border-white/30 bg-black/55 px-3 py-2 text-xs text-white/85 hover:bg-white/15">
            {hidden?t('Show watched movies'):t('Hide watched movies')}
          </button>
        </div>}

        {page==='home'&&followedShows.length>0&&<Row title={t('Following — new episode alerts')} count={followedShows.length}>
          {followedShows.map(item=><Card key={`follow-tv-${item.id}`}
            item={{...item,type:'tv'}} onOpen={()=>openTitle({type:'tv',id:item.id})}
            onPlay={()=>playTitle({type:'tv',id:item.id,title:item.title,poster:item.poster})}/>) }
        </Row>}

        {page==='home'&&picks.length>0&&<Row title={t('Recommended for you')} count={picks.length}>
          {picks.map(item=><Card key={`${item.type}-${item.id}`} item={item} onOpen={()=>openTitle(item)} onPlay={()=>playTitle(item)}/>)}
        </Row>}

        {page === 'home' && saved.length > 0 && (
          <Row title={t("My List")} count={saved.length}>
            {saved.map((item) => (
              <Card key={`${item.type}-${item.id}`} item={item} onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
            ))}
          </Row>
        )}

        {page==='home'&&home.watchAgain?.length>0&&<Row title={t('Watch again')} count={home.watchAgain.length}>
          {home.watchAgain.map(item=><Card key={`${item.type}-${item.id}`} item={item} onOpen={()=>openTitle(item)} onPlay={()=>playTitle(item)}/>)}
        </Row>}

        {state.loading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : (
          data.rows.map((row) => {
            const items=page==='home'?excludeCompletedMovies(row.items,completed,hidden):row.items;
            return items.length>0?<Row key={row.id} title={row.title} count={items.length}>
              {items.map((item) => (
                <Card key={`${item.type}-${item.id}`} item={item} onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
              ))}
            </Row>:null;
          })
        )}
      </div>
    </div>
  );
}

function HistoryRow({ history, play, openTitle }) {
  const { t } = useLocale();
  return (
    <Row title={t("Continue Watching")} count={history.length}>
      {history.map((h) => {
        const item = historyItem(h);
        const subtitle = h.type === 'tv' ? `S${h.season}:E${h.episode}${h.subtitle ? ` \u2022 ${h.subtitle}` : ''}` : null;
        return (
          <Card
            key={h.contentKey}
            item={item}
            variant="wide"
            subtitle={subtitle}
            badge={h.nextUp ? t('Up next') : null}
            progress={h.durationSeconds ? h.positionSeconds / h.durationSeconds : 0}
            onPlay={() => play(historySpec(h))}
            onOpen={h.tmdbId ? () => openTitle(item) : () => play(historySpec(h))}
          />
        );
      })}
    </Row>
  );
}
