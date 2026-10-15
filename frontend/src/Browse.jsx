import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useApp } from './context';
import Billboard from './Billboard';
import Card from './Card';
import Row, { RowSkeleton } from './Row';

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
      <h2 className="text-2xl font-bold">Set up your catalog</h2>
      <p className="mt-2 text-[#b3b3b3]">
        To fill this page with posters, trailers and descriptions, StreamHub uses The Movie Database (TMDB). It&apos;s free and takes about a minute.
      </p>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-[#e5e5e5]">
        <li>
          Create a free account at <span className="font-bold">themoviedb.org</span>.
        </li>
        <li>
          Open <span className="font-bold">Settings → API</span> and copy your <span className="font-bold">API Key</span>.
        </li>
        <li>
          Add this line to the <code className="rounded bg-black/50 px-1.5 py-0.5">.env</code> file next to your docker-compose.yml:
          <pre className="mt-2 overflow-x-auto rounded bg-black/60 p-3 text-sm text-[#46d369]">TMDB_API_KEY=your_key_here</pre>
        </li>
        <li>
          Run <code className="rounded bg-black/50 px-1.5 py-0.5">docker compose up -d</code> and refresh this page.
        </li>
      </ol>
      <p className="mt-5 text-sm text-[#808080]">Until then, you can still use the search box to find releases directly from your indexers.</p>
    </div>
  );
}

export function ListPage() {
  const { myList, openTitle, playTitle } = useApp();
  return (
    <div className="px-[4%] pb-24 pt-28 animate-fadeIn">
      <h1 className="mb-8 text-3xl font-bold">My List</h1>
      {myList.length === 0 ? (
        <p className="text-lg text-[#b3b3b3]">You haven&apos;t added any titles to your list yet. Use the + button on any title.</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-2 gap-y-10 sm:grid-cols-4 lg:grid-cols-6">
          {myList.map((item) => (
            <Card key={`${item.type}-${item.id}`} item={item} fluid onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Browse({ page, historyVersion, suspended }) {
  const { profile, myList, play, openTitle, playTitle } = useApp();
  const [state, setState] = useState({ loading: true });
  const [history, setHistory] = useState([]);
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
        <p className="text-xl">{state.error}</p>
        <button onClick={() => setReload((n) => n + 1)} className="btn-white mt-6">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="pb-24 animate-fadeIn">
      <Billboard data={state.loading ? null : data.billboard} suspended={suspended} />

      <div className="relative z-10 -mt-[11vw] sm:-mt-[9vw]">
        {showHistory && <HistoryRow history={history} play={play} openTitle={openTitle} />}

        {page === 'home' && myList.length > 0 && (
          <Row title="My List" count={myList.length}>
            {myList.map((item) => (
              <Card key={`${item.type}-${item.id}`} item={item} onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
            ))}
          </Row>
        )}

        {state.loading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : (
          data.rows.map((row) => (
            <Row key={row.id} title={row.title} count={row.items.length}>
              {row.items.map((item) => (
                <Card key={`${item.type}-${item.id}`} item={item} onOpen={() => openTitle(item)} onPlay={() => playTitle(item)} />
              ))}
            </Row>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRow({ history, play, openTitle }) {
  return (
    <Row title="Continue Watching" count={history.length}>
      {history.map((h) => {
        const item = historyItem(h);
        const subtitle = h.type === 'tv' ? `S${h.season}:E${h.episode}${h.subtitle ? ` \u2022 ${h.subtitle}` : ''}` : null;
        return (
          <Card
            key={h.contentKey}
            item={item}
            variant="wide"
            subtitle={subtitle}
            badge={h.nextUp ? 'Up next' : null}
            progress={h.durationSeconds ? h.positionSeconds / h.durationSeconds : 0}
            onPlay={() => play(historySpec(h))}
            onOpen={h.tmdbId ? () => openTitle(item) : () => play(historySpec(h))}
          />
        );
      })}
    </Row>
  );
}
