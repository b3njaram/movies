import { spawn } from 'child_process';
import { Readable } from 'stream';
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
  profileSecurity, setProfilePin, getSkipMarkers, putSkipMarkers,
  upsertProgress,
  getProgressByKey,
  getTitleProgress,
  getRecentProgress,
  getMyList,
  addToMyList,
  removeFromMyList,
} from './db.js';
import { verifyPassword, hashPassword, issueSession, clearSession, requireAuth, getSessionUser, issueActiveProfile, clearActiveProfile, getActiveProfileId } from './auth.js';
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
  getLocalizedTitle, getDiscover, getRecommendations,
} from './tmdb.js';
import { searchSources, lookupRef, bytesToSize, describeRelease } from './sources.js';
import { listAccounts, createAccount, updateAccount, adminSummary } from './admin.js';
import { validatedFileRef, listSubtitleFiles, toVtt } from './subtitles.js';
import { allowedByRating, maxAgeValue, cleanMarkers, safeContentKey, cleanDiscoverFilters } from './premium.js';
import { thumbnailFor } from './preview.js';
import fs from 'node:fs';
import {
  getPlaybackSettings, savePlaybackSettings, getServerOptions, updateServerOptions,
  insertDownload, getDownload, listDownloads, listReady, updateDownload, deleteDownload,
  monitorSummary, recordEvent, savePresence, listPresence, claimPresence, pollHandoff, removePresence,
} from './advanced-db.js';
import {validHash,validFileIndex,downloadName,convertOptions,deviceId,safeContentKey as safeAdvancedContentKey} from './advanced-rules.js';
import {startAdvancedJobs,setDownloadTouch,wakeDownloads,cancelCurrent,removeJobFiles,localFileStatus,serverRuntime,createBackup,listBackups,backupFile,convertVideo} from './advanced-worker.js';

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
  if (!user || user.disabled || !verifyPassword(String(password), user.password_hash)) {
    attempts.get(ip).push(Date.now());
    return res.status(400).json({ error: 'Incorrect username or password.' });
  }

  attempts.delete(ip);
  issueSession(res, user, remember !== false);
  res.json({ username: user.username, isAdmin: Boolean(user.is_admin) });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.', code: 'AUTH' });
  res.json({ username: user.username, isAdmin: Boolean(user.isAdmin) });
});

// Everything below requires a valid session.
app.use('/api', requireAuth);

// Used by nginx (auth_request) to protect /stream/* with the same session.
// Nginx auth_request must also see the signed active profile. Checking only the
// account would let a restricted viewer bypass restrictions by requesting /stream/.
app.get('/api/auth/check', (req, res) => {
  const pid = getActiveProfileId(req, req.user);
  if (!pid) return res.sendStatus(403);
  const profile = getProfile(req.user.id, pid);
  if (!profile) return res.sendStatus(403);
  if (profile.maxAge < 18) {
    const uri = req.get('x-original-uri') || '';
    const url = new URL(uri, 'http://local');
    const hash = url.searchParams.get('link');
    if (!hash || !isGrantedHash(req.user.id, pid, hash)) return res.sendStatus(403);
  }
  const {bandwidthMbps}=getPlaybackSettings(pid);
  res.setHeader('X-Stream-Rate', String(bandwidthMbps ? Math.floor(bandwidthMbps * 1000000 / 8) : 0));
  return res.sendStatus(204);
});

// Browser-facing administration is role checked on every request, not by a
// flag sent from the browser. A disabled user loses access immediately.
function requireAdmin(req, res, next) {
  const selected = activeProfile(req);
  if (!req.user.isAdmin || !selected || selected.maxAge < 18) return res.status(403).json({ error: 'An unrestricted administrator profile is required.' });
  next();
}

app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
  const [prowlarr, torrserver] = await Promise.all([checkProwlarr(), checkTorrServer()]);
  const recent = [...touched.values()].filter(at => Date.now() - at < 2 * 60 * 1000).length;
  res.json({ ...adminSummary(), recentTorrents: recent, prowlarr, torrserver });
}));

app.get('/api/admin/users', requireAdmin, (req, res) => res.json({ users: listAccounts() }));

app.post('/api/admin/users', requireAdmin, wrap(async (req, res) => {
  const id = createAccount(req.body?.username, req.body?.password);
  console.info(`[admin] account ${id} created by user ${req.user.id}`);
  res.status(201).json({ ok: true, id });
}));

app.patch('/api/admin/users/:id', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'Invalid account ID.');
  updateAccount(req.user.id, id, req.body?.action, req.body?.password);
  console.info(`[admin] ${req.body?.action} on account ${id} by user ${req.user.id}`);
  res.json({ ok: true });
}));


// Phase 3 monitoring, storage quotas, backup and conversion limits are all in
// the existing data mount. Settings require an admin profile.
app.get('/api/admin/advanced', requireAdmin, (req,res)=>{
  res.json({options:getServerOptions(),metrics:monitorSummary(),runtime:serverRuntime(),backups:listBackups()});
});
app.put('/api/admin/advanced',requireAdmin,(req,res)=>res.json({options:updateServerOptions(req.body||{})}));
app.post('/api/admin/backups',requireAdmin,wrap(async(req,res)=>res.status(201).json({backup:await createBackup()})));
app.get('/api/admin/backups/:name',requireAdmin,(req,res)=>{
  const file=backupFile(req.params.name);
  if(!file)return res.status(404).json({error:'Backup not found.'});
  res.download(file,req.params.name);
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function cleanProfileInput(body) {
  const name = String(body?.name || '').trim().slice(0, 20);
  if (!name) throw httpError(400, 'Please enter a name for the profile.');
  const avatar = Math.min(7, Math.max(0, parseInt(body?.avatar, 10) || 0));
  const kids = Boolean(body?.kids);
  return { name, avatar, kids, maxAge: maxAgeValue(body?.maxAge, kids), lang: body?.lang === 'es' ? 'es' : 'en', subLang: ['en', 'es'].includes(body?.subLang) ? body.subLang : 'off', uiLang: body?.uiLang === 'es' ? 'es' : 'en' };
}

app.get('/api/profiles', (req, res) => {
  const profiles = ensureDefaultProfile(req.user);
  const minAge = Math.min(...profiles.map(p=>p.maxAge));
  res.json({ profiles: profiles.map(p=>({...p,requiresPassword: !p.hasPin && p.maxAge > minAge})) });
});

function requireAccountPassword(req) {
  const user = getUserByUsername(req.user.username);
  if (!user || !verifyPassword(String(req.body?.accountPassword || ''), user.password_hash)) {
    throw httpError(403, 'Confirm your account password to change parental controls.');
  }
}

app.post('/api/profiles', (req, res) => {
  const input = cleanProfileInput(req.body);
  // Otherwise a child could create an unrestricted profile with only a session cookie.
  if (!input.kids || input.maxAge > 10) requireAccountPassword(req);
  const profile = createProfile(req.user.id, input);
  res.status(201).json({ profile });
});

app.put('/api/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = getProfile(req.user.id, id);
  if (!current) throw httpError(404, 'Profile not found.');
  const input = cleanProfileInput({ ...current, ...(req.body || {}) });
  const pinChange = Object.prototype.hasOwnProperty.call(req.body || {}, 'newPin');
  const needsPassword = pinChange || (current.kids && !input.kids) || input.maxAge > current.maxAge;
  if (needsPassword) requireAccountPassword(req);
  if (pinChange) {
    const pin = String(req.body.newPin || '');
    if (pin && !/^\d{4,8}$/.test(pin)) throw httpError(400, 'PIN must contain 4–8 digits.');
    setProfilePin(req.user.id, id, pin ? hashPassword(pin) : null);
    clearActiveProfile(res);
  }
  res.json({ profile: updateProfile(req.user.id, id, input) });
});

app.delete('/api/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfile(req.user.id, id)) throw httpError(404, 'Profile not found.');
  if (listProfiles(req.user.id).length <= 1) throw httpError(400, 'You need at least one profile.');
  requireAccountPassword(req);
  deleteProfile(req.user.id, id);
  clearActiveProfile(res);
  res.json({ ok: true });
});

// Only the account owner can issue an active-profile cookie. A protected profile
// also requires its PIN, rate-limited independently of account login.
const pinAttempts = new Map();
app.post('/api/profiles/:id/activate', (req, res) => {
  const id = Number(req.params.id);
  const profile = getProfile(req.user.id, id);
  if (!profile) throw httpError(404, 'Profile not found.');
  const sec = profileSecurity(req.user.id, id);
  if (!sec.pinHash) {
    const profiles=listProfiles(req.user.id);
    const minAge=Math.min(...profiles.map(p=>p.maxAge));
    if (profile.maxAge > minAge) requireAccountPassword(req);
  }
  if (sec.pinHash) {
    const key = `${req.user.id}:${id}:${clientIp(req)}`;
    const now = Date.now();
    const misses = (pinAttempts.get(key) || []).filter(t => now - t < 5 * 60 * 1000);
    if (misses.length >= 5) return res.status(429).json({error:'Too many PIN attempts. Try again in five minutes.'});
    if (!verifyPassword(String(req.body?.pin || ''), sec.pinHash)) {
      misses.push(now); pinAttempts.set(key, misses);
      return res.status(403).json({error:'Incorrect profile PIN.', code:'PIN'});
    }
    pinAttempts.delete(key);
  }
  issueActiveProfile(res, req.user, profile, sec.pinVersion);
  res.json({profile});
});
app.post('/api/profiles/deactivate', (req, res) => {
  clearActiveProfile(res);
  res.json({ok:true});
});

// A restricted profile can play only sources returned by an approved title
// search, and only torrent hashes resulting from those source grants.
const grantedLinks = new Map();
const grantedHashes = new Map();
const GRANT_TTL = 2 * 60 * 60 * 1000;
const grantKey = (u,p) => `${u}:${p}`;
function grantLink(u,p,link) {
  const key = grantKey(u,p);
  const map = grantedLinks.get(key) || new Map();
  map.set(String(link), Date.now() + GRANT_TTL);
  if (map.size > 150) map.delete(map.keys().next().value);
  grantedLinks.set(key,map);
}
function grantHash(u,p,hash) {
  const key = grantKey(u,p);
  const map = grantedHashes.get(key) || new Map();
  map.set(String(hash).toLowerCase(),Date.now()+GRANT_TTL);
  if (map.size > 100) map.delete(map.keys().next().value);
  grantedHashes.set(key,map);
}
function isGranted(map,u,p,value) {
  const expiry = map.get(grantKey(u,p))?.get(String(value));
  return Number(expiry) > Date.now();
}
const isGrantedLink = (u,p,link) => isGranted(grantedLinks,u,p,link);
const isGrantedHash = (u,p,hash) => isGranted(grantedHashes,u,p,String(hash).toLowerCase());

function activeProfile(req) {
  const id = getActiveProfileId(req, req.user);
  return id ? getProfile(req.user.id, id) : null;
}
function withActiveProfile(req,res,next) {
  const p = activeProfile(req);
  if (!p) return res.status(403).json({error:'Unlock a profile first.', code:'PROFILE_LOCKED'});
  req.profile = p;
  next();
}
function requireGrantedFile(req,res,next) {
  if (req.profile.maxAge >= 18) return next();
  const hash = String(req.query.hash || req.params.hash || '').toLowerCase();
  if (!isGrantedHash(req.user.id, req.profile.id, hash)) return res.status(403).json({error:'This title is not permitted for this profile.'});
  next();
}

// Routes below act on behalf of one profile, sent as X-Profile-Id (or in the body for beacons).
function withProfile(req, res, next) {
  const raw = req.get('x-profile-id') || req.body?.profileId || req.query.profileId;
  const profile = raw ? getProfile(req.user.id, Number(raw)) : null;
  if (!profile) return res.status(400).json({ error: 'Choose a profile first.', code: 'PROFILE' });
  if (getActiveProfileId(req,req.user) !== profile.id) {
    return res.status(403).json({error:'Unlock this profile before continuing.',code:'PROFILE_LOCKED'});
  }
  req.profile = profile;
  next();
}


app.get('/api/playback/settings',withProfile,(req,res)=>res.json({settings:getPlaybackSettings(req.profile.id)}));
app.put('/api/playback/settings',withProfile,(req,res)=>res.json({settings:savePlaybackSettings(req.profile.id,req.body||{})}));

// Handoff notices are scoped to the unlocked profile. A receiving device may
// only claim a currently-active session from its own profile.
app.post('/api/playback/presence',withProfile,wrap(async(req,res)=>{
  const b=req.body||{};
  if(req.profile.maxAge<18) await enforceTitleRating(req.profile,b.mediaType,b.tmdbId);
  savePresence(req.profile.id,b);
  res.json({ok:true});
}));
app.get('/api/playback/devices',withProfile,(req,res)=>{
  res.json({devices:listPresence(req.profile.id,req.query.deviceId?deviceId(req.query.deviceId):null)});
});
app.post('/api/playback/claim',withProfile,wrap(async(req,res)=>{
  const item=listPresence(req.profile.id).find(x=>x.deviceId===req.body?.sourceDevice);
  if(!item)throw httpError(404,'That device is no longer playing.');
  if(req.profile.maxAge<18)await enforceTitleRating(req.profile,item.type,item.tmdbId);
  const row=claimPresence(req.profile.id,req.body?.sourceDevice,req.body?.targetDevice);
  const progress=getProgressByKey(req.profile.id,row.content_key);
  res.json({session:{type:row.media_type,tmdbId:row.tmdb_id,title:row.title,season:row.season,episode:row.episode,
    contentKey:row.content_key,positionSeconds:row.position_seconds,durationSeconds:row.duration_seconds,
    magnet:progress?.magnet||null,poster:progress?.poster||null,year:progress?.year||null}});
}));
app.get('/api/playback/commands',withProfile,(req,res)=>res.json(pollHandoff(req.profile.id,req.query.deviceId)));
app.delete('/api/playback/presence/:deviceId',withProfile,(req,res)=>{
  removePresence(req.profile.id,req.params.deviceId);res.json({ok:true});
});

async function enforceTitleRating(profile,type,id) {
  if (profile.maxAge >= 18) return null;
  if (!tmdbEnabled() || !validType(type) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    throw httpError(403, 'Only rated catalog titles are available to restricted profiles.');
  }
  const title = await getTitle(type,Number(id));
  if (!allowedByRating(title.certification,profile.maxAge)) throw httpError(403, 'This title exceeds the profile age rating.');
  return title;
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
  const data = await getBrowse(page, { kids: req.profile.kids, maxAge: req.profile.maxAge });
  res.json({ configured: true, ...data });
}));

app.get('/api/search', withProfile, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!tmdbEnabled()) return res.json({ configured: false, results: [] });
  if (q.length < 2) return res.json({ configured: true, results: [] });
  const all = await searchTitles(q, {kids: req.profile.kids});
  // Filter candidates by certified rating, not just a genre label.
  const candidates = req.profile.maxAge < 18 ? all.slice(0,20) : all;
  const checked = await Promise.all(candidates.map(async item => {
    try { await enforceTitleRating(req.profile,item.type,item.id); return item; } catch { return null; }
  }));
  res.json({configured:true,results:checked.filter(Boolean)});
}));

app.get('/api/title/tv/:id/season/:n', requireTmdb, withProfile, wrap(async (req, res) => {
  await enforceTitleRating(req.profile,'tv',req.params.id);
  res.json(await getSeason(Number(req.params.id), Number(req.params.n)));
}));

app.get('/api/title/tv/:id/next', requireTmdb, withProfile, wrap(async (req, res) => {
  await enforceTitleRating(req.profile,'tv',req.params.id);
  const next = await getNextEpisode(Number(req.params.id), Number(req.query.season), Number(req.query.episode));
  res.json({ next });
}));

// What should the "Play" button do for this title right now?
app.get('/api/title/:type/:id/target', requireTmdb, withProfile, wrap(async (req, res) => {
  const type = validType(req.params.type);
  if (!type) throw httpError(404, 'Unknown type');
  const id = Number(req.params.id);
  await enforceTitleRating(req.profile,type,id);
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

app.get('/api/title/:type/:id', requireTmdb, withProfile, wrap(async (req, res) => {
  const type = validType(req.params.type);
  if (!type) throw httpError(404, 'Unknown type');
  await enforceTitleRating(req.profile,type,req.params.id);
  res.json(await getTitle(type, Number(req.params.id)));
}));

// User-driven discovery and viewing-history recommendations; no extra service.
app.get('/api/discover',requireTmdb,withProfile,wrap(async(req,res)=>{
  const filters = cleanDiscoverFilters(req.query);
  const items = await getDiscover(filters);
  const limited = req.profile.maxAge < 18 ? items.slice(0,20) : items;
  const checked = await Promise.all(limited.map(async item => {
    try { await enforceTitleRating(req.profile,item.type,item.id); return item; } catch { return null; }
  }));
  res.json({items:checked.filter(Boolean),filters});
}));
app.get('/api/recommendations',requireTmdb,withProfile,wrap(async(req,res)=>{
  const recent = getRecentProgress(req.profile.id,20).filter(x => x.tmdbId && validType(x.mediaType));
  const saved = getMyList(req.profile.id).filter(x => x.id);
  const seen = new Set();
  const seed = [...recent.map(x=>({type:x.mediaType,id:x.tmdbId})),...saved]
    .filter(x=>{const k=`${x.type}:${x.id}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,8);
  const found = await getRecommendations(seed);
  const checked = await Promise.all(found.items.slice(0,16).map(async item=>{
    try {await enforceTitleRating(req.profile,item.type,item.id);return item;}catch{return null;}
  }));
  res.json({items:checked.filter(Boolean),genre:found.genre});
}));


// ---------------------------------------------------------------------------
// Sources (Prowlarr)
// ---------------------------------------------------------------------------

app.get('/api/sources', withProfile, wrap(async (req, res) => {
  const { type, title, year, q } = req.query;
  if (!q && !title) throw httpError(400, 'Missing title');
  if (req.profile.kids && !title) throw httpError(403, 'Direct indexer search is turned off for Kids profiles.');
  let approvedTitle = null;
  if (req.profile.maxAge < 18) {
    const tmdbId = Number(req.query.tmdbId);
    if (!validType(type) || !Number.isSafeInteger(tmdbId) || tmdbId < 1 || q) {
      throw httpError(403,'Direct source searches are disabled for age-restricted profiles.');
    }
    approvedTitle = await enforceTitleRating(req.profile,type,tmdbId);
  }
  // Spanish releases carry the Spanish title, so look that up when the profile prefers Spanish.
  let altTitles = [];
  const tmdbId = parseInt(req.query.tmdbId, 10);
  if (req.profile.lang === 'es' && title && validType(type) && tmdbId && tmdbEnabled()) {
    try {
      const loc = await getLocalizedTitle(type, tmdbId, 'es-MX');
      if (loc.title) altTitles = [loc.title];
    } catch {
      /* searching with the original title still works */
    }
  }
  const { results, skipped } = await searchSources({
    prowlarrUrl: PROWLARR_URL,
    apiKey: PROWLARR_API_KEY,
    lang: req.profile.lang,
    altTitles,
    type: validType(type),
    title: approvedTitle?.title || (title ? String(title) : undefined),
    year: year ? String(year) : undefined,
    season: req.query.season !== undefined ? Number(req.query.season) : undefined,
    episode: req.query.episode !== undefined ? Number(req.query.episode) : undefined,
    q: q ? String(q) : undefined,
  });
  if (req.profile.maxAge < 18) for (const result of results) if (result.link) grantLink(req.user.id,req.profile.id,result.link);
  res.json({ results, skipped, lang: req.profile.lang, altTitles });
}));

// ---------------------------------------------------------------------------
// TorrServer
// ---------------------------------------------------------------------------

const touched = new Map(); // hash -> last time a client showed interest
const touch = (hash) => touched.set(hash, Date.now());
setDownloadTouch(touch);

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

  const overall = AbortSignal.timeout(25000); // all hops together, so one request never nears Cloudflare's 100 s limit
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'X-Api-Key': PROWLARR_API_KEY },
      signal: overall,
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
    return tsPost('/torrents', { action: 'add', link: resolved.value, save_to_db: false }, 40000);
  }
  const form = new FormData();
  form.append('save', 'false');
  form.append('file', new Blob([resolved.value]), 'source.torrent');
  let res;
  try {
    res = await fetch(`${TORRSERVER_URL}/torrent/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(40000),
    });
  } catch (e) {
    throw httpError(502, `TorrServer is not reachable (${e.message})`);
  }
  if (!res.ok) throw httpError(502, `TorrServer rejected the torrent file (HTTP ${res.status})`);
  return res.json();
}

async function waitForFiles(hash, tries = 20) {
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
  if (req.profile.maxAge < 18 && !isGrantedLink(req.user.id,req.profile.id,link)) {
    throw httpError(403,'This source was not approved for this restricted profile. Search the title first.');
  }

  const resolved = await addToTorrServer(await resolveLink(link));
  const hash = resolved.hash;
  if (!hash) throw httpError(502, 'TorrServer did not return a torrent hash.');
  touch(hash);

  const info = resolved.file_stats?.length ? resolved : await waitForFiles(hash);
  const file = pickFile(info.file_stats, season ?? null, episode ?? null);
  if (!file) throw httpError(404, 'No playable video file was found in this torrent.');
  // Grant access only after finding a playable file for this approved title.
  recordEvent('playback_started',req.profile.id);
  if (req.profile.maxAge < 18) grantHash(req.user.id,req.profile.id,hash);

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
    torrentName: info.title || baseName,
    release: describeRelease(info.title || baseName),
    streamUrl: `/stream/${encodeURIComponent(baseName)}?link=${hash}&index=${file.id}&play`,
  });
}));

app.get('/api/stats/:hash', withActiveProfile, requireGrantedFile, wrap(async (req, res) => {
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

// Sidecar SRT and VTT subtitles found beside the selected video in TorrServer.
// No third-party subtitle service or API key is needed. Subtitles never modify
// the main video stream and no file is stored in SQLite.

// One server-side download at a time. Source references have already gone
// through /api/stream, which validates index and age permissions.
async function allowedLibraryItems(profile,rows) {
  if(profile.maxAge>=18)return rows;
  const checked=await Promise.all(rows.map(async row=>{
    try {await enforceTitleRating(profile,row.media_type,row.tmdb_id);return row;}catch{return null;}
  }));
  return checked.filter(Boolean);
}
app.get('/api/downloads/queue',withProfile,wrap(async(req,res)=>res.json({jobs:await allowedLibraryItems(req.profile,listDownloads(req.profile.id))})));
app.get('/api/library',withProfile,wrap(async(req,res)=>res.json({items:await allowedLibraryItems(req.profile,listReady(req.profile.id))})));
app.post('/api/downloads/queue',withProfile,wrap(async(req,res)=>{
  const b=req.body||{};
  const hash=validHash(b.hash),index=validFileIndex(b.index);
  if(index<1)throw httpError(400,'Invalid file index.');
  if(req.profile.maxAge<18&&!isGrantedHash(req.user.id,req.profile.id,hash))throw httpError(403,'This download is not approved for this profile.');
  if(!['movie','tv','raw'].includes(b.mediaType))throw httpError(400,'Invalid media type.');
  if(req.profile.maxAge<18)await enforceTitleRating(req.profile,b.mediaType,b.tmdbId);
  const key=safeAdvancedContentKey(b.contentKey);
  const info=await tsPost('/torrents',{action:'get',hash});
  const selected=(info.file_stats||[]).find(f=>Number(f.id)===index);
  if(!selected || !/\.(mp4|mkv|webm|avi|mov|ts|m4v)$/i.test(selected.path||selected.name||''))throw httpError(404,'Video file is no longer available.');
  const name=downloadName(selected.path||selected.name);
  const length=Number(selected.length||0);
  if(!Number.isSafeInteger(length)||length<0||length>100*1024**3)throw httpError(400,'Invalid file length.');
  const title=String(b.title||name).trim().slice(0,180);
  const job=insertDownload({userId:req.user.id,profileId:req.profile.id,hash,index,fileName:name,title,contentKey:key,
    mediaType:b.mediaType,tmdbId:b.tmdbId?Number(b.tmdbId):null,season:b.season??null,episode:b.episode??null,totalBytes:length});
  recordEvent('download_queued',req.profile.id);touch(hash);wakeDownloads();
  res.status(201).json({job});
}));
app.post('/api/downloads/queue/:id',withProfile,(req,res)=>{
  const job=getDownload(Number(req.params.id));
  if(!job||job.profile_id!==req.profile.id)return res.status(404).json({error:'Download not found.'});
  const action=req.body?.action;
  if(action==='pause' && ['queued','running','failed'].includes(job.status)){
    updateDownload(job.id,{status:'paused'});cancelCurrent(job.id);
  }else if(action==='resume' && ['paused','failed'].includes(job.status)){
    updateDownload(job.id,{status:'queued',error:null});wakeDownloads();
  }else if(action==='delete'){
    updateDownload(job.id,{status:'paused'});cancelCurrent(job.id);removeJobFiles(job);deleteDownload(job.id);
  }else return res.status(400).json({error:'This action is not available for this download.'});
  res.json({ok:true});
});
app.get('/api/library/stream/:id',withActiveProfile,wrap(async(req,res)=>{
  const job=getDownload(Number(req.params.id));
  if(!job||job.user_id!==req.user.id||job.profile_id!==req.profile.id)return res.sendStatus(404);
  if(req.profile.maxAge<18)await enforceTitleRating(req.profile,job.media_type,job.tmdb_id);
  const file=localFileStatus(job);
  if(!file)return res.status(404).json({error:'Saved video not found.'});
  res.setHeader('Cache-Control','no-store');
  recordEvent('local_playback',req.profile.id);
  res.sendFile(file,{acceptRanges:true});
}));
app.get('/api/video/convert',withActiveProfile,wrap(async(req,res)=>{
  const opts=convertOptions(req.query);
  let url;
  if(req.query.libraryId){
    const job=getDownload(Number(req.query.libraryId));
    if(!job||job.user_id!==req.user.id||job.profile_id!==req.profile.id)throw httpError(404,'Saved video not found.');
    if(req.profile.maxAge<18)await enforceTitleRating(req.profile,job.media_type,job.tmdb_id);
    url=localFileStatus(job);
    if(!url)throw httpError(404,'Saved video file missing.');
  }else{
    const {hash,index}=fileRef(req);
    if(req.profile.maxAge<18&&!isGrantedHash(req.user.id,req.profile.id,hash))throw httpError(403,'Source not permitted.');
    url=torrentFileUrl(hash,index);touch(hash);
  }
  recordEvent('conversion_started',req.profile.id);
  convertVideo(req,res,{url,...opts});
}));

app.get('/api/subtitles', withActiveProfile, requireGrantedFile, wrap(async (req, res) => {
  const { hash, index } = validatedFileRef(req.query.hash, req.query.index);
  const info = await tsPost('/torrents', { action: 'get', hash }, 8000);
  res.json({ subtitles: listSubtitleFiles(info.file_stats, index) });
}));

app.get('/api/subtitles/file', withActiveProfile, requireGrantedFile, wrap(async (req, res) => {
  const { hash, index } = validatedFileRef(req.query.hash, req.query.index);
  const videoIndex = Number(req.query.videoIndex);
  if (!Number.isSafeInteger(videoIndex) || videoIndex < 1) throw httpError(400, 'Invalid video index.');
  const info = await tsPost('/torrents', { action: 'get', hash }, 8000);
  const allowed = listSubtitleFiles(info.file_stats, videoIndex).find(f => f.index === index);
  if (!allowed) throw httpError(404, 'Subtitle file not available for this video.');
  // TorrServer's stream endpoint uses the torrent hash and file index; neither
  // the host nor the URL can be supplied by the user.
  const url = `${TORRSERVER_URL}/stream/${encodeURIComponent(allowed.name)}?link=${hash}&index=${index}&play`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!upstream.ok) throw httpError(502, `Subtitle could not be loaded (${upstream.status}).`);
  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > 5 * 1024 * 1024) throw httpError(413, 'Subtitle file too large.');
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw httpError(413, 'Subtitle file too large.');
  res.set({ 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(toVtt(new TextDecoder('utf-8').decode(bytes)));
}));

// Low-resolution thumbnail previews are only generated while requested; at most
// one ffmpeg process runs, with short deadlines and a small disk cache.
app.get('/api/preview',withActiveProfile,requireGrantedFile,wrap(async(req,res)=>{
  const {hash,index}=validatedFileRef(req.query.hash,req.query.index);
  const at=Number(req.query.at);
  if (!Number.isFinite(at) || at<0 || at>12*3600) throw httpError(400,'Invalid preview position.');
  const bytes=await thumbnailFor(hash,index,at,torrentFileUrl(hash,index));
  res.set({'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
  res.send(bytes);
}));

// ---------------------------------------------------------------------------
// Audio fix: browsers (Firefox above all) cannot decode AC3 / E-AC3 / DTS / TrueHD, so a
// release plays picture-only. We keep the video untouched (stream copy, almost no CPU) and
// re-encode just the audio track to AAC with ffmpeg, as a fragmented MP4 piped straight to
// the browser. Seeking works by restarting the stream at an offset (see ?t=).
// ---------------------------------------------------------------------------

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const MAX_AUDIOFIX = Number(process.env.MAX_AUDIOFIX || 3);
const SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const MISSING_FFMPEG = 'ffmpeg is not installed in the backend container. Rebuild it with: docker compose up -d --build';
let activeFixes = 0;
const probeCache = new Map();

// Hash + 1-based file index (as TorrServer numbers them). Validated so nothing else can reach ffmpeg.
function fileRef(req) {
  const hash = String(req.query.hash || '');
  const index = parseInt(req.query.index, 10);
  if (!/^[a-f0-9]{40}$/i.test(hash) || !Number.isInteger(index) || index < 1 || index > 100000) {
    throw httpError(400, 'Bad file reference.');
  }
  return { hash: hash.toLowerCase(), index };
}

const torrentFileUrl = (hash, index) => `${TORRSERVER_URL}/stream/video?link=${hash}&index=${index}&play`;

function runProbe(url) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-analyzeduration', '8000000', '-probesize', '8000000', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(httpError(504, 'Timed out reading the file. Are there peers for this torrent?'));
    }, 45000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(httpError(500, e.code === 'ENOENT' ? MISSING_FFMPEG : `ffprobe failed: ${e.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(httpError(502, `Could not read the media file${err ? `: ${err.trim().split('\n').pop()}` : ''}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(httpError(502, 'Unreadable ffprobe output.'));
      }
    });
  });
}

function summarizeProbe(info) {
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const tracks = streams
    .filter((s) => s.codec_type === 'audio')
    .map((a, ord) => ({
      ord,
      codec: a.codec_name || 'unknown',
      channels: a.channels || 2,
      lang: a.tags?.language || null,
      title: a.tags?.title || null,
      isDefault: Boolean(a.disposition?.default),
    }));
  const defaultTrack = tracks.find((t) => t.isDefault)?.ord ?? 0;
  const videoCodec = video?.codec_name || null;

  let reason = null;
  if (!video) reason = 'This file has no video track.';
  else if (videoCodec !== 'h264') {
    reason = `This file uses ${String(videoCodec).toUpperCase()} video, which many browsers cannot play. The audio fix only repairs sound, so please choose another source.`;
  } else if (!tracks.length) reason = 'This file has no audio track.';

  return {
    duration: parseFloat(info.format?.duration) || parseFloat(video?.duration) || 0,
    videoCodec,
    tracks,
    defaultTrack,
    canFix: reason === null,
    needsFix: tracks.length > 0 && !SAFE_AUDIO.has(tracks[defaultTrack]?.codec),
    reason,
  };
}

app.get('/api/audiofix/probe', withActiveProfile, requireGrantedFile, wrap(async (req, res) => {
  const { hash, index } = fileRef(req);
  touch(hash);
  const key = `${hash}:${index}`;
  let hit = probeCache.get(key);
  if (!hit || Date.now() - hit.at > 30 * 60 * 1000) {
    hit = { at: Date.now(), data: summarizeProbe(await runProbe(torrentFileUrl(hash, index))) };
    probeCache.set(key, hit);
    if (probeCache.size > 200) probeCache.delete(probeCache.keys().next().value);
  }
  res.json(hit.data);
}));

app.get('/api/audiofix/stream', withActiveProfile, requireGrantedFile, wrap(async (req, res) => {
  const { hash, index } = fileRef(req);
  const start = Math.min(Math.max(parseFloat(req.query.t) || 0, 0), 172800);
  const track = Math.min(Math.max(parseInt(req.query.a, 10) || 0, 0), 31);
  if (activeFixes >= MAX_AUDIOFIX) throw httpError(503, 'Too many audio-fix streams are running. Close another player and try again.');
  touch(hash);

  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];
  // -noaccurate_seek keeps the copied video and the re-encoded audio starting at the same point.
  if (start > 0) args.push('-noaccurate_seek', '-ss', String(start));
  args.push(
    '-i', torrentFileUrl(hash, index),
    '-map', '0:v:0', '-map', `0:a:${track}?`, '-sn', '-dn',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );

  activeFixes += 1;
  let counted = true;
  const release = () => {
    if (counted) {
      counted = false;
      activeFixes -= 1;
    }
  };

  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false;
  let stderr = '';
  const heartbeat = setInterval(() => touch(hash), 60000);

  ff.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  ff.on('error', (e) => {
    release();
    if (!res.headersSent) res.status(500).json({ error: e.code === 'ENOENT' ? MISSING_FFMPEG : e.message });
    else res.destroy();
  });
  ff.on('close', (code) => {
    release();
    if (!started && !res.headersSent) {
      res.status(502).json({ error: `Audio fix failed: ${stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`}` });
    } else if (!res.writableEnded) res.end();
  });
  ff.stdout.on('data', (chunk) => {
    if (!started) {
      started = true;
      res.status(200);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Accept-Ranges', 'none');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    if (!res.write(chunk)) {
      ff.stdout.pause();
      res.once('drain', () => ff.stdout.resume());
    }
  });
  // The browser closing the connection (seek, stop, leave page) must stop ffmpeg right away.
  res.on('close', () => {
    clearInterval(heartbeat);
    ff.kill('SIGKILL');
  });
}));

// ---------------------------------------------------------------------------
// Download a file to the viewer's own device. The browser asks for it with a normal link, so
// the server streams the bytes with "Content-Disposition: attachment" and honours Range, which
// lets browsers resume an interrupted download.
// ---------------------------------------------------------------------------

app.get('/api/download', withActiveProfile, requireGrantedFile, wrap(async (req, res) => {
  const { hash, index } = fileRef(req);
  const rawName = String(req.query.name || 'video.mkv').split(/[\\/]/).pop().trim();
  const name = rawName.replace(/[\u0000-\u001f"]/g, '').slice(0, 200) || 'video.mkv';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');

  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetch(`${TORRSERVER_URL}/stream/${encodeURIComponent(name)}?link=${hash}&index=${index}&play`, {
    headers,
    signal: controller.signal,
  });
  if (upstream.status !== 200 && upstream.status !== 206) throw httpError(502, `TorrServer answered HTTP ${upstream.status} for this file.`);

  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  // Keep the torrent alive for as long as the download runs (the idle cleanup would otherwise drop it).
  touch(hash);
  const heartbeat = setInterval(() => touch(hash), 60000);
  res.on('close', () => clearInterval(heartbeat));

  Readable.fromWeb(upstream.body)
    .on('error', () => res.destroy())
    .pipe(res);
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

app.post('/api/progress', withProfile, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.contentKey || !b.title || !b.mediaType) throw httpError(400, 'Missing progress fields.');
  if (req.profile.maxAge < 18) await enforceTitleRating(req.profile,b.mediaType,b.tmdbId);
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
}));

app.get('/api/skip-markers',withProfile,(req,res)=>{
  const key=safeContentKey(req.query.contentKey);
  res.json({markers:getSkipMarkers(req.profile.id,key)});
});
app.put('/api/skip-markers',withProfile,(req,res)=>{
  const key=safeContentKey(req.body?.contentKey);
  const value=cleanMarkers(req.body?.markers);
  res.json({markers:putSkipMarkers(req.profile.id,key,value)});
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

app.get('/api/progress/title', withProfile, wrap(async (req, res) => {
  const type = validType(req.query.type);
  if (!type) throw httpError(400, 'Unknown type');
  await enforceTitleRating(req.profile,type,req.query.id);
  const items = getTitleProgress(req.profile.id, type, Number(req.query.id)).map((r) => ({
    season: r.season,
    episode: r.episode,
    positionSeconds: r.positionSeconds,
    durationSeconds: r.durationSeconds,
    completed: Boolean(r.completed),
  }));
  res.json({ items });
}));

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
  let rows = getRecentProgress(req.profile.id);
  if(req.profile.maxAge<18){
    const limited=await Promise.all(rows.slice(0,40).map(async row=>{
      try {await enforceTitleRating(req.profile,row.mediaType,row.tmdbId);return row;}catch{return null;}
    }));
    rows=limited.filter(Boolean);
  }
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

app.get('/api/mylist', withProfile, wrap(async(req,res)=>{
  let items=getMyList(req.profile.id);
  if(req.profile.maxAge<18){
    const checked=await Promise.all(items.slice(0,50).map(async item=>{try{await enforceTitleRating(req.profile,item.type,item.id);return item;}catch{return null;}}));
    items=checked.filter(Boolean);
  }
  res.json({items});
}));

app.post('/api/mylist', withProfile, wrap(async (req, res) => {
  const { type, id, title } = req.body || {};
  if (!validType(type) || !id || !title) throw httpError(400, 'Missing title details.');
  await enforceTitleRating(req.profile,type,id);
  addToMyList(req.profile.id, { ...req.body, id: Number(id) });
  res.json({ ok: true });
}));

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
  if (res.headersSent) {
    // e.g. the viewer closed a download/stream mid-way: nothing left to tell them.
    if (!res.writableEnded) res.end();
    return;
  }
  const status = err.status && err.status !== 401 ? err.status : err.status === 401 ? 502 : 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err.message);
  res.status(status).json({ error: err.message || 'Something went wrong.', code: err.code });
});

app.listen(PORT, () => {
  console.log(`StreamHub backend listening on :${PORT}`);
  console.log(`  Prowlarr:   ${PROWLARR_URL}`);
  console.log(`  TorrServer: ${TORRSERVER_URL}`);
  console.log(`  TMDB:       ${tmdbEnabled() ? 'configured' : 'NOT configured (set TMDB_API_KEY to enable the catalog)'}`);
  startAdvancedJobs();
  setTimeout(async () => {
    const p = await checkProwlarr();
    if (!p.ok) console.error(`[startup] ${p.reason}`);
    else console.log('[startup] Prowlarr API key accepted.');
  }, 8000).unref();
});
