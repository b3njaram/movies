import React, { useEffect, useState } from 'react';
import { api } from './api';
import { WarningIcon } from './Icons';
import { cx } from './utils';

const QUALITY_STYLE = {
  '2160p': 'bg-purple-600',
  '1080p': 'bg-emerald-600',
  '720p': 'bg-sky-600',
  '480p': 'bg-zinc-600',
  SD: 'bg-zinc-700',
};

export function SourceRow({ source, onPick, actionLabel = 'Play' }) {
  return (
    <button
      onClick={() => onPick(source)}
      className="group flex w-full items-center gap-3 rounded px-3 py-2.5 text-left transition-colors hover:bg-white/10"
    >
      <span className={cx('w-[52px] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold', QUALITY_STYLE[source.quality] || 'bg-zinc-700')}>
        {source.quality}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-all text-[13px] leading-snug text-white">{source.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#9a9a9a]">
          <span>{source.size}</span>
          <span className="text-emerald-400">▲ {source.seeders}</span>
          <span>{source.indexer}</span>
          {source.codec && <span>{source.codec}</span>}
          {source.source && <span>{source.source}</span>}
          {source.risky && (
            <span className="flex items-center gap-1 text-amber-400" title="HEVC/AV1 video or AC3/DTS audio often does not play in browsers">
              <WarningIcon size={12} /> may not play in browser
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 rounded bg-white px-3 py-1 text-xs font-bold text-black opacity-0 transition-opacity group-hover:opacity-100">
        {actionLabel}
      </span>
    </button>
  );
}

// Lists releases found through Prowlarr for a movie / episode, best first.
export default function SourcePicker({ spec, onPick, className = '' }) {
  const [state, setState] = useState({ loading: true, results: [], error: '' });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, results: [], error: '' });
    const params = new URLSearchParams();
    params.set('type', spec.type);
    params.set('title', spec.title);
    if (spec.year) params.set('year', spec.year);
    if (spec.season != null) {
      params.set('season', spec.season);
      params.set('episode', spec.episode);
    }
    api(`/api/sources?${params}`)
      .then((d) => alive && setState({ loading: false, results: d.results, error: '' }))
      .catch((e) => alive && setState({ loading: false, results: [], error: e.message }));
    return () => {
      alive = false;
    };
  }, [spec.type, spec.title, spec.year, spec.season, spec.episode]);

  return (
    <div className={cx('rounded-md bg-[#1f1f1f] p-2', className)}>
      {state.loading && (
        <div className="flex items-center gap-3 px-3 py-6 text-sm text-[#b3b3b3]">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-nf-red" />
          Searching your indexers…
        </div>
      )}
      {state.error && <p className="px-3 py-4 text-sm text-[#e87c03]">{state.error}</p>}
      {!state.loading && !state.error && state.results.length === 0 && (
        <p className="px-3 py-4 text-sm text-[#b3b3b3]">No sources found for this title on your indexers.</p>
      )}
      <div className="thin-scroll max-h-[340px] overflow-y-auto">
        {state.results.map((s) => (
          <SourceRow key={s.id} source={s} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}
