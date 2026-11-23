const KEY='sh_device_id';
export function localDeviceId() {
  try {
    let id=localStorage.getItem(KEY);
    if(!id){
      id=globalThis.crypto?.randomUUID?.().replace(/-/g,'') || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY,id);
    }
    return id;
  }catch{return `session_${Math.random().toString(36).slice(2).padEnd(12,'0')}`;}
}
export function localDeviceName() {
  const agent=navigator.userAgent||'';
  const type=/iPhone|iPad/i.test(agent)?'iPhone / iPad':/Android/i.test(agent)?'Android':/Mac/i.test(agent)?'Mac':/Windows/i.test(agent)?'Windows':'Browser';
  return `StreamHub on ${type}`;
}
