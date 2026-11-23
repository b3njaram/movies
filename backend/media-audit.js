import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const EXTENSIONS = new Set(['.mp4','.mkv','.mov','.m4v','.webm']);
const MAX_FILES = 1500;
const MAX_SAMPLES = 150;
const SAMPLE_BYTES = 64 * 1024;
const safeRel = (p) => typeof p === 'string' && p.length < 600 && !path.isAbsolute(p) &&
  p !== '..' && !p.startsWith('../') && !p.includes('\\') && !p.split('/').includes('..');

// Read-only admin audit. It never deletes or modifies video, files or the DB.
// Sample digests are advisory (size + first/last 64 KiB), not proof of equality.
export async function auditMediaFolder(root, indexedRows = []) {
  const base = path.resolve(root);
  try {
    if (await fs.realpath(base) !== base) throw new Error('Media directory cannot be a symlink.');
  } catch (e) { if (e.code === 'ENOENT') return {scanned:0,bytes:0,missing:indexedRows.map(x=>x.rel_path).filter(safeRel),possibleDuplicates:[],partial:false};throw e; }
  const records=[];
  let partial=false;
  async function walk(dir, depth) {
    if (depth > 3 || partial) return;
    const ents = await fs.readdir(dir,{withFileTypes:true});
    for (const ent of ents) {
      if (ent.isSymbolicLink()) continue;
      const full=path.join(dir,ent.name);
      if (ent.isDirectory()) await walk(full,depth+1);
      else if (ent.isFile() && EXTENSIONS.has(path.extname(ent.name).toLowerCase())) {
        const stat=await fs.stat(full);
        if (stat.isFile() && stat.size >= 1024) records.push({path:full,rel:path.relative(base,full).split(path.sep).join('/'),bytes:stat.size});
      }
      if (records.length >= MAX_FILES) {partial=true;break;}
    }
  }
  await walk(base,0);
  const seen = new Set(records.map(r=>r.rel));
  const missing = indexedRows.map(x=>x.rel_path).filter(x=>safeRel(x) && !seen.has(x)).slice(0,100);
  const groups = new Map();
  for(const r of records) {
    const list=groups.get(r.bytes)||[];list.push(r);groups.set(r.bytes,list);
  }
  let sampled=0;
  const candidates = [];
  for(const [bytes,group] of groups) {
    if(group.length<2)continue;
    for(const item of group) {
      if(sampled >= MAX_SAMPLES) {partial=true;break;}
      sampled++;
      const fh = await fs.open(item.path,'r');
      try {
        const start=Buffer.alloc(Math.min(SAMPLE_BYTES,bytes));
        const end=Buffer.alloc(Math.min(SAMPLE_BYTES,bytes));
        await fh.read(start,0,start.length,0);
        await fh.read(end,0,end.length,Math.max(0,bytes-end.length));
        item.signature=crypto.createHash('sha256').update(start).update(end).digest('hex');
      } finally {await fh.close();}
    }
    const hashes=new Map();
    for(const item of group.filter(x=>x.signature)){
      const k=item.signature;const a=hashes.get(k)||[];a.push(item.rel);hashes.set(k,a);
    }
    for(const files of hashes.values())if(files.length>1&&candidates.length<30)candidates.push({sizeBytes:bytes,files});
    if(sampled >= MAX_SAMPLES)break;
  }
  return {scanned:records.length,bytes:records.reduce((sum,r)=>sum+r.bytes,0),missing,
    possibleDuplicates:candidates,partial,checkedAt:Date.now()};
}
