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
  const surround = /\b(ac3|dd5|ddp|dd\+|eac3|e-ac-3|dts|truehd|atmos)/.test(t);
  const aac = /\baac/.test(t);
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

  return { quality, hevc, av1, h264, surround, aac, remux, hdr, source, season, episode, pack, packSeason };
}

export function scoreRelease(p, seeders, sizeBytes, want = {}) {
  let s = Math.log2(seeders + 1) * 12;
  s += { '2160p': 8, '1080p': 34, '720p': 20, '480p': 2, SD: -5 }[p.quality] ?? 0;
  if (p.source === 'CAM') s -= 300;
  if (p.source === 'WEB' || p.source === 'BluRay') s += 8;
  if (p.hevc) s -= 28;
  if (p.av1) s -= 40;
  if (p.aac) s += 14;
  if (p.surround) s -= 22;
  if (p.remux) s -= 40;

  const gb = (sizeBytes || 0) / 1024 ** 3;
  if (want.type === 'movie') {
    if (gb > 25) s -= 25;
    if (gb > 0 && gb < 0.5) s -= 15;
  }
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

function buildQueries({ type, title, year, season, episode, q }) {
  if (q) return [q];
  const variants = titleVariants(title);
  const shortTitle = variants[variants.length - 1];
  const names = [title];
  if (shortTitle && normalize(title) !== shortTitle) names.push(shortTitle);

  if (type === 'movie') return names.map((n) => `${n} ${year || ''}`.trim());
  const sxx = `S${pad(season ?? 1)}`;
  if (episode == null) return [`${title} ${sxx}`];
  return [`${title} ${sxx}E${pad(episode)}`, `${title} ${sxx}`];
}

function magnetFromHash(hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || hash)}`;
}

export async function searchSources({ prowlarrUrl, apiKey, ...want }) {
  const queries = buildQueries(want);
  const category = want.type === 'movie' ? '&categories=2000' : want.type === 'tv' ? '&categories=5000' : '';

  const responses = await Promise.all(
    queries.map(async (query) => {
      let res;
      try {
        res = await fetch(
          `${prowlarrUrl}/api/v1/search?query=${encodeURIComponent(query)}&type=search&limit=100${category}`,
          { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(60000) }
        );
      } catch (e) {
        throw httpError(502, `Could not reach Prowlarr (${e.message})`);
      }
      if (res.status === 401 || res.status === 403) {
        throw httpError(
          502,
          'Prowlarr rejected the API key. Check PROWLARR_API_KEY in your .env against Settings → General in Prowlarr.',
          'PROWLARR_KEY'
        );
      }
      if (!res.ok) throw httpError(502, `Prowlarr error (HTTP ${res.status})`);
      return res.json();
    })
  );

  const seen = new Set();
  const variants = want.title ? titleVariants(want.title) : [];
  const out = [];

  for (const raw of responses.flat()) {
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
    const score = want.type ? scoreRelease(parsed, seeders, raw.size, want) : seeders;

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
      // Chrome/Firefox/Safari can't decode HEVC/AV1 everywhere, and most can't play AC3/DTS audio.
      risky: parsed.hevc || parsed.av1 || parsed.surround,
      score,
    });
  }

  out.sort((a, b) => b.score - a.score || b.seeders - a.seeders);
  return out.slice(0, 40);
}
