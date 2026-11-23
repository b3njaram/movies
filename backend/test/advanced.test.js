import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackSettings,convertOptions,downloadName,validHash,validFileIndex,deviceId,safeContentKey,bytesPerSecond} from '../advanced-rules.js';

test('quality and bandwidth are bounded allowlists',()=>{
  assert.deepEqual(playbackSettings({quality:'720p',bandwidthMbps:5}),{quality:'720p',bandwidthMbps:5});
  assert.throws(()=>playbackSettings({quality:'4k<script>',bandwidthMbps:1}),/supported/);
  assert.throws(()=>playbackSettings({quality:'auto',bandwidthMbps:-50}),/supported/);
  assert.equal(bytesPerSecond(10),1250000);
});
test('video conversion has a strict resolution and seek bound',()=>{
  assert.deepEqual(convertOptions({height:'480',t:'70'}),{height:480,seconds:70});
  assert.throws(()=>convertOptions({height:2160,t:0}),/Invalid/);
  assert.throws(()=>convertOptions({height:720,t:-1}),/Invalid/);
});
test('queue filenames and server file references reject traversal',()=>{
  assert.equal(downloadName('../../video.mkv'),'video.mkv');
  assert.equal(downloadName('/etc/passwd'),'video.mp4');
  assert.equal(validFileIndex('3'),3);
  assert.throws(()=>validFileIndex('../3'),/Invalid/);
  assert.equal(validHash('A'.repeat(40)),'a'.repeat(40));
  assert.throws(()=>validHash('magnet:?xt='),/Invalid/);
});
test('handoff identifiers and content keys are constrained',()=>{
  assert.equal(deviceId('device_abcd123456'),'device_abcd123456');
  assert.throws(()=>deviceId('../root'),/Invalid/);
  assert.equal(safeContentKey('movie:55'),'movie:55');
  assert.equal(safeContentKey('tv:55:s2e3'),'tv:55:s2e3');
  assert.throws(()=>safeContentKey('http://attacker/'),/Invalid/);
});
