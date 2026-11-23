// Pure source and torrent-file selection rules, shared by search and playback.
// Never present subtitle/metadata-only releases as playable videos.
const VIDEO_EXT = /\.(?:mp4|mkv|avi|mov|webm|m4v|ts|wmv)$/i;
const NON_VIDEO_EXT = /\.(?:srt|vtt|ass|ssa|sub|idx|nfo|txt|jpg|jpeg|png|pdf|zip|rar|7z|exe|iso)$/i;
const MIN_RELEASE_BYTES = 8 * 1024 * 1024;
const MIN_VIDEO_FILE_BYTES = 2 * 1024 * 1024;

export function isLikelyVideoRelease(title, sizeBytes) {
  const name = String(title || '').trim();
  if (!name || NON_VIDEO_EXT.test(name)) return false;
  const size = Number(sizeBytes);
  if (Number.isFinite(size) && size > 0 && size < MIN_RELEASE_BYTES) return false;
  // Some subtitle torrents end in a language tag followed by "srt" without a dot.
  if (/(?:^|[\s._-])(?:srt|vtt|subrip|subtitles?)(?:\s*)$/i.test(name)) return false;
  return true;
}

export function isBrowserIncompatibleContainer(name) {
  // These are valid video files, but are rarely supported by an HTML5 video element.
  return /\.(?:avi|wmv)$/i.test(String(name || '').trim());
}

export function pickPlayableFile(fileStats, season, episode) {
  if (!Array.isArray(fileStats)) return null;
  const videos = fileStats
    .map(f => ({ ...f, path: String(f.path || f.name || '') }))
    .filter(f => VIDEO_EXT.test(f.path) && !/(?:^|[\s._/-])sample(?:[\s._/-]|$)/i.test(f.path))
    .filter(f => !Number.isFinite(Number(f.length)) || Number(f.length) <= 0 || Number(f.length) >= MIN_VIDEO_FILE_BYTES);
  if (!videos.length) return null;
  const largest = arr => [...arr].sort((a, b) => (Number(b.length) || 0) - (Number(a.length) || 0))[0];
  if (season == null || episode == null) return largest(videos);
  const s = Number(season), e = Number(episode);
  if (!Number.isSafeInteger(s) || !Number.isSafeInteger(e) || s < 0 || e < 1) return null;
  const patterns = [
    new RegExp(`s0*${s}[ ._-]*e0*${e}(?!\\d)`, 'i'),
    new RegExp(`(?:^|[^\\d])0*${s}x0*${e}(?!\\d)`, 'i'),
    new RegExp(`season[ ._-]*0*${s}[^\\d].*?(?:episode|ep|e)[ ._-]*0*${e}(?!\\d)`, 'i'),
  ];
  for (const re of patterns) {
    const hits = videos.filter(f => re.test(f.path));
    if (hits.length) return largest(hits);
  }
  // Multi-video season packs must contain an identifiable episode.
  if (videos.length > 1) return null;
  // A single video explicitly tagged as a DIFFERENT episode is not a valid fallback.
  if (/\bs\d{1,2}[ ._-]*e\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i.test(videos[0].path)) return null;
  return videos[0]; // old untagged single-file torrents remain usable
}
