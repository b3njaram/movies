// TMDB exposes an air *date*, not a regional streaming availability guarantee.
// Keep comparisons deterministic, reject invalid/future episodes, and ignore specials.
export function airedEpisode(raw, today = new Date().toISOString().slice(0, 10)) {
  if (!raw || typeof raw !== 'object') return null;
  const season = Number(raw.season_number);
  const episode = Number(raw.episode_number);
  const date = String(raw.air_date || '');
  if (!Number.isSafeInteger(season) || season < 1 || season > 300 ||
      !Number.isSafeInteger(episode) || episode < 1 || episode > 10000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today ||
      Number.isNaN(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date) return null;
  return { season, episode, airDate: date, name: String(raw.name || '').slice(0, 140) };
}

export function isNewEpisode(latest, previous) {
  if (!latest) return false;
  const season = Number(previous?.last_seen_season || 0);
  const episode = Number(previous?.last_seen_episode || 0);
  return latest.season > season || (latest.season === season && latest.episode > episode);
}

export function showId(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || String(raw).trim() !== String(id)) {
    const err = new Error('Invalid TV show ID.'); err.status = 400; throw err;
  }
  return id;
}
