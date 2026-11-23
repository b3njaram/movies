import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const BACKEND=dirname(dirname(fileURLToPath(import.meta.url)));
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}

test('notifications, home preferences, CSRF and cross-profile isolation', {timeout:45000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'streamhub-phase6-'));
  const dbPath=join(dir,'app','streamhub.db');mkdirSync(dirname(dbPath),{recursive:true});
  const port=await freePort();
  const env={...process.env,DB_PATH:dbPath,JWT_SECRET:'testing-phase6-static-secret-longer-than-32-characters',PORT:String(port),
    PROWLARR_URL:'http://127.0.0.1:1',TORRSERVER_URL:'http://127.0.0.1:1',TMDB_API_KEY:''};
  let server;
  try{
    for(const name of ['alice','bob'])execFileSync('node',['create-user.js',name,'long-test-pass-123'],{cwd:BACKEND,env,timeout:15000});
    server=spawn('node',['server.js'],{cwd:BACKEND,env,stdio:'ignore'});
    const base=`http://127.0.0.1:${port}`;
    let started=false;
    for(let i=0;i<80;i++){
      if(server.exitCode!==null)throw new Error('StreamHub exited during startup.');
      try{const r=await fetch(base+'/api/auth/me');if(r.status===401){started=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(started,'backend started');
    const evil=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'long-test-pass-123'})});
    assert.equal(evil.status,403,'browser cross-origin login rejected');
    async function account(username){
      let cookies=[];
      const send=async(path,method='GET',body=null,profile=null,additional={})=>{
        const headers={...additional};
        if(body!==null)headers['Content-Type']='application/json';
        if(profile!==null)headers['X-Profile-Id']=String(profile);
        if(cookies.length)headers.Cookie=cookies.join('; ');
        const response=await fetch(base+path,{method,headers,body:body!==null?JSON.stringify(body):undefined});
        const setCookies=response.headers.getSetCookie?.()||[];
        for(const raw of setCookies){const cookie=raw.split(';',1)[0];const key=cookie.split('=',1)[0];cookies=cookies.filter(c=>!c.startsWith(key+'='));cookies.push(cookie);}
        const content=await response.text();return {status:response.status,data:JSON.parse(content||'{}')};
      };
      assert.equal((await send('/api/auth/login','POST',{username,password:'long-test-pass-123'})).status,200);
      const id=(await send('/api/profiles')).data.profiles[0].id;
      assert.equal((await send(`/api/profiles/${id}/activate`,'POST',{})).status,200);
      return {id,send};
    }
    const a=await account('alice'),b=await account('bob');
    assert.equal((await b.send('/api/home/preferences','GET',null,b.id)).data.settings.hideWatched,false);
    assert.equal((await b.send('/api/home/preferences','PUT',{hideWatched:true},b.id)).status,200);
    assert.equal((await b.send('/api/home/preferences','GET',null,b.id)).data.settings.hideWatched,true);
    assert.equal((await a.send('/api/home/preferences','GET',null,a.id)).data.settings.hideWatched,false);
    assert.equal((await b.send('/api/home/preferences','PUT',{hideWatched:'yes'},b.id)).status,400);
    assert.equal((await b.send('/api/progress','POST',{contentKey:'movie:991',title:'Test film',mediaType:'movie',tmdbId:991,positionSeconds:97,durationSeconds:100},b.id)).status,200);
    const home=(await b.send('/api/home/preferences','GET',null,b.id)).data;
    assert.ok(home.completedMovieIds.includes(991));
    assert.equal(home.watchAgain[0].title,'Test film');
    assert.equal((await a.send('/api/home/preferences','GET',null,a.id)).data.watchAgain.length,0);
    const request=await b.send('/api/community/requests','POST',{type:'movie',title:'Sample title'},b.id);
    assert.equal(request.status,201);
    const reqid=request.data.id;
    assert.equal((await a.send(`/api/admin/community/requests/${reqid}`,'PATCH',{status:'available'},a.id)).status,200);
    let alerts=(await b.send('/api/notifications','GET',null,b.id)).data;
    assert.equal(alerts.unread,1);assert.equal(alerts.items[0].destination,'community');
    const alertId=alerts.items[0].id;
    assert.equal((await a.send('/api/notifications','GET',null,a.id)).data.unread,0);
    assert.equal((await a.send('/api/notifications/read','POST',{id:alertId},a.id)).status,200);
    assert.equal((await b.send('/api/notifications','GET',null,b.id)).data.unread,1,'cannot mark another profile’s alert');
    assert.equal((await b.send('/api/notifications/read','POST',{id:alertId},b.id)).status,200);
    assert.equal((await b.send('/api/notifications','GET',null,b.id)).data.unread,0);
    assert.equal((await a.send(`/api/admin/community/requests/${reqid}`,'PATCH',{status:'available'},a.id)).status,200);
    assert.equal((await b.send('/api/notifications','GET',null,b.id)).data.unread,0,'same state generates no duplicate');
    assert.equal((await a.send('/api/notifications/read','POST',{id:'1 OR 1=1'},a.id)).status,400);
    assert.equal((await b.send('/api/notifications/read','POST',{all:true},b.id)).status,200);
  }finally{if(server)server.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});
