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
    throw new ApiError('Cannot reach the server. Check your connection.', 0, 'NETWORK');
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
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
