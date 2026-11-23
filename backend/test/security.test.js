import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedMutation,LoginLimiter} from '../security-rules.js';

test('Cross-origin browser mutations are rejected while same-origin and CLI requests work',()=>{
  assert.equal(isAllowedMutation('POST','https://movies.example.com','movies.example.com','same-origin'),true);
  assert.equal(isAllowedMutation('PATCH','https://movies.example.com','movies.example.com','same-origin'),true);
  assert.equal(isAllowedMutation('POST','https://attacker.example','movies.example.com','cross-site'),false);
  assert.equal(isAllowedMutation('POST','https://movies.example.com','movies.example.com','cross-site'),false);
  assert.equal(isAllowedMutation('DELETE','null','movies.example.com','none'),false);
  assert.equal(isAllowedMutation('PUT',null,'movies.example.com','cross-site'),false);
  assert.equal(isAllowedMutation('POST',null,'movies.example.com',undefined),true);
  assert.equal(isAllowedMutation('POST','http://macmini2012:3111','macmini2012:3111','same-origin'),true);
  assert.equal(isAllowedMutation('POST','http://macmini2012:3000','macmini2012:3111','same-site'),false);
  assert.equal(isAllowedMutation('GET','https://attacker.example','movies.example.com','cross-site'),true);
  assert.equal(isAllowedMutation('POST','https://movies.example.com.evil','movies.example.com','same-site'),false);
  assert.equal(isAllowedMutation('POST','javascript:alert(1)','movies.example.com',undefined),false);
});

test('Login limiter blocks by both address and account, resets on success, and prunes',()=>{
  const l=new LoginLimiter({windowMs:1000,limit:2,maxKeys:3});
  l.fail(['ip:one','user:alice'],100);
  l.fail(['ip:one','user:alice'],101);
  assert.equal(l.blocked('ip:one',102),true);
  assert.equal(l.blocked('user:alice',102),true);
  assert.equal(l.blocked('ip:other',102),false);
  l.success(['ip:one','user:alice']);
  assert.equal(l.blocked('ip:one',102),false);
  l.fail(['ip:1','user:1','ip:2','user:2'],200);
  assert.ok(l.map.size<=3);
  assert.equal(l.blocked('ip:new',201),true);
  assert.equal(l.blocked('ip:new',1201),false);
});
