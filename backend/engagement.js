// Phase 6: private per-profile notifications and homepage choices.
// The existing SQLite database/bind mount is reused; migrations are additive.
import { db } from './db.js';

const safeText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const destinations = new Set(['library', 'community', 'home']);

db.exec(`
  CREATE TABLE IF NOT EXISTS profile_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    event_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    destination TEXT NOT NULL DEFAULT 'home',
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    UNIQUE(profile_id, event_key),
    FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_profile_notifications ON profile_notifications(profile_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS profile_home_preferences (
    profile_id INTEGER PRIMARY KEY,
    hide_watched INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
  );
`);

export function addNotification(profileId, eventKey, kind, title, message, destination = 'home') {
  const id = Number(profileId);
  if (!Number.isSafeInteger(id) || id < 1) return false;
  const key = safeText(eventKey, 110), heading = safeText(title, 140);
  if (!key || !heading) return false;
  const result = db.prepare(`INSERT OR IGNORE INTO profile_notifications
    (profile_id,event_key,kind,title,message,destination,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(id,key,safeText(kind,32),heading,safeText(message,260),
      destinations.has(destination) ? destination : 'home',Date.now());
  // Bound disk growth for small servers while retaining at least 120 recent entries.
  if (result.changes) db.prepare(`DELETE FROM profile_notifications WHERE profile_id=? AND id NOT IN
    (SELECT id FROM profile_notifications WHERE profile_id=? ORDER BY id DESC LIMIT 120)`).run(id,id);
  return Boolean(result.changes);
}

export function listNotifications(profileId) {
  const items = db.prepare(`SELECT id,kind,title,message,destination,created_at AS createdAt,
    read_at AS readAt FROM profile_notifications WHERE profile_id=? ORDER BY id DESC LIMIT 40`).all(profileId);
  const unread = db.prepare('SELECT COUNT(*) n FROM profile_notifications WHERE profile_id=? AND read_at IS NULL').get(profileId).n;
  return { items, unread };
}

export function readNotifications(profileId, input = {}) {
  if (input.all === true) {
    db.prepare('UPDATE profile_notifications SET read_at=? WHERE profile_id=? AND read_at IS NULL').run(Date.now(), profileId);
  } else {
    const id = Number(input.id);
    if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Invalid notification ID.'),{status:400});
    db.prepare('UPDATE profile_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND profile_id=?').run(Date.now(),id,profileId);
  }
  return listNotifications(profileId);
}

export function deleteNotification(profileId, inputId) {
  const id = Number(inputId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Invalid notification ID.'),{status:400});
  db.prepare('DELETE FROM profile_notifications WHERE id=? AND profile_id=?').run(id,profileId);
  return listNotifications(profileId);
}

export function getHomePreferences(profileId) {
  const row=db.prepare('SELECT hide_watched AS hideWatched FROM profile_home_preferences WHERE profile_id=?').get(profileId);
  return {hideWatched:Boolean(row?.hideWatched)};
}
export function setHomePreferences(profileId, input) {
  if (typeof input?.hideWatched !== 'boolean') throw Object.assign(new Error('Choose whether to hide watched movies.'),{status:400});
  db.prepare(`INSERT INTO profile_home_preferences(profile_id,hide_watched) VALUES(?,?)
    ON CONFLICT(profile_id) DO UPDATE SET hide_watched=excluded.hide_watched`).run(profileId,input.hideWatched?1:0);
  return getHomePreferences(profileId);
}

export function completedMovies(profileId) {
  // Completing an episode does not mean that an entire TV series was watched.
  return db.prepare(`SELECT DISTINCT tmdb_id AS id FROM progress WHERE profile_id=? AND media_type='movie'
    AND completed=1 AND tmdb_id IS NOT NULL ORDER BY updated_at DESC LIMIT 500`).all(profileId).map(r=>r.id);
}
export function watchAgainMovies(profileId) {
  const rows=db.prepare(`SELECT tmdb_id AS id,media_type AS type,title,year,poster,backdrop
    FROM progress WHERE profile_id=? AND media_type='movie' AND completed=1 AND tmdb_id IS NOT NULL
    ORDER BY updated_at DESC LIMIT 90`).all(profileId);
  const seen=new Set();
  return rows.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;}).slice(0,18);
}
