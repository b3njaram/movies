import React, { useRef, useState } from 'react';
import { useApp } from './context';
import { CheckIcon, ChevronDown, PlayIcon, PlusIcon } from './Icons';
import { cx, img } from './utils';

const WIDTHS = {
  poster: 'w-[40%] sm:w-[28%] md:w-[21.5%] lg:w-[17.5%] xl:w-[15%] 2xl:w-[13%]',
  wide: 'w-[62%] sm:w-[40%] md:w-[29%] lg:w-[22%] xl:w-[18%]',
};

function Fallback({ title }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2a2a2a] to-[#111] p-3 text-center">
      <span className="text-sm font-bold leading-tight text-white/80">{title}</span>
    </div>
  );
}

// One title tile. `item` is { id, type, title, year, poster, backdrop, rating?, genres? }.
// variant "poster" = portrait art, "wide" = landscape art (Continue Watching).
export default function Card({ item, variant = 'poster', progress = null, subtitle = null, badge = null, onPlay, onOpen, fluid = false }) {
  const { inList, toggleList } = useApp();
  const ref = useRef(null);
  const [origin, setOrigin] = useState('center');
  const [loaded, setLoaded] = useState(false);

  const src = variant === 'wide' ? img(item.backdrop || item.poster, 'w500') : img(item.poster || item.backdrop, 'w342');
  const listed = item.id ? inList(item.type, item.id) : false;

  const onEnter = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    if (r.left < 70) setOrigin('left center');
    else if (r.right > window.innerWidth - 70) setOrigin('right center');
    else setOrigin('center');
  };

  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn?.();
  };

  const primary = variant === 'wide' ? onPlay : onOpen;

  return (
    <div
      ref={ref}
      onMouseEnter={onEnter}
      className={cx('group relative flex-none hover:z-30', fluid ? 'w-full' : WIDTHS[variant])}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => primary?.()}
        onKeyDown={(e) => e.key === 'Enter' && primary?.()}
        style={{ aspectRatio: variant === 'wide' ? '16 / 9' : '2 / 3', transformOrigin: origin }}
        className="relative cursor-pointer overflow-hidden rounded-[5px] bg-[#232323] outline-none transition-all duration-300 ease-out focus-visible:ring-2 focus-visible:ring-white group-hover:scale-[1.22] group-hover:shadow-[0_16px_40px_rgba(0,0,0,.85)] group-hover:delay-[350ms]"
      >
        {src ? (
          <>
            {!loaded && <div className="skeleton absolute inset-0" />}
            <img
              src={src}
              alt={item.title}
              loading="lazy"
              draggable={false}
              onLoad={() => setLoaded(true)}
              className={cx('h-full w-full object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
            />
          </>
        ) : (
          <Fallback title={item.title} />
        )}

        {/* wide cards show their title on the art until hovered */}
        {variant === 'wide' && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2.5 pt-8 transition-opacity duration-200 group-hover:opacity-0">
            <p className="truncate text-[13px] font-bold">{item.title}</p>
            {subtitle && <p className="truncate text-[11px] text-white/70">{subtitle}</p>}
          </div>
        )}

        {badge && (
          <span className="absolute left-2 top-2 rounded-sm bg-nf-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">{badge}</span>
        )}

        {progress != null && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
            <div className="h-full bg-nf-red" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}

        {/* hover details panel */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-[#181818] via-[#181818]/95 to-transparent px-2.5 pb-2.5 pt-14 opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-hover:delay-[350ms]">
          <div className="flex items-center gap-1.5">
            <button
              onClick={stop(onPlay)}
              aria-label={`Play ${item.title}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/75"
            >
              <PlayIcon size={17} />
            </button>
            {item.id && (
              <button
                onClick={stop(() => toggleList(item))}
                aria-label={listed ? 'Remove from My List' : 'Add to My List'}
                className="icon-btn !h-8 !w-8"
              >
                {listed ? <CheckIcon size={15} /> : <PlusIcon size={15} />}
              </button>
            )}
            <button onClick={stop(onOpen)} aria-label="More info" className="icon-btn ml-auto !h-8 !w-8">
              <ChevronDown size={16} />
            </button>
          </div>

          {variant === 'wide' && <p className="mt-2 truncate text-xs font-bold">{item.title}</p>}
          {subtitle && variant === 'wide' && <p className="truncate text-[11px] text-white/70">{subtitle}</p>}

          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold">
            {item.rating ? <span className="text-[#46d369]">★ {item.rating}</span> : null}
            <span className="rounded-sm border border-white/40 px-1 text-[9px] font-medium text-white/80">
              {item.type === 'tv' ? 'SERIES' : 'MOVIE'}
            </span>
            {item.year ? <span className="font-medium text-white/70">{item.year}</span> : null}
          </div>
          {item.genres?.length ? (
            <p className="mt-1 truncate text-[11px] text-white/90">{item.genres.join('  \u2022  ')}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
