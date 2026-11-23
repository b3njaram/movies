import test from 'node:test';import assert from 'node:assert/strict';
import {nearestInDirection} from '../src/tv-spatial.js';
test('TV remote selects the nearest directional focus target',()=>{
  const current={left:100,top:100,width:50,height:50};
  const targets=[{left:190,top:100,width:40,height:40},{left:90,top:190,width:40,height:40},{left:0,top:100,width:40,height:40}];
  assert.equal(nearestInDirection(current,targets,'right'),0);
  assert.equal(nearestInDirection(current,targets,'down'),1);
  assert.equal(nearestInDirection(current,targets,'left'),2);
  assert.equal(nearestInDirection(current,targets,'up'),-1);
});
