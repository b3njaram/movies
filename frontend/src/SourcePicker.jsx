import React, { useEffect, useState } from 'react';
import { api } from './api';
import { useApp } from './context';
import { DownloadIcon, PlayIcon, VolumeIcon, WarningIcon } from './Icons';
import { cx } from './utils';

const QUALITY_STYLE = {
  '2160p': 'bg-purple-600',
  '1080p': 'bg-emerald-600',
  '720p': 'bg-sky-600',
  '480p': 'bg-zinc-600',
  SD: 'bg-zinc-700',
};

const SAFE_AUDIO = new Set(['AAC', 'Opus', 'MP3']);

// Audio language of a release, e.g. EN, ES·LAT, EN+ES·LAT. Green = matches your preference.
export function LangChip({ lang, langMatch, langAssumed, className = '' }) {
  if (!lang) return null;
  const tone =
    langMatch === 'preferred'
      ? 'border-emerald-500/70 text-emerald-400'
      : langMatch === 'other'
        ? 'border-red-400/60 text-red-300'
        : 'border-white/30 text-white/70';
  return (
    <span
      className={cx('rounded border px-1.5 py-px text-[10px] font-bold leading-4', tone, langAssumed && 'opacity-70', className)}
      title={
        langAssumed
          ? 'No language is stated in the release name, so it is assumed to be English'
          : langMatch === 'other'
            ? 'Not in your preferred language'
            : 'Audio language'
      }
    >
      {lang}
      {langAssumed ? '?' : ''}
    </span>
  );
}

// English / Español switch for the profile's preferred audio language.
export function LangToggle({ className = '' }) {
  const { profile, setLang } = useApp();
  if (!profile || !setLang) return null;
  const btn = (code, label) => (
    <button
      key={code}
      onClick={() => setLang(code)}
      aria-pressed={profile.lang === code}
      className={cx(
        'px-3 py-1 text-xs font-bold transition-colors',
        profile.lang === code ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
      )}
    >
      {label}
    </button>
  );
  return (
    <div className={cx('flex items-center gap-2 text-xs text-[#b3b3b3]', className)}>
      Preferred audio
      <span className="flex overflow-hidden rounded border border-white/30">
        {btn('en', 'English')}
        {btn('es', 'Español')}
      </span>
    </div>
  );
}

const STATUS = {
  playing: { text: '▶ Playing', cls: 'bg-emerald-500/20 text-emerald-300' },
  trying: { text: 'Trying…', cls: 'bg-sky-500/20 text-sky-300' },
  failed: { text: '✕ Would not play', cls: 'bg-red-500/20 text-red-300' },
  switched: { text: 'Replaced', cls: 'bg-white/10 text-white/60' },
};

// One release found on the indexers, with its three actions:
//   Play | Audio fix (play, converting the sound to AAC) | Download (to this device)
export function SourceRow({ source, onPick, onPickFix, onDownload, status = null, compact = false }) {
  const safeAudio = SAFE_AUDIO.has(source.audio);
  const st = status && STATUS[status.status];
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded px-3 py-2.5 transition-colors hover:bg-white/[0.07]', !compact && 'sm:flex-nowrap')}>
      <span className={cx('w-[52px] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold', QUALITY_STYLE[source.quality] || 'bg-zinc-700')}>
        {source.quality}
      </span>

      <button onClick={() => onPick(source)} className={cx('min-w-0 flex-1 text-left', compact ? 'basis-[70%]' : 'basis-[55%]')}>
        <span className="line-clamp-2 break-all text-[13px] leading-snug text-white">{source.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#9a9a9a]">
          <LangChip lang={source.lang} langMatch={source.langMatch} langAssumed={source.langAssumed} />
          <span>{source.size}</span>
          <span className="text-emerald-400">▲ {source.seeders}</span>
          <span>{source.indexer}</span>
          {source.codec && <span>{source.codec}</span>}
          {source.source && <span>{source.source}</span>}
          {source.audio && (
            <span className={cx('font-bold', safeAudio ? 'text-emerald-400' : 'text-amber-400')} title={safeAudio ? 'Plays everywhere' : 'This audio format is silent in many browsers'}>
              {source.audio}
            </span>
          )}
          {st && <span className={cx('rounded px-1.5 py-px font-bold', st.cls)}>{st.text}</span>}
        </span>
        {status?.reason && <span className="mt-0.5 block text-[11px] text-red-300/80">{status.reason}</span>}
        {source.videoRisk && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-400">
            <WarningIcon size={12} /> HEVC/AV1 video — may not play in your browser
          </span>
        )}
        {!source.videoRisk && source.audioRisk && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-400">
            <WarningIcon size={12} /> Sound may be missing in some browsers — use Audio fix
          </span>
        )}
      </button>

      <div className={cx('flex shrink-0 items-center gap-1.5', compact ? 'w-full pl-[64px]' : 'ml-auto')}>
        <button
          onClick={() => onPick(source)}
          className="flex items-center gap-1 rounded bg-white px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-white/75"
        >
          <PlayIcon size={13} /> Play
        </button>
        {onPickFix && (
          <button
            onClick={() => onPickFix(source)}
            title="Play with audio fix: keeps the picture as it is and converts the sound to AAC, for releases that play without sound"
            className="flex items-center gap-1 rounded border border-white/40 px-2.5 py-1.5 text-xs font-bold transition-colors hover:border-white hover:bg-white/10"
          >
            <VolumeIcon size={14} /> Audio fix
          </button>
        )}
        {onDownload && (
          <button
            onClick={() => onDownload(source)}
            aria-label={`Download ${source.title}`}
            title="Download this file to this device"
            className="flex h-[30px] w-[30px] items-center justify-center rounded border border-white/40 transition-colors hover:border-white hover:bg-white/10"
          >
            <DownloadIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export function SkippedNote({ skipped }) {
  if (!skipped?.length) return null;
  return (
    <p className="px-3 pb-2 pt-2 text-[11px] text-[#808080]">
      {skipped.length} indexer{skipped.length > 1 ? 's' : ''} did not answer in time ({skipped.slice(0, 4).join(', ')}
      {skipped.length > 4 ? '…' : ''}), so this list may be incomplete.
    </p>
  );
}

// Lists releases found through Prowlarr for a movie / episode, best match for your language first.
// `preloaded` lets the player hand over the search it already ran, so the list opens instantly.
export default function SourcePicker({ spec, onPick, onPickFix, onDownload, statusOf, preloaded, showLang = true, compact = false, className = '' }) {
  const { profile } = useApp();
  const lang = profile?.lang || 'en';
  const usable = preloaded && preloaded.lang === lang ? preloaded : null;
  const [state, setState] = useState(() =>
    usable ? { loading: false, results: usable.results, skipped: usable.skipped || [], error: '' } : { loading: true, results: [], skipped: [], error: '' }
  );

  useEffect(() => {
    if (usable) {
      setState({ loading: false, results: usable.results, skipped: usable.skipped || [], error: '' });
      return undefined;
    }
    let alive = true;
    setState({ loading: true, results: [], skipped: [], error: '' });
    const params = new URLSearchParams();
    params.set('type', spec.type);
    params.set('title', spec.title);
    if (spec.year) params.set('year', spec.year);
    if (spec.tmdbId) params.set('tmdbId', spec.tmdbId);
    if (spec.season != null) {
      params.set('season', spec.season);
      params.set('episode', spec.episode);
    }
    api(`/api/sources?${params}`)
      .then((d) => alive && setState({ loading: false, results: d.results, skipped: d.skipped || [], error: '' }))
      .catch((e) => alive && setState({ loading: false, results: [], skipped: [], error: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.type, spec.title, spec.year, spec.tmdbId, spec.season, spec.episode, lang, usable]);

  return (
    <div className={cx('rounded-md bg-[#1f1f1f] p-2', className)}>
      {showLang && <LangToggle className="px-3 pb-1 pt-1" />}
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
      <div className={cx('thin-scroll', !compact && 'max-h-[340px] overflow-y-auto')}>
        {state.results.map((s) => (
          <SourceRow key={s.id} source={s} onPick={onPick} onPickFix={onPickFix} onDownload={onDownload} status={statusOf ? statusOf(s) : null} compact={compact} />
        ))}
      </div>
      <SkippedNote skipped={state.skipped} />
    </div>
  );
}
