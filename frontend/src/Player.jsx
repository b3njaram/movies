import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, BASE, getProfileId, sendBeaconJson } from './api';
import { useApp } from './context';
import {
  BackIcon,
  ChevronDown,
  DownloadIcon,
  ExitFullscreenIcon,
  Forward10,
  FullscreenIcon,
  ListIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  Rewind10,
  SpeedIcon,
  VolumeIcon,
  WarningIcon,
} from './Icons';
import SourcesDrawer from './SourcesDrawer';
import { LangChip } from './SourcePicker';
import { contentKeyOf, cx, fmtSpeed, fmtTime } from './utils';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Automatic source fallback: how many candidates one search pass will try to connect to, how many
// sources may fail in total before giving up, and how long a connected source may stay silent.
const MAX_AUTO_SOURCES = 6;
const MAX_FALLBACKS = 8;
const STARTUP_TIMEOUT_MS = Number(import.meta.env.VITE_STARTUP_TIMEOUT_MS) || 45000;

function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem('sh_volume'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
}

// "Always use the audio fix when a file needs it" — remembered once the viewer turns it on.
const autoFixPref = () => {
  try {
    return localStorage.getItem('sh_audiofix') === '1';
  } catch {
    return false;
  }
};
const setAutoFixPref = (on) => {
  try {
    localStorage.setItem('sh_audiofix', on ? '1' : '0');
  } catch {
    /* ignore */
  }
};

const LANG_ALIAS = { fre: 'fra', ger: 'deu', chi: 'zho', dut: 'nld', gre: 'ell', cze: 'ces', rum: 'ron', per: 'fas' };
function langName(code) {
  if (!code || code === 'und') return null;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(LANG_ALIAS[code] || code);
    if (name && name !== code) return name;
  } catch {
    /* fall through */
  }
  return code.toUpperCase();
}

function trackLabel(t) {
  const ch = t.channels === 6 ? ' 5.1' : t.channels === 8 ? ' 7.1' : t.channels > 2 ? ` ${t.channels}ch` : '';
  const name = langName(t.lang) || `Track ${t.ord + 1}`;
  return `${name}${t.title ? ` \u2013 ${t.title}` : ''} \u00b7 ${String(t.codec).toUpperCase()}${ch}`;
}

export default function Player({ spec, onClose, onNext }) {
  const { notify, download } = useApp();

  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const barRef = useRef(null);
  const idleTimer = useRef(null);
  const scrubRef = useRef(null);
  const resumeAtRef = useRef(0);
  const resumedRef = useRef(false);
  const seekingRef = useRef(false);
  const canReport = useRef(false);
  const metaRef = useRef({});
  const streamRef = useRef(null);
  const lastPos = useRef({ t: 0, d: 0 });
  const menuOpenRef = useRef(false);
  const fixExplicitRef = useRef(Boolean(spec.audioFix));
  const hintDismissedRef = useRef(false);
  const fixOnRef = useRef(false);
  const baseRef = useRef(0);
  const durRef = useRef(0);
  const failedRef = useRef(new Set()); // source links that connected but would not play
  const currentLinkRef = useRef(null); // the source currently being played
  const playedRef = useRef(false); // has this source produced picture yet?
  const forcedRef = useRef(null);

  const [phase, setPhase] = useState('resolving'); // resolving | ready | error
  const [message, setMessage] = useState('Finding the best source…');
  const [errorText, setErrorText] = useState('');
  const [stream, setStream] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [forced, setForced] = useState(spec.source || null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // log of the sources this viewing has tried and what happened to each
  const [attempts, setAttempts] = useState([]);
  const attemptsRef = useRef([]);
  const [searched, setSearched] = useState(null); // the player's own source search, reused by the drawer
  const [nowPlaying, setNowPlaying] = useState(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateMenu, setRateMenu] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [stats, setStats] = useState(null);
  const [nextEp, setNextEp] = useState(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [scrub, setScrub] = useState(null);
  const [hoverPct, setHoverPct] = useState(null);

  // audio fix
  const [fixOn, setFixOn] = useState(false);
  const [fixOffset, setFixOffset] = useState(0);
  const [fixTrack, setFixTrack] = useState(0);
  const [fixInfo, setFixInfo] = useState(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [audioMenu, setAudioMenu] = useState(false);
  const [noAudioHint, setNoAudioHint] = useState(false);

  const contentKey = contentKeyOf(spec);
  menuOpenRef.current = rateMenu || pickerOpen || audioMenu;
  forcedRef.current = forced;

  const markAttempt = useCallback((link, patch = {}, { fill = false } = {}) => {
    const list = attemptsRef.current;
    let a = list.find((x) => x.link === link);
    if (!a) {
      a = { link, status: 'trying' };
      list.push(a);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      if (fill && a[k] !== undefined && a[k] !== null && a[k] !== '') continue;
      a[k] = v;
    }
    setAttempts(list.map((x) => ({ ...x })));
  }, []);

  // In audio-fix mode the <video> only knows the time since its own (re)start, so the real position
  // is the stream's start offset plus the video's currentTime. Everything below goes through these.
  fixOnRef.current = fixOn;
  baseRef.current = fixOn ? fixOffset : 0;
  durRef.current = Number.isFinite(duration) && duration > 0 ? duration : 0;

  const videoSrc = stream
    ? fixOn
      ? `${BASE}/api/audiofix/stream?hash=${stream.hash}&index=${stream.fileIndex}&t=${Math.floor(fixOffset)}&a=${fixTrack}`
      : stream.streamUrl
    : null;

  // ---------------------------------------------------------------------
  // Progress reporting
  // ---------------------------------------------------------------------

  const reportNow = useCallback((beacon = false) => {
    const { t, d } = lastPos.current;
    if (!canReport.current || !(d > 0) || !metaRef.current.contentKey) return;
    const body = {
      ...metaRef.current,
      positionSeconds: t,
      durationSeconds: d,
      hash: streamRef.current?.hash,
      profileId: getProfileId(),
    };
    if (beacon) sendBeaconJson('/api/progress', body);
    else api('/api/progress', { method: 'POST', body }).catch(() => {});
  }, []);

  // Download the very file that is playing (it is already registered, so this starts at once).
  const downloadCurrent = useCallback(() => {
    const st = streamRef.current;
    if (!st) return;
    const a = document.createElement('a');
    a.href = `${BASE}/api/download?hash=${st.hash}&index=${st.fileIndex}&name=${encodeURIComponent(st.fileName)}`;
    a.download = st.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    notify(`Downloading ${st.fileName} (${st.fileSize})`);
  }, [notify]);

  useEffect(() => {
    if (!nowPlaying) return undefined;
    const t = setTimeout(() => setNowPlaying(null), 7000);
    return () => clearTimeout(t);
  }, [nowPlaying]);

  const finish = useCallback(() => {
    reportNow();
    onClose();
  }, [reportNow, onClose]);

  useEffect(() => {
    const onHide = () => reportNow(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      reportNow();
    };
  }, [reportNow]);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => reportNow(), 10000);
    return () => clearInterval(t);
  }, [playing, reportNow]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${spec.title} \u2013 StreamHub`;
    return () => {
      document.title = prev;
    };
  }, [spec.title]);

  // ---------------------------------------------------------------------
  // Find a source and register it with TorrServer
  // ---------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    canReport.current = false;
    resumedRef.current = false;
    seekingRef.current = false;
    playedRef.current = false;
    currentLinkRef.current = null;
    for (const a of attemptsRef.current) if (a.status === 'playing') a.status = 'switched';
    setAttempts(attemptsRef.current.map((x) => ({ ...x })));

    (async () => {
      setPhase('resolving');
      setStream(null);
      streamRef.current = null;
      setErrorText('');
      setBuffering(true);
      setPickerOpen(false);
      setFixOn(false);
      setFixOffset(0);
      setNoAudioHint(false);
      const failures = failedRef.current.size;
      setMessage(
        failures
          ? `That source would not play \u2014 trying another (${failures + 1})\u2026`
          : forced
            ? 'Connecting to peers…'
            : spec.magnet
              ? 'Resuming…'
              : 'Finding the best source…'
      );

      resumeAtRef.current = 0;
      if (!spec.startOver && contentKey) {
        try {
          const p = await api(`/api/progress/get?contentKey=${encodeURIComponent(contentKey)}`);
          if (cancelled) return;
          resumeAtRef.current = p.positionSeconds || 0;
        } catch {
          /* start from the beginning */
        }
      }

      let lastError = null;
      const connect = async (list) => {
        for (let i = 0; i < list.length; i++) {
          if (cancelled) return null;
          if (i > 0) setMessage('That source did not respond \u2014 trying another\u2026');
          const cand = list[i];
          const c = cand.src || {};
          markAttempt(cand.link, {
            status: 'trying',
            reason: '',
            title: cand.saved ? 'Source from your last viewing' : c.title,
            quality: c.quality,
            audio: c.audio,
            lang: c.lang,
            langMatch: c.langMatch,
            langAssumed: c.langAssumed,
            size: c.size || (cand.saved ? spec.sizeLabel : undefined),
            seeders: c.seeders,
            indexer: c.indexer,
          });
          try {
            const data = await api('/api/stream', {
              method: 'POST',
              body: { link: cand.link, season: spec.season, episode: spec.episode, contentKey },
            });
            if (cancelled) return null;
            const rel = data.release || {};
            if (cand.saved) markAttempt(cand.link, { title: data.torrentName }); // replace the placeholder
            markAttempt(
              cand.link,
              { title: data.torrentName, quality: rel.quality, audio: rel.audio, lang: rel.lang, langAssumed: rel.langAssumed, size: data.fileSize },
              { fill: true }
            );
            return { data, src: cand.src, link: cand.link };
          } catch (e) {
            lastError = e;
            markAttempt(cand.link, { status: 'failed', reason: String(e.message || '').replace(/\s+/g, ' ').slice(0, 110) });
            if (e.code === 'AUTH') return null;
          }
        }
        return null;
      };

      const first = [];
      if (forced) first.push({ link: forced.link, src: forced });
      else if (spec.magnet && !failedRef.current.has(spec.magnet)) first.push({ link: spec.magnet, src: { indexer: spec.indexer }, saved: true });

      let result = await connect(first);

      if (!result && !cancelled && !forced && spec.type !== 'raw') {
        setMessage('Finding the best source…');
        try {
          const params = new URLSearchParams({ type: spec.type, title: spec.title });
          if (spec.year) params.set('year', spec.year);
          if (spec.tmdbId) params.set('tmdbId', spec.tmdbId);
          if (spec.season != null) {
            params.set('season', spec.season);
            params.set('episode', spec.episode);
          }
          const found = await api(`/api/sources?${params}`);
          const { results } = found;
          if (!cancelled) setSearched({ results: found.results, skipped: found.skipped || [], lang: found.lang });
          const list = results
            .filter((r) => r.seeders > 0 && r.link !== spec.magnet && !failedRef.current.has(r.link))
            .slice(0, MAX_AUTO_SOURCES)
            .map((r) => ({ link: r.link, src: r }));
          if (!list.length && !lastError) {
            const n = failedRef.current.size;
            lastError = new Error(
              n
                ? `I tried ${n} source${n > 1 ? 's' : ''} and none of them would play. Open Sources to pick one yourself, or try again later.`
                : 'No sources were found for this title on your indexers.'
            );
          }
          if (list.length) {
            setMessage('Connecting to peers…');
            result = await connect(list);
          }
        } catch (e) {
          lastError = e;
        }
      }

      if (cancelled) return;
      if (!result) {
        setPhase('error');
        setErrorText(lastError?.message || 'Playback could not be started.');
        return;
      }

      const { data, src } = result;
      currentLinkRef.current = result.link;
      if (!contentKey) {
        try {
          const p = await api(`/api/progress/get?contentKey=${encodeURIComponent(data.contentKey)}`);
          if (cancelled) return;
          resumeAtRef.current = p.positionSeconds || 0;
        } catch {
          /* ignore */
        }
      }

      // Audio fix: only probed when it was asked for, or when the viewer chose "use it whenever needed".
      let info = null;
      let useFix = false;
      const explicit = fixExplicitRef.current;
      if (explicit || autoFixPref()) {
        try {
          setMessage('Preparing audio fix…');
          info = await api(`/api/audiofix/probe?hash=${data.hash}&index=${data.fileIndex}`);
          if (cancelled) return;
          useFix = info.canFix && (explicit || info.needsFix);
          if (explicit && !info.canFix) notify(info.reason);
        } catch (e) {
          if (cancelled) return;
          if (explicit) notify(`Audio fix unavailable: ${e.message}`);
        }
      }

      metaRef.current = {
        contentKey: data.contentKey,
        mediaType: spec.type,
        tmdbId: spec.tmdbId,
        season: spec.season,
        episode: spec.episode,
        title: spec.title,
        subtitle: spec.type === 'tv' ? spec.episodeTitle || null : null,
        year: spec.year,
        poster: spec.poster,
        backdrop: spec.backdrop,
        magnet: data.magnet,
        sizeLabel: data.fileSize,
        indexer: src?.indexer || spec.indexer || null,
      };
      streamRef.current = data;
      setFixInfo(info);
      setFixTrack(info?.defaultTrack ?? 0);
      if (useFix) {
        // the stream itself starts at the resume point, so no in-video seek is needed
        resumedRef.current = true;
        setFixOffset(Math.floor(resumeAtRef.current));
        if (info.duration) setDuration(info.duration);
      }
      fixOnRef.current = useFix;
      setFixOn(useFix);
      setStream(data);
      setMessage('Buffering…');
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, forced]);

  // The current source connected but cannot be watched (decode error, or no picture ever arrived).
  // Unless the viewer picked it themselves, remember that and move on to the next-best source.
  const failCurrent = useCallback(
    (reason) => {
      const link = currentLinkRef.current;
      if (!link || playedRef.current || forcedRef.current || fixOnRef.current) return false;
      if (failedRef.current.size >= MAX_FALLBACKS) return false;
      failedRef.current.add(link);
      markAttempt(link, { status: 'failed', reason });
      setAttempt((n) => n + 1);
      return true;
    },
    [markAttempt]
  );

  useEffect(() => {
    if (phase !== 'ready' || !videoSrc) return undefined;
    const t = setTimeout(() => {
      if (!playedRef.current) failCurrent('No picture arrived within 45 seconds');
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, videoSrc, failCurrent]);

  // Peer / speed readout (also tells the server this stream is still in use).
  useEffect(() => {
    if (phase !== 'ready' || !stream?.hash) return undefined;
    let alive = true;
    const poll = () =>
      api(`/api/stats/${stream.hash}`)
        .then((s) => alive && setStats(s))
        .catch(() => {});
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [phase, stream?.hash]);

  // What comes after this episode?
  useEffect(() => {
    setNextEp(null);
    setNextDismissed(false);
    setCountdown(null);
    if (phase !== 'ready' || spec.type !== 'tv' || !spec.tmdbId) return undefined;
    let alive = true;
    api(`/api/title/tv/${spec.tmdbId}/next?season=${spec.season}&episode=${spec.episode}`)
      .then((d) => alive && setNextEp(d.next))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [phase, spec.type, spec.tmdbId, spec.season, spec.episode]);

  // ---------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------

  const poke = useCallback(() => {
    setShowControls(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !menuOpenRef.current) {
        setShowControls(false);
        setRateMenu(false);
      }
    }, 3000);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const evs = ['mousemove', 'pointerdown', 'touchstart'];
    evs.forEach((e) => el.addEventListener(e, poke, { passive: true }));
    return () => {
      evs.forEach((e) => el.removeEventListener(e, poke));
      clearTimeout(idleTimer.current);
    };
  }, [poke]);

  useEffect(() => {
    if (playing) poke();
    else setShowControls(true);
  }, [playing, poke]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // Jump to an absolute position (seconds). In audio-fix mode a jump outside what has already been
  // received restarts the converted stream at that point.
  const seekTo = useCallback((target) => {
    const v = videoRef.current;
    if (!v) return;
    const total = durRef.current || Infinity;
    const t = Math.max(0, Math.min(total - 1, target));
    if (!fixOnRef.current) {
      v.currentTime = t;
      return;
    }
    const rel = t - baseRef.current;
    const b = v.buffered;
    let inBuffer = false;
    for (let i = 0; i < b.length; i++) if (rel >= b.start(i) - 0.1 && rel <= b.end(i) - 1) inBuffer = true;
    if (inBuffer) {
      v.currentTime = rel;
    } else {
      setBuffering(true);
      setTime(t);
      lastPos.current = { t, d: durRef.current };
      setFixOffset(Math.floor(t));
    }
  }, []);

  const seekBy = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (!v) return;
      seekTo(baseRef.current + v.currentTime + delta);
    },
    [seekTo]
  );

  const applyVolume = useCallback((val) => {
    const x = Math.min(1, Math.max(0, val));
    setVolume(x);
    setMuted(x === 0);
    try {
      localStorage.setItem('sh_volume', String(x));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (m && volume === 0) setVolume(0.6);
      return !m;
    });
  }, [volume]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted, videoSrc]);

  const toggleFs = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else videoRef.current?.webkitEnterFullscreen?.(); // iOS Safari
  }, []);

  useEffect(() => {
    const on = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // ---------------------------------------------------------------------
  // Audio fix controls
  // ---------------------------------------------------------------------

  const currentAbs = () => {
    const v = videoRef.current;
    return v ? baseRef.current + v.currentTime : lastPos.current.t;
  };

  const toggleFix = useCallback(async () => {
    const s = streamRef.current;
    if (fixBusy || !s) return;
    const at = currentAbs();

    if (fixOnRef.current) {
      // back to the original file, continuing from the same moment
      fixExplicitRef.current = false;
      setAutoFixPref(false);
      resumeAtRef.current = at;
      resumedRef.current = false;
      seekingRef.current = false;
      setBuffering(true);
      setFixOn(false);
      setFixOffset(0);
      return;
    }

    setFixBusy(true);
    try {
      const info = fixInfo || (await api(`/api/audiofix/probe?hash=${s.hash}&index=${s.fileIndex}`));
      setFixInfo(info);
      if (!info.canFix) {
        notify(info.reason);
        return;
      }
      fixExplicitRef.current = true;
      setAutoFixPref(true);
      setNoAudioHint(false);
      setFixTrack(info.defaultTrack ?? 0);
      if (info.duration) setDuration(info.duration);
      setBuffering(true);
      setFixOffset(Math.floor(at));
      setFixOn(true);
    } catch (e) {
      notify(`Audio fix unavailable: ${e.message}`);
    } finally {
      setFixBusy(false);
    }
  }, [fixBusy, fixInfo, notify]);

  const changeTrack = (ord) => {
    setAudioMenu(false);
    if (ord === fixTrack) return;
    const at = currentAbs();
    setBuffering(true);
    setFixOffset(Math.floor(at));
    setFixTrack(ord);
  };

  // Best-effort "this file has no playable sound" detection (Firefox / Chromium expose it).
  useEffect(() => {
    if (fixOn || !playing || noAudioHint || hintDismissedRef.current) return undefined;
    let n = 0;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      n += 1;
      const firefoxSilent = v.mozHasAudio === false && v.currentTime > 1.5;
      const chromeSilent =
        typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0 && !v.muted && v.volume > 0 && v.currentTime > 3;
      if (firefoxSilent || chromeSilent) {
        setNoAudioHint(true);
        clearInterval(t);
      } else if (n > 8) clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [fixOn, playing, noAudioHint, videoSrc]);

  useEffect(() => {
    const onKey = (e) => {
      if (pickerOpen && e.key === 'Escape') {
        setPickerOpen(false);
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          applyVolume(volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          applyVolume(volume - 0.1);
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFs();
          break;
        case 'Escape':
          if (audioMenu) setAudioMenu(false);
          else if (!document.fullscreenElement) finish();
          break;
        default:
          return;
      }
      poke();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen, audioMenu, toggle, seekBy, applyVolume, volume, toggleMute, toggleFs, finish, poke]);

  // ---------------------------------------------------------------------
  // <video> events
  // ---------------------------------------------------------------------

  const onLoadedMetadata = (e) => {
    const v = e.currentTarget;
    if (!fixOnRef.current) setDuration(v.duration);
    const r = resumeAtRef.current;
    if (!resumedRef.current && !fixOnRef.current && r > 10 && Number.isFinite(v.duration) && r < v.duration - 15) {
      seekingRef.current = true;
      v.currentTime = r;
    }
    resumedRef.current = true;
    v.playbackRate = rate;
    v.play().catch(() => setBuffering(false));
  };

  const onTimeUpdate = (e) => {
    const v = e.currentTarget;
    const base = baseRef.current;
    const abs = base + v.currentTime;
    setTime(abs);
    const d = fixOnRef.current ? durRef.current : Number.isFinite(v.duration) ? v.duration : 0;
    lastPos.current = { t: abs, d };
    const b = v.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.5 && b.end(i) > end) end = b.end(i);
    }
    setBufferedEnd(base + end);
  };

  const onEnded = () => {
    const { t, d } = lastPos.current;
    if (fixOnRef.current && d && t < d - 45) {
      setPhase('error');
      setErrorText('The audio-fix stream stopped early. Try again.');
      return;
    }
    lastPos.current = { t: d, d };
    reportNow();
    if (nextEp) setCountdown(8);
    else setTimeout(() => onClose(), 700);
  };

  const onVideoError = () => {
    if (failCurrent('Your browser could not decode this file')) return; // moved on to the next source
    const code = videoRef.current?.error?.code;
    if (currentLinkRef.current && !playedRef.current) markAttempt(currentLinkRef.current, { status: 'failed', reason: 'Your browser could not decode this file' });
    setPhase('error');
    setErrorText(
      code === 3 || code === 4
        ? 'Your browser could not play this file \u2014 its video or audio format (for example HEVC video) is not supported. Try the audio fix, or choose another source.'
        : 'The stream was interrupted. Try again, or pick another source.'
    );
  };

  // ---------------------------------------------------------------------
  // Next episode
  // ---------------------------------------------------------------------

  const goNext = useCallback(() => {
    if (!nextEp) return;
    reportNow();
    onNext(nextEp);
  }, [nextEp, onNext, reportNow]);

  useEffect(() => {
    if (countdown === null) return undefined;
    const t = setTimeout(() => {
      if (countdown <= 1) goNext();
      else setCountdown(countdown - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown, goNext]);

  // ---------------------------------------------------------------------
  // Seek bar
  // ---------------------------------------------------------------------

  const pctFromEvent = (e) => {
    const r = barRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const onBarDown = (e) => {
    if (!durRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pctFromEvent(e);
    scrubRef.current = p;
    setScrub(p);
  };
  const onBarMove = (e) => {
    const p = pctFromEvent(e);
    setHoverPct(p);
    if (scrubRef.current !== null) {
      scrubRef.current = p;
      setScrub(p);
    }
  };
  const onBarUp = () => {
    if (scrubRef.current === null) return;
    if (durRef.current) seekTo(scrubRef.current * durRef.current);
    scrubRef.current = null;
    setScrub(null);
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const safeDuration = durRef.current;
  const shownTime = scrub !== null ? scrub * safeDuration : time;
  const pct = safeDuration ? (shownTime / safeDuration) * 100 : 0;
  const bufPct = safeDuration ? (bufferedEnd / safeDuration) * 100 : 0;
  const remaining = safeDuration ? Math.max(0, safeDuration - shownTime) : 0;

  const controlsVisible = showControls || phase !== 'ready' || !playing;
  const hideCursor = phase === 'ready' && playing && !showControls;
  const nearEnd = nextEp && safeDuration > 0 && safeDuration - time <= 25 && !nextDismissed;
  const showNextCard = phase === 'ready' && !pickerOpen && (countdown !== null || nearEnd);
  const tracks = fixInfo?.tracks || [];
  const activeTrack = tracks.find((t) => t.ord === fixTrack) || tracks[0];

  const playingAttempt = attempts.find((a) => a.status === 'playing');
  const nowAttempt = nowPlaying ? attempts.find((a) => a.link === nowPlaying) : null;
  const failedCount = attempts.filter((a) => a.status === 'failed').length;
  const statusOf = (src) => {
    const a = attempts.find((x) => x.link === src.link);
    return a ? { status: a.status, reason: a.reason } : null;
  };

  const heading =
    spec.type === 'tv' ? (
      <>
        <span className="font-bold">{spec.title}</span>
        <span className="ml-3 text-white/80">
          S{spec.season}:E{spec.episode}
          {spec.episodeTitle ? ` \u201c${spec.episodeTitle}\u201d` : ''}
        </span>
      </>
    ) : (
      <span className="font-bold">{spec.title}</span>
    );

  const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-full text-white transition-transform duration-150 hover:scale-125';
  const topBtn = 'flex items-center gap-2 rounded px-3 py-2 text-sm text-white/90 transition-colors hover:bg-white/15';

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[200] select-none overflow-hidden bg-black text-white"
      style={{ cursor: hideCursor ? 'none' : 'default' }}
    >
      {videoSrc && phase === 'ready' && (
        <video
          key={videoSrc}
          ref={videoRef}
          src={videoSrc}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-contain"
          onClick={() => (showControls ? toggle() : poke())}
          onDoubleClick={toggleFs}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={(e) => {
            if (!fixOnRef.current) setDuration(e.currentTarget.duration);
          }}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPlaying={() => {
            if (!playedRef.current && currentLinkRef.current) {
              markAttempt(currentLinkRef.current, { status: 'playing', reason: '' });
              setNowPlaying(currentLinkRef.current);
            }
            playedRef.current = true;
            setPlaying(true);
            setBuffering(false);
            if (!seekingRef.current) canReport.current = true;
          }}
          onPause={() => {
            setPlaying(false);
            reportNow();
          }}
          onSeeking={() => setBuffering(true)}
          onSeeked={() => {
            seekingRef.current = false;
            setBuffering(false);
            if (!videoRef.current?.paused) canReport.current = true;
          }}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onEnded={onEnded}
          onError={onVideoError}
        />
      )}

      {/* loading / buffering */}
      {(phase === 'resolving' || (phase === 'ready' && buffering)) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 animate-fadeIn">
          <div className="nf-spinner" />
          {phase === 'resolving' && (
            <>
              <p className="max-w-[80%] text-center text-lg text-white/80">{message}</p>
              {attempts.length > 0 && (
                <ul className="w-[min(92vw,560px)] space-y-1.5" aria-label="Sources being tried">
                  {attempts.slice(-5).map((a) => (
                    <li key={a.link} className="flex items-start gap-2 rounded bg-white/[0.06] px-3 py-2 text-left text-xs">
                      <span
                        className={cx(
                          'mt-px w-4 shrink-0 text-center font-bold',
                          a.status === 'failed' ? 'text-red-300' : a.status === 'playing' ? 'text-emerald-300' : 'text-sky-300'
                        )}
                      >
                        {a.status === 'failed' ? '✕' : a.status === 'playing' ? '▶' : '…'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-white/90">{a.title || 'Connecting…'}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-white/50">
                          {a.quality && <span>{a.quality}</span>}
                          <LangChip lang={a.lang} langMatch={a.langMatch} langAssumed={a.langAssumed} />
                          {a.audio && <span>{a.audio}</span>}
                          {a.size && <span>{a.size}</span>}
                          {a.reason && <span className="text-red-300/80">{a.reason}</span>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {phase === 'ready' && stats && (
            <p className="text-sm text-white/60">
              {fmtSpeed(stats.downloadSpeed)} &middot; {stats.activePeers} peers connected
            </p>
          )}
        </div>
      )}

      {/* error */}
      {phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-6 animate-fadeIn">
          <div className="max-w-[560px] text-center">
            <WarningIcon size={56} className="mx-auto text-nf-red" />
            <h2 className="mt-4 text-2xl font-bold">We can&apos;t play this right now</h2>
            <p className="mt-2 text-[#b3b3b3]">{errorText}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {spec.type !== 'raw' && (
                <button onClick={() => setPickerOpen(true)} className="btn-white">
                  Choose another source
                </button>
              )}
              {!fixOn && streamRef.current && (
                <button
                  onClick={() => {
                    fixExplicitRef.current = true;
                    setAttempt((n) => n + 1);
                  }}
                  className="btn-gray"
                >
                  <VolumeIcon size={18} /> Try audio fix
                </button>
              )}
              <button onClick={() => setAttempt((n) => n + 1)} className="btn-gray">
                Try again
              </button>
              <button onClick={finish} className="btn-gray">
                Go back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* top bar */}
      <div
        className={cx(
          'absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/80 to-transparent px-[3%] pb-10 pt-5 transition-opacity duration-300 sm:gap-2',
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <button onClick={finish} aria-label="Back to browsing" className={iconBtn}>
          <BackIcon size={32} />
        </button>
        <div className="flex-1" />

        {fixOn && tracks.length > 1 && (
          <div className="relative">
            <button onClick={() => setAudioMenu((v) => !v)} aria-label="Choose audio language" className={topBtn}>
              <VolumeIcon size={18} />
              <span className="max-w-[160px] truncate">{activeTrack ? langName(activeTrack.lang) || `Track ${activeTrack.ord + 1}` : 'Audio'}</span>
              <ChevronDown size={14} />
            </button>
            {audioMenu && (
              <div className="absolute right-0 top-11 z-10 w-72 animate-dropIn overflow-hidden rounded bg-black/95 py-1 shadow-2xl">
                <p className="px-4 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-white/50">Audio</p>
                {tracks.map((t) => (
                  <button
                    key={t.ord}
                    onClick={() => changeTrack(t.ord)}
                    className={cx('block w-full px-4 py-2 text-left text-sm hover:bg-white/15', t.ord === fixTrack ? 'font-bold text-white' : 'text-white/70')}
                  >
                    {t.ord === fixTrack ? '\u2713 ' : ''}
                    {trackLabel(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === 'ready' && (
          <button
            onClick={toggleFix}
            disabled={fixBusy}
            aria-pressed={fixOn}
            title="Keeps the picture exactly as it is and converts the sound to AAC. Use it when a release plays without sound (AC3, E-AC3, DTS, TrueHD). Your choice is remembered."
            className={cx(topBtn, fixOn && '!bg-white font-bold !text-black hover:!bg-white/80', fixBusy && 'opacity-60')}
          >
            <VolumeIcon size={18} />
            {fixBusy ? 'Preparing\u2026' : fixOn ? 'Audio fix: On' : 'Audio fix'}
          </button>
        )}
        <button onClick={() => setPickerOpen((v) => !v)} aria-pressed={pickerOpen} className={cx(topBtn, pickerOpen && 'bg-white/15')}>
          <ListIcon size={20} /> Sources
          {playingAttempt && (
            <span className="hidden items-center gap-1 rounded bg-white/15 px-1.5 py-px text-[11px] font-bold sm:inline-flex">
              {[playingAttempt.quality, playingAttempt.lang].filter(Boolean).join(' · ')}
            </span>
          )}
        </button>
      </div>

      {/* which source is playing — appears briefly, never blocks the picture or the controls */}
      {nowAttempt && phase === 'ready' && !pickerOpen && (
        <div className="pointer-events-none absolute left-[3%] top-24 z-10 w-[min(90vw,440px)] animate-slideLeft rounded-md border border-white/15 bg-black/80 p-3 shadow-2xl backdrop-blur">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/50">
            Now playing
            {failedCount > 0 && (
              <span className="font-normal normal-case tracking-normal text-white/60">
                {' '}
                · after {failedCount} source{failedCount > 1 ? 's' : ''} that would not play
              </span>
            )}
          </p>
          <p className="mt-1 break-all text-[13px] font-medium leading-snug">{nowAttempt.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#b3b3b3]">
            {nowAttempt.quality && <span className="rounded bg-white/10 px-1.5 py-px font-bold text-white">{nowAttempt.quality}</span>}
            <LangChip lang={nowAttempt.lang} langMatch={nowAttempt.langMatch} langAssumed={nowAttempt.langAssumed} />
            {nowAttempt.audio && <span>{nowAttempt.audio}</span>}
            {nowAttempt.size && <span>{nowAttempt.size}</span>}
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="pointer-events-auto mt-2 flex items-center gap-1.5 rounded border border-white/40 px-2.5 py-1 text-xs font-bold transition-colors hover:border-white hover:bg-white/10"
          >
            <DownloadIcon size={13} /> Details &amp; download
          </button>
        </div>
      )}

      {/* "no sound?" hint */}
      {noAudioHint && !fixOn && phase === 'ready' && !pickerOpen && (
        <div className="absolute bottom-32 left-1/2 z-10 w-[min(92vw,470px)] -translate-x-1/2 animate-fadeInUp rounded-md border border-white/20 bg-black/90 p-4 shadow-2xl backdrop-blur">
          <p className="font-bold">No sound?</p>
          <p className="mt-1 text-sm text-white/70">
            This file&apos;s audio format isn&apos;t supported by your browser. The audio fix keeps the picture as it is and converts only the sound.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={toggleFix} className="btn-white !px-4 !py-1.5 !text-sm">
              <VolumeIcon size={16} /> Play with audio fix
            </button>
            <button
              onClick={() => {
                hintDismissedRef.current = true;
                setNoAudioHint(false);
              }}
              className="btn-gray !px-4 !py-1.5 !text-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* bottom controls */}
      {phase === 'ready' && (
        <div
          className={cx(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pb-5 pt-16 transition-opacity duration-300',
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <div className="flex items-center gap-4 px-[3%]">
            <div
              ref={barRef}
              onPointerDown={onBarDown}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={onBarUp}
              onPointerLeave={() => setHoverPct(null)}
              className="group/bar relative flex h-7 flex-1 cursor-pointer touch-none items-center"
            >
              <div className="relative h-[5px] w-full rounded bg-white/30 transition-all duration-150 group-hover/bar:h-[8px]">
                <div className="absolute inset-y-0 left-0 rounded bg-white/35" style={{ width: `${bufPct}%` }} />
                <div className="absolute inset-y-0 left-0 rounded bg-nf-red" style={{ width: `${pct}%` }} />
                <div
                  className={cx(
                    'absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-nf-red transition-transform duration-150 group-hover/bar:scale-100',
                    scrub !== null ? 'scale-100' : 'scale-0'
                  )}
                  style={{ left: `${pct}%` }}
                />
              </div>
              {hoverPct !== null && safeDuration > 0 && (
                <div
                  className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-black/85 px-2 py-1 text-xs tabular-nums"
                  style={{ left: `${hoverPct * 100}%` }}
                >
                  {fmtTime(hoverPct * safeDuration)}
                </div>
              )}
            </div>
            <span className="w-[72px] text-right text-lg tabular-nums sm:text-xl">{fmtTime(remaining)}</span>
          </div>

          <div className="mt-1 flex items-center gap-1 px-[3%] sm:gap-2">
            <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className={iconBtn}>
              {playing ? <PauseIcon size={38} /> : <PlayIcon size={38} />}
            </button>
            <button onClick={() => seekBy(-10)} aria-label="Back 10 seconds" className={iconBtn}>
              <Rewind10 size={36} />
            </button>
            <button onClick={() => seekBy(10)} aria-label="Forward 10 seconds" className={iconBtn}>
              <Forward10 size={36} />
            </button>

            <div className="group/vol flex items-center">
              <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className={iconBtn}>
                <VolumeIcon size={34} level={muted || volume === 0 ? 0 : volume < 0.5 ? 1 : 2} />
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={muted ? 0 : volume}
                onChange={(e) => applyVolume(parseFloat(e.target.value))}
                aria-label="Volume"
                className="nf-range w-0 opacity-0 transition-all duration-200 group-hover/vol:ml-1 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:ml-1 focus:w-24 focus:opacity-100"
                style={{ '--val': `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>

            <div className="mx-3 min-w-0 flex-1 truncate text-center text-sm sm:text-lg">{heading}</div>

            {nextEp && (
              <button onClick={goNext} aria-label="Next episode" title={`Next: S${nextEp.season}:E${nextEp.episode}`} className={iconBtn}>
                <NextIcon size={34} />
              </button>
            )}

            <div className="relative">
              <button onClick={() => setRateMenu((v) => !v)} aria-label="Playback speed" className={iconBtn}>
                <SpeedIcon size={34} />
              </button>
              {rateMenu && (
                <div className="absolute bottom-14 right-0 w-36 animate-dropIn overflow-hidden rounded bg-black/95 py-1 shadow-2xl">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setRate(s);
                        if (videoRef.current) videoRef.current.playbackRate = s;
                        setRateMenu(false);
                      }}
                      className={cx('block w-full px-4 py-2 text-left text-sm hover:bg-white/15', rate === s ? 'font-bold text-white' : 'text-white/70')}
                    >
                      {s === 1 ? 'Normal' : `${s}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={toggleFs} aria-label={isFs ? 'Exit full screen' : 'Full screen'} className={iconBtn}>
              {isFs ? <ExitFullscreenIcon size={32} /> : <FullscreenIcon size={32} />}
            </button>
          </div>
        </div>
      )}

      {/* next episode card */}
      {showNextCard && nextEp && (
        <div className="absolute bottom-28 right-[3%] z-10 w-[300px] animate-slideLeft rounded-md border border-white/20 bg-black/85 p-4 shadow-2xl backdrop-blur">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60">Next Episode</p>
          <p className="mt-1 truncate font-bold">
            S{nextEp.season}:E{nextEp.episode} {nextEp.name ? `\u2013 ${nextEp.name}` : ''}
          </p>
          {countdown !== null && <p className="mt-1 text-sm text-white/70">Starting in {countdown}&hellip;</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={goNext} className="btn-white !px-4 !py-1.5 !text-sm">
              <PlayIcon size={16} /> Play now
            </button>
            <button
              onClick={() => {
                setCountdown(null);
                setNextDismissed(true);
              }}
              className="btn-gray !px-4 !py-1.5 !text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* sources: a side drawer, so the video keeps playing while it is open */}
      {pickerOpen && (
        <SourcesDrawer
          spec={spec}
          attempts={attempts}
          preloaded={searched}
          statusOf={statusOf}
          onClose={() => setPickerOpen(false)}
          onPick={(source) => {
            setForced(source);
            setAttempt((n) => n + 1);
          }}
          onPickFix={(source) => {
            fixExplicitRef.current = true;
            setForced(source);
            setAttempt((n) => n + 1);
          }}
          onDownload={(source) => download(source, spec)}
          onDownloadCurrent={downloadCurrent}
        />
      )}
    </div>
  );
}
