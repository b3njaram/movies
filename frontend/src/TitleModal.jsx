import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useApp } from './context';
import { CheckIcon, ChevronDown, CloseIcon, ListIcon, PlayIcon, PlusIcon } from './Icons';
import SourcePicker from './SourcePicker';
import { cx, fmtRuntime, img } from './utils';

function Hero({ data, children, onClose }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black">
      {data.backdrop && <img src={img(data.backdrop, 'w1280')} alt="" className="h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#181818] transition-colors hover:bg-[#2a2a2a]">
        <CloseIcon size={20} />
      </button>
      <div className="absolute inset-x-0 bottom-0 px-6 pb-6 sm:px-10 sm:pb-8">{children}</div>
    </div>
  );
}

export default function TitleModal({ target, onClose, onOpenOther }) {
  const { play, inList, toggleList, download } = useApp();
  const scrollRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [playTarget, setPlayTarget] = useState(null);
  const [progress, setProgress] = useState([]);
  const [season, setSeason] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [showSources, setShowSources] = useState(false);
  const [epSources, setEpSources] = useState(null); // "season:episode" whose source list is open
  const requested = useRef(new Set());

  const { type, id } = target;

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    setPlayTarget(null);
    setProgress([]);
    setEpisodes({});
    setSeason(null);
    setShowSources(false);
    setEpSources(null);
    requested.current = new Set();
    scrollRef.current?.scrollTo({ top: 0 });

    Promise.all([
      api(`/api/title/${type}/${id}`),
      api(`/api/title/${type}/${id}/target`).catch(() => null),
      api(`/api/progress/title?type=${type}&id=${id}`).catch(() => ({ items: [] })),
    ])
      .then(([d, t, p]) => {
        if (!alive) return;
        setData(d);
        setPlayTarget(t);
        setProgress(p.items);
        if (type === 'tv') setSeason(t?.season ?? d.seasons?.[0]?.number ?? 1);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [type, id]);

  // Episodes are cached per "<title>:<season>"; each season is requested at most once.
  useEffect(() => {
    if (type !== 'tv' || season == null) return;
    const key = `${id}:${season}`;
    if (requested.current.has(key)) return;
    requested.current.add(key);
    setEpisodes((prev) => ({ ...prev, [key]: { loading: true, list: [] } }));
    api(`/api/title/tv/${id}/season/${season}`)
      .then((s) => setEpisodes((prev) => ({ ...prev, [key]: { loading: false, list: s.episodes } })))
      .catch(() => setEpisodes((prev) => ({ ...prev, [key]: { loading: false, list: [] } })));
  }, [type, id, season]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const progressMap = useMemo(() => {
    const m = {};
    for (const r of progress) m[`${r.season}:${r.episode}`] = r;
    return m;
  }, [progress]);

  const baseSpec = data && { type, tmdbId: data.id, title: data.title, year: data.year, poster: data.poster, backdrop: data.backdrop };
  const specFor = (s, e, name) => (type === 'tv' ? { ...baseSpec, season: s, episode: e, episodeTitle: name } : baseSpec);
  const mainSpec = data && (type === 'tv' && playTarget ? specFor(playTarget.season, playTarget.episode, playTarget.name) : baseSpec);

  const listed = data ? inList(type, data.id) : false;
  const resumeLeft =
    playTarget?.resume && playTarget.durationSeconds ? Math.max(1, Math.round((playTarget.durationSeconds - playTarget.positionSeconds) / 60)) : null;

  const seasonData = episodes[`${id}:${season}`];

  return (
    <div
      ref={scrollRef}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className="thin-scroll fixed inset-0 z-[120] flex animate-fadeIn items-start justify-center overflow-y-auto bg-black/75"
    >
      <div className="relative my-0 w-full max-w-[880px] animate-scaleIn overflow-hidden bg-[#181818] shadow-[0_20px_80px_rgba(0,0,0,.9)] sm:my-10 sm:rounded-lg">
        {!data && !error && (
          <>
            <div className="skeleton aspect-video w-full" />
            <div className="space-y-3 p-8">
              <div className="skeleton h-5 w-1/3 rounded" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-5/6 rounded" />
            </div>
          </>
        )}

        {error && (
          <div className="p-10 text-center">
            <p className="text-lg">{error}</p>
            <button onClick={onClose} className="btn-white mt-6">
              Close
            </button>
          </div>
        )}

        {data && (
          <>
            <Hero data={data} onClose={onClose}>
              {data.logo ? (
                <img src={img(data.logo, 'w500')} alt={data.title} className="mb-5 max-h-[110px] max-w-[60%] object-contain object-left drop-shadow-[0_2px_12px_rgba(0,0,0,.7)]" />
              ) : (
                <h2 className="mb-5 text-3xl font-black leading-tight drop-shadow-lg sm:text-5xl">{data.title}</h2>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                <button onClick={() => play(mainSpec)} className="btn-white !px-6 sm:!px-8 sm:!py-2.5 sm:!text-xl">
                  <PlayIcon size={26} />
                  {playTarget?.resume ? 'Resume' : 'Play'}
                  {type === 'tv' && playTarget && <span className="text-sm font-medium opacity-70">S{playTarget.season}:E{playTarget.episode}</span>}
                </button>
                <button
                  onClick={() => toggleList(data)}
                  aria-label={listed ? 'Remove from My List' : 'Add to My List'}
                  title={listed ? 'Remove from My List' : 'Add to My List'}
                  className="icon-btn !h-11 !w-11"
                >
                  {listed ? <CheckIcon size={20} /> : <PlusIcon size={20} />}
                </button>
                <button
                  onClick={() => setShowSources((v) => !v)}
                  aria-label="Choose a source"
                  title="Choose a source"
                  className={cx('icon-btn !h-11 !w-11', showSources && '!border-white !bg-white !text-black')}
                >
                  <ListIcon size={20} />
                </button>
                {resumeLeft != null && (
                  <div className="ml-2 flex items-center gap-2 text-sm text-white/85">
                    <div className="h-[3px] w-24 overflow-hidden rounded bg-white/30">
                      <div className="h-full bg-nf-red" style={{ width: `${Math.min(100, (playTarget.positionSeconds / playTarget.durationSeconds) * 100)}%` }} />
                    </div>
                    {resumeLeft} min left
                  </div>
                )}
              </div>
            </Hero>

            {showSources && mainSpec && (
              <div className="animate-fadeIn px-6 pt-4 sm:px-10">
                <p className="mb-2 text-sm text-[#b3b3b3]">
                  Pick a specific release{type === 'tv' && playTarget ? ` for S${playTarget.season}:E${playTarget.episode}` : ''}. Best matches are listed first.
                </p>
                <SourcePicker
                  spec={mainSpec}
                  onPick={(source) => play({ ...mainSpec, source })}
                  onPickFix={(source) => play({ ...mainSpec, source, audioFix: true })}
                  onDownload={(source) => download(source, mainSpec)}
                />
              </div>
            )}

            <div className="grid gap-6 px-6 py-6 sm:grid-cols-[2fr_1fr] sm:px-10">
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
                  {data.rating ? <span className="font-bold text-[#46d369]">★ {data.rating}</span> : null}
                  {data.year && <span className="text-[#bcbcbc]">{data.year}</span>}
                  {type === 'tv' && data.seasons?.length ? (
                    <span className="text-[#bcbcbc]">
                      {data.seasons.length} Season{data.seasons.length > 1 ? 's' : ''}
                    </span>
                  ) : null}
                  {type === 'movie' && data.runtime ? <span className="text-[#bcbcbc]">{fmtRuntime(data.runtime)}</span> : null}
                  {data.certification && <span className="rounded-sm border border-white/50 px-1.5 text-xs text-[#bcbcbc]">{data.certification}</span>}
                  <span className="rounded-sm border border-white/50 px-1 text-[10px] font-bold text-[#bcbcbc]">HD</span>
                </div>
                {data.tagline && <p className="mt-3 text-sm italic text-[#bcbcbc]">{data.tagline}</p>}
                <p className="mt-3 text-[15px] leading-relaxed text-white">{data.overview || 'No description available.'}</p>
              </div>
              <div className="space-y-2 text-[13px] leading-snug">
                {data.cast?.length > 0 && (
                  <p>
                    <span className="text-[#777]">Cast: </span>
                    {data.cast.slice(0, 4).join(', ')}
                  </p>
                )}
                {data.creators?.length > 0 && (
                  <p>
                    <span className="text-[#777]">Creators: </span>
                    {data.creators.join(', ')}
                  </p>
                )}
                {data.genres?.length > 0 && (
                  <p>
                    <span className="text-[#777]">Genres: </span>
                    {data.genres.join(', ')}
                  </p>
                )}
              </div>
            </div>

            {type === 'tv' && data.seasons?.length > 0 && (
              <section className="px-6 pb-6 sm:px-10">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-2xl font-bold">Episodes</h3>
                  <div className="relative">
                    <select
                      value={season ?? ''}
                      onChange={(e) => setSeason(Number(e.target.value))}
                      className="cursor-pointer appearance-none rounded border border-white/30 bg-[#242424] py-2 pl-4 pr-10 text-base font-medium outline-none hover:border-white"
                    >
                      {data.seasons.map((s) => (
                        <option key={s.number} value={s.number}>
                          {s.name || `Season ${s.number}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="border-t border-[#404040]">
                  {seasonData?.loading && <div className="skeleton my-4 h-24 w-full rounded" />}
                  {seasonData?.list.map((ep) => {
                    const pr = progressMap[`${season}:${ep.number}`];
                    const pct = pr && pr.durationSeconds ? Math.min(1, pr.positionSeconds / pr.durationSeconds) : 0;
                    const isTarget = playTarget?.season === season && playTarget?.episode === ep.number;
                    const epKey = `${season}:${ep.number}`;
                    const epSpec = specFor(season, ep.number, ep.name);
                    return (
                      <div key={ep.number} className={cx('border-b border-[#404040]', isTarget && 'bg-[#333]')}>
                        <div className="group flex items-center transition-colors hover:bg-[#2a2a2a]">
                          <button
                            onClick={() => play(epSpec)}
                            className="flex min-w-0 flex-1 items-center gap-3 px-2 py-4 text-left sm:gap-5 sm:px-4"
                          >
                            <span className="w-6 shrink-0 text-center text-xl text-[#d2d2d2] sm:w-8 sm:text-2xl">{ep.number}</span>
                            <span className="relative aspect-video w-[112px] shrink-0 overflow-hidden rounded bg-[#2a2a2a] sm:w-[130px]">
                              {ep.still && <img src={img(ep.still, 'w300')} alt="" loading="lazy" className="h-full w-full object-cover" />}
                              <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-black/50">
                                  <PlayIcon size={18} />
                                </span>
                              </span>
                              {pct > 0 && (
                                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
                                  <span className="block h-full bg-nf-red" style={{ width: `${pct * 100}%` }} />
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-3">
                                <span className="truncate text-[15px] font-bold sm:text-base">{ep.name}</span>
                                <span className="shrink-0 text-sm text-[#d2d2d2]">{ep.runtime ? `${ep.runtime}m` : ''}</span>
                              </span>
                              <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-[#d2d2d2]">{ep.overview}</span>
                              {pr?.completed && (
                                <span className="mt-1 inline-flex items-center gap-1 text-xs text-[#46d369]">
                                  <CheckIcon size={13} /> Watched
                                </span>
                              )}
                            </span>
                          </button>
                          <button
                            onClick={() => setEpSources(epSources === epKey ? null : epKey)}
                            aria-label={`Sources and download for episode ${ep.number}`}
                            title="Sources & download"
                            className={cx('icon-btn mr-2 !h-9 !w-9 shrink-0 sm:mr-4', epSources === epKey && '!border-white !bg-white !text-black')}
                          >
                            <ListIcon size={16} />
                          </button>
                        </div>
                        {epSources === epKey && (
                          <div className="animate-fadeIn px-2 pb-4 sm:px-4">
                            <SourcePicker
                              spec={epSpec}
                              onPick={(source) => play({ ...epSpec, source })}
                              onPickFix={(source) => play({ ...epSpec, source, audioFix: true })}
                              onDownload={(source) => download(source, epSpec)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {seasonData && !seasonData.loading && seasonData.list.length === 0 && (
                    <p className="py-6 text-sm text-[#b3b3b3]">No episode information is available for this season.</p>
                  )}
                </div>
              </section>
            )}

            {data.similar?.length > 0 && (
              <section className="px-6 pb-10 sm:px-10">
                <h3 className="mb-4 text-2xl font-bold">More Like This</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {data.similar.slice(0, 9).map((s) => (
                    <button
                      key={`${s.type}-${s.id}`}
                      onClick={() => onOpenOther(s)}
                      className="group overflow-hidden rounded bg-[#2f2f2f] text-left transition-transform duration-200 hover:scale-[1.03]"
                    >
                      <div className="relative aspect-video bg-[#222]">
                        {(s.backdrop || s.poster) && <img src={img(s.backdrop || s.poster, 'w300')} alt={s.title} loading="lazy" className="h-full w-full object-cover" />}
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-1.5 pt-6 text-sm font-bold">{s.title}</span>
                      </div>
                      <div className="p-3">
                        <div className="mb-1.5 flex items-center gap-2 text-xs">
                          {s.rating ? <span className="font-bold text-[#46d369]">★ {s.rating}</span> : null}
                          <span className="text-[#bcbcbc]">{s.year}</span>
                        </div>
                        <p className="line-clamp-3 text-xs leading-snug text-[#d2d2d2]">{s.overview}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
