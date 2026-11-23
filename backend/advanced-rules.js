// Dependency-free validation used by the Phase 3 backend and its tests.
export const QUALITY_VALUES = Object.freeze(['auto', '480p', '720p', '1080p', '2160p']);
export const BANDWIDTH_VALUES = Object.freeze([0, 2, 5, 10, 20, 40]); // Mbps, 0 = unrestricted
export const CONVERSION_HEIGHTS = Object.freeze([480, 720]);
export function playbackSettings(input = {}) {
  const quality = String(input.quality || 'auto');
  const bandwidthMbps = Number(input.bandwidthMbps ?? 0);
  if (!QUALITY_VALUES.includes(quality) || !BANDWIDTH_VALUES.includes(bandwidthMbps)) {
    throw Object.assign(new Error('Choose a supported quality and bandwidth setting.'), { status: 400 });
  }
  return { quality, bandwidthMbps };
}
export function convertOptions(input = {}) {
  const height = Number(input.height ?? 720);
  const seconds = Number(input.t ?? 0);
  if (!CONVERSION_HEIGHTS.includes(height) || !Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 3600) {
    throw Object.assign(new Error('Invalid conversion settings.'), { status: 400 });
  }
  return { height, seconds: Math.floor(seconds) };
}
export function downloadName(name) {
  const cleaned = String(name || 'video.mp4').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
  return cleaned && /\.(mp4|mkv|mov|avi|webm|m4v|ts)$/i.test(cleaned) ? cleaned : 'video.mp4';
}
export function validHash(value) {
  const hash = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) throw Object.assign(new Error('Invalid torrent hash.'), { status: 400 });
  return hash;
}
export function validFileIndex(value) {
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0 || index > 100000) throw Object.assign(new Error('Invalid file index.'), { status: 400 });
  return index;
}
export function deviceId(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) throw Object.assign(new Error('Invalid device identifier.'), { status: 400 });
  return id;
}
export function safeTitle(value) { return String(value || '').trim().slice(0, 180); }
export function safeContentKey(value) {
  const key = String(value || '');
  if (!/^(?:movie:\d+|tv:\d+:s\d+e\d+|raw:[\w:-]+)$/.test(key) || key.length > 160) throw Object.assign(new Error('Invalid playback identifier.'), { status: 400 });
  return key;
}
export function queueStatus(status) { return ['queued','running','paused','ready','failed'].includes(status); }
export function bytesPerSecond(mbps) { return Number(mbps) > 0 ? Math.floor(Number(mbps) * 1_000_000 / 8) : 0; }
export function safeFileSize(n) { return Number.isSafeInteger(n) && n >= 0 && n <= 100 * 1024 ** 3; }
