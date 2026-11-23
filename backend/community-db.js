import {randomBytes} from 'node:crypto';
import {db} from './db.js';
import {invalid,titleText,mediaType,positiveId,collectionId,roomCode,roomSpec,playbackState} from './community-rules.js';
const fail=(msg,status=404)=>{throw Object.assign(new Error(msg),{status});};
const now=()=>Date.now();
const EIGHT_HOURS=8*60*60*1000;
const ACTIVE_MEMBER_MS=10*60*1000;

db.exec(`
CREATE TABLE IF NOT EXISTS community_collections (
 id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL,
 name TEXT NOT NULL, created_at INTEGER NOT NULL,
 FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collections_profile ON community_collections(profile_id, id);
CREATE TABLE IF NOT EXISTS community_collection_items (
 collection_id INTEGER NOT NULL, media_type TEXT NOT NULL, tmdb_id INTEGER NOT NULL,
 title TEXT NOT NULL, poster TEXT, added_at INTEGER NOT NULL,
 PRIMARY KEY(collection_id,media_type,tmdb_id),
 FOREIGN KEY(collection_id) REFERENCES community_collections(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS community_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL,
 media_type TEXT NOT NULL, tmdb_id INTEGER, title TEXT NOT NULL, year TEXT,
 status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_community_requests ON community_requests(profile_id,created_at DESC);
CREATE TABLE IF NOT EXISTS community_parties (
 code TEXT PRIMARY KEY, host_profile_id INTEGER NOT NULL,
 type TEXT NOT NULL, tmdb_id INTEGER NOT NULL, title TEXT NOT NULL,
 season INTEGER, episode INTEGER, position_seconds REAL NOT NULL DEFAULT 0,
 playing INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 FOREIGN KEY(host_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS community_party_members (
 code TEXT NOT NULL, profile_id INTEGER NOT NULL, joined_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 PRIMARY KEY(code,profile_id),
 FOREIGN KEY(code) REFERENCES community_parties(code) ON DELETE CASCADE,
 FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
`);

export function listCollections(profileId) {
  const collections=db.prepare(`SELECT id,name,created_at AS createdAt FROM community_collections
    WHERE profile_id=? ORDER BY id DESC LIMIT 50`).all(profileId);
  const items=db.prepare(`SELECT media_type AS type,tmdb_id AS id,title,poster FROM community_collection_items
    WHERE collection_id=? ORDER BY added_at DESC LIMIT 300`);
  return collections.map(c=>({...c,items:items.all(c.id)}));
}
export function createCollection(profileId,name) {
  const title=titleText(name,60);
  if(db.prepare('SELECT COUNT(*) AS n FROM community_collections WHERE profile_id=?').get(profileId).n>=50)
    fail('Limit of 50 collections per profile.',409);
  const result=db.prepare('INSERT INTO community_collections(profile_id,name,created_at) VALUES(?,?,?)').run(profileId,title,now());
  return result.lastInsertRowid;
}
export function deleteCollection(profileId,id) {
  const result=db.prepare('DELETE FROM community_collections WHERE id=? AND profile_id=?').run(collectionId(id),profileId);
  if(!result.changes)fail('Collection not found.');
}
export function changeCollectionItem(profileId,id,body,remove=false) {
  const cid=collectionId(id);
  if(!db.prepare('SELECT 1 FROM community_collections WHERE id=? AND profile_id=?').get(cid,profileId))fail('Collection not found.');
  const type=mediaType(body?.type),tmdbId=positiveId(body?.id);
  if(remove){db.prepare('DELETE FROM community_collection_items WHERE collection_id=? AND media_type=? AND tmdb_id=?').run(cid,type,tmdbId);return;}
  const title=titleText(body?.title,180);
  const poster=typeof body?.poster==='string'&&body.poster.length<=500&&/^(?:https:\/\/|\/[A-Za-z0-9_-]{4,})/.test(body.poster)?body.poster:null;
  const count=db.prepare('SELECT COUNT(*) n FROM community_collection_items WHERE collection_id=?').get(cid).n;
  if(count>=300&&!db.prepare('SELECT 1 FROM community_collection_items WHERE collection_id=? AND media_type=? AND tmdb_id=?').get(cid,type,tmdbId))fail('Collection is full.',409);
  db.prepare(`INSERT INTO community_collection_items(collection_id,media_type,tmdb_id,title,poster,added_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(collection_id,media_type,tmdb_id)
    DO UPDATE SET title=excluded.title,poster=excluded.poster`).run(cid,type,tmdbId,title,poster,now());
}
export function submitRequest(profileId,input) {
  const type=mediaType(input?.type),tmdbId=positiveId(input?.tmdbId,false),title=titleText(input?.title,180);
  const year=input?.year==null?null:String(input.year).slice(0,12);
  if(db.prepare("SELECT 1 FROM community_requests WHERE profile_id=? AND media_type=? AND lower(title)=lower(?) AND status='pending'").get(profileId,type,title))fail('Already requested by this profile.',409);
  const result=db.prepare(`INSERT INTO community_requests(profile_id,media_type,tmdb_id,title,year,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(profileId,type,tmdbId,title,year,now(),now());
  return result.lastInsertRowid;
}
export function listRequests(profileId,isAdmin=false) {
  const sql=`SELECT r.id,r.media_type AS type,r.tmdb_id AS tmdbId,r.title,r.year,r.status,
    r.created_at AS createdAt,r.updated_at AS updatedAt,
    p.name AS profileName,u.username
    FROM community_requests r JOIN profiles p ON p.id=r.profile_id JOIN users u ON u.id=p.user_id `;
  return isAdmin
    ? db.prepare(sql+'ORDER BY r.created_at DESC LIMIT 150').all()
    : db.prepare(sql+'WHERE r.profile_id=? ORDER BY r.created_at DESC LIMIT 100').all(profileId)
      .map(({username,profileName,...rest})=>rest);
}
export function requestStatus(id,status) {
  const requestId=positiveId(id);
  if(!['pending','approved','available','declined'].includes(status))throw invalid('Invalid request status.');
  if(!db.prepare('UPDATE community_requests SET status=?,updated_at=? WHERE id=?').run(status,now(),requestId).changes)
    fail('Request not found.');
}
function expireParties(){db.prepare('DELETE FROM community_parties WHERE expires_at<?').run(now());}
function partyRecord(code){return db.prepare('SELECT * FROM community_parties WHERE code=? AND expires_at>?').get(roomCode(code),now());}
function member(profileId,code){return db.prepare('SELECT 1 FROM community_party_members WHERE code=? AND profile_id=?').get(code,profileId);}
export function partyDetails(profileId,code,authorized=false) {
  const p=partyRecord(code);
  if(!p)fail('Watch party not found or expired.');
  if(!authorized&&!member(profileId,p.code))fail('Join the watch party first.',403);
  const viewers=db.prepare('SELECT COUNT(*) n FROM community_party_members WHERE code=? AND last_seen>?').get(p.code,now()-ACTIVE_MEMBER_MS).n;
  return {code:p.code,type:p.type,tmdbId:p.tmdb_id,title:p.title,season:p.season,episode:p.episode,
    positionSeconds:p.position_seconds,playing:!!p.playing,updatedAt:p.updated_at,expiresAt:p.expires_at,
    isHost:p.host_profile_id===profileId,viewers};
}
export function createParty(profileId,input) {
  expireParties();
  const spec=roomSpec(input);
  const count=db.prepare('SELECT COUNT(*) AS n FROM community_parties WHERE host_profile_id=? AND expires_at>?').get(profileId,now()).n;
  if(count>=3)fail('Close an existing watch party first.',409);
  const code=randomBytes(6).toString('hex').toUpperCase();
  const ts=now();
  db.transaction(()=>{
    db.prepare(`INSERT INTO community_parties(code,host_profile_id,type,tmdb_id,title,season,episode,updated_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(code,profileId,spec.type,spec.tmdbId,spec.title,spec.season,spec.episode,ts,ts+EIGHT_HOURS);
    db.prepare('INSERT INTO community_party_members(code,profile_id,joined_at,last_seen) VALUES(?,?,?,?)').run(code,profileId,ts,ts);
  })();
  return partyDetails(profileId,code);
}
export function joinParty(profileId,code) {
  const p=partyRecord(code);
  if(!p)fail('Watch party not found or expired.');
  db.transaction(()=>{
    const memberCount=db.prepare('SELECT COUNT(*) n FROM community_party_members WHERE code=?').get(p.code).n;
    if(memberCount>=8&&!member(profileId,p.code))fail('This watch party is full.',409);
    db.prepare(`INSERT INTO community_party_members(code,profile_id,joined_at,last_seen) VALUES(?,?,?,?)
      ON CONFLICT(code,profile_id) DO UPDATE SET last_seen=excluded.last_seen`).run(p.code,profileId,now(),now());
  })();
  return partyDetails(profileId,p.code);
}
export function pollParty(profileId,code) {
  const room=partyDetails(profileId,code);
  db.prepare('UPDATE community_party_members SET last_seen=? WHERE code=? AND profile_id=?').run(now(),room.code,profileId);
  return room;
}
export function updateParty(profileId,code,input) {
  const room=partyDetails(profileId,code);
  if(!room.isHost)fail('Only the host controls shared playback.',403);
  const state=playbackState(input);
  db.prepare('UPDATE community_parties SET position_seconds=?,playing=?,updated_at=? WHERE code=?').run(state.positionSeconds,state.playing?1:0,now(),room.code);
  return partyDetails(profileId,code);
}
export function leaveParty(profileId,code) {
  const room=partyDetails(profileId,code);
  if(room.isHost)db.prepare('DELETE FROM community_parties WHERE code=?').run(room.code);
  else db.prepare('DELETE FROM community_party_members WHERE code=? AND profile_id=?').run(room.code,profileId);
}
