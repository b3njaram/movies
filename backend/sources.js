import crypto from 'crypto';
import { httpError } from './tmdb.js';

// ---------------------------------------------------------------------------
// Opaque link references.
// Prowlarr "download" links embed the Prowlarr API key. We never send those to
// the browser; instead the client receives "ref:<token>" and the server resolves
// it again when the user presses play.
// ---------------------------------------------------------------------------

const refs = new Map();
const REF_TTL_MS = 60 * 60 * 1000;
const REF_MAX = 2000;

export function makeRef(url) {
  const token = crypto.randomBytes(9).toString('base64url');
  refs.set(token, { url, at: Date.now() });
  if (refs.size > REF_MAX) {
    const oldest = [...refs.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 200);
    for (const [k] of oldest) refs.delete(k);
  }
  return `ref:${token}`;
}

export function lookupRef(ref) {
  const entry = refs.get(ref.replace(/^ref:/, ''));
  if (!entry || Date.now() - entry.at > REF_TTL_MS) return null;
  return entry.url;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Star Wars: Episode IV" -> ["star wars episode iv", "star wars"]
export function titleVariants(title) {
  const full = normalize(title);
  const short = normalize(String(title).split(/[:\u2013\u2014]| - /)[0]);
  return [...new Set([full, short].filter((v) => v.length > 1))];
}

export function titleMatches(releaseTitle, variants, year) {
  const r = ` ${normalize(releaseTitle)} `;
  if (!variants.some((v) => r.includes(` ${v} `))) return false;
  if (year) {
    const wanted = Number(year);
    const years = [...r.matchAll(/ (19\d\d|20\d\d) /g)].map((m) => Number(m[1]));
    // If the release states a year, it must be (about) the right one — avoids remakes.
    if (years.length && !years.some((y) => Math.abs(y - wanted) <= 1)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Release parsing + scoring
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audio language, read from the release name.
// Only the part AFTER the title/year is inspected (so a film called "Spa Night" is not "Spanish"),
// and subtitle-only tags ("ENG SUBS", "VOSTFR") do not count as audio.
// ---------------------------------------------------------------------------

const LANG_RULES = [
  ['es-lat', /\b(latino|latin|latam|lat|es (la|mx|419)|spa lat)\b/],
  ['es-esp', /\b(castellano|es es|spain|iberico)\b/],
  ['es', /\b(spanish|espanol|esp|spa)\b/],
  ['en', /\b(english|eng|ingles)\b/],
  ['fr', /\b(french|truefrench|vff|vfq|vfi|vf|fre|fra)\b/],
  ['de', /\b(german|deutsch|ger|deu)\b/],
  ['it', /\b(italian|ita)\b/],
  ['pt', /\b(portuguese|portugues|dublado|ptbr|pt br|por)\b/],
  ['ru', /\b(russian|rus)\b/],
  ['hi', /\b(hindi|hin)\b/],
  ['ja', /\b(japanese|jpn|jap)\b/],
  ['ko', /\b(korean|kor)\b/],
  ['zh', /\b(chinese|mandarin|cantonese|chi|zho)\b/],
  ['pl', /\b(polish|pol|lektor)\b/],
  ['tr', /\b(turkish|tur)\b/],
];
const LANG_ORDER = ['en', 'es', 'es-lat', 'es-esp', 'fr', 'de', 'it', 'pt', 'ru', 'hi', 'ja', 'ko', 'zh', 'pl', 'tr', 'multi'];
const LANG_LABEL = {
  en: 'EN', es: 'ES', 'es-lat': 'ES\u00b7LAT', 'es-esp': 'ES\u00b7ESP', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT',
  ru: 'RU', hi: 'HI', ja: 'JA', ko: 'KO', zh: 'ZH', pl: 'PL', tr: 'TR', multi: 'MULTI',
};

export function parseLanguages(name) {
  const spaced = ` ${String(name || '').toLowerCase().replace(/[._\-+[\](){}]+/g, ' ').replace(/\s+/g, ' ')} `;
  const marker = /\b(19\d\d|20\d\d)\b|\bs\d{1,2}(e\d{1,3})?\b|\b(2160p|1080[pi]|720p|480p|576p)\b/.exec(spaced);
  let tail = marker ? spaced.slice(marker.index) : spaced;

  // language words that belong to SUBTITLES, not to the sound
  tail = tail
    .replace(/\b\w+ (subs?|subbed|subtitles?)\b/g, ' ')
    .replace(/\b(subs?|subbed|subtitles?) \w+\b/g, ' ')
    .replace(/\b(vostfr|vose|vosta|vost|multisubs?|msubs?|esubs?|hc)\b/g, ' ');

  const found = new Set();
  for (const [code, re] of LANG_RULES) if (re.test(tail)) found.add(code);
  if (found.has('es-lat') || found.has('es-esp')) found.delete('es'); // the specific kind wins

  const dual = /\b(dual|dualaudio)\b/.test(tail);
  const multi = /\bmulti(audio|lang)?\b/.test(tail);
  if (dual) found.add('en'); // "Dual" pairs the original (English) track with a local dub
  let assumed = false;
  if (!found.size) {
    if (multi) found.add('multi');
    else {
      found.add('en'); // nothing stated: scene releases of Western titles are English
      assumed = true;
    }
  }
  const languages = LANG_ORDER.filter((l) => found.has(l));
  return { languages, langAssumed: assumed, langLabel: languages.map((l) => LANG_LABEL[l]).join('+') };
}

// How well a release's audio fits the viewer's preferred language ('en' | 'es').
export function languageFit(p, pref) {
  const hasEn = p.languages.includes('en');
  const hasEs = p.languages.some((l) => l.startsWith('es'));
  const multi = p.languages.includes('multi');
  if (pref === 'es') {
    if (hasEs) return { score: 100 + (p.languages.includes('es-lat') ? 10 : 0), match: 'preferred' };
    if (multi) return { score: 20, match: 'ok' };
    if (hasEn) return { score: p.langAssumed ? -20 : -30, match: 'ok' };
    return { score: -120, match: 'other' };
  }
  if (hasEn) return { score: p.langAssumed ? 25 : 35, match: p.langAssumed ? 'ok' : 'preferred' };
  if (multi) return { score: 5, match: 'ok' };
  return { score: hasEs ? -90 : -120, match: 'other' };
}

export function parseRelease(name) {
  const t = String(name || '').toLowerCase();

  let quality = 'SD';
  if (/\b(2160p|4k|uhd)\b/.test(t)) quality = '2160p';
  else if (/\b1080[pi]\b/.test(t)) quality = '1080p';
  else if (/\b720p\b/.test(t)) quality = '720p';
  else if (/\b(480p|576p)\b/.test(t)) quality = '480p';

  const hevc = /\b(x265|h[ .]?265|hevc)\b/.test(t);
  const av1 = /\bav1\b/.test(t);
  const h264 = /\b(x264|h[ .]?264|avc)\b/.test(t);
  const surround = /\b(ac3|e-?ac-?3|dd[p+]?\d|dd\+|ddp|dts|truehd|atmos)/.test(t);
  const aac = /\b(aac|opus|mp3)/.test(t); // audio every browser can decode

  let audio = null;
  if (/\batmos\b/.test(t)) audio = 'Atmos';
  else if (/\btruehd\b/.test(t)) audio = 'TrueHD';
  else if (/\bdts/.test(t)) audio = 'DTS';
  else if (/\b(e-?ac-?3|ddp|dd\+|dd[p+]\d)/.test(t)) audio = 'DD+';
  else if (/\b(ac3|dd\d)/.test(t)) audio = 'AC3';
  else if (/\baac/.test(t)) audio = 'AAC';
  else if (/\bopus\b/.test(t)) audio = 'Opus';
  else if (/\bmp3\b/.test(t)) audio = 'MP3';
  const remux = /\bremux\b/.test(t);
  const hdr = /\b(hdr10?\+?|dolby[ .]?vision|dv)\b/.test(t);

  let source = null;
  if (/\b(cam|hdcam|camrip|hdts|hd-ts|telesync|telecine|dvdscr|screener)\b/.test(t)) source = 'CAM';
  else if (/\b(web[ .-]?dl|webrip|web)\b/.test(t)) source = 'WEB';
  else if (/\b(blu[ .-]?ray|bdrip|brrip|bdremux|remux)\b/.test(t)) source = 'BluRay';
  else if (/\bhdtv\b/.test(t)) source = 'HDTV';
  else if (/\b(dvdrip|dvd)\b/.test(t)) source = 'DVD';
  else if (/\bts\b/.test(t)) source = 'CAM';

  const se = t.match(/\bs(\d{1,2})[ ._-]?e(\d{1,3})\b/);
  const season = se ? Number(se[1]) : null;
  const episode = se ? Number(se[2]) : null;

  let pack = false;
  let packSeason = null;
  if (!se) {
    const packMatch = t.match(/\bs(\d{1,2})\b/) || t.match(/season[ ._-]?(\d{1,2})\b/);
    if (packMatch) {
      pack = true;
      packSeason = Number(packMatch[1]);
    } else if (/\b(complete|collection|all[ .]seasons)\b/.test(t)) {
      pack = true;
    }
  }

  const lang = parseLanguages(name);

  return { quality, hevc, av1, h264, surround, aac, audio, remux, hdr, source, season, episode, pack, packSeason, ...lang };
}

export function scoreRelease(p, seeders, sizeBytes, want = {}) {
  let s = Math.log2(seeders + 1) * 12;
  s += { '2160p': 8, '1080p': 34, '720p': 20, '480p': 2, SD: -5 }[p.quality] ?? 0;
  if (p.source === 'CAM') s -= 300;
  if (p.source === 'WEB' || p.source === 'BluRay') s += 8;
  if (p.hevc) s -= 28;
  if (p.av1) s -= 40;
  // Browsers (Firefox especially) cannot decode AC3/E-AC3/DTS/TrueHD, which shows up as "no sound".
  // AAC is strongly preferred; it outweighs roughly a 5x seeder advantage.
  if (p.aac) s += 45;
  if (p.surround) s -= 35;
  if (p.remux) s -= 40;

  const gb = (sizeBytes || 0) / 1024 ** 3;
  if (want.type === 'movie') {
    if (gb > 25) s -= 25;
    if (gb > 0 && gb < 0.5) s -= 15;
  }
  s += languageFit(p, want.lang === 'es' ? 'es' : 'en').score;
  if (seeders < 1) s -= 1000;
  else if (seeders < 3) s -= 15;

  if (want.type === 'tv' && want.episode != null) {
    if (p.season === want.season && p.episode === want.episode) s += 40;
    else if (p.pack && p.packSeason === want.season) s += 5;
    else if (p.pack && p.packSeason == null) s -= 10;
    else s -= 1000; // different episode / different season
  }
  return Math.round(s);
}

export function bytesToSize(bytes) {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Prowlarr search
// ---------------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

function buildQueries({ type, title, altTitles = [], year, season, episode, q }) {
  if (q) return [q];
  const variants = titleVariants(title);
  const shortTitle = variants[variants.length - 1];
  const names = [title];
  if (shortTitle && normalize(title) !== shortTitle) names.push(shortTitle);
  // Spanish releases are named with the Spanish title, so those get searched for too
  for (const alt of altTitles) if (alt && !names.some((n) => normalize(n) === normalize(alt))) names.push(alt);

  if (type === 'movie') return names.map((n) => `${n} ${year || ''}`.trim());
  const sxx = `S${pad(season ?? 1)}`;
  const bases = [title, ...altTitles.filter((a) => a && normalize(a) !== normalize(title))];
  if (episode == null) return bases.map((n) => `${n} ${sxx}`);
  return bases.flatMap((n) => [`${n} ${sxx}E${pad(episode)}`, `${n} ${sxx}`]);
}

function magnetFromHash(hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || hash)}`;
}

// ---------------------------------------------------------------------------
// Asking Prowlarr. One call across ALL indexers is only as fast as the slowest one (indexers behind
// FlareSolverr can take a minute), which can push a single request past Cloudflare's 100 second
// limit. So each indexer is searched on its own with a short timeout; whatever answered in time is
// used and the rest are reported as "skipped".
// ---------------------------------------------------------------------------

const PER_INDEXER_MS = Number(process.env.INDEXER_TIMEOUT_MS || 25000);
const TOTAL_MS = Number(process.env.SEARCH_TOTAL_MS || 40000);
const CONCURRENCY = 8;
let indexerCache = { at: 0, url: '', list: null };

const keyError = () =>
  httpError(
    502,
    'Prowlarr rejected the API key. Check PROWLARR_API_KEY in your .env against Settings → General in Prowlarr.',
    'PROWLARR_KEY'
  );

async function listIndexers(prowlarrUrl, apiKey) {
  if (indexerCache.list && indexerCache.url === prowlarrUrl && Date.now() - indexerCache.at < 60 * 1000) return indexerCache.list;
  let res;
  try {
    res = await fetch(`${prowlarrUrl}/api/v1/indexer`, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw httpError(502, `Could not reach Prowlarr (${e.message})`);
  }
  if (res.status === 401 || res.status === 403) throw keyError();
  if (!res.ok) return null; // unusual Prowlarr: fall back to one combined search
  const all = await res.json();
  const list = all
    .filter((i) => i.enable !== false && (!i.protocol || i.protocol === 'torrent'))
    .map((i) => ({ id: i.id, name: i.name || `#${i.id}` }));
  indexerCache = { at: Date.now(), url: prowlarrUrl, list };
  return list;
}

async function prowlarrSearch(prowlarrUrl, apiKey, query, category, indexerId, timeoutMs) {
  const only = indexerId != null ? `&indexerIds=${indexerId}` : '';
  const res = await fetch(`${prowlarrUrl}/api/v1/search?query=${encodeURIComponent(query)}&type=search&limit=100${category}${only}`, {
    headers: { 'X-Api-Key': apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw keyError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function runPool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= tasks.length) return;
        try {
          out[i] = { ok: true, value: await tasks[i]() };
        } catch (error) {
          out[i] = { ok: false, error };
        }
      }
    })
  );
  return out;
}

export async function searchSources({ prowlarrUrl, apiKey, ...want }) {
  const queries = buildQueries(want);
  const category = want.type === 'movie' ? '&categories=2000' : want.type === 'tv' ? '&categories=5000' : '';
  const deadline = Date.now() + TOTAL_MS;

  let raws = [];
  let skipped = [];
  const indexers = await listIndexers(prowlarrUrl, apiKey);

  if (indexers === null) {
    try {
      raws = (await Promise.all(queries.map((q) => prowlarrSearch(prowlarrUrl, apiKey, q, category, null, TOTAL_MS)))).flat();
    } catch (e) {
      if (e.code === 'PROWLARR_KEY') throw e;
      throw httpError(502, `Prowlarr did not answer in time (${e.message})`);
    }
  } else {
    if (!indexers.length) throw httpError(404, 'No torrent indexers are enabled in Prowlarr. Add or enable one in Prowlarr → Indexers.');
    const jobs = indexers.flatMap((ix) => queries.map((q) => ({ ix, q })));
    const outcomes = await runPool(
      jobs.map((j) => async () => {
        const left = deadline - Date.now();
        if (left < 500) throw new Error('out of time');
        return prowlarrSearch(prowlarrUrl, apiKey, j.q, category, j.ix.id, Math.min(PER_INDEXER_MS, left));
      }),
      CONCURRENCY
    );

    const bad = outcomes.find((o) => !o.ok && o.error.code === 'PROWLARR_KEY');
    if (bad) throw bad.error;

    const answered = new Set();
    const failed = new Set();
    outcomes.forEach((o, i) => {
      if (o.ok) {
        raws.push(...o.value);
        answered.add(jobs[i].ix.name);
      } else failed.add(jobs[i].ix.name);
    });
    skipped = [...failed].filter((n) => !answered.has(n));
    if (!answered.size) {
      throw httpError(
        504,
        `None of your indexers answered within ${Math.round(PER_INDEXER_MS / 1000)} seconds (${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}). Check them in Prowlarr → Indexers, or try again.`
      );
    }
  }

  const seen = new Set();
  const variants = want.title ? [...new Set([...titleVariants(want.title), ...(want.altTitles || []).flatMap(titleVariants)])] : [];
  const pref = want.lang === 'es' ? 'es' : 'en';
  const out = [];

  for (const raw of raws) {
    if (raw.protocol && raw.protocol !== 'torrent') continue;
    const dedupeKey = raw.infoHash || raw.guid || `${raw.title}:${raw.size}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const link =
      raw.magnetUrl ||
      (raw.infoHash ? magnetFromHash(raw.infoHash, raw.title) : null) ||
      (raw.downloadUrl ? makeRef(raw.downloadUrl) : null);
    if (!link) continue;

    if (variants.length && !titleMatches(raw.title, variants, want.type === 'movie' ? want.year : null)) continue;

    const parsed = parseRelease(raw.title);
    if (want.type === 'tv' && want.episode != null) {
      const wrongEpisode = parsed.season != null && (parsed.season !== want.season || parsed.episode !== want.episode);
      const wrongPack = parsed.pack && parsed.packSeason != null && parsed.packSeason !== want.season;
      if (wrongEpisode || wrongPack) continue;
    }
    const seeders = raw.seeders ?? 0;
    const score = want.type ? scoreRelease(parsed, seeders, raw.size, { ...want, lang: pref }) : seeders;
    const fit = languageFit(parsed, pref);

    out.push({
      id: dedupeKey,
      title: raw.title,
      size: bytesToSize(raw.size),
      sizeBytes: raw.size || 0,
      seeders,
      leechers: raw.leechers ?? 0,
      indexer: raw.indexer || String(raw.indexerId || ''),
      publishDate: raw.publishDate || null,
      link,
      quality: parsed.quality,
      source: parsed.source,
      codec: parsed.hevc ? 'HEVC' : parsed.av1 ? 'AV1' : parsed.h264 ? 'H.264' : null,
      hdr: parsed.hdr,
      pack: parsed.pack,
      audio: parsed.audio,
      lang: parsed.langLabel,
      langs: parsed.languages,
      langAssumed: parsed.langAssumed,
      langMatch: fit.match,
      // HEVC/AV1 video often will not play in a browser (the audio fix cannot help with that)...
      videoRisk: parsed.hevc || parsed.av1,
      // ...while AC3/E-AC3/DTS/TrueHD audio plays silently in many browsers (the audio fix solves it).
      audioRisk: parsed.surround,
      risky: parsed.hevc || parsed.av1 || parsed.surround,
      score,
    });
  }

  out.sort((a, b) => b.score - a.score || b.seeders - a.seeders);
  return { results: out.slice(0, 40), skipped };
}

// Short description of a release name (used for the file that is actually playing).
export function describeRelease(name) {
  const p = parseRelease(name);
  return {
    name,
    quality: p.quality,
    audio: p.audio,
    codec: p.hevc ? 'HEVC' : p.av1 ? 'AV1' : p.h264 ? 'H.264' : null,
    source: p.source,
    lang: p.langLabel,
    langs: p.languages,
    langAssumed: p.langAssumed,
  };
}
