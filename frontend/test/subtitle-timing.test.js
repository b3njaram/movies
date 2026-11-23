import test from 'node:test';import assert from 'node:assert/strict';import {shiftTextTrack} from '../src/subtitle-timing.js';
test('subtitle offsets do not accumulate and can reset',()=>{
 const cue={startTime:5,endTime:7},track={cues:[cue]},map=new WeakMap();
 shiftTextTrack(track,1.5,map);assert.equal(cue.startTime,6.5);
 shiftTextTrack(track,-2,map);assert.equal(cue.startTime,3);assert.equal(cue.endTime,5);
 shiftTextTrack(track,0,map);assert.equal(cue.startTime,5);assert.equal(cue.endTime,7);
});
test('caption times cannot become negative',()=>{
 const track={cues:[{startTime:1,endTime:2}]};shiftTextTrack(track,-8);assert.equal(track.cues[0].startTime,0);assert.ok(track.cues[0].endTime>0);
});
