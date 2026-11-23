// Public, dependency-free validation of endpoints to prevent push-based SSRF.
export function safePushEndpoint(endpoint){
 if(typeof endpoint!=='string'||endpoint.length>2048)return false;
 try {
  const u=new URL(endpoint);
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.hash)return false;
  const h=u.hostname.toLowerCase();
  return h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||
    h==='web.push.apple.com'||h==='push.services.mozilla.com'||
    /^wns2-[a-z0-9-]+\.notify\.windows\.com$/.test(h);
 }catch{return false;}
}
