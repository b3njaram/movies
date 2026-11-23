// Pure, browser-independent HTTP Range validation helpers.
export const MAX_OFFLINE_BYTES = 8 * 1024 ** 3;
export const DEVICE_BUDGETS_GB = Object.freeze([2, 5, 10, 20, 40]);
export function parseContentRange(value) {
  const m = /^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(String(value || '').trim());
  if (!m) return null;
  const start = Number(m[1]), end = Number(m[2]), total = Number(m[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total)
    && start <= end && end < total ? { start, end, total } : null;
}
export function evaluateDownloadResponse({ status, contentRange, contentLength, offset, previousTotal = 0 }) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid resume position.');
  const length = Number(contentLength || 0);
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid response length.');
  if (status === 206) {
    const range = parseContentRange(contentRange);
    if (!range || range.start !== offset || (length && length !== range.end - range.start + 1)) {
      throw new Error('Server returned a mismatched byte range. Download was not appended.');
    }
    if (previousTotal && previousTotal !== range.total) throw new Error('Video changed since download began.');
    if (range.total > MAX_OFFLINE_BYTES) throw new Error('Video exceeds the 8 GB offline-file limit.');
    return { offset, total: range.total, resumed: offset > 0 };
  }
  if (status === 200) {
    if (length > MAX_OFFLINE_BYTES) throw new Error('Video exceeds the 8 GB offline-file limit.');
    return { offset: 0, total: length, resumed: false };
  }
  throw new Error(`Server returned ${status} instead of video bytes.`);
}
export function validOfflineSource(src, origin) {
  const url = new URL(src, origin);
  if (url.origin !== origin || !/^\/api\/(?:download|library\/stream\/[1-9]\d*|local-media\/stream\/[1-9]\d*)$/.test(url.pathname)) {
    throw new Error('Offline download URL is not allowed.');
  }
  if (url.username || url.password) throw new Error('Offline URL contains credentials.');
  return url.href;
}
export function normalizedBudgetGb(value) {
  const n = Number(value);
  if (!DEVICE_BUDGETS_GB.includes(n)) throw new Error('Unsupported device storage budget.');
  return n;
}
