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
   mtime_ms=excluded.mtime_ms,scanned_at=excluded.scanned_at`);
  db.transaction(()=>{
    for(const f of files)upsert.run(f.rel,f.titleInfo.title,f.titleInfo.type,f.titleInfo.year,
      f.titleInfo.season,f.titleInfo.episode,f.size,f.mtime,stamp);
    if(files.length<1500)db.prepare('DELETE FROM local_media WHERE scanned_at<?').run(stamp);
  })();
  return {found:files.length,partial:files.length>=1500,folder:MEDIA_ROOT};
}
export function listLocalMedia() {
  return db.prepare(`SELECT id,title,media_type AS type,year,season,episode,size_bytes AS sizeBytes
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
