import { db } from './db.js';
import { playbackSettings, safeTitle, safeContentKey, deviceId } from './advanced-rules.js';

// All data is additive and stored in the same existing SQLite database.
db.exec(`
CREATE TABLE IF NOT EXISTS download_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  file_index INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  content_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  tmdb_id INTEGER,
  season INTEGER,
  episode INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_download_jobs ON download_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS idx_download_profile ON download_jobs(profile_id,id DESC);
CREATE TABLE IF NOT EXISTS playback_devices (
  profile_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  content_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  tmdb_id INTEGER,
  season INTEGER,
  episode INTEGER,
  title TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  target_device TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id,device_id),
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_playback_devices ON playback_devices(profile_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS server_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  profile_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_events_date ON server_events(created_at,event_type);
CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
`);
for (const ddl of [
  "ALTER TABLE profiles ADD COLUMN playback_quality TEXT NOT NULL DEFAULT 'auto'",
  'ALTER TABLE profiles ADD COLUMN bandwidth_mbps INTEGER NOT NULL DEFAULT 0',
]) {
  try { db.exec(ddl); } catch(e) { if (!/duplicate column name/i.test(e.message)) throw e; }
}
// A worker interrupted by a restart can resume from its .part file.
db.prepare("UPDATE download_jobs SET status = 'queued' WHERE status = 'running'").run();

export function getPlaybackSettings(profileId) {
  const row = db.prepare('SELECT playback_quality AS quality, bandwidth_mbps AS bandwidthMbps FROM profiles WHERE id=?').get(profileId);
  return row ? {quality:row.quality,bandwidthMbps:row.bandwidthMbps} : {quality:'auto',bandwidthMbps:0};
}
export function savePlaybackSettings(profileId,input) {
  const data=playbackSettings(input);
  db.prepare('UPDATE profiles SET playback_quality=?,bandwidth_mbps=? WHERE id=?').run(data.quality,data.bandwidthMbps,profileId);
  return getPlaybackSettings(profileId);
}
export function getServerSetting(key,fallback) {
  const v=db.prepare('SELECT value FROM server_settings WHERE key=?').get(key);
  return v ? JSON.parse(v.value) : fallback;
}
export function putServerSetting(key,value) {db.prepare('INSERT INTO server_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
export function getServerOptions() {
  return {libraryQuotaGb:getServerSetting('libraryQuotaGb',50),downloadMbps:getServerSetting('downloadMbps',0),backupIntervalHours:getServerSetting('backupIntervalHours',24)};
}
export function updateServerOptions(raw) {
  const opts={libraryQuotaGb:Number(raw.libraryQuotaGb),downloadMbps:Number(raw.downloadMbps),backupIntervalHours:Number(raw.backupIntervalHours)};
  if(![10,25,50,100,200].includes(opts.libraryQuotaGb)||![0,2,5,10,20,40].includes(opts.downloadMbps)||![0,12,24,48,168].includes(opts.backupIntervalHours)) throw Object.assign(new Error('Unsupported server storage or backup settings.'),{status:400});
  for(const [k,v] of Object.entries(opts))putServerSetting(k,v);
  return opts;
}
export function insertDownload(p) {
  const result=db.prepare(`INSERT INTO download_jobs(user_id,profile_id,hash,file_index,file_name,title,content_key,media_type,tmdb_id,season,episode,total_bytes)
    VALUES(@userId,@profileId,@hash,@index,@fileName,@title,@contentKey,@mediaType,@tmdbId,@season,@episode,@totalBytes)`).run(p);
  return getDownload(result.lastInsertRowid);
}
export function getDownload(id) {return db.prepare('SELECT * FROM download_jobs WHERE id=?').get(id);}
export function listDownloads(profileId) {return db.prepare('SELECT * FROM download_jobs WHERE profile_id=? ORDER BY id DESC LIMIT 100').all(profileId);}
export function listReady(profileId) {return db.prepare("SELECT * FROM download_jobs WHERE profile_id=? AND status='ready' ORDER BY id DESC LIMIT 100").all(profileId);}
export function nextQueuedDownload() {return db.prepare("SELECT * FROM download_jobs WHERE status='queued' ORDER BY id LIMIT 1").get();}
export function updateDownload(id,patch) {
  const accepted=['status','downloaded_bytes','total_bytes','error'];
  const keys=Object.keys(patch).filter(k=>accepted.includes(k));
  if(!keys.length)return;
  const update=keys.map(k=>`${k}=@${k}`).join(',');
  db.prepare(`UPDATE download_jobs SET ${update},updated_at=datetime('now') WHERE id=@id`).run({id,...patch});
}
export function deleteDownload(id) {return db.prepare('DELETE FROM download_jobs WHERE id=?').run(id);}
export function libraryBytes() {return db.prepare("SELECT COALESCE(SUM(downloaded_bytes),0) size FROM download_jobs WHERE status IN ('ready','running','paused','queued')").get().size;}
export function recordEvent(event,profileId=null){db.prepare('INSERT INTO server_events(event_type,profile_id) VALUES(?,?)').run(event,profileId);}
export function monitorSummary() {
  const events=db.prepare('SELECT event_type AS type,COUNT(*) AS count FROM server_events WHERE created_at>=unixepoch()-86400 GROUP BY event_type').all();
  const jobs=db.prepare('SELECT status,COUNT(*) AS count FROM download_jobs GROUP BY status').all();
  const active=db.prepare('SELECT COUNT(*) AS n FROM playback_devices WHERE updated_at>?').get(Date.now()-2*60000).n;
  return {events,jobs,activeDevices:active,libraryBytes:libraryBytes()};
}
export function savePresence(profileId,b) {
  const did=deviceId(b.deviceId),contentKey=safeContentKey(b.contentKey),title=safeTitle(b.title);
  if(!title||!['movie','tv','raw'].includes(b.mediaType)) throw Object.assign(new Error('Invalid playback status.'),{status:400});
  const duration=Math.max(0,Math.min(86400,Number(b.durationSeconds)||0));
  const pos=Math.max(0,Math.min(duration||86400,Number(b.positionSeconds)||0));
  db.prepare(`INSERT INTO playback_devices(profile_id,device_id,device_name,content_key,media_type,tmdb_id,season,episode,title,position_seconds,duration_seconds,updated_at)
    VALUES(@profileId,@deviceId,@deviceName,@contentKey,@mediaType,@tmdbId,@season,@episode,@title,@positionSeconds,@durationSeconds,@updatedAt)
    ON CONFLICT(profile_id,device_id) DO UPDATE SET device_name=excluded.device_name,content_key=excluded.content_key,media_type=excluded.media_type,
    tmdb_id=excluded.tmdb_id,season=excluded.season,episode=excluded.episode,title=excluded.title,position_seconds=excluded.position_seconds,
    duration_seconds=excluded.duration_seconds,updated_at=excluded.updated_at`).run({profileId,deviceId:did,deviceName:safeTitle(b.deviceName)||'Another device',contentKey,mediaType:b.mediaType,tmdbId:b.tmdbId||null,season:b.season??null,episode:b.episode??null,title,positionSeconds:pos,durationSeconds:duration,updatedAt:Date.now()});
}
export function listPresence(profileId,exclude=null) {
  return db.prepare('SELECT device_id AS deviceId,device_name AS deviceName,content_key AS contentKey,media_type AS type,tmdb_id AS tmdbId,season,episode,title,position_seconds AS positionSeconds,duration_seconds AS durationSeconds,updated_at AS updatedAt FROM playback_devices WHERE profile_id=? AND updated_at>? AND device_id!=? ORDER BY updated_at DESC LIMIT 10').all(profileId,Date.now()-5*60000,exclude||'');
}
export function claimPresence(profileId,sourceDevice,targetDevice,permitted=()=>true) {
  deviceId(sourceDevice);deviceId(targetDevice);
  const row=db.prepare('SELECT * FROM playback_devices WHERE profile_id=? AND device_id=? AND updated_at>?').get(profileId,sourceDevice,Date.now()-5*60000);
  if(!row) throw Object.assign(new Error('That device is no longer playing.'),{status:404});
  if(!permitted(row)) throw Object.assign(new Error('This title is not allowed on the receiving profile.'),{status:403});
  db.prepare('UPDATE playback_devices SET target_device=? WHERE profile_id=? AND device_id=?').run(targetDevice,profileId,sourceDevice);
  return row;
}
export function pollHandoff(profileId,sourceDevice) {
  deviceId(sourceDevice);
  const target=db.prepare('SELECT target_device AS targetDevice FROM playback_devices WHERE profile_id=? AND device_id=?').get(profileId,sourceDevice)?.targetDevice||null;
  if(target)db.prepare('UPDATE playback_devices SET target_device=NULL WHERE profile_id=? AND device_id=?').run(profileId,sourceDevice);
  return {targetDevice:target};
}
export function removePresence(profileId,device) {db.prepare('DELETE FROM playback_devices WHERE profile_id=? AND device_id=?').run(profileId,deviceId(device));}
