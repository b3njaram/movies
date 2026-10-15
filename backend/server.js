import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import {
  getUserByUsername,
  ensureDefaultProfile,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  listProfiles,
  MAX_PROFILES,
  upsertProgress,
  getProgressByKey,
  getTitleProgress,
  getRecentProgress,
  getMyList,
  addToMyList,
  removeFromMyList,
} from './db.js';
import { verifyPassword, issueSession, clearSession, requireAuth, getSessionUser } from './auth.js';
import {
  tmdbEnabled,
  httpError,
  getBrowse,
  BROWSE_PAGES,
  getTitle,
  getSeason,
  getNextEpisode,
  getFirstEpisode,
  getEpisodeName,
  searchTitles,
} from './tmdb.js';
import { searchSources, lookupRef, bytesToSize } from './sources.js';

const PROWLARR_URL = (process.env.PROWLARR_URL || 'http://localhost:9696').replace(/\/$/, '');
const PROWLARR_API_KEY = process.env.PROWLARR_API_KEY || '';
const TORRSERVER_URL = (process.env.TORRSERVER_URL || 'http://localhost:8090').replace(/\/$/, '');
const PORT = process.env.PORT || 4000;

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Login (public) — with a small brute-force limiter, since this may be internet-facing
// ---------------------------------------------------------------------------

const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Behind Cloudflare the real client address arrives in CF-Connecting-IP (it cannot be spoofed there).
const clientIp = (req) => req.get('cf-connecting-ip') || req.ip;

function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

app.post('/api/auth/login', (req, res) => {
  const { username, password, remember } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Please enter your username and password.' });

  const ip = clientIp(req);
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  const user = getUserByUsername(String(username).trim());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    attempts.get(ip).push(Date.now());
    return res.status(400).json({ error: 'Incorrect username or password.' });
  }

  attempts.delete(ip);
  issueSession(res, user, remember !== false);
  res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.', code: 'AUTH' });
  res.json({ username: user.username });
});

// Everything below requires a valid session.
app.use('/api', requireAuth);

// Used by nginx (auth_request) to protect /stream/* with the same session.
app.get('/api/auth/check', (req, res) => res.sendStatus(204));

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function cleanProfileInput(body) {
  const name = String(body?.name || '').trim().slice(0, 20);
  if (!name) throw httpError(400, 'Please enter a name for the profile.');
  const avatar = Math.min(7, Math.max(0, parseInt(body?.avatar, 10) || 0));
  return { name, avatar, kids: Boolean(body?.kids) };
}

app.get('/api/profiles', (req, res) => {
  res.json({ profiles: ensureDefaultProfile(req.user) });
});

app.post('/api/profiles', (req, res) => {
  if (listProfiles(req.user.id).length >= MAX_PROFILES) {
    throw httpError(400, `You can have up to ${MAX_PROFILES} profiles.`);
  }
  res.json({ profile: createProfile(req.user.id, cleanProfileInput(req.body)) });
});

app.put('/api/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfile(req.user.id, id)) throw httpError(404, 'Profile not found.');
  res.json({ profile: updateProfile(req.user.id, id, cleanProfileInput(req.body)) });
});

app.delete('/api/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfile(req.user.id, id)) throw httpError(404, 'Profile not found.');
  if (listProfiles(req.user.id).length <= 1) throw httpError(400, 'You need at least one profile.');
  deleteProfile(req.user.id, id);
  res.json({ ok: true });
});

// Routes below act on behalf of one profile, sent as X-Profile-Id (or in the body for beacons).
function withProfile(req, res, next) {
  const raw = req.get('x-profile-id') || req.body?.profileId || req.query.profileId;
  const profile = raw ? getProfile(req.user.id, Number(raw)) : null;
  if (!profile) return res.status(400).json({ error: 'Choose a profile first.', code: 'PROFILE' });
  req.profile = profile;
  next();
}

// ---------------------------------------------------------------------------
// Service status (Prowlarr key, TorrServer, TMDB)
// ---------------------------------------------------------------------------

async function checkProwlarr() {
  try {
    const r = await fetch(`${PROWLARR_URL}/api/v1/system/status`, {
      headers: { 'X-Api-Key': PROWLARR_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: 'Prowlarr rejected the API key (PROWLARR_API_KEY does not match Prowlarr → Settings → General).' };
    }
    return r.ok ? { ok: true } : { ok: false, reason: `Prowlarr answered HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, reason: `Prowlarr is not reachable (${e.message}).` };
  }
}

async function checkTorrServer() {
  try {
    const r = await fetch(`${TORRSERVER_URL}/echo`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? { ok: true } : { ok: false, reason: `TorrServer answered HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, reason: `TorrServer is not reachable (${e.message}).` };
  }
}

app.get('/api/status', wrap(async (req, res) => {
  const [prowlarr, torrserver] = await Promise.all([checkProwlarr(), checkTorrServer()]);
  res.json({ tmdb: tmdbEnabled(), prowlarr, torrserver });
}));

// ---------------------------------------------------------------------------
// Catalog (TMDB)
// ---------------------------------------------------------------------------

function requireTmdb(req, res, next) {
  if (!tmdbEnabled()) return res.status(503).json({ error: 'Catalog is not configured.', code: 'NO_TMDB' });
  next();
}

const validType = (t) => (t === 'movie' || t === 'tv' ? t : null);

app.get('/api/browse/:page', withProfile, wrap(async (req, res) => {
  if (!tmdbEnabled()) return res.json({ configured: false });
  const page = BROWSE_PAGES.includes(req.params.page) ? req.params.page : 'home';
  const data = await getBrowse(page, { kids: req.profile.kids });
  res.json({ configured: true, ...data });
}));

app.get('/api/search', withProfile, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!tmdbEnabled()) return res.json({ configured: false, results: [] });
  if (q.length < 2) return res.json({ configured: true, results: [] });
  res.json({ configured: true, results: await searchTitles(q, { kids: req.profile.kids }) });
}));

app.get('/api/title/tv/:id/season/:n', requireTmdb, wrap(async (req, res) => {
  res.json(await getSeason(Number(req.params.id), Number(req.params.n)));
}));

app.get('/api/title/tv/:id/next', requireTmdb, wrap(async (req, res) => {
  const next = await getNextEpisode(Number(req.params.id), Number(req.query.season), Number(req.query.episode));
  res.json({ next });
}));

// What should the "Play" button do for this title right now?
app.get('/api/title/:type/:id/target', requireTmdb, withProfile, wrap(async (req, res) => {
  const type = validType(req.params.type);
  if (!type) throw httpError(404, 'Unknown type');
  const id = Number(req.params.id);
  const rows = getTitleProgress(req.profile.id, type, id);
  const latest = rows[0];

  if (type === 'movie') {
    const resume = Boolean(latest && !latest.completed && latest.positionSeconds > 10);
    return res.json({
      type,
      resume,
      positionSeconds: resume ? latest.positionSeconds : 0,
      durationSeconds: resume ? latest.durationSeconds : 0,
    });
  }

  let season, episode, name, resume = false, positionSeconds = 0, durationSeconds = 0;
  if (!latest) {
    ({ season, episode, name } = await getFirstEpisode(id));
  } else if (!latest.completed) {
    ({ season, episode } = latest);
    resume = latest.positionSeconds > 10;
    positionSeconds = resume ? latest.positionSeconds : 0;
    durationSeconds = latest.durationSeconds;
    name = await getEpisodeName(id, season, episode);
  } else {
    const next = await getNextEpisode(id, latest.season, latest.episode).catch(() => null);
    if (next) ({ season, episode, name } = next);
    else {
      ({ season, episode } = latest);
      name = await getEpisodeName(id, season, episode);
    }
  }
  res.json({ type, season, episode, name, resume, positionSeconds, durationSeconds });
}));

app.get('/api/title/:type/:id', requireTmdb, wrap(async (req, res) => {
  const type = validType(req.params.type);
  if (!type) throw httpError(404, 'Unknown type');
  res.json(await getTitle(type, Number(req.params.id)));
}));

// ---------------------------------------------------------------------------
// Sources (Prowlarr)
// ---------------------------------------------------------------------------

app.get('/api/sources', withProfile, wrap(async (req, res) => {
  const { type, title, year, q } = req.query;
  if (!q && !title) throw httpError(400, 'Missing title');
  if (req.profile.kids && !title) throw httpError(403, 'Direct indexer search is turned off for Kids profiles.');
  const results = await searchSources({
    prowlarrUrl: PROWLARR_URL,
    apiKey: PROWLARR_API_KEY,
    type: validType(type),
    title: title ? String(title) : undefined,
    year: year ? String(year) : undefined,
    season: req.query.season !== undefined ? Number(req.query.season) : undefined,
    episode: req.query.episode !== undefined ? Number(req.query.episode) : undefined,
    q: q ? String(q) : undefined,
  });
  res.json({ results });
}));

// ---------------------------------------------------------------------------
// TorrServer
// ---------------------------------------------------------------------------

const touched = new Map(); // hash -> last time a client showed interest
const touch = (hash) => touched.set(hash, Date.now());

async function tsPost(pathname, body, timeoutMs = 20000) {
  let res;
  try {
    res = await fetch(`${TORRSERVER_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw httpError(502, `TorrServer is not reachable (${e.message})`);
  }
  const text = await res.text();
  if (!res.ok) throw httpError(502, `TorrServer: ${text.slice(0, 160) || res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function resolveLink(input) {
  const link = String(input || '').trim();
  // Only links the server itself handed out ("ref:" tokens from /api/sources) may lead to an
  // outgoing HTTP request. Anything a client types in directly is limited to magnets and hashes.
  if (link.startsWith('ref:')) {
    const url = lookupRef(link);
    if (!url) throw httpError(410, 'That source expired. Please search again.');
    return fetchTorrentOrMagnet(url);
  }
  if (/^magnet:/i.test(link)) return { kind: 'magnet', value: link };
  if (/^[a-f0-9]{40}$/i.test(link)) return { kind: 'magnet', value: `magnet:?xt=urn:btih:${link}` };
  throw httpError(400, 'Unsupported source link.');
}

// Some indexers only give a .torrent URL (or a redirect to a magnet). Fetch it server-side.
async function fetchTorrentOrMagnet(url) {
  const base = new URL(PROWLARR_URL);
  let current = new URL(url);
  if (['localhost', '127.0.0.1'].includes(current.hostname)) {
    current.protocol = base.protocol;
    current.host = base.host;
  }

  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'X-Api-Key': PROWLARR_API_KEY },
      signal: AbortSignal.timeout(25000),
    }).catch((e) => {
      throw httpError(502, `Could not download the torrent file (${e.message})`);
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      if (/^magnet:/i.test(location)) return { kind: 'magnet', value: location };
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) throw httpError(502, `Indexer returned HTTP ${res.status} for this torrent.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] !== 0x64) throw httpError(502, 'The indexer did not return a valid torrent file.');
    return { kind: 'file', value: buf };
  }
  throw httpError(502, 'Too many redirects while fetching the torrent.');
}

async function addToTorrServer(resolved) {
  if (resolved.kind === 'magnet') {
    return tsPost('/torrents', { action: 'add', link: resolved.value, save_to_db: false }, 60000);
  }
  const form = new FormData();
  form.append('save', 'false');
  form.append('file', new Blob([resolved.value]), 'source.torrent');
  let res;
  try {
    res = await fetch(`${TORRSERVER_URL}/torrent/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw httpError(502, `TorrServer is not reachable (${e.message})`);
  }
  if (!res.ok) throw httpError(502, `TorrServer rejected the torrent file (HTTP ${res.status})`);
  return res.json();
}

async function waitForFiles(hash, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const info = await tsPost('/torrents', { action: 'get', hash }).catch(() => null);
    if (info?.file_stats?.length) return info;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw httpError(504, 'No peers answered in time for this source.');
}

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|webm|m4v|ts|wmv)$/i;
const largest = (files) => [...files].sort((a, b) => (b.length || 0) - (a.length || 0))[0];

function pickFile(fileStats, season, episode) {
  const all = fileStats.map((f) => ({ ...f, path: f.path || f.name || '' }));
  const videos = all.filter((f) => VIDEO_EXT.test(f.path) && !/\bsample\b/i.test(f.path));
  const pool = videos.length ? videos : all;
  if (!pool.length) return null;

  if (season != null && episode != null) {
    const s = season;
    const e = episode;
    const patterns = [
      new RegExp(`s0*${s}[ ._-]*e0*${e}(?!\\d)`, 'i'),
      new RegExp(`(?:^|[^\\d])0*${s}x0*${e}(?!\\d)`, 'i'),
      new RegExp(`season[ ._-]*0*${s}[^\\d].*?(?:episode|ep|e)[ ._-]*0*${e}(?!\\d)`, 'i'),
    ];
    for (const re of patterns) {
      const hits = pool.filter((f) => re.test(f.path));
      if (hits.length) return largest(hits);
    }
    if (pool.length > 1) throw httpError(404, `Season ${s} episode ${e} was not found inside this torrent.`);
  }
  return largest(pool);
}

app.post('/api/stream', withProfile, wrap(async (req, res) => {
  const { link, season, episode, contentKey } = req.body || {};
  if (!link) throw httpError(400, 'Missing source link.');

  const resolved = await addToTorrServer(await resolveLink(link));
  const hash = resolved.hash;
  if (!hash) throw httpError(502, 'TorrServer did not return a torrent hash.');
  touch(hash);

  const info = resolved.file_stats?.length ? resolved : await waitForFiles(hash);
  const file = pickFile(info.file_stats, season ?? null, episode ?? null);
  if (!file) throw httpError(404, 'No playable video file was found in this torrent.');

  const baseName = (file.path.split('/').pop() || 'video').trim() || 'video';
  const originalMagnet = /^magnet:/i.test(String(link)) ? String(link) : null;

  res.json({
    hash,
    contentKey: contentKey || `raw:${hash}:${file.id}`,
    fileIndex: file.id,
    fileName: baseName,
    fileSize: bytesToSize(file.length),
    // Stored so "Continue Watching" can reconnect to exactly this torrent later.
    magnet: originalMagnet || `magnet:?xt=urn:btih:${hash}`,
    streamUrl: `/stream/${encodeURIComponent(baseName)}?link=${hash}&index=${file.id}&play`,
  });
}));

app.get('/api/stats/:hash', wrap(async (req, res) => {
  const hash = String(req.params.hash);
  touch(hash);
  const t = await tsPost('/torrents', { action: 'get', hash }).catch(() => ({}));
  const s = t.torrent_status || t;
  res.json({
    activePeers: s.active_peers ?? 0,
    totalPeers: s.total_peers ?? 0,
    seeders: s.connected_seeders ?? 0,
    downloadSpeed: s.download_speed ?? 0,
  });
}));

// Drop torrents nobody has touched for a while (frontend polls /stats while playing).
setInterval(async () => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [hash, at] of touched) {
    if (at < cutoff) {
      touched.delete(hash);
      tsPost('/torrents', { action: 'rem', hash }).catch(() => {});
    }
  }
}, 2 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Watch progress / Continue Watching
// ---------------------------------------------------------------------------

app.post('/api/progress', withProfile, (req, res) => {
  const b = req.body || {};
  if (!b.contentKey || !b.title || !b.mediaType) throw httpError(400, 'Missing progress fields.');
  upsertProgress({
    profileId: req.profile.id,
    contentKey: String(b.contentKey),
    mediaType: String(b.mediaType),
    tmdbId: b.tmdbId != null ? Number(b.tmdbId) : null,
    season: b.season != null ? Number(b.season) : null,
    episode: b.episode != null ? Number(b.episode) : null,
    title: String(b.title).slice(0, 300),
    subtitle: b.subtitle ? String(b.subtitle).slice(0, 300) : null,
    year: b.year ? String(b.year).slice(0, 8) : null,
    poster: b.poster || null,
    backdrop: b.backdrop || null,
    magnet: b.magnet || null,
    sizeLabel: b.sizeLabel || null,
    indexer: b.indexer || null,
    positionSeconds: b.positionSeconds,
    durationSeconds: b.durationSeconds,
  });
  if (b.hash) touch(String(b.hash));
  res.json({ saved: true });
});

app.get('/api/progress/get', withProfile, (req, res) => {
  const row = getProgressByKey(req.profile.id, String(req.query.contentKey || ''));
  if (!row) return res.json({ positionSeconds: 0, durationSeconds: 0, completed: false });
  res.json({
    positionSeconds: row.completed ? 0 : row.positionSeconds,
    durationSeconds: row.durationSeconds,
    completed: Boolean(row.completed),
  });
});

app.get('/api/progress/title', withProfile, (req, res) => {
  const type = validType(req.query.type);
  if (!type) throw httpError(400, 'Unknown type');
  const items = getTitleProgress(req.profile.id, type, Number(req.query.id)).map((r) => ({
    season: r.season,
    episode: r.episode,
    positionSeconds: r.positionSeconds,
    durationSeconds: r.durationSeconds,
    completed: Boolean(r.completed),
  }));
  res.json({ items });
});

function historyItem(r, extra = {}) {
  return {
    contentKey: r.contentKey,
    type: r.mediaType,
    tmdbId: r.tmdbId,
    season: r.season,
    episode: r.episode,
    title: r.title,
    subtitle: r.subtitle,
    year: r.year,
    poster: r.poster,
    backdrop: r.backdrop,
    magnet: r.magnet,
    sizeLabel: r.sizeLabel,
    indexer: r.indexer,
    positionSeconds: r.positionSeconds,
    durationSeconds: r.durationSeconds,
    ...extra,
  };
}

app.get('/api/history', withProfile, wrap(async (req, res) => {
  const rows = getRecentProgress(req.profile.id);
  const seen = new Set();
  const tasks = [];

  for (const r of rows) {
    const group = r.mediaType === 'raw' ? r.contentKey : `${r.mediaType}:${r.tmdbId}`;
    if (seen.has(group)) continue;
    seen.add(group);

    if (!r.completed) {
      if (r.positionSeconds >= 10) tasks.push(Promise.resolve(historyItem(r)));
      continue;
    }
    // Finished an episode -> offer the next one ("Up next").
    if (r.mediaType === 'tv' && tmdbEnabled() && r.tmdbId) {
      tasks.push(
        getNextEpisode(r.tmdbId, r.season, r.episode)
          .then((next) =>
            next
              ? historyItem(r, {
                  contentKey: `tv:${r.tmdbId}:s${next.season}e${next.episode}`,
                  season: next.season,
                  episode: next.episode,
                  subtitle: next.name,
                  magnet: null,
                  sizeLabel: null,
                  indexer: null,
                  positionSeconds: 0,
                  durationSeconds: 0,
                  nextUp: true,
                })
              : null
          )
          .catch(() => null)
      );
    }
    if (tasks.length >= 24) break;
  }

  const items = (await Promise.all(tasks)).filter(Boolean).slice(0, 20);
  res.json({ items });
}));

// ---------------------------------------------------------------------------
// My List
// ---------------------------------------------------------------------------

app.get('/api/mylist', withProfile, (req, res) => res.json({ items: getMyList(req.profile.id) }));

app.post('/api/mylist', withProfile, (req, res) => {
  const { type, id, title } = req.body || {};
  if (!validType(type) || !id || !title) throw httpError(400, 'Missing title details.');
  addToMyList(req.profile.id, { ...req.body, id: Number(id) });
  res.json({ ok: true });
});

app.delete('/api/mylist/:type/:id', withProfile, (req, res) => {
  removeFromMyList(req.profile.id, req.params.type, Number(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Errors — upstream failures are always 5xx/4xx-other-than-401, never "AUTH".
// ---------------------------------------------------------------------------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status && err.status !== 401 ? err.status : err.status === 401 ? 502 : 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err.message);
  res.status(status).json({ error: err.message || 'Something went wrong.', code: err.code });
});

app.listen(PORT, () => {
  console.log(`StreamHub backend listening on :${PORT}`);
  console.log(`  Prowlarr:   ${PROWLARR_URL}`);
  console.log(`  TorrServer: ${TORRSERVER_URL}`);
  console.log(`  TMDB:       ${tmdbEnabled() ? 'configured' : 'NOT configured (set TMDB_API_KEY to enable the catalog)'}`);
  setTimeout(async () => {
    const p = await checkProwlarr();
    if (!p.ok) console.error(`[startup] ${p.reason}`);
    else console.log('[startup] Prowlarr API key accepted.');
  }, 8000).unref();
});
