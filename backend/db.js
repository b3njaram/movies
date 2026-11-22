import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || '/app/data/streamhub.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Legacy table from the first version. Kept only so existing history can be migrated.
  CREATE TABLE IF NOT EXISTS watch_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content_key TEXT NOT NULL,
    title TEXT NOT NULL,
    magnet TEXT NOT NULL,
    size_label TEXT,
    indexer TEXT,
    position_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, content_key)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    avatar INTEGER NOT NULL DEFAULT 0,
    kids INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    content_key TEXT NOT NULL,
    media_type TEXT NOT NULL,
    tmdb_id INTEGER,
    season INTEGER,
    episode INTEGER,
    title TEXT NOT NULL,
    subtitle TEXT,
    year TEXT,
    poster TEXT,
    backdrop TEXT,
    magnet TEXT,
    size_label TEXT,
    indexer TEXT,
    position_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(profile_id, content_key),
    FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_progress_profile ON progress(profile_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_progress_title ON progress(profile_id, media_type, tmdb_id);

  CREATE TABLE IF NOT EXISTS my_list (
    profile_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    poster TEXT,
    backdrop TEXT,
    year TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, media_type, tmdb_id),
    FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS meta_cache (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
`);

// Preferred language of the audio ('en' | 'es'), per profile. Added after the first release,
// so existing databases get the column here (no-op once it exists).
try {
  db.exec("ALTER TABLE profiles ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
} catch {
  /* column already exists */
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function createUser(username, passwordHash) {
  return db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export function listProfiles(userId) {
  return db
    .prepare('SELECT id, name, avatar, kids, lang FROM profiles WHERE user_id = ? ORDER BY id')
    .all(userId)
    .map((p) => ({ ...p, kids: !!p.kids }));
}

export function getProfile(userId, profileId) {
  const p = db
    .prepare('SELECT id, name, avatar, kids, lang FROM profiles WHERE id = ? AND user_id = ?')
    .get(profileId, userId);
  return p ? { ...p, kids: !!p.kids } : null;
}

// Every account always has at least one profile. The first time an account is
// used we create one named after the user and migrate any watch history that
// was recorded by the first version of the app (before profiles existed).
export function ensureDefaultProfile(user) {
  const existing = listProfiles(user.id);
  if (existing.length) return existing;

  const info = db
    .prepare('INSERT INTO profiles (user_id, name, avatar, kids) VALUES (?, ?, 0, 0)')
    .run(user.id, user.username.slice(0, 20));

  db.prepare(
    `INSERT OR IGNORE INTO progress
       (profile_id, content_key, media_type, title, magnet, size_label, indexer,
        position_seconds, duration_seconds, completed, updated_at)
     SELECT ?, 'raw:' || content_key, 'raw', title, magnet, size_label, indexer,
            position_seconds, duration_seconds, completed, updated_at
     FROM watch_progress WHERE user_id = ?`
  ).run(info.lastInsertRowid, user.id);

  return listProfiles(user.id);
}

export function createProfile(userId, { name, avatar, kids, lang }) {
  const info = db
    .prepare('INSERT INTO profiles (user_id, name, avatar, kids, lang) VALUES (?, ?, ?, ?, ?)')
    .run(userId, name, avatar, kids ? 1 : 0, lang === 'es' ? 'es' : 'en');
  return getProfile(userId, Number(info.lastInsertRowid));
}

export function updateProfile(userId, profileId, { name, avatar, kids, lang }) {
  db.prepare('UPDATE profiles SET name = ?, avatar = ?, kids = ?, lang = ? WHERE id = ? AND user_id = ?').run(
    name,
    avatar,
    kids ? 1 : 0,
    lang === 'es' ? 'es' : 'en',
    profileId,
    userId
  );
  return getProfile(userId, profileId);
}

export function deleteProfile(userId, profileId) {
  return db.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').run(profileId, userId);
}

// ---------------------------------------------------------------------------
// Watch progress (per profile)
// ---------------------------------------------------------------------------

function isCompleted(position, duration) {
  if (!duration || duration <= 0) return 0;
  const ratio = position / duration;
  if (ratio >= 0.93) return 1;
  if (duration > 900 && duration - position < 75) return 1;
  return 0;
}

export function upsertProgress(p) {
  const row = {
    profileId: p.profileId,
    contentKey: p.contentKey,
    mediaType: p.mediaType,
    tmdbId: p.tmdbId ?? null,
    season: p.season ?? null,
    episode: p.episode ?? null,
    title: p.title,
    subtitle: p.subtitle ?? null,
    year: p.year ?? null,
    poster: p.poster ?? null,
    backdrop: p.backdrop ?? null,
    magnet: p.magnet ?? null,
    sizeLabel: p.sizeLabel ?? null,
    indexer: p.indexer ?? null,
    positionSeconds: Math.max(0, Number(p.positionSeconds) || 0),
    durationSeconds: Math.max(0, Number(p.durationSeconds) || 0),
  };
  row.completed = isCompleted(row.positionSeconds, row.durationSeconds);

  db.prepare(
    `INSERT INTO progress
       (profile_id, content_key, media_type, tmdb_id, season, episode, title, subtitle, year,
        poster, backdrop, magnet, size_label, indexer, position_seconds, duration_seconds,
        completed, updated_at)
     VALUES
       (@profileId, @contentKey, @mediaType, @tmdbId, @season, @episode, @title, @subtitle, @year,
        @poster, @backdrop, @magnet, @sizeLabel, @indexer, @positionSeconds, @durationSeconds,
        @completed, datetime('now'))
     ON CONFLICT(profile_id, content_key) DO UPDATE SET
       title = excluded.title,
       subtitle = COALESCE(excluded.subtitle, progress.subtitle),
       year = COALESCE(excluded.year, progress.year),
       poster = COALESCE(excluded.poster, progress.poster),
       backdrop = COALESCE(excluded.backdrop, progress.backdrop),
       magnet = COALESCE(excluded.magnet, progress.magnet),
       size_label = COALESCE(excluded.size_label, progress.size_label),
       indexer = COALESCE(excluded.indexer, progress.indexer),
       position_seconds = excluded.position_seconds,
       duration_seconds = excluded.duration_seconds,
       completed = excluded.completed,
       updated_at = datetime('now')`
  ).run(row);
}

const PROGRESS_COLUMNS = `
  content_key AS contentKey, media_type AS mediaType, tmdb_id AS tmdbId, season, episode,
  title, subtitle, year, poster, backdrop, magnet, size_label AS sizeLabel, indexer,
  position_seconds AS positionSeconds, duration_seconds AS durationSeconds,
  completed, updated_at AS updatedAt`;

export function getProgressByKey(profileId, contentKey) {
  return db
    .prepare(`SELECT ${PROGRESS_COLUMNS} FROM progress WHERE profile_id = ? AND content_key = ?`)
    .get(profileId, contentKey);
}

export function getTitleProgress(profileId, mediaType, tmdbId) {
  return db
    .prepare(
      `SELECT ${PROGRESS_COLUMNS} FROM progress
       WHERE profile_id = ? AND media_type = ? AND tmdb_id = ?
       ORDER BY updated_at DESC, id DESC`
    )
    .all(profileId, mediaType, tmdbId);
}

export function getRecentProgress(profileId, limit = 120) {
  return db
    .prepare(
      `SELECT ${PROGRESS_COLUMNS} FROM progress
       WHERE profile_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`
    )
    .all(profileId, limit);
}

// ---------------------------------------------------------------------------
// My List
// ---------------------------------------------------------------------------

export function getMyList(profileId) {
  return db
    .prepare(
      `SELECT media_type AS type, tmdb_id AS id, title, poster, backdrop, year
       FROM my_list WHERE profile_id = ? ORDER BY added_at DESC, rowid DESC`
    )
    .all(profileId);
}

export function addToMyList(profileId, item) {
  db.prepare(
    `INSERT OR REPLACE INTO my_list (profile_id, media_type, tmdb_id, title, poster, backdrop, year)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(profileId, item.type, item.id, item.title, item.poster ?? null, item.backdrop ?? null, item.year ?? null);
}

export function removeFromMyList(profileId, type, id) {
  db.prepare('DELETE FROM my_list WHERE profile_id = ? AND media_type = ? AND tmdb_id = ?').run(profileId, type, id);
}

// ---------------------------------------------------------------------------
// Metadata cache (TMDB responses)
// ---------------------------------------------------------------------------

export function cacheGet(key, ttlSeconds) {
  const row = db.prepare('SELECT json, ts FROM meta_cache WHERE key = ?').get(key);
  if (!row) return null;
  if (Math.floor(Date.now() / 1000) - row.ts > ttlSeconds) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

export function cacheSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO meta_cache (key, json, ts) VALUES (?, ?, ?)').run(
    key,
    JSON.stringify(value),
    Math.floor(Date.now() / 1000)
  );
}
