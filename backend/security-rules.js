// Only same-origin browsers may issue authenticated state-changing requests.
// Requests with no Origin remain supported for CLI tools and older clients;
// the browser-controlled Fetch Metadata header still blocks cross-site calls.
export function isAllowedMutation(method, origin, host, fetchSite) {
  if (['GET','HEAD','OPTIONS'].includes(String(method).toUpperCase())) return true;
  if (fetchSite === 'cross-site') return false;
  if (origin == null) return true;
  try {
    const url=new URL(origin);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username && !url.password && Boolean(host) &&
      url.host.toLowerCase() === String(host).toLowerCase();
  } catch { return false; }
}

// Bounded login attempt tracking; do not trust an arbitrary CF-Connecting-IP
// forwarded by the caller, and never allow spoofed X-Forwarded-For entries.
export class LoginLimiter {
  constructor({windowMs=5*60*1000, limit=10, maxKeys=4000}={}) {
    this.windowMs=windowMs; this.limit=limit; this.maxKeys=maxKeys; this.map=new Map();
  }
  prune(now=Date.now()) {
    for (const [key,list] of this.map) {
      const remaining=list.filter(ts=>now-ts<this.windowMs);
      if (remaining.length) this.map.set(key,remaining);
      else this.map.delete(key);
    }
  }
  blocked(key, now=Date.now()) {
    this.prune(now);
    const attempts=this.map.get(key)||[];
    return attempts.length>=this.limit || (!this.map.has(key) && this.map.size>=this.maxKeys);
  }
  fail(keys,now=Date.now()) {
    this.prune(now);
    for(const key of keys){
      if(!this.map.has(key)&&this.map.size>=this.maxKeys)continue;
      this.map.set(key,[...(this.map.get(key)||[]),now]);
    }
  }
  success(keys){for(const key of keys)this.map.delete(key);}
}
