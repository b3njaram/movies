// Source scoring happens locally, after Prowlarr's relevance/seed/language
// ranking. No capabilities or playback history are sent to third parties.
// Read the existing per-profile key without coupling tests to Vite's import.meta.env.
function getProfileId() { try { return localStorage.getItem('sh_profile'); } catch { return null; } }

const ORDER = { SD: 0, '480p': 1, '720p': 2, '1080p': 3, '2160p': 4 };
const QUALITY = ['auto', '2160p', '1080p', '720p'];
function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private browser */ } }
function key(suffix) { return `sh_${suffix}_${getProfileId() || 'guest'}`; }
export function getQualityPref() { const s = storageGet(key('quality')); return QUALITY.includes(s) ? s : 'auto'; }
export function setQualityPref(quality) {
  const valid = QUALITY.includes(quality) ? quality : 'auto';
  storageSet(key('quality'), valid);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('sh:quality-change'));
}
export function detectVideoSupport(video) {
  const probe = (mime) => {
    try { return !!video?.canPlayType?.(mime); } catch { return false; }
  };
  return {
    h264: probe('video/mp4; codecs="avc1.42E01E"'),
    hevc: probe('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    av1: probe('video/mp4; codecs="av01.0.05M.08"'),
    aac: probe('audio/mp4; codecs="mp4a.40.2"'),
  };
}
function rememberKey(contentKey) { return key(`good_${contentKey || 'raw'}`); }
export function rememberSuccessfulSource(contentKey, sourceTitle) {
  if (sourceTitle) storageSet(rememberKey(contentKey), sourceTitle.slice(0, 180));
}
export function rankSourcesForDevice(sources, { support = {}, quality = 'auto', remembered = null } = {}) {
  if (!Array.isArray(sources)) return [];
  return [...sources].map(src => {
    let bonus = 0;
    if (src.codec === 'HEVC' && !support.hevc) bonus -= 175;
    if (src.codec === 'AV1' && !support.av1) bonus -= 175;
    if (src.codec === 'H.264' && support.h264) bonus += 22;
    if (src.audioRisk) bonus -= 32;
    if (['AAC','Opus','MP3'].includes(src.audio)) bonus += 15;
    if (remembered && src.title === remembered) bonus += 80;
    if (quality !== 'auto') {
      const rank = ORDER[src.quality] ?? 0;
      const target = ORDER[quality] ?? 3;
      bonus -= rank > target ? 120 : (target - rank) * 10;
      if (rank === target) bonus += 22;
    }
    return { ...src, deviceScore: (src.score || 0) + bonus, deviceWarning: (src.codec === 'HEVC' && !support.hevc) || (src.codec === 'AV1' && !support.av1) };
  }).sort((a,b) => b.deviceScore - a.deviceScore || (b.seeders || 0) - (a.seeders || 0));
}
export function getRankedSources(sources, contentKey, video) {
  return rankSourcesForDevice(sources, {
    support: detectVideoSupport(video || (typeof document !== 'undefined' ? document.createElement('video') : null)),
    quality: getQualityPref(), remembered: storageGet(rememberKey(contentKey)),
  });
}
