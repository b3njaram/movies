import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {signCastToken,verifyCastToken,castSupportedPath} from '../cast-token.js';
const secret=crypto.randomBytes(32),now=Date.now();const c={userId:1,profileId:3,kind:'library',id:8};
test('cast link is bound to owner, kind, file, and expiry',()=>{
 const tok=signCastToken(secret,c,now);assert.equal(verifyCastToken(secret,tok,'library',8,now+10).p,3);
 assert.equal(verifyCastToken(secret,tok,'media',8,now),null);
 assert.equal(verifyCastToken(secret,tok,'library',9,now),null);
 assert.equal(verifyCastToken(secret,tok,'library',8,now+7*3600*1000),null);
 assert.equal(verifyCastToken(crypto.randomBytes(32),tok,'library',8,now),null);
 assert.equal(verifyCastToken(secret,tok.slice(0,-3)+'abc','library',8,now),null);
});
test('chromecast only advertises likely supported containers',()=>{
 assert.equal(castSupportedPath('video.mp4'),true);assert.equal(castSupportedPath('video.webm'),true);assert.equal(castSupportedPath('video.mkv'),false);
});
