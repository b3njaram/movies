// Sidecar subtitle files from the same TorrServer release. The selected video
// and subtitle must belong to the same torrent; no arbitrary upstream URLs.
const SAFE_HASH = /^[a-f0-9]{40}$/i;
const SUB_EXT = /\.(srt|vtt)$/i;
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i;

export function validatedFileRef(hash, index) {
  const number = Number(index);
  if (!SAFE_HASH.test(String(hash)) || !Number.isSafeInteger(number) || number < 1 || number > 100000) {
    throw Object.assign(new Error('Invalid torrent file reference.'), { status: 400 });
  }
  return { hash: String(hash).toLowerCase(), index: number };
}

export function detectSubtitleLang(filename) {
  const words = String(filename).toLowerCase().replace(/[._\-()[\]]/g, ' ');
  if (/\b(spa|spanish|espanol|español|latino|castellano|es)\b/i.test(words)) return 'es';
  if (/\b(eng|english|en)\b/i.test(words)) return 'en';
  if (/\b(fra|french|fr)\b/i.test(words)) return 'fr';
  return 'und';
}

function stem(s) { return String(s).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function parent(s) { return String(s).replace(/\\/g, '/').split('/').slice(0, -1).join('/'); }
function similarity(a, b) {
  const x = new Set(stem(a).split(' ').filter(w => w.length > 1));
  const y = new Set(stem(b).split(' ').filter(w => w.length > 1 && !/^(en|eng|english|es|spa|spanish|forced|sdh)$/.test(w)));
  return [...x].filter(t => y.has(t)).length / Math.max(1, x.size);
}

export function listSubtitleFiles(stats, videoIndex) {
  if (!Array.isArray(stats)) return [];
  const video = stats.find(f => Number(f.id) === Number(videoIndex));
  if (!video || !VIDEO_EXT.test(video.path || video.name || '')) return [];
  const videoPath = String(video.path || video.name).replace(/\\/g, '/');
  return stats.filter(f => SUB_EXT.test(f.path || f.name || '')).map(f => {
    const filePath = String(f.path || f.name).replace(/\\/g, '/');
    // Never attach a different episode's subtitles merely because its words match.
    const episodeOf = p => /\bs(\d{1,2})[ ._-]*e(\d{1,3})\b/i.exec(p)?.slice(1).map(Number).join(':') || null;
    const a = episodeOf(videoPath), b = episodeOf(filePath);
    if (a && b && a !== b) return null;
    const score = (parent(filePath) === parent(videoPath) ? 2 : 0) + similarity(videoPath, filePath);
    return { index: Number(f.id), name: filePath.split('/').pop(), lang: detectSubtitleLang(filePath), score, size: Number(f.length || 0) };
  }).filter(f => f && f.score >= 2.25 && f.size >= 0 && f.size <= 5 * 1024 * 1024)
    .sort((a,b) => b.score - a.score).slice(0, 20)
    .map(({score, ...item})=>item);
}

export function toVtt(source) {
  let text = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT(?:\s|$)/.test(text.trimStart())) return text;
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2');
  // Normalize SRT numeric cue indices and invalid tags without interpreting HTML.
  return `WEBVTT\n\n${text.trim()}\n`;
}
