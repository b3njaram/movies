import test from 'node:test';
import assert from 'node:assert/strict';
import { decideStall } from '../src/stall-recovery.js';
const base={now:50000,lastProgress:0,softAt:0,paused:false,seeking:false,forced:false,local:false,failures:0};
test('do not retry a paused or actively seeking video',()=>{
  assert.equal(decideStall({...base,paused:true}),'none');
  assert.equal(decideStall({...base,seeking:true}),'none');
  assert.equal(decideStall({...base,lastProgress:49000}),'none');
});
test('try one soft reconnect, then switch an auto source if still stalled',()=>{
  assert.equal(decideStall(base),'retry');
  assert.equal(decideStall({...base,now:75000,softAt:51000}),'none');
  assert.equal(decideStall({...base,now:81000,softAt:51000}),'switch');
});
test('never silently change user-selected or local video source',()=>{
  assert.equal(decideStall({...base,now:81000,softAt:51000,forced:true}),'notify');
  assert.equal(decideStall({...base,now:81000,softAt:51000,local:true}),'notify');
  assert.equal(decideStall({...base,now:81000,softAt:51000,failures:8}),'notify');
});
