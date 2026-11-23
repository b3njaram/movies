// Device-local videos live in Origin Private File System, never in the SW cache.
// Only an explicit user gesture initiates downloads. This module is shared by
// the authenticated React app and the standalone, offline-capable player page.
const FOLDER = 'streamhub-offline-v1';
const MAX_BYTES = 8 * 1024 ** 3;
const allowed = /^\/(?:api\/(?:download(?:\?|$)|library\/stream\/\d+(?:\?|$)|local-media\/stream\/\d+(?:\?|$)))/;
export function offlineSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory && crypto?.randomUUID);
}
async function folder() {
  if (!offlineSupported()) throw new Error('This browser cannot securely store offline videos.');
  const origin = await navigator.storage.getDirectory();
  return origin.getDirectoryHandle(FOLDER, { create: true });
}
const fileName = (id, ext) => `${id}.${ext}`;
function safeId(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid offline item ID.');
  return id;
}
async function writeJson(directory, id, value) {
  const handle = await directory.getFileHandle(fileName(id, 'json'), { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(JSON.stringify(value)); await writer.close(); }
  catch (e) { await writer.abort().catch(() => {}); throw e; }
}
export async function listOfflineVideos() {
  const dir = await folder();
  const items = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const item = JSON.parse(await (await handle.getFile()).text());
      if (!item?.id || !item.title || !Number.isSafeInteger(item.bytes)) continue;
      await dir.getFileHandle(fileName(safeId(item.id), 'bin'));
      items.push(item);
    } catch { /* Skip incomplete or corrupted entries. */ }
  }
  return items.sort((a, b) => b.savedAt - a.savedAt);
}
export async function offlineVideoFile(id) {
  const dir = await folder();
  const handle = await dir.getFileHandle(fileName(safeId(id), 'bin'));
  return handle.getFile();
}
export async function removeOfflineVideo(id) {
  const dir = await folder();
  safeId(id);
  await dir.removeEntry(fileName(id, 'json')).catch(e => { if (e.name !== 'NotFoundError') throw e; });
  await dir.removeEntry(fileName(id, 'bin')).catch(e => { if (e.name !== 'NotFoundError') throw e; });
}
export async function updateOfflinePosition(id, seconds) {
  const item = (await listOfflineVideos()).find(x => x.id === id);
  if (!item) return;
  item.position = Math.max(0, Math.floor(Number(seconds) || 0));
  await writeJson(await folder(), id, item);
}
export async function downloadOfflineVideo({ src, title, poster = '', profileName = '', profileId = 0, signal, onProgress = () => {} }) {
  if (!navigator.onLine) throw new Error('Connect to your StreamHub server before downloading.');
  const url = new URL(src, location.origin);
  if (url.origin !== location.origin || !allowed.test(url.pathname + url.search)) throw new Error('Offline download URL is not allowed.');
  const dir = await folder();
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (/text\/html|application\/json/.test(contentType)) throw new Error('Server did not return a video file.');
  const expected = Number(res.headers.get('content-length') || 0);
  if (expected > MAX_BYTES) throw new Error('Video exceeds the 8 GB offline-file limit.');
  const estimate = await navigator.storage.estimate?.();
  if (expected && estimate?.quota && expected + (estimate.usage || 0) > estimate.quota * 0.94)
    throw new Error('Not enough free browser storage for this video.');
  const id = crypto.randomUUID();
  const writer = await (await dir.getFileHandle(fileName(id, 'bin'), { create: true })).createWritable();
  let bytes = 0, closed = false;
  try {
    const reader = res.body.getReader();
    for (;;) {
      if (signal?.aborted) throw new DOMException('Download cancelled.', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Video exceeds the 8 GB offline-file limit.');
      await writer.write(value);
      onProgress({ downloaded: bytes, total: expected || null });
    }
    if (expected && bytes !== expected) throw new Error('Download ended before the complete video was received.');
    await writer.close(); closed = true;
    // Metadata is published only when the complete media file exists.
    const item = { id, title: String(title || 'Video').slice(0, 180), poster: String(poster || '').slice(0, 300),
      profileName: String(profileName || '').slice(0, 40), profileId: Number(profileId) || 0,
      bytes, savedAt: Date.now(), position: 0, mime: contentType.split(';')[0] || 'video/mp4' };
    await writeJson(dir, id, item);
    return item;
  } catch (error) {
    if (!closed) await writer.abort().catch(() => {});
    await dir.removeEntry(fileName(id, 'bin')).catch(() => {});
    await dir.removeEntry(fileName(id, 'json')).catch(() => {});
    throw error;
  }
}
