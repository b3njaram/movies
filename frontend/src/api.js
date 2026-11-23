// Same-origin by default: nginx proxies /api and /stream, so this works on
// localhost, the LAN, or behind a Cloudflare Tunnel without any configuration.
export const BASE = import.meta.env.VITE_API_URL || '';

let profileId = null;
try {
  profileId = localStorage.getItem('sh_profile');
} catch {
  /* storage unavailable */
}

export function setProfileId(id) {
  profileId = id == null ? null : String(id);
  try {
    if (profileId) localStorage.setItem('sh_profile', profileId);
    else localStorage.removeItem('sh_profile');
  } catch {
    /* ignore */
  }
}

export const getProfileId = () => profileId;


// Cloudflare (or any proxy) can answer with a full HTML error page instead of our JSON. Never show
// that markup to the viewer: say what happened, with the error code and Ray ID needed to look it up.
function looksLikeHtml(text) {
  return /^\s*<(!doctype|html)/i.test(text || '');
}

export function describeBadResponse(status, text) {
  if (!looksLikeHtml(text)) return String(text || '').slice(0, 200) || `Request failed (${status})`;
  const title = (/<title>([^<]*)<\/title>/i.exec(text)?.[1] || '').replace(/\s+/g, ' ').trim();
  const code = /Error code\s*(\d{3,4})/i.exec(text)?.[1] || /\b(5\d\d|10\d\d)\b/.exec(title)?.[1] || String(status);
  const ray = /Ray ID:\s*(?:<[^>]+>\s*)*([a-f0-9]{8,})/i.exec(text)?.[1];
  const rayTxt = ray ? ` (Ray ID ${ray})` : '';

  if (!/cloudflare/i.test(text)) return `The server sent an unexpected web page instead of data (HTTP ${status}).`;
  if (code === '524') return `Cloudflare error 524: the server took longer than 100 seconds to answer.${rayTxt}`;
  if (/^(1020|1010|1015|1006|1007|1008|1009)$/.test(code) || /blocked|attention required/i.test(title + text.slice(0, 4000))) {
    return `Cloudflare's firewall blocked this request (error ${code}). In the Cloudflare dashboard, open Security \u2192 Events to see which rule did it.${rayTxt}`;
  }
  if (/^(502|503|504|52\d|530)$/.test(code)) {
    return `Cloudflare error ${code}: it could not get an answer from your server. Check that the Docker containers are running.${rayTxt}`;
  }
  return `Cloudflare answered with error ${code} instead of your server.${rayTxt}`;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (profileId) headers['X-Profile-Id'] = profileId;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e.name === 'TimeoutError') throw new ApiError('TorrServer took too long to prepare this source. Trying another release may help.', 504, 'SOURCE_TIMEOUT');
    throw new ApiError('Cannot reach the server. Check your connection.', 0, 'NETWORK');
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON: an HTML error page (e.g. from Cloudflare) or plain text
      if (res.ok && !looksLikeHtml(text)) throw new ApiError('The server sent an unreadable answer.', res.status);
      data = { error: describeBadResponse(res.status, text) };
      if (res.ok) throw new ApiError(data.error, res.status);
    }
  }

  if (!res.ok) {
    const err = new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
    // Only OUR session check can sign the user out — never an upstream error.
    if (res.status === 401 && data?.code === 'AUTH') window.dispatchEvent(new Event('sh:unauthorized'));
    throw err;
  }
  return data;
}

export function sendBeaconJson(path, payload) {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return navigator.sendBeacon(`${BASE}${path}`, blob);
  } catch {
    return false;
  }
}
