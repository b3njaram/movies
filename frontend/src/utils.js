export const cx = (...parts) => parts.filter(Boolean).join(' ');

// TMDB image helper. size examples: w185, w342, w500, w780, w1280, original
export const img = (path, size = 'w500') => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtRuntime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec) return '0 KB/s';
  const kb = bytesPerSec / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB/s` : `${Math.round(kb)} KB/s`;
}

// Progress is stored per movie / per episode, independent of which torrent was used.
export function contentKeyOf(spec) {
  if (spec.contentKey) return spec.contentKey;
  if (spec.type === 'movie' && spec.tmdbId) return `movie:${spec.tmdbId}`;
  if (spec.type === 'tv' && spec.tmdbId) return `tv:${spec.tmdbId}:s${spec.season}e${spec.episode}`;
  return null;
}

export const episodeTag = (season, episode) => `S${season}:E${episode}`;

// Build a play spec from a catalog item (movie/tv) — season/episode filled in by the caller.
export function specFromItem(item, extra = {}) {
  return {
    type: item.type,
    tmdbId: item.id,
    title: item.title,
    year: item.year,
    poster: item.poster,
    backdrop: item.backdrop,
    ...extra,
  };
}
