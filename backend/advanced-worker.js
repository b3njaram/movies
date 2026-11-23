import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { db } from './db.js';
import { bytesPerSecond, downloadName } from './advanced-rules.js';
import { getDownload, nextQueuedDownload, updateDownload, getServerOptions, libraryBytes, recordEvent } from './advanced-db.js';

const ROOT = path.dirname(process.env.DB_PATH || '/app/data/streamhub.db');
export const LIBRARY_ROOT = path.join(ROOT, 'library');
const BACKUP_ROOT = path.join(ROOT, 'backups');
const BASE = String(process.env.TORRSERVER_URL || 'http://torrserver:8090').replace(/\/$/,'');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const GB = 1024 ** 3;
const activeControllers = new Map();
let busy = false;
let started = false;
let lastBackupError = null;
let lastBackupTime = 0;
let converting = false;
let touchTorrent = () => {};
export function setDownloadTouch(fn) { if (typeof fn === 'function') touchTorrent = fn; }

export const partialPath = id => path.join(LIBRARY_ROOT,`${id}.part`);
export function readyPath(job) {
  // File path is never sourced from a request or database filename: only the numeric ID.
  return path.join(LIBRARY_ROOT,`${job.id}${path.extname(downloadName(job.file_name)).toLowerCase()}`);
}
export function startAdvancedJobs() {
  if(started)return;
  started = true;
  fs.mkdirSync(LIBRARY_ROOT,{recursive:true});
  fs.mkdirSync(BACKUP_ROOT,{recursive:true});
  setImmediate(pump);
  setInterval(pump,5000).unref();
  setTimeout(()=>autoBackup().catch(e=>console.warn('[backup]',e.message)),15000).unref();
  setInterval(()=>autoBackup().catch(e=>console.warn('[backup]',e.message)),3600000).unref();
}
export function wakeDownloads() {setImmediate(pump);}
export function cancelCurrent(id) {activeControllers.get(Number(id))?.abort();}
function wait(ms) {return new Promise(r=>setTimeout(r,ms));}

async function pump() {
  if(busy)return;
  const job=nextQueuedDownload();
  if(!job)return;
  busy=true;
  try {await downloadOne(job);} catch(e) {
    const current=getDownload(job.id);
    if(current && ['running','queued'].includes(current.status)){
      updateDownload(job.id,{status:'failed',error:String(e.message||e).slice(0,250)});
      recordEvent('download_failed',job.profile_id);
    }
  } finally {busy=false;setImmediate(pump);}
}
async function downloadOne(job) {
  const options=getServerOptions();
  const limit=options.libraryQuotaGb*GB;
  fs.mkdirSync(LIBRARY_ROOT,{recursive:true});
  const part=partialPath(job.id);
  let offset=fs.existsSync(part)?fs.statSync(part).size:0;
  if((libraryBytes()+Math.max(0,job.total_bytes-offset))>limit) throw new Error('Library quota reached. Free space or raise the quota in Admin.');
  const controller=new AbortController();activeControllers.set(job.id,controller);
  updateDownload(job.id,{status:'running',downloaded_bytes:offset,error:null});
  touchTorrent(job.hash);
  const name=downloadName(job.file_name);
  const url=`${BASE}/stream/${encodeURIComponent(name)}?link=${job.hash}&index=${job.file_index}&play`;
  const headers=offset?{Range:`bytes=${offset}-`}:{};
  let stream;
  try {
    const response=await fetch(url,{headers,signal:controller.signal});
    if(![200,206].includes(response.status)||!response.body)throw new Error(`Source returned HTTP ${response.status}`);
    if(offset && response.status!==206){
      // Never append a full 200 response to an incomplete file.
      offset=0;
    }
    const total=Number(response.headers.get('content-length'))||0;
    const expected=job.total_bytes||(total?(response.status===206?offset+total:total):0);
    if(expected && expected>limit)throw new Error('This file exceeds your library quota.');
    if(expected && libraryBytes()-job.downloaded_bytes+expected>limit)throw new Error('Insufficient library quota for this download.');
    updateDownload(job.id,{total_bytes:expected,downloaded_bytes:offset});
    stream=fs.createWriteStream(part,{flags:offset?'a':'w'});
    let bytes=offset,checkpoint=Date.now(),start=Date.now(),received=0;
    const bps=bytesPerSecond(options.downloadMbps);
    for await(const chunk of response.body){
      if(controller.signal.aborted)throw new Error('Download paused.');
      bytes+=chunk.length;received+=chunk.length;touchTorrent(job.hash);
      if(bytes>limit || libraryBytes()-job.downloaded_bytes+bytes>limit)throw new Error('Library quota reached.');
      if(!stream.write(chunk))await once(stream,'drain');
      if(bps){const shouldWait=(received/bps)*1000-(Date.now()-start);if(shouldWait>0)await wait(Math.min(shouldWait,3000));}
      if(Date.now()-checkpoint>900){updateDownload(job.id,{downloaded_bytes:bytes});checkpoint=Date.now();}
    }
    stream.end();await once(stream,'finish');
    stream=null;
    if(expected&&bytes<expected)throw new Error('Download ended before the complete file was received. Resume it to retry.');
    fs.renameSync(part,readyPath(job));
    updateDownload(job.id,{status:'ready',downloaded_bytes:bytes,total_bytes:bytes,error:null});
    recordEvent('download_complete',job.profile_id);
  } finally {
    if(stream){stream.destroy();await wait(20);}
    activeControllers.delete(job.id);
  }
}
export function removeJobFiles(job) {
  if(!job)return;
  cancelCurrent(job.id);
  for(const f of [partialPath(job.id),readyPath(job)]){
    try{fs.unlinkSync(f);}catch(e){if(e.code!=='ENOENT')console.warn('[library]',e.message);}
  }
}
export function localFileStatus(job) {
  const p=readyPath(job);
  if(job.status!=='ready'||!fs.existsSync(p))return null;
  return p;
}
export function serverRuntime() {
  let disk=null;
  try{const s=fs.statfsSync(ROOT);disk={freeBytes:s.bavail*s.bsize,totalBytes:s.blocks*s.bsize};}catch{}
  return {uptimeSeconds:Math.floor(process.uptime()),memoryBytes:process.memoryUsage().rss,freeMemoryBytes:os.freemem(),loadAverage:os.loadavg(),disk,converting,backup:lastBackupTime,backupError:lastBackupError};
}
export async function createBackup() {
  fs.mkdirSync(BACKUP_ROOT,{recursive:true});
  const filename=`streamhub-${new Date().toISOString().slice(0,10)}-${Date.now()}.sqlite`;
  const dest=path.join(BACKUP_ROOT,filename);
  await db.backup(dest);
  lastBackupTime=Date.now();lastBackupError=null;recordEvent('backup_created');
  const all=fs.readdirSync(BACKUP_ROOT).filter(n=>/^streamhub-.*\.sqlite$/.test(n)).sort().reverse();
  for(const excess of all.slice(14))fs.unlinkSync(path.join(BACKUP_ROOT,excess));
  return {fileName:filename,sizeBytes:fs.statSync(dest).size,createdAt:lastBackupTime};
}
export function listBackups() {
  try{return fs.readdirSync(BACKUP_ROOT).filter(n=>/^streamhub-.*\.sqlite$/.test(n)).map(n=>({name:n,sizeBytes:fs.statSync(path.join(BACKUP_ROOT,n)).size,createdAt:fs.statSync(path.join(BACKUP_ROOT,n)).mtimeMs})).sort((a,b)=>b.createdAt-a.createdAt).slice(0,14);}catch{return [];}
}
export function backupFile(name){
  if(!/^streamhub-\d{4}-\d{2}-\d{2}-\d+\.sqlite$/.test(String(name)))return null;
  const p=path.join(BACKUP_ROOT,name);
  return fs.existsSync(p)?p:null;
}
async function autoBackup() {
  const hours=getServerOptions().backupIntervalHours;
  if(!hours)return;
  const latest=listBackups()[0];
  if(latest&&Date.now()-latest.createdAt<hours*3600000)return;
  try{await createBackup();}catch(e){lastBackupError=e.message;throw e;}
}
export function conversionActive(){return converting;}
// Full video conversion is opt-in and single-session for older CPUs. Container already includes ffmpeg.
export function convertVideo(req,res,{url,seconds,height}) {
  if(converting)throw Object.assign(new Error('Another video is being converted. Try again later.'),{status:503});
  converting=true;
  const bitrate=height===480?'1200k':'2500k';
  const args=['-nostdin','-hide_banner','-loglevel','error'];
  if(seconds>0)args.push('-ss',String(seconds));
  args.push('-i',url,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-c:v','libx264','-preset','ultrafast','-tune','zerolatency',
    '-vf',`scale=-2:${height}:force_original_aspect_ratio=decrease`, '-maxrate',bitrate,'-bufsize',height===480?'2400k':'5000k',
    '-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ac','2','-movflags','frag_keyframe+empty_moov+default_base_moof',
    '-f','mp4','pipe:1');
  const proc=spawn(FFMPEG,args,{stdio:['ignore','pipe','pipe']});
  let closed=false,started=false,stderr='';
  const stop=()=>{if(closed)return;closed=true;converting=false;proc.kill('SIGKILL');};
  proc.stdout.on('data',chunk=>{
    if(closed)return;
    if(!started){started=true;res.setHeader('Content-Type','video/mp4');res.setHeader('Cache-Control','no-store');res.setHeader('Accept-Ranges','none');res.setHeader('X-Accel-Buffering','no');}
    if(!res.write(chunk)){proc.stdout.pause();res.once('drain',()=>proc.stdout.resume());}
  });
  proc.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-900);});
  proc.on('error',e=>{if(!res.headersSent)res.status(503).json({error:e.message});else res.end();stop();});
  proc.on('close',code=>{if(!closed){converting=false;if(!started&&!res.headersSent)res.status(502).json({error:'Conversion failed. The source may be unavailable.'});else res.end();closed=true;}});
  res.on('close',stop);
}
