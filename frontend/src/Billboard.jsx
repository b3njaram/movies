import { Localized } from './locale';
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './context';
import { InfoIcon, PlayIcon, VolumeIcon } from './Icons';
import { cx, img } from './utils';

const shadow = { textShadow: '0 2px 8px rgba(0,0,0,.65)' };

export default function Billboard({ data, suspended = false }) {
  const { playTitle, openTitle } = useApp();
  const rootRef = useRef(null);
  const frameRef = useRef(null);
  const [inView, setInView] = useState(true);
  const [mountTrailer, setMountTrailer] = useState(false);
  const [trailerOn, setTrailerOn] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Netflix waits a moment before the trailer starts.
  useEffect(() => {
    setMountTrailer(false);
    setTrailerOn(false);
    setMuted(true);
    if (!data?.trailer) return undefined;
    const t = setTimeout(() => setMountTrailer(true), 2500);
    return () => clearTimeout(t);
  }, [data?.id, data?.trailer]);

  const active = Boolean(data?.trailer) && mountTrailer && inView && !suspended;

  // Only reveal the video once YouTube reports that it is really playing.
  useEffect(() => {
    if (!active) {
      setTrailerOn(false);
      return undefined;
    }
    const onMessage = (e) => {
      if (!String(e.origin).includes('youtube')) return;
      let d = e.data;
      if (typeof d === 'string') {
        try {
          d = JSON.parse(d);
        } catch {
          return;
        }
      }
      if (!d) return;
      let state;
      if (d.event === 'onStateChange') state = d.info;
      else if (d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number') state = d.info.playerState;
      if (state === 1) setTrailerOn(true);
      else if (state === 0 || d.event === 'onError') setTrailerOn(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active]);

  const post = (payload) => frameRef.current?.contentWindow?.postMessage(JSON.stringify(payload), '*');

  const toggleMute = () => {
    post({ event: 'command', func: muted ? 'unMute' : 'mute', args: [] });
    setMuted(!muted);
  };

  if (!data) return <div className="skeleton w-full" style={{ height: 'min(56.25vw, 85vh)', minHeight: 420 }} />;

  const trailerUrl = `https://www.youtube-nocookie.com/embed/${data.trailer}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${data.trailer}&enablejsapi=1&disablekb=1&iv_load_policy=3&fs=0`;

  return (
    <section ref={rootRef} className="relative w-full overflow-hidden bg-black" style={{ height: 'min(56.25vw, 85vh)', minHeight: 440 }}>
      {/* artwork */}
      <div className="absolute inset-0">
        {data.backdrop && (
          <img
            key={data.id}
            src={img(data.backdrop, 'original')}
            alt=""
            className={cx('h-full w-full animate-kenburns object-cover object-top transition-opacity duration-1000', trailerOn && 'opacity-0')}
          />
        )}
      </div>

      {/* trailer */}
      {active && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-1000" style={{ opacity: trailerOn ? 1 : 0 }}>
          <iframe
            ref={frameRef}
            title="Trailer"
            src={trailerUrl}
            allow="autoplay; encrypted-media"
            onLoad={() => post({ event: 'listening', id: 1, channel: 'widget' })}
            className="absolute left-1/2 top-1/2 border-0"
            style={{ width: '100vw', height: '56.25vw', transform: 'translate(-50%, -50%) scale(1.3)' }}
          />
        </div>
      )}

      {/* vignettes */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-nf-black via-nf-black/60 to-transparent" />

      {/* text */}
      <div className="absolute bottom-[19%] left-[4%] right-[4%] z-10 sm:bottom-[26%] sm:max-w-[46%]">
        <div className={cx('origin-bottom-left transition-transform duration-1000', trailerOn && 'scale-[0.72]')}>
          {data.logo ? (
            <img
              src={img(data.logo, 'w500')}
              alt={data.title}
              className="mb-4 max-h-[84px] max-w-[72%] object-contain object-left drop-shadow-[0_2px_12px_rgba(0,0,0,.6)] sm:max-h-[150px]"
            />
          ) : (
            <h1 className="mb-3 text-3xl font-black leading-[1.05] sm:text-5xl lg:text-6xl" style={shadow}>
              {data.title}
            </h1>
          )}
        </div>

        <p
          className={cx(
            'overflow-hidden text-[13px] leading-snug text-white transition-all duration-1000 sm:text-lg',
            'line-clamp-3',
            trailerOn ? 'max-h-0 opacity-0' : 'max-h-28 opacity-100'
          )}
          style={shadow}
        >
          {data.overview}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => playTitle(data)} className="btn-white !px-5 sm:!px-8 sm:!py-2.5 sm:!text-xl">
            <PlayIcon size={26} /> <Localized text={"Play"} /></button>
          <button onClick={() => openTitle(data)} className="btn-gray !px-4 sm:!px-7 sm:!py-2.5 sm:!text-xl">
            <InfoIcon size={26} /> <Localized text={"More Info"} /></button>
        </div>
      </div>

      {/* right side controls */}
      <div className="absolute bottom-[19%] right-0 z-10 flex items-center gap-3 sm:bottom-[26%]">
        {trailerOn && (
          <button onClick={toggleMute} aria-label={muted ? 'Unmute trailer' : 'Mute trailer'} className="icon-btn animate-fadeIn !h-10 !w-10">
            <VolumeIcon level={muted ? 0 : 2} size={20} />
          </button>
        )}
        {data.certification && (
          <div className="hidden border-l-[3px] border-white/70 bg-black/45 py-1.5 pl-3 pr-[4vw] text-sm font-medium sm:block sm:text-lg">{data.certification}</div>
        )}
      </div>
    </section>
  );
}
