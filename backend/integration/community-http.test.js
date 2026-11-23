// Integration test runs after npm install (better-sqlite3, Express etc.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const BACKEND=dirname(dirname(fileURLToPath(import.meta.url)));
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}

test('community endpoints isolate profiles, enforce host-only updates, and guard local media', {timeout:45000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'streamhub-phase4-'));
  const dbpath=join(dir,'app','streamhub.db');mkdirSync(dirname(dbpath),{recursive:true});
  const port=await freePort();
  const env={...process.env,DB_PATH:dbpath,JWT_SECRET:'testing-phase4-static-long-secret',PORT:String(port),
    PROWLARR_URL:'http://127.0.0.1:1',TORRSERVER_URL:'http://127.0.0.1:1',TMDB_API_KEY:''};
  let server;
  try {
    for(const who of ['alice','bob'])execFileSync('node',['create-user.js',who,'test-password-123'],{cwd:BACKEND,env,timeout:15000});
    server=spawn('node',['server.js'],{cwd:BACKEND,env,stdio:'ignore'});
    const base=`http://127.0.0.1:${port}`;
    let up=false;
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error(`Backend exited early: ${server.exitCode}`);
      try{const r=await fetch(base+'/api/auth/me');if(r.status===401){up=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(up,'server started');
    async function account(username){
      let cookies=[];
      const send=async(path,method='GET',body=null,profile=null)=>{
        const headers={};if(body!==null)headers['Content-Type']='application/json';
        if(profile!==null)headers['X-Profile-Id']=String(profile);
        if(cookies.length)headers.Cookie=cookies.join('; ');
        const res=await fetch(base+path,{method,headers,body:body!==null?JSON.stringify(body):undefined});
        const next=res.headers.getSetCookie?.()||[];
        for(const raw of next){const cookie=raw.split(';',1)[0];const key=cookie.split('=',1)[0];cookies=cookies.filter(c=>!c.startsWith(key+'='));cookies.push(cookie);}
        const text=await res.text();return {status:res.status,data:JSON.parse(text||'{}')};
      };
      assert.equal((await send('/api/auth/login','POST',{username,password:'test-password-123'})).status,200);
      const profiles=(await send('/api/profiles')).data.profiles;
      assert.equal(profiles.length,1);
      const id=profiles[0].id;
      assert.equal((await send(`/api/profiles/${id}/activate`,'POST',{})).status,200);
      return {send,id};
    }
    const alice=await account('alice'), bob=await account('bob');
    const created=await alice.send('/api/community/collections','POST',{name:'Favorites'},alice.id);
    assert.equal(created.status,201);
    const collectionId=created.data.id;
    assert.equal((await bob.send('/api/community/collections', 'GET',null,bob.id)).data.collections.length,0);
    assert.equal((await bob.send(`/api/community/collections/${collectionId}`,'DELETE',null,bob.id)).status,404);
    assert.equal((await alice.send(`/api/community/collections/${collectionId}/items`,'POST',{type:'movie',id:99,title:'Film'},alice.id)).status,200);
    assert.equal((await alice.send('/api/community/collections','GET',null,alice.id)).data.collections[0].items.length,1);
    assert.equal((await bob.send('/api/community/collections','GET',null,bob.id)).data.collections.length,0);
    assert.equal((await bob.send('/api/community/requests','POST',{type:'movie',title:'Request from bob'},bob.id)).status,201);
    assert.equal((await alice.send('/api/admin/community/requests','GET',null,alice.id)).data.requests.length,1);
    assert.equal((await bob.send('/api/admin/community/requests','GET',null,bob.id)).status,403);
    const party=await alice.send('/api/community/parties','POST',{type:'movie',tmdbId:99,title:'Film'},alice.id);
    assert.equal(party.status,201);
    const code=party.data.party.code;
    assert.equal((await bob.send(`/api/community/parties/${code}`,'GET',null,bob.id)).status,403);
    assert.equal((await bob.send(`/api/community/parties/${code}/join`,'POST',{},bob.id)).status,200);
    assert.equal((await bob.send(`/api/community/parties/${code}`,'PUT',{positionSeconds:30,playing:true},bob.id)).status,403);
    assert.equal((await alice.send(`/api/community/parties/${code}`,'PUT',{positionSeconds:30,playing:true},alice.id)).status,200);
    assert.equal((await bob.send(`/api/community/parties/${code}`,'GET',null,bob.id)).data.party.positionSeconds,30);
    const media=join(dir,'app','media');mkdirSync(media);writeFileSync(join(media,'Test.Movie.2020.mp4'),Buffer.alloc(4096,65));
    assert.equal((await alice.send('/api/admin/local-media/scan','POST',{},alice.id)).status,200);
    const items=(await bob.send('/api/local-media','GET',null,bob.id)).data.items;
    assert.equal(items.length,1);
    const stream=await fetch(base+`/api/local-media/stream/${items[0].id}`,{headers:{Cookie:await (async()=>{
      // Just test that anonymous requests are rejected without leaking files.
      return '';
    })(),Range:'bytes=0-99'}});
    assert.equal(stream.status,401);
  } finally {
    if(server)server.kill('SIGTERM');
    rmSync(dir,{recursive:true,force:true});
  }
});
