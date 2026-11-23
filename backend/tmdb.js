import { cacheGet, cacheSet } from './db.js';
import { allowedByRating, selectFavoriteGenre } from './premium.js';

const KEY = process.env.TMDB_API_KEY || '';
const LANG = process.env.TMDB_LANGUAGE || 'en-US';

export const tmdbEnabled = () => Boolean(KEY);

export function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

async function tmdbFetch(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  const headers = { accept: 'application/json' };
  // Both key styles work: the short "API Key (v3)" or the long "Read Access Token (v4)".
  if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
  else url.searchParams.set('api_key', KEY);
  url.searchParams.set('language', LANG);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  } catch (e) {
    throw httpError(502, `Could not reach TMDB (${e.message})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw httpError(502, 'TMDB rejected the API key. Check TMDB_API_KEY in your .env file.');
  }
  if (res.status === 404) throw httpError(404, 'Not found');
  if (!res.ok) throw httpError(502, `TMDB error (HTTP ${res.status})`);
  return res.json();
}

// Coalesce simultaneous metadata requests across profiles without changing the
// persistent TMDB cache or increasing the polling interval.
const inFlight = new Map();
async function cached(key, ttlSeconds, producer) {
  const hit = cacheGet(key, ttlSeconds);
  if (hit) return hit;
  if (inFlight.has(key)) return inFlight.get(key);
  const task = Promise.resolve().then(producer).then(value => {
    cacheSet(key, value);
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};

const KIDS_GENRES = new Set([16, 10751, 10762]);

export function isKidsFriendly(item) {
  return !item.adult && (item.genreIds || []).some((g) => KIDS_GENRES.has(g));
}

function normItem(raw, forcedType) {
  const type = raw.media_type || forcedType || (raw.title !== undefined ? 'movie' : 'tv');
  const date = raw.release_date || raw.first_air_date || '';
  return {
    id: raw.id,
    type,
    title: raw.title || raw.name || 'Untitled',
    year: date.slice(0, 4),
    overview: raw.overview || '',
    poster: raw.poster_path || null,
    backdrop: raw.backdrop_path || null,
    rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null,
    genres: (raw.genre_ids || []).map((g) => GENRES[g]).filter(Boolean).slice(0, 3),
    genreIds: raw.genre_ids || [],
    adult: Boolean(raw.adult),
  };
}

function toRowItems(results, forcedType) {
  return (results || [])
    .filter((r) => !r.media_type || r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => normItem(r, forcedType))
    .filter((i) => i.poster || i.backdrop)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Title details
// ---------------------------------------------------------------------------

export async function getTitle(type, id) {
  return cached(`title:${type}:${id}`, 24 * 3600, async () => {
    const append =
      type === 'movie'
        ? 'credits,videos,images,similar,release_dates'
        : 'credits,videos,images,similar,content_ratings';
    const d = await tmdbFetch(`/${type}/${id}`, {
      append_to_response: append,
      include_image_language: 'en,null',
      include_video_language: 'en,null',
    });

    const item = normItem({ ...d, genre_ids: (d.genres || []).map((g) => g.id) }, type);
    const logos = d.images?.logos || [];
    const logo = logos.find((l) => l.iso_639_1 === 'en') || logos[0];

    const vids = (d.videos?.results || []).filter((v) => v.site === 'YouTube');
    const trailer =
      vids.find((v) => v.type === 'Trailer' && v.official) ||
      vids.find((v) => v.type === 'Trailer') ||
      vids.find((v) => v.type === 'Teaser');

    let certification = null;
    if (type === 'movie') {
      const us = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US');
      certification = us?.release_dates?.find((r) => r.certification)?.certification || null;
    } else {
      const us = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US');
      certification = us?.rating || null;
    }

    let seasons;
    if (type === 'tv') {
      const all = (d.seasons || []).filter((s) => s.episode_count > 0);
      const regular = all.filter((s) => s.season_number > 0);
      seasons = (regular.length ? regular : all).map((s) => ({
        number: s.season_number,
        name: s.name,
        episodeCount: s.episode_count,
      }));
    }

    return {
      ...item,
      genres: (d.genres || []).map((g) => g.name),
      tagline: d.tagline || '',
      runtime: type === 'movie' ? d.runtime || null : d.episode_run_time?.[0] || null,
      logo: logo?.file_path || null,
      trailer: trailer?.key || null,
      certification,
      cast: (d.credits?.cast || []).slice(0, 10).map((c) => c.name),
      creators: type === 'tv' ? (d.created_by || []).map((c) => c.name) : undefined,
      seasons,
      status: d.status || null,
      similar: toRowItems(d.similar?.results, type).slice(0, 12),
    };
  });
}

// Lightweight, separately cached airing status. This is intentionally fresher than
// the 24-hour title details cache and doesn't fetch credits, images or trailers.
export async function getTvAirStatus(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n < 1) throw httpError(400, 'Invalid TV show ID.');
  return cached(`tv-air:${n}`, 60 * 60, async () => {
    const d = await tmdbFetch(`/tv/${n}`);
    return { last: d.last_episode_to_air || null, next: d.next_episode_to_air || null };
  });
}

// The title as Spanish-language releases are named (e.g. "El Padrino" for "The Godfather").
export async function getLocalizedTitle(type, id, language = 'es-MX') {
  return cached(`title-loc:${language}:${type}:${id}`, 30 * 24 * 3600, async () => {
    const d = await tmdbFetch(`/${type}/${id}`, { language });
    return { title: d.title || d.name || null };
  });
}

export async function getSeason(tvId, seasonNumber) {
  return cached(`season:${tvId}:${seasonNumber}`, 12 * 3600, async () => {
    const d = await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`);
    return {
      number: seasonNumber,
      name: d.name,
      episodes: (d.episodes || []).map((e) => ({
        number: e.episode_number,
        name: e.name || `Episode ${e.episode_number}`,
        overview: e.overview || '',
        still: e.still_path || null,
        runtime: e.runtime || null,
        airDate: e.air_date || null,
      })),
    };
  });
}

export async function getNextEpisode(tvId, season, episode) {
  const show = await getTitle('tv', tvId);
  const seasonNumbers = (show.seasons || []).map((s) => s.number).sort((a, b) => a - b);

  const current = await getSeason(tvId, season).catch(() => null);
  const sameSeason = current?.episodes.find((e) => e.number > episode);
  if (sameSeason) return { season, episode: sameSeason.number, name: sameSeason.name };

  const nextSeasonNumber = seasonNumbers.find((n) => n > season);
  if (nextSeasonNumber === undefined) return null;
  const next = await getSeason(tvId, nextSeasonNumber).catch(() => null);
  const first = next?.episodes[0];
  return first ? { season: nextSeasonNumber, episode: first.number, name: first.name } : null;
}

export async function getFirstEpisode(tvId) {
  const show = await getTitle('tv', tvId);
  const firstSeason = (show.seasons || []).map((s) => s.number).sort((a, b) => a - b)[0] ?? 1;
  const season = await getSeason(tvId, firstSeason).catch(() => null);
  const first = season?.episodes[0];
  return { season: firstSeason, episode: first?.number ?? 1, name: first?.name || null };
}

export async function getEpisodeName(tvId, season, episode) {
  const s = await getSeason(tvId, season).catch(() => null);
  return s?.episodes.find((e) => e.number === episode)?.name || null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchTitles(query, { kids = false } = {}) {
  const key = `search:${query.toLowerCase().trim()}`;
  const items = await cached(key, 3600, async () => {
    const d = await tmdbFetch('/search/multi', { query, include_adult: 'false' });
    return (d.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => normItem(r))
      .filter((i) => i.poster)
      .slice(0, 36);
  });
  return kids ? items.filter(isKidsFriendly) : items;
}

// ---------------------------------------------------------------------------
// Browse pages (rows of titles + a billboard)
// ---------------------------------------------------------------------------

const discover = (type, genres, extra = {}) => ({
  path: `/discover/${type}`,
  type,
  params: {
    with_genres: genres,
    sort_by: 'popularity.desc',
    include_adult: 'false',
    'vote_count.gte': 150,
    ...extra,
  },
});
const list = (path, type) => ({ path, type, params: {} });

const KIDS_MOVIE = { certification_country: 'US', 'certification.lte': 'PG' };

const PAGES = {
  home: [
    ['Trending Now', list('/trending/all/week')],
    ['Popular Movies', list('/movie/popular', 'movie')],
    ['Popular TV Shows', list('/tv/popular', 'tv')],
    ['Top Rated Movies', list('/movie/top_rated', 'movie')],
    ['Action & Adventure', discover('movie', '28')],
    ['Comedies', discover('movie', '35')],
    ['Top Rated TV Shows', list('/tv/top_rated', 'tv')],
    ['Sci-Fi Movies', discover('movie', '878')],
    ['Crime TV Shows', discover('tv', '80')],
    ['Scary Movies', discover('movie', '27')],
    ['Animated Series', discover('tv', '16')],
    ['Romance', discover('movie', '10749')],
    ['Documentaries', discover('movie', '99')],
  ],
  tv: [
    ['Trending TV Shows', list('/trending/tv/week', 'tv')],
    ['Popular TV Shows', list('/tv/popular', 'tv')],
    ['Top Rated TV Shows', list('/tv/top_rated', 'tv')],
    ['Airing Today', list('/tv/airing_today', 'tv')],
    ['Dramas', discover('tv', '18')],
    ['Comedies', discover('tv', '35')],
    ['Sci-Fi & Fantasy', discover('tv', '10765')],
    ['Crime', discover('tv', '80')],
    ['Action & Adventure', discover('tv', '10759')],
    ['Animation', discover('tv', '16')],
    ['Reality TV', discover('tv', '10764')],
    ['Documentaries', discover('tv', '99')],
  ],
  movies: [
    ['Trending Movies', list('/trending/movie/week', 'movie')],
    ['Popular Movies', list('/movie/popular', 'movie')],
    ['Top Rated Movies', list('/movie/top_rated', 'movie')],
    ['Now Playing', list('/movie/now_playing', 'movie')],
    ['Action & Adventure', discover('movie', '28')],
    ['Comedies', discover('movie', '35')],
    ['Thrillers', discover('movie', '53')],
    ['Sci-Fi Movies', discover('movie', '878')],
    ['Scary Movies', discover('movie', '27')],
    ['Dramas', discover('movie', '18')],
    ['Romance', discover('movie', '10749')],
    ['Animation', discover('movie', '16')],
    ['Documentaries', discover('movie', '99')],
  ],
  new: [
    ['Trending Today', list('/trending/all/day')],
    ['Coming Soon', list('/movie/upcoming', 'movie')],
    ['Now Playing in Theaters', list('/movie/now_playing', 'movie')],
    ['TV Shows On The Air', list('/tv/on_the_air', 'tv')],
    ['Airing Today', list('/tv/airing_today', 'tv')],
    ['This Week\u2019s Top Movies', list('/trending/movie/week', 'movie')],
  ],
};

const KIDS_PAGE = [
  ['Family Movies', discover('movie', '10751', KIDS_MOVIE)],
  ['Animated Movies', discover('movie', '16', KIDS_MOVIE)],
  ['Kids TV Shows', discover('tv', '10762')],
  ['Animated Series', discover('tv', '16,10751')],
  ['Family TV', discover('tv', '10751')],
  ['Adventure for Kids', discover('movie', '12,10751', KIDS_MOVIE)],
];

export const BROWSE_PAGES = Object.keys(PAGES);

async function fetchRow([title, def]) {
  const items = await cached(`row:${def.path}:${JSON.stringify(def.params)}`, 6 * 3600, async () => {
    const d = await tmdbFetch(def.path, def.params);
    return toRowItems(d.results, def.type);
  });
  return { id: `${def.path}:${title}`, title, items };
}

export async function getBrowse(page, { kids = false, maxAge = 18 } = {}) {
  const defs = kids ? KIDS_PAGE : PAGES[page] || PAGES.home;
  const settled = await Promise.allSettled(defs.map(fetchRow));
  let rows = settled.filter((s) => s.status === 'fulfilled' && s.value.items.length).map((s) => s.value);
  if (maxAge < 18) {
    // TMDB genre labels alone are not age ratings. Confirm certification before
    // sending a card or billboard to a restricted profile. Work in a bounded
    // pool to avoid saturating TMDB on a cold cache.
    const jobs = rows.flatMap((row,r)=>row.items.slice(0,12).map(item=>({r,item})));
    const allowed=Array.from({length:rows.length},()=>[]);
    let next=0;
    await Promise.all(Array.from({length:6},async()=>{
      while(next<jobs.length){
        const job=jobs[next++];
        try { const detail=await getTitle(job.item.type,job.item.id);
          if(allowedByRating(detail.certification,maxAge)) allowed[job.r].push(job.item);
        } catch { /* Fail closed when certification cannot be verified. */ }
      }
    }));
    rows=rows.map((row,i)=>({...row,items:allowed[i]})).filter(row=>row.items.length);
  }

  if (!rows.length) {
    const firstError = settled.find((s) => s.status === 'rejected');
    if (firstError) throw firstError.reason;
  }

  // Billboard: pick from the top of the first row (random, so Home feels fresh).
  let billboard = null;
  const candidates = (rows[0]?.items || []).filter((i) => i.backdrop && i.overview).slice(0, 6);
  for (let attempt = 0; attempt < candidates.length && !billboard; attempt++) {
    const pick = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
    try {
      const d = await getTitle(pick.type, pick.id);
      billboard = {
        id: d.id,
        type: d.type,
        title: d.title,
        year: d.year,
        overview: d.overview,
        backdrop: d.backdrop,
        poster: d.poster,
        logo: d.logo,
        trailer: d.trailer,
        certification: d.certification,
        genres: d.genres.slice(0, 3),
        rating: d.rating,
      };
    } catch {
      /* try the next candidate */
    }
  }

  return { rows, billboard };
}

// ---------------------------------------------------------------------------
// Phase 2 discovery and history-driven suggestions (same TMDB key and cache)
// ---------------------------------------------------------------------------
export async function getDiscover(filters) {
  const {type,genre,year,minRating,sort} = filters;
  const params = {
    sort_by:type==='tv'&&sort==='primary_release_date.desc'?'first_air_date.desc':sort, include_adult:'false', 'vote_count.gte':minRating>0?150:30,
    'vote_average.gte':minRating || undefined,
    with_genres:genre || undefined,
    ...(year ? (type==='movie'?{'primary_release_year':year}:{first_air_date_year:year}) : {}),
  };
  const cacheKey = `phase2:discover:${type}:${JSON.stringify(params)}`;
  return cached(cacheKey,4*3600,async()=>{
    const data=await tmdbFetch(`/discover/${type}`,params);
    return toRowItems(data.results,type);
  });
}

export async function getRecommendations(seeds) {
  const details=await Promise.all(seeds.slice(0,8).map(async item=>{
    if(!['movie','tv'].includes(item.type)||!Number(item.id))return null;
    try {return await getTitle(item.type,item.id);} catch {return null;}
  }));
  const actual=details.filter(Boolean);
  const genre=selectFavoriteGenre(actual);
  if(!genre)return {items:[],genre:null};
  const favoredType=actual.filter(i=>i.type==='tv').length>actual.filter(i=>i.type==='movie').length?'tv':'movie';
  const candidates=await getDiscover({type:favoredType,genre:String(genre),sort:'popularity.desc',minRating:0,year:null});
  const watched=new Set(seeds.map(i=>`${i.type}:${i.id}`));
  return {items:candidates.filter(i=>!watched.has(`${i.type}:${i.id}`)),genre};
}
