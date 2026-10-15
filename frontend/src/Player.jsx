import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getProfileId, sendBeaconJson } from './api';
import {
  BackIcon,
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
import SourcePicker from './SourcePicker';
import { contentKeyOf, cx, fmtSpeed, fmtTime } from './utils';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem('sh_volume'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
}

export default function Player({ spec, onClose, onNext }) {
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

  const [phase, setPhase] = useState('resolving'); // resolving | ready | error
  const [message, setMessage] = useState('Finding the best source…');
  const [errorText, setErrorText] = useState('');
  const [stream, setStream] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [forced, setForced] = useState(spec.source || null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const contentKey = contentKeyOf(spec);
  menuOpenRef.current = rateMenu || pickerOpen;

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

    (async () => {
      setPhase('resolving');
      setStream(null);
      streamRef.current = null;
      setErrorText('');
      setBuffering(true);
      setPickerOpen(false);
      setMessage(forced ? 'Connecting to peers…' : spec.magnet ? 'Resuming…' : 'Finding the best source…');

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
          try {
            const data = await api('/api/stream', {
              method: 'POST',
              body: { link: list[i].link, season: spec.season, episode: spec.episode, contentKey },
            });
            if (cancelled) return null;
            return { data, src: list[i].src };
          } catch (e) {
            lastError = e;
            if (e.code === 'AUTH') return null;
          }
        }
        return null;
      };

      const first = [];
      if (forced) first.push({ link: forced.link, src: forced });
      else if (spec.magnet) first.push({ link: spec.magnet, src: { indexer: spec.indexer } });

      let result = await connect(first);

      if (!result && !cancelled && !forced && spec.type !== 'raw') {
        setMessage('Finding the best source…');
        try {
          const params = new URLSearchParams({ type: spec.type, title: spec.title });
          if (spec.year) params.set('year', spec.year);
          if (spec.season != null) {
            params.set('season', spec.season);
            params.set('episode', spec.episode);
          }
          const { results } = await api(`/api/sources?${params}`);
          const list = results
            .filter((r) => r.seeders > 0 && r.link !== spec.magnet)
            .slice(0, 4)
            .map((r) => ({ link: r.link, src: r }));
          if (!list.length && !lastError) lastError = new Error('No sources were found for this title on your indexers.');
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
      if (!contentKey) {
        try {
          const p = await api(`/api/progress/get?contentKey=${encodeURIComponent(data.contentKey)}`);
          if (cancelled) return;
          resumeAtRef.current = p.positionSeconds || 0;
        } catch {
          /* ignore */
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
      setStream(data);
      setMessage('Buffering…');
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, forced]);

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

  const seekBy = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    const end = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(end, Math.max(0, v.currentTime + delta));
  }, []);

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
  }, [volume, muted, stream]);

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

  useEffect(() => {
    const onKey = (e) => {
      if (pickerOpen) {
        if (e.key === 'Escape') setPickerOpen(false);
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
          if (!document.fullscreenElement) finish();
          break;
        default:
          return;
      }
      poke();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen, toggle, seekBy, applyVolume, volume, toggleMute, toggleFs, finish, poke]);

  // ---------------------------------------------------------------------
  // <video> events
  // ---------------------------------------------------------------------

  const onLoadedMetadata = (e) => {
    const v = e.currentTarget;
    setDuration(v.duration);
    const r = resumeAtRef.current;
    if (!resumedRef.current && r > 10 && Number.isFinite(v.duration) && r < v.duration - 15) {
      seekingRef.current = true;
      v.currentTime = r;
    }
    resumedRef.current = true;
    v.playbackRate = rate;
    v.play().catch(() => setBuffering(false));
  };

  const onTimeUpdate = (e) => {
    const v = e.currentTarget;
    setTime(v.currentTime);
    lastPos.current = { t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : 0 };
    const b = v.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.5 && b.end(i) > end) end = b.end(i);
    }
    setBufferedEnd(end);
  };

  const onEnded = () => {
    const { d } = lastPos.current;
    lastPos.current = { t: d, d };
    reportNow();
    if (nextEp) setCountdown(8);
    else setTimeout(() => onClose(), 700);
  };

  const onVideoError = () => {
    const code = videoRef.current?.error?.code;
    setPhase('error');
    setErrorText(
      code === 3 || code === 4
        ? 'Your browser could not play this file \u2014 its video or audio format (for example HEVC video or AC3/DTS sound) is not supported. Try another source.'
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
    if (!duration) return;
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
    const v = videoRef.current;
    if (v && duration) v.currentTime = scrubRef.current * duration;
    scrubRef.current = null;
    setScrub(null);
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const shownTime = scrub !== null ? scrub * safeDuration : time;
  const pct = safeDuration ? (shownTime / safeDuration) * 100 : 0;
  const bufPct = safeDuration ? (bufferedEnd / safeDuration) * 100 : 0;
  const remaining = safeDuration ? safeDuration - shownTime : 0;

  const controlsVisible = showControls || phase !== 'ready' || !playing;
  const hideCursor = phase === 'ready' && playing && !showControls;
  const nearEnd = nextEp && safeDuration > 0 && safeDuration - time <= 25 && !nextDismissed;
  const showNextCard = phase === 'ready' && !pickerOpen && (countdown !== null || nearEnd);

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

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[200] select-none overflow-hidden bg-black text-white"
      style={{ cursor: hideCursor ? 'none' : 'default' }}
    >
      {stream && phase === 'ready' && (
        <video
          key={stream.streamUrl}
          ref={videoRef}
          src={stream.streamUrl}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-contain"
          onClick={() => (showControls ? toggle() : poke())}
          onDoubleClick={toggleFs}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPlaying={() => {
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
          {phase === 'resolving' && <p className="max-w-[80%] text-center text-lg text-white/80">{message}</p>}
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
          <div className="max-w-[520px] text-center">
            <WarningIcon size={56} className="mx-auto text-nf-red" />
            <h2 className="mt-4 text-2xl font-bold">We can&apos;t play this right now</h2>
            <p className="mt-2 text-[#b3b3b3]">{errorText}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {spec.type !== 'raw' && (
                <button onClick={() => setPickerOpen(true)} className="btn-white">
                  Choose another source
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
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-[3%] pb-10 pt-5 transition-opacity duration-300',
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <button onClick={finish} aria-label="Back to browsing" className={iconBtn}>
          <BackIcon size={32} />
        </button>
        <div className="flex-1" />
        {spec.type !== 'raw' && phase !== 'resolving' && (
          <button onClick={() => setPickerOpen(true)} className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white/90 transition-colors hover:bg-white/15">
            <ListIcon size={20} /> Sources
          </button>
        )}
      </div>

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

      {/* source picker */}
      {pickerOpen && spec.type !== 'raw' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 px-4 animate-fadeIn" onMouseDown={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
          <div className="w-full max-w-[760px] animate-scaleIn rounded-lg bg-[#181818] p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-bold">Choose a source</h3>
              <button onClick={() => setPickerOpen(false)} className="text-sm text-[#b3b3b3] hover:text-white">
                Close
              </button>
            </div>
            <SourcePicker
              spec={spec}
              onPick={(source) => {
                setPickerOpen(false);
                setForced(source);
                setAttempt((n) => n + 1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
