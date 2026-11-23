// Private TV episode follows, stored in the existing SQLite database.
import { db } from './db.js';
import { addNotification } from './engagement.js';
import { airedEpisode, isNewEpisode, showId } from './episode-following-rules.js';

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS tv_episode_follows (
    profile_id INTEGER NOT NULL,
    tv_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    poster TEXT,
    last_seen_season INTEGER NOT NULL DEFAULT 0,
    last_seen_episode INTEGER NOT NULL DEFAULT 0,
    last_air_date TEXT,
    next_air_date TEXT,
    last_checked_at INTEGER NOT NULL DEFAULT 0,
    followed_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, tv_id),
    FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_tv_follows_check ON tv_episode_follows(last_checked_at, tv_id);
`);

const select = db.prepare(`SELECT tv_id AS id,title,poster,last_seen_season AS lastSeason,
  last_seen_episode AS lastEpisode,last_air_date AS lastAirDate,next_air_date AS nextAirDate,
  followed_at AS followedAt,last_checked_at AS lastCheckedAt
  FROM tv_episode_follows WHERE profile_id=? ORDER BY followed_at DESC LIMIT 100`);

export const listFollowedShows = profileId => select.all(profileId);

export function followShow(profileId, rawId, title, poster, airStatus, now = Date.now()) {
  const id = showId(rawId);
  const name = String(title || '').trim().slice(0, 140);
  if (!name) throw Object.assign(new Error('TV show title is missing.'), {status:400});
  const latest = airedEpisode(airStatus?.last, new Date(now).toISOString().slice(0,10));
  const nextDate = airStatus?.next?.air_date || null;
  const existing = db.prepare('SELECT 1 FROM tv_episode_follows WHERE profile_id=? AND tv_id=?').get(profileId, id);
  if (!existing) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM tv_episode_follows WHERE profile_id=?').get(profileId).n;
    if (count >= 100) throw Object.assign(new Error('Maximum 100 followed TV shows per profile.'),{status:400});
  }
  // Never reset the episode baseline by following an already-followed show.
  db.prepare(`INSERT INTO tv_episode_follows(profile_id,tv_id,title,poster,last_seen_season,
    last_seen_episode,last_air_date,next_air_date,last_checked_at,followed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(profile_id,tv_id) DO UPDATE SET title=excluded.title,poster=excluded.poster`)
    .run(profileId,id,name,poster||null,latest?.season||0,latest?.episode||0,latest?.airDate||null,
      nextDate,now,now);
  return listFollowedShows(profileId).find(x=>x.id===id);
}

export function unfollowShow(profileId, rawId) {
  const id = showId(rawId);
  db.prepare('DELETE FROM tv_episode_follows WHERE profile_id=? AND tv_id=?').run(profileId,id);
  return {ok:true};
}

export function dueFollowedShows(now=Date.now(), limit=40) {
  return db.prepare(`SELECT f.profile_id AS profileId,f.tv_id AS tvId,f.title,f.last_seen_season,
    f.last_seen_episode,f.last_air_date,p.max_age AS maxAge FROM tv_episode_follows f
    JOIN profiles p ON p.id=f.profile_id
    WHERE f.last_checked_at <= ?
    ORDER BY f.last_checked_at ASC,f.tv_id ASC LIMIT ?`).all(now-CHECK_INTERVAL_MS,limit);
}

export function recordEpisodeCheck(row, airStatus, now=Date.now()) {
  const latest = airedEpisode(airStatus?.last,new Date(now).toISOString().slice(0,10));
  const nextDate = airStatus?.next?.air_date || null;
  // Rows can be unfollowed while network calls are in flight: never resurrect them.
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM tv_episode_follows WHERE profile_id=? AND tv_id=?')
      .get(row.profileId,row.tvId);
    if (!current) return false;
    const fresh = isNewEpisode(latest,current);
    if (fresh) {
      // A notification says an episode aired, not that an indexer has the file.
      const label = `S${latest.season}E${latest.episode}`;
      addNotification(row.profileId,`new-tv:${row.tvId}:${label}`,'new-episode',
        `New episode: ${current.title}`, `${label}${latest.name ? ` · ${latest.name}` : ''} aired on ${latest.airDate}.`,
        `tv:${row.tvId}`);
    }
    db.prepare(`UPDATE tv_episode_follows SET last_checked_at=?,next_air_date=?,
      last_seen_season=?,last_seen_episode=?,last_air_date=?
      WHERE profile_id=? AND tv_id=?`).run(now,nextDate,
        fresh?latest.season:current.last_seen_season,
        fresh?latest.episode:current.last_seen_episode,
        fresh?latest.airDate:current.last_air_date,row.profileId,row.tvId);
    return fresh;
  })();
}

export function markEpisodeCheckFailure(row, now=Date.now()) {
  // Retry in roughly an hour instead of hammering TMDB on every scheduler wake.
  db.prepare('UPDATE tv_episode_follows SET last_checked_at=? WHERE profile_id=? AND tv_id=?')
    .run(now-CHECK_INTERVAL_MS+60*60*1000,row.profileId,row.tvId);
}
