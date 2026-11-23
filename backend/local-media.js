import fs from 'node:fs';
import path from 'node:path';
import {db} from './db.js';
import {parseMediaName} from './local-media-rules.js';
const root=path.dirname(process.env.DB_PATH||'/app/data/streamhub.db');
export const MEDIA_ROOT=path.join(root,'media');
const extensions=new Set(['.mp4','.mkv','.m4v','.webm','.mov']);
// Operates solely within the existing backend data mount; no Docker mount changes.
db.exec(`CREATE TABLE IF NOT EXISTS local_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rel_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, media_type TEXT NOT NULL, year TEXT,
  season INTEGER,episode INTEGER,size_bytes INTEGER NOT NULL,mtime_ms INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL
);`);
// Phase 5 metadata columns are additive: files, identities, history and previous
// scans continue to work without rebuilding the SQLite database.
const existingColumns=new Set(db.prepare('PRAGMA table_info(local_media)').all().map(c=>c.name));
for(const [column,ddl] of Object.entries({
  tmdb_id:'INTEGER',tmdb_type:'TEXT',poster:'TEXT',match_state:"TEXT NOT NULL DEFAULT 'unmatched'",
  match_confidence:'REAL',matched_at:'INTEGER',match_checked_at:'INTEGER'
}))if(!existingColumns.has(column))db.exec(`ALTER TABLE local_media ADD COLUMN ${column} ${ddl}`);
const mediaId=id=>{const n=Number(id);if(!Number.isSafeInteger(n)||n<1)throw Object.assign(new Error('Invalid local media ID.'),{status:400});return n;};
export function localMediaById(id){return db.prepare('SELECT * FROM local_media WHERE id=?').get(mediaId(id))||null;}
export function unmatchedLocalMedia(limit=6){return db.prepare(`SELECT * FROM local_media WHERE tmdb_id IS NULL ORDER BY coalesce(match_checked_at,0),id ASC LIMIT ?`).all(Math.min(12,Math.max(1,Number(limit)||6)));}
export function noteMatchAttempt(id){db.prepare('UPDATE local_media SET match_checked_at=? WHERE id=?').run(Date.now(),mediaId(id));}
export function saveLocalMediaMatch(id,item,{automatic=false,confidence=null}={}){
  const row=localMediaById(id);
  if(!row)throw Object.assign(new Error('Local media file not found.'),{status:404});
  if(item!==null){
    if(item.type!==row.media_type||!Number.isSafeInteger(Number(item.id))||Number(item.id)<1)
      throw Object.assign(new Error('Movie/series type does not match the local file.'),{status:400});
    const poster=typeof item.poster==='string'&&/^\/[a-zA-Z0-9_/.-]{2,200}$/.test(item.poster)?item.poster:null;
    db.prepare(`UPDATE local_media SET tmdb_id=?,tmdb_type=?,poster=?,match_state=?,match_confidence=?,matched_at=?,match_checked_at=? WHERE id=?`)
      .run(Number(item.id),item.type,poster,automatic?'automatic':'manual',confidence,Date.now(),Date.now(),row.id);
  }else{
    db.prepare(`UPDATE local_media SET tmdb_id=NULL,tmdb_type=NULL,poster=NULL,match_state='unmatched',match_confidence=NULL,matched_at=NULL,match_checked_at=NULL WHERE id=?`).run(row.id);
  }
  return localMediaById(id);
}
export function scanLocalMedia() {
  fs.mkdirSync(MEDIA_ROOT,{recursive:true});
  if (fs.realpathSync(MEDIA_ROOT) !== path.resolve(MEDIA_ROOT)) throw new Error('Media root must not be a symbolic link.');
  const files=[];
  function walk(dir,depth){
    if(depth>3||files.length>=1500)return;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(entry.isSymbolicLink())continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())walk(full,depth+1);
      else if(entry.isFile()&&extensions.has(path.extname(entry.name).toLowerCase())){
        const st=fs.statSync(full);
        if(!st.isFile()||st.size<1024)continue;
        const rel=path.relative(MEDIA_ROOT,full);
        files.push({rel,titleInfo:parseMediaName(entry.name),size:st.size,mtime:Math.floor(st.mtimeMs)});
      }
      if(files.length>=1500)break;
    }
  }
  walk(MEDIA_ROOT,0);
  const stamp=Date.now();
  const upsert=db.prepare(`INSERT INTO local_media(rel_path,title,media_type,year,season,episode,size_bytes,mtime_ms,scanned_at)
   VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(rel_path) DO UPDATE SET title=excluded.title,media_type=excluded.media_type,
   year=excluded.year,season=excluded.season,episode=excluded.episode,size_bytes=excluded.size_bytes,
   mtime_ms=excluded.mtime_ms,scanned_at=excluded.scanned_at,
   tmdb_id=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN NULL ELSE local_media.tmdb_id END,
   tmdb_type=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN NULL ELSE local_media.tmdb_type END,
   poster=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN NULL ELSE local_media.poster END,
   match_state=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN 'unmatched' ELSE local_media.match_state END,
   match_confidence=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN NULL ELSE local_media.match_confidence END,
   matched_at=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN NULL ELSE local_media.matched_at END,
   match_checked_at=CASE WHEN local_media.size_bytes!=excluded.size_bytes OR local_media.mtime_ms!=excluded.mtime_ms THEN NULL ELSE local_media.match_checked_at END`);
  db.transaction(()=>{
    for(const f of files)upsert.run(f.rel,f.titleInfo.title,f.titleInfo.type,f.titleInfo.year,
      f.titleInfo.season,f.titleInfo.episode,f.size,f.mtime,stamp);
    if(files.length<1500)db.prepare('DELETE FROM local_media WHERE scanned_at<?').run(stamp);
  })();
  return {found:files.length,partial:files.length>=1500,folder:MEDIA_ROOT};
}
export function listLocalMedia() {
  return db.prepare(`SELECT id,title,media_type AS type,year,season,episode,size_bytes AS sizeBytes,
      tmdb_id AS tmdbId,tmdb_type AS tmdbType,poster,match_state AS matchState,match_confidence AS matchConfidence
    FROM local_media ORDER BY title COLLATE NOCASE ASC LIMIT 1500`).all();
}
export function localMediaFile(id) {
  if(!Number.isSafeInteger(Number(id))||Number(id)<1)return null;
  const row=db.prepare('SELECT * FROM local_media WHERE id=?').get(Number(id));
  if(!row)return null;
  const full=path.resolve(MEDIA_ROOT,row.rel_path);
  let resolvedRoot;
  try {resolvedRoot=fs.realpathSync(MEDIA_ROOT);} catch {return null;}
  if(resolvedRoot !== path.resolve(MEDIA_ROOT) || !full.startsWith(resolvedRoot+path.sep))return null;
  try{
    const real=fs.realpathSync(full);
    if(!real.startsWith(resolvedRoot+path.sep)||!fs.statSync(real).isFile())return null;
    return {file:real,row};
  }catch{return null;}
}
