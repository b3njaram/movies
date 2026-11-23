import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const backend=dirname(dirname(fileURLToPath(import.meta.url)));
async function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.once('error',rej);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>res(n));});});}

test('episode-following subscriptions, notifications and deletions are profile-private', {timeout:45000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sh-follow-'));
  const dbPath=join(dir,'app','streamhub.db');mkdirSync(dirname(dbPath),{recursive:true});
  const port=await freePort();
  const env={...process.env,DB_PATH:dbPath,JWT_SECRET:'testing-phase7-static-secret-longer-than-32-characters',PORT:String(port),
    PROWLARR_URL:'http://127.0.0.1:1',TORRSERVER_URL:'http://127.0.0.1:1',TMDB_API_KEY:''};
  let server;
  try{
    for(const user of ['alice','bob'])execFileSync('node',['create-user.js',user,'long-test-password'],{cwd:backend,env,timeout:15000});
    // Exercise real SQLite module: new follows seed a baseline and only new episodes alert.
    const run=String.raw`
      import assert from 'node:assert/strict';
      import {db} from './db.js';
      await import('./engagement.js');
      const {followShow,recordEpisodeCheck}=await import('./episode-following.js');
      const ids=db.prepare('SELECT id FROM profiles ORDER BY id').all().map(x=>x.id);
      const date='2026-11-21';
      const earlier={season_number:1,episode_number:2,air_date:date,name:'First'};
      const later={season_number:1,episode_number:3,air_date:'2026-11-22',name:'Second'};
      for(const pid of ids)followShow(pid,123,'A TV Show','/poster.jpg',{last:earlier,next:null});
      assert.equal(recordEpisodeCheck({profileId:ids[0],tvId:123},{last:earlier,next:null}),false);
      assert.equal(recordEpisodeCheck({profileId:ids[0],tvId:123},{last:later,next:null}),true);
      assert.equal(recordEpisodeCheck({profileId:ids[0],tvId:123},{last:later,next:null}),false);
      assert.equal(db.prepare('SELECT count(*) n FROM profile_notifications WHERE profile_id=?').get(ids[0]).n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM profile_notifications WHERE profile_id=?').get(ids[1]).n,0);
    `;
    execFileSync('node',['--input-type=module','-e',run],{cwd:backend,env,timeout:15000});
    server=spawn('node',['server.js'],{cwd:backend,env,stdio:'ignore'});
    const base=`http://127.0.0.1:${port}`;
    let online=false;
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error('Backend exited early');
      try{const resp=await fetch(base+'/api/auth/me');if(resp.status===401){online=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(online,'server starts');
    async function account(username){
      let cookies=[];
      async function request(path,method='GET',body=null,pid=null){
        const headers={};if(body!==null)headers['Content-Type']='application/json';
        if(pid!==null)headers['X-Profile-Id']=String(pid);
        if(cookies.length)headers.Cookie=cookies.join('; ');
        const r=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
        for(const raw of r.headers.getSetCookie?.()||[]){const c=raw.split(';',1)[0];cookies=cookies.filter(x=>!x.startsWith(c.split('=')[0]+'='));cookies.push(c);}
        return {status:r.status,data:await r.json()};
      }
      assert.equal((await request('/api/auth/login','POST',{username,password:'long-test-password'})).status,200);
      const id=(await request('/api/profiles')).data.profiles[0].id;
      assert.equal((await request(`/api/profiles/${id}/activate`,'POST',{})).status,200);
      return {id,request};
    }
    const a=await account('alice'),b=await account('bob');
    assert.equal((await a.request('/api/followed-shows','GET',null,a.id)).data.items.length,1);
    assert.equal((await b.request('/api/followed-shows','GET',null,b.id)).data.items.length,1);
    assert.equal((await a.request('/api/notifications','GET',null,a.id)).data.items[0].destination,'tv:123');
    assert.equal((await b.request('/api/notifications','GET',null,b.id)).data.unread,0);
    assert.equal((await b.request('/api/followed-shows/123','DELETE',null,b.id)).status,200);
    assert.equal((await a.request('/api/followed-shows','GET',null,a.id)).data.items.length,1);
    assert.equal((await b.request('/api/followed-shows','GET',null,b.id)).data.items.length,0);
    assert.equal((await b.request('/api/followed-shows','POST',{id:123},b.id)).status,503,'TMDB key required for new follows');
    assert.equal((await a.request('/api/followed-shows/123%20OR%201=1','DELETE',null,a.id)).status,400);
  }finally{if(server)server.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});
