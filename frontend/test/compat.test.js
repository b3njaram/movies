import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSourcesForDevice, detectVideoSupport } from '../src/compat.js';

const sources = [
  {title:'Movie.2160p.HEVC.DTS',codec:'HEVC',quality:'2160p',audioRisk:true,score:125,seeders:10},
  {title:'Movie.1080p.H264.AAC',codec:'H.264',quality:'1080p',audio:'AAC',score:100,seeders:6},
  {title:'Movie.720p.H264.AAC',codec:'H.264',quality:'720p',audio:'AAC',score:105,seeders:9},
];
test('prefers browser-compatible formats and does not mutate Prowlarr results', () => {
  const ranked=rankSourcesForDevice(sources,{support:{h264:true,hevc:false,av1:false},quality:'auto'});
  assert.equal(ranked[0].codec,'H.264');
  assert.equal(ranked.at(-1).codec,'HEVC');
  assert.equal(sources[0].codec,'HEVC');
});
test('quality preference penalizes exceeding the chosen ceiling', () => {
  const ranked=rankSourcesForDevice(sources,{support:{h264:true,hevc:true},quality:'720p'});
  assert.equal(ranked[0].quality,'720p');
});
test('remembers successful releases and probes browser capabilities', () => {
  const ranked=rankSourcesForDevice(sources,{support:{h264:true,hevc:true},quality:'auto',remembered:'Movie.1080p.H264.AAC'});
  assert.equal(ranked[0].title,'Movie.1080p.H264.AAC');
  const capabilities=detectVideoSupport({canPlayType: mime => mime.includes('avc1') ? 'probably' : ''});
  assert.equal(capabilities.h264,true); assert.equal(capabilities.hevc,false);
});
