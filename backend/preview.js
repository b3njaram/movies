import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Mac mini friendly: one thumbnail at a time, a 12s timeout, <= 160KB JPEGs,
// a 30-second time bucket, and a bounded cache in the already-mounted app data.
const ROOT = path.join(path.dirname(process.env.DB_PATH || '/app/data/streamhub.db'), 'previews');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_PREVIEWS = 200;
let active = false;
const inflight = new Map();

function cleanup() {
  try {
    const files = fs.readdirSync(ROOT).map(name => ({name, t: fs.statSync(path.join(ROOT,name)).mtimeMs}));
    files.sort((a,b) => b.t - a.t);
    for (const old of files.slice(MAX_PREVIEWS)) fs.unlinkSync(path.join(ROOT,old.name));
  } catch { /* cache failure should never break playback */ }
}

function frame(url,at) {
  return new Promise((resolve,reject)=>{
    const args = [
      '-nostdin','-hide_banner','-loglevel','error','-ss',String(at),
      '-i',url,'-an','-sn','-frames:v','1','-vf','scale=240:-2',
      '-q:v','7','-f','image2pipe','-vcodec','mjpeg','pipe:1',
    ];
    const process = spawn(FFMPEG,args,{stdio:['ignore','pipe','ignore']});
    const parts=[];let bytes=0;let settled=false;
    const finish=(err,data)=>{ if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(data); };
    const timer=setTimeout(()=>{process.kill('SIGKILL');finish(Object.assign(new Error('Preview timed out.'),{status:503}));},12000);
    process.stdout.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>160*1024){process.kill('SIGKILL');finish(Object.assign(new Error('Preview is too large.'),{status:503}));}
      else parts.push(chunk);
    });
    process.on('error',()=>finish(Object.assign(new Error('Preview generator is unavailable.'),{status:503})));
    process.on('close',code=>finish(code===0&&bytes ? null : Object.assign(new Error('Preview is not available for this source.'),{status:503}),Buffer.concat(parts)));
  });
}

export async function thumbnailFor(hash,index,at,url) {
  const bucket = Math.floor(at/30)*30;
  const name = `${hash}-${index}-${bucket}.jpg`;
  const file = path.join(ROOT,name);
  try { return fs.readFileSync(file); } catch { /* cache miss */ }
  if(inflight.has(name)) return inflight.get(name);
  if(active) throw Object.assign(new Error('Thumbnail generator is busy; try again.'),{status:503});
  active=true;
  const task=(async()=>{
    const bytes=await frame(url,bucket);
    try { fs.mkdirSync(ROOT,{recursive:true});fs.writeFileSync(file,bytes);cleanup(); } catch { /* cache is optional */ }
    return bytes;
  })().finally(()=>{active=false;inflight.delete(name);});
  inflight.set(name,task);
  return task;
}
