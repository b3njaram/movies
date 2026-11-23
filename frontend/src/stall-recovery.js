// A stalled torrent is recovered in two bounded steps. Never auto-switch a
// viewer-selected source, an offline file, or a stream that is simply paused.
export const STALL_MS = 22000;
export const RETRY_MS = 28000;
export function decideStall({now, lastProgress, softAt = 0, paused, seeking, forced, local, failures = 0, maxFailures = 8}) {
  if (paused || seeking || now - lastProgress < STALL_MS) return 'none';
  if (!softAt) return 'retry';
  if (now - softAt < RETRY_MS) return 'none';
  if (forced || local || failures >= maxFailures) return 'notify';
  return 'switch';
}
