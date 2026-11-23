// Offline media is explicitly requested by the user and held in OPFS, not the
// service worker cache. This is private to a browser origin, NOT encrypted or
// an account authentication boundary; shared device users can read these files.
import { MAX_OFFLINE_BYTES, evaluateDownloadResponse, validOfflineSource, normalizedBudgetGb } from './offline-range.js';
const FOLDER = 'streamhub-offline-v1';
const DEFAULT_BUDGET_GB = 10;
const MAX_STRING = 180;
let downloadInProgress = false;
export function offlineSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory && globalThis.crypto?.randomUUID);
}
async function folder() {
  if (!offlineSupported()) throw new Error('This browser cannot securely store offline videos.');
  return (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER, {create: true});
}
const name = (id, extension) => `${id}.${extension}`;
function safeId(id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) throw new Error('Invalid offline item ID.');
  return id;
}
async function readJson(dir, file) {
  return JSON.parse(await (await dir.getFileHandle(file)).getFile().then(f => f.text()));
}
async function writeJson(dir, file, value) {
  const handle = await dir.getFileHandle(file, {create: true});
  const writer = await handle.createWritable();
  try { await writer.write(JSON.stringify(value)); await writer.close(); }
  catch (e) { await writer.abort().catch(() => {}); throw e; }
}
async function removeIfPresent(dir, file) {
  try { await dir.removeEntry(file); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
}
export async function listOfflineVideos() {
  const dir = await folder(), items = [];
  for await (const [file, entry] of dir.entries()) {
    if (entry.kind !== 'file' || !/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    try {
      const item = await readJson(dir, file);
      if (!item?.id || !item.title || !Number.isSafeInteger(item.bytes)) continue;
      const video = await (await dir.getFileHandle(name(safeId(item.id), 'bin'))).getFile();
      if (video.size !== item.bytes || video.size < 1) continue;
      items.push(item);
    } catch { /* Ignore incomplete or malformed entries. */ }
  }
  return items.sort((a, b) => b.savedAt - a.savedAt);
}
export async function listOfflinePending() {
  const dir = await folder(), items = [];
  for await (const [file, entry] of dir.entries()) {
    if (entry.kind !== 'file' || !/^[a-f0-9-]{36}\.pending\.json$/.test(file)) continue;
    try {
      const item = await readJson(dir, file), id = safeId(item.id);
      // Completed media always wins when a cleanup was interrupted.
      try { await dir.getFileHandle(name(id, 'json')); continue; } catch {}
      const video = await (await dir.getFileHandle(name(id, 'bin'))).getFile();
      if (!item.src || !item.title || !Number.isSafeInteger(video.size) || video.size > MAX_OFFLINE_BYTES) continue;
      // Never trust persisted URLs or arbitrary filesystem paths.
      validOfflineSource(item.src, location.origin);
      items.push({...item, bytes: video.size});
    } catch { /* Skip malformed metadata and missing partial files. */ }
  }
  return items.sort((a, b) => b.savedAt - a.savedAt);
}
export async function offlineVideoFile(id) {
  const dir = await folder(), key = safeId(id), item = await readJson(dir, name(key, 'json'));
  const file = await (await dir.getFileHandle(name(key, 'bin'))).getFile();
  if (file.size !== item.bytes) throw new Error('Offline video is incomplete.');
  return file;
}
export async function removeOfflineVideo(id) {
  const dir = await folder(), key = safeId(id);
  await removeIfPresent(dir, name(key, 'json'));
  await removeIfPresent(dir, name(key, 'pending.json'));
  await removeIfPresent(dir, name(key, 'bin'));
}
export async function updateOfflinePosition(id, seconds) {
  const item = (await listOfflineVideos()).find(x => x.id === id);
  if (!item) return;
  item.position = Math.max(0, Math.floor(Number(seconds) || 0));
  await writeJson(await folder(), name(id, 'json'), item);
}
export async function getOfflineBudget() {
  try { return normalizedBudgetGb((await readJson(await folder(), 'device-settings.json')).budgetGb); }
  catch { return DEFAULT_BUDGET_GB; }
}
export async function setOfflineBudget(gb) {
  const value = normalizedBudgetGb(gb);
  await writeJson(await folder(), 'device-settings.json', {budgetGb: value});
  return value;
}
export async function offlineStorageSummary() {
  const [videos, partials, estimate, budgetGb] = await Promise.all([
    listOfflineVideos(), listOfflinePending(), navigator.storage.estimate?.(), getOfflineBudget()
  ]);
  return { completeBytes: videos.reduce((n, v) => n + v.bytes, 0),
    partialBytes: partials.reduce((n, v) => n + v.bytes, 0),
    deviceUsage: estimate?.usage ?? null, deviceQuota: estimate?.quota ?? null, budgetGb };
}
export async function cleanupOfflineOrphans() {
  const dir = await folder(), entries = [];
  for await (const [file, handle] of dir.entries()) if (handle.kind === 'file') entries.push(file);
  let cleaned = 0;
  for (const file of entries.filter(n => /^[a-f0-9-]{36}\.bin$/.test(n))) {
    const id = file.slice(0, -4);
    if (!entries.includes(name(id, 'json')) && !entries.includes(name(id, 'pending.json'))) {
      await removeIfPresent(dir, file); cleaned++;
    }
  }
  return cleaned;
}
export async function downloadOfflineVideo({src, title, poster = '', profileName = '', profileId = 0,
  signal, onProgress = () => {}}) {
  if (downloadInProgress) throw new Error('Another offline download is already running in this tab.');
  const task = async () => {
    downloadInProgress = true;
    try { return await downloadInternal({src,title,poster,profileName,profileId,signal,onProgress}); }
    finally { downloadInProgress = false; }
  };
  // Web Locks prevent two tabs from appending to one partial on supporting browsers.
  if (navigator.locks?.request) return navigator.locks.request('streamhub-offline-write', {mode:'exclusive',signal},task);
  return task();
}
async function downloadInternal({src,title,poster,profileName,profileId,signal,onProgress}) {
  if (!navigator.onLine) throw new Error('Connect to your StreamHub server before downloading.');
  const source = validOfflineSource(src, location.origin);
  const dir = await folder(), profile = Number(profileId) || 0;
  if ((await listOfflineVideos()).some(item => item.src === source && item.profileId === profile)) {
    throw new Error('This video is already saved on this device.');
  }
  const pending = (await listOfflinePending()).find(x => x.src === source && x.profileId === profile);
  const id = pending?.id || crypto.randomUUID();
  const partial = {id,src:source,title:String(title || pending?.title || 'Video').slice(0,MAX_STRING),
    poster:String(poster || pending?.poster || '').slice(0,300),profileName:String(profileName || pending?.profileName || '').slice(0,40),
    profileId:profile,savedAt:pending?.savedAt || Date.now(),etag:pending?.etag || '',lastModified:pending?.lastModified || '',
    expected:pending?.expected || 0,mime:pending?.mime || 'video/mp4'};
  const handle = await dir.getFileHandle(name(id,'bin'), {create:true});
  const file = await handle.getFile();
  let offset = pending ? file.size : 0;
  if (offset > MAX_OFFLINE_BYTES) throw new Error('Partial video exceeds the 8 GB limit.');
  // Without a strong validator, Range could append bytes from a different file.
  const validator = partial.etag && !partial.etag.startsWith('W/') ? partial.etag : partial.lastModified;
  if (offset && !validator) offset = 0;
  const headers = offset ? {Range:`bytes=${offset}-`, 'If-Range':validator} : {};
  const response = await fetch(source,{credentials:'same-origin',cache:'no-store',headers,signal});
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
  const mime = (response.headers.get('content-type') || '').toLowerCase();
  if (/text\/html|application\/(json|problem\+json)/.test(mime)) throw new Error('Server did not return a video file.');
  if (offset && response.status === 206) {
    if (partial.etag && response.headers.get('etag') && response.headers.get('etag') !== partial.etag)
      throw new Error('Media identity changed; cannot safely resume. Delete the partial copy and retry.');
    if (partial.lastModified && response.headers.get('last-modified') && response.headers.get('last-modified') !== partial.lastModified)
      throw new Error('Video changed since the partial download was saved.');
  }
  const plan = evaluateDownloadResponse({status:response.status,contentRange:response.headers.get('content-range'),
    contentLength:response.headers.get('content-length'),offset,previousTotal:offset?partial.expected:0});
  const budgetBytes = (await getOfflineBudget()) * 1024**3;
  const sizes = await offlineStorageSummary();
  const currentPartial = pending?.bytes || 0;
  const alreadyStored = sizes.completeBytes + sizes.partialBytes - currentPartial;
  if (plan.total && alreadyStored + plan.total > budgetBytes) throw new Error('Device offline budget exceeded. Delete videos or increase the budget.');
  const estimate = await navigator.storage.estimate?.();
  if (plan.total && estimate?.quota && (estimate.usage || 0) + Math.max(0,plan.total-file.size) > estimate.quota * 0.94)
    throw new Error('Not enough free browser storage for this video.');
  partial.mime = mime.split(';')[0] || partial.mime;
  partial.etag = response.headers.get('etag') || '';
  partial.lastModified = response.headers.get('last-modified') || '';
  partial.expected = plan.total;
  await writeJson(dir,name(id,'pending.json'),partial);
  const writer = await handle.createWritable({keepExistingData:plan.offset > 0});
  let bytes = plan.offset, opened = true;
  try {
    if (plan.offset) await writer.seek(plan.offset);
    const reader = response.body.getReader();
    for (;;) {
      if (signal?.aborted) throw new DOMException('Download paused.', 'AbortError');
      const {done,value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_OFFLINE_BYTES || alreadyStored + bytes > budgetBytes) throw new Error('Offline storage limit reached.');
      if (plan.total && bytes > plan.total) throw new Error('Received more bytes than expected.');
      await writer.write(value);
      onProgress({downloaded:bytes,total:plan.total || null,resumed:plan.resumed});
    }
    if (!bytes || (plan.total && bytes !== plan.total)) throw new Error('Download ended before the complete video was received.');
    await writer.close(); opened = false;
    const item = {...partial,bytes,savedAt:Date.now(),position:0};
    delete item.expected; delete item.etag; delete item.lastModified;
    await writeJson(dir,name(id,'json'),item); // Publish only after successful transfer.
    await removeIfPresent(dir,name(id,'pending.json'));
    return item;
  } catch (error) {
    // Commit the partially received bytes so pause/network failures can resume.
    if (opened) {
      try { await writer.close(); opened = false; }
      catch { await writer.abort().catch(() => {}); }
    }
    throw error;
  }
}
