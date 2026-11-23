// Optional Web Push: secret keys live under the existing SQLite data mount.
// Subscription endpoints are tightly whitelisted to avoid arbitrary outbound SSRF.
import fs from 'node:fs';import path from 'node:path';
import webPush from 'web-push';
import {safePushEndpoint} from './push-rules.js';
import {db} from './db.js';
const ROOT=path.dirname(process.env.DB_PATH||'/app/data/streamhub.db');
const KEYS_PATH=path.join(ROOT,'push-vapid-keys.json');
let configured=false,started=false,busy=false;
db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL,
 endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL,created_at INTEGER NOT NULL,
 FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS idx_push_profile ON push_subscriptions(profile_id);
 CREATE TABLE IF NOT EXISTS push_deliveries (
 subscription_id INTEGER NOT NULL, notification_id INTEGER NOT NULL,
 delivered_at INTEGER NOT NULL, PRIMARY KEY(subscription_id,notification_id),
 FOREIGN KEY(subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 FOREIGN KEY(notification_id) REFERENCES profile_notifications(id) ON DELETE CASCADE);`);
function keys(){
 fs.mkdirSync(ROOT,{recursive:true});
 try{fs.writeFileSync(KEYS_PATH,JSON.stringify(webPush.generateVAPIDKeys()),{flag:'wx',mode:0o600});}
 catch(e){if(e.code!=='EEXIST')throw e;}
 const value=JSON.parse(fs.readFileSync(KEYS_PATH,'utf8'));
 if(!value.publicKey||!value.privateKey)throw new Error('Invalid saved push signing keys.');
 if(!configured){webPush.setVapidDetails('https://github.com/b3njaram/movies',value.publicKey,value.privateKey);configured=true;}
 return value;
}
export const getPushPublicKey=()=>keys().publicKey;
export function savePushSubscription(profileId,body){
 const endpoint=body?.endpoint;
 if(typeof endpoint!=='string'||!safePushEndpoint(endpoint))throw Object.assign(new Error('Unsupported push service endpoint.'),{status:400});
 const p256dh=body?.keys?.p256dh,auth=body?.keys?.auth;
 if(!/^[A-Za-z0-9_-]{80,120}$/.test(p256dh||'')||!/^[A-Za-z0-9_-]{16,44}$/.test(auth||''))throw Object.assign(new Error('Invalid push subscription keys.'),{status:400});
 const count=db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE profile_id=?').get(profileId).n;
 const existing=db.prepare('SELECT profile_id FROM push_subscriptions WHERE endpoint=?').get(endpoint);
 if(count>=5 && (!existing||existing.profile_id!==profileId))throw Object.assign(new Error('A profile may have up to five push devices.'),{status:400});
 db.prepare(`INSERT INTO push_subscriptions(profile_id,endpoint,subscription_json,created_at) VALUES(?,?,?,?)
  ON CONFLICT(endpoint) DO UPDATE SET profile_id=excluded.profile_id,subscription_json=excluded.subscription_json,created_at=excluded.created_at`).run(profileId,endpoint,JSON.stringify({endpoint,keys:{p256dh,auth}}),Date.now());
 return {ok:true};
}
export function deletePushSubscription(profileId,endpoint){
 db.prepare('DELETE FROM push_subscriptions WHERE profile_id=? AND endpoint=?').run(profileId,String(endpoint||''));
 return {ok:true};
}
export async function deliverPush(){
 if(busy)return;busy=true;
 try{
  const pending=db.prepare(`SELECT s.id AS sid,s.endpoint,s.subscription_json AS subscription,
   n.id AS nid,n.kind,n.title,n.message,n.destination
   FROM push_subscriptions s JOIN profile_notifications n ON n.profile_id=s.profile_id
   LEFT JOIN push_deliveries d ON d.subscription_id=s.id AND d.notification_id=n.id
   WHERE d.notification_id IS NULL AND n.created_at>=s.created_at
     AND n.created_at>? ORDER BY n.id LIMIT 25`).all(Date.now()-24*3600000);
  if(!pending.length)return;
  keys();
  for(const item of pending){
   try {
    await webPush.sendNotification(JSON.parse(item.subscription),JSON.stringify({title:'StreamHub update',body:'Open StreamHub to see your notification.',kind:item.kind}),{TTL:3600,urgency:'normal'});
    db.prepare('INSERT OR IGNORE INTO push_deliveries(subscription_id,notification_id,delivered_at) VALUES(?,?,?)').run(item.sid,item.nid,Date.now());
   }catch(e){
    if(e.statusCode===404||e.statusCode===410)db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(item.sid);
    else console.warn('[push] delivery unavailable:',e.statusCode||e.message);
   }
  }
 }finally{busy=false;}
}
export function schedulePush(){setImmediate(()=>deliverPush().catch(e=>console.warn('[push]',e.message)));}
export function startPushDelivery(){
 if(started)return;started=true;
 setInterval(()=>deliverPush().catch(e=>console.warn('[push]',e.message)),120000).unref();
}
