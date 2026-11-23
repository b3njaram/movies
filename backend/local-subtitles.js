import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);
const TEXT_CODECS=new Set(['subrip','ass','ssa','webvtt','mov_text','text']);
const LANG={eng:'en',spa:'es',fre:'fr',fra:'fr',deu:'de',ger:'de',por:'pt',jpn:'ja'};
export function textSubtitleTracks(probe) {
  return (probe?.streams||[]).filter(s=>s.codec_type==='subtitle'&&TEXT_CODECS.has(s.codec_name))
    .slice(0,16).map(s=>({index:s.index,lang:LANG[s.tags?.language]||s.tags?.language||'und',
      codec:s.codec_name,title:String(s.tags?.title||'').slice(0,100)}))
    .filter(s=>Number.isInteger(s.index)&&s.index>=0&&s.index<=999);
}
export async function probeLocalSubtitles(file) {
  const {stdout}=await execFileAsync(process.env.FFPROBE_PATH||'ffprobe',
    ['-v','error','-show_entries','stream=index,codec_type,codec_name:stream_tags=language,title',
      '-of','json',file],{timeout:12000,maxBuffer:1024*1024,windowsHide:true});
  return textSubtitleTracks(JSON.parse(stdout));
}
let running=0;
export async function extractLocalSubtitle(file,trackIndex) {
  const index=Number(trackIndex);
  if(!Number.isSafeInteger(index)||index<0||index>999)throw Object.assign(new Error('Invalid subtitle track.'),{status:400});
  const tracks=await probeLocalSubtitles(file);
  if(!tracks.some(t=>t.index===index))throw Object.assign(new Error('Unsupported subtitle track.'),{status:404});
  if(running>=2)throw Object.assign(new Error('Subtitle conversion is busy. Try again.'),{status:429});
  running++;
  return new Promise((resolve,reject)=>{
    let child;
    try {child=spawn(process.env.FFMPEG_PATH||'ffmpeg',
      ['-nostdin','-hide_banner','-loglevel','error','-i',file,'-map',`0:${index}`,
        '-vn','-an','-f','webvtt','pipe:1'],{stdio:['ignore','pipe','pipe']});}
    catch(error){running--;reject(error);return;}
    const chunks=[];let bytes=0,finished=false;
    const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
    const end=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);running--;error?reject(error):resolve(value);};
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>5*1024*1024){child.kill('SIGKILL');return;}chunks.push(chunk);});
    child.on('error',e=>end(Object.assign(new Error(`ffmpeg failed: ${e.message}`),{status:502})));
    child.on('close',code=>{
      if(code!==0||bytes>5*1024*1024)return end(Object.assign(new Error(bytes>5*1024*1024?'Subtitles exceed 5 MB.':'Subtitle extraction failed.'),{status:bytes>5*1024*1024?413:502}));
      const data=Buffer.concat(chunks);
      if(!data.toString('utf8',0,16).startsWith('WEBVTT'))return end(Object.assign(new Error('Invalid converted subtitles.'),{status:502}));
      end(null,data);
    });
  });
}
