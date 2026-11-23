import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';import net from 'node:net';
const backend=dirname(dirname(fileURLToPath(import.meta.url)));
async function port(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
test('signed casting Range, push ownership, and auth guard', {timeout:45000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sh-phase8-'));const dbPath=join(dir,'app','streamhub.db');mkdirSync(dirname(dbPath),{recursive:true});
 const n=await port(),base=`http://127.0.0.1:${n}`;
 const env={...process.env,PORT:String(n),DB_PATH:dbPath,JWT_SECRET:'testing-phase8-static-long-secret-123456',TMDB_API_KEY:'',PROWLARR_URL:'http://127.0.0.1:1',TORRSERVER_URL:'http://127.0.0.1:1'};
 let server;
 try {
  for(const name of ['alice','bob'])execFileSync('node',['create-user.js',name,'password-long-enough'],{cwd:backend,env,timeout:15000});
  const media=join(dir,'app','media');mkdirSync(media);writeFileSync(join(media,'Movie.2024.mp4'),Buffer.alloc(4096,42));
  server=spawn('node',['server.js'],{cwd:backend,env,stdio:'ignore'});
  for(let i=0;i<90;i++){if(server.exitCode!==null)throw new Error('Backend quit');try{if((await fetch(base+'/api/auth/me')).status===401)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  async function account(name){
   let cookie=[];
   async function raw(path,method='GET',body=null,pid=null,extra={}){
    const headers={...extra};if(body!==null)headers['Content-Type']='application/json';if(pid!==null)headers['X-Profile-Id']=String(pid);
    if(cookie.length)headers.Cookie=cookie.join('; ');
    const res=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
    for(const value of res.headers.getSetCookie?.()||[]){const entry=value.split(';')[0],key=entry.split('=')[0];cookie=cookie.filter(x=>!x.startsWith(key+'='));cookie.push(entry);}
    return res;
   }
   async function json(path,method='GET',body=null,pid=null){const r=await raw(path,method,body,pid);return {status:r.status,data:await r.json()};}
   assert.equal((await json('/api/auth/login','POST',{username:name,password:'password-long-enough'})).status,200);
   const p=(await json('/api/profiles')).data.profiles[0].id;
   assert.equal((await json(`/api/profiles/${p}/activate`,'POST',{})).status,200);
   return {raw,json,p};
  }
  assert.equal((await fetch(base+'/api/push/public-key')).status,401);
  assert.equal((await fetch(base+'/api/cast/media/media/1?token=bogus')).status,403);
  const alice=await account('alice'),bob=await account('bob');
  assert.equal((await alice.json('/api/admin/local-media/scan','POST',{},alice.p)).status,200);
  const mediaId=(await alice.json('/api/local-media','GET',null,alice.p)).data.items[0].id;
  const token=await alice.json('/api/cast/session','POST',{kind:'media',id:mediaId},alice.p);
  assert.equal(token.status,200);
  assert.ok(token.data.path.startsWith('/api/cast/media/media/'));
  const cast=await fetch(base+token.data.path,{headers:{Range:'bytes=0-99'}});
  assert.equal(cast.status,206);assert.equal((await cast.arrayBuffer()).byteLength,100);
  const tampered=token.data.path.replace(/token=./,'token=x');
  assert.equal((await fetch(base+tampered)).status,403);
  assert.equal((await bob.json('/api/cast/session','POST',{kind:'library',id:999},bob.p)).status,404);
  const bad=await alice.json('/api/push/subscription','POST',{endpoint:'https://127.0.0.1/private',keys:{}},alice.p);
  assert.equal(bad.status,400);
  const endpoint='https://fcm.googleapis.com/fcm/send/dummy-phase8-test';
  const good=await alice.json('/api/push/subscription','POST',{endpoint,keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}},alice.p);
  assert.equal(good.status,201);
  assert.equal((await bob.json('/api/push/subscription','DELETE',{endpoint},bob.p)).status,200);
  assert.equal((await alice.json('/api/push/subscription','DELETE',{endpoint},alice.p)).status,200);
  const keys=await alice.json('/api/push/public-key','GET',null,alice.p);
  assert.equal(keys.status,200);assert.ok(keys.data.publicKey.length>40);
 }finally{server?.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});
