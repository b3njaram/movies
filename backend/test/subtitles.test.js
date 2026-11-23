import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedFileRef, listSubtitleFiles, detectSubtitleLang, toVtt } from '../subtitles.js';

const hash = 'a'.repeat(40);
const files = [
  { id: 1, path: 'Show/S01E01.1080p.H264.mkv', length: 1200000000 },
  { id: 2, path: 'Show/S01E01.1080p.H264.eng.srt', length: 15894 },
  { id: 3, path: 'Show/S01E01.1080p.H264.es.vtt', length: 15712 },
  { id: 4, path: 'Show/S01E02.1080p.H264.eng.srt', length: 15123 },
  { id: 5, path: 'Show/S01E01.txt', length: 1000 },
  { id: 6, path: 'other/Movie.spanish.srt', length: 1000 },
];

test('subtitle list is tied to current episode, size, and safe extensions', () => {
  const got = listSubtitleFiles(files, 1);
  assert.deepEqual(got.map(f=>f.index), [2,3]);
  assert.deepEqual(got.map(f=>f.lang), ['en','es']);
  assert.deepEqual(listSubtitleFiles(files, 999), []);
});
test('validates file references to prevent arbitrary upstream paths', () => {
  assert.deepEqual(validatedFileRef(hash, 3), {hash,index:3});
  for (const [h,i] of [['../etc/passwd',1],[hash,-1],[hash,'nan'],[hash,0]]) assert.throws(()=>validatedFileRef(h,i));
});
test('subtitle conversion keeps valid WebVTT and converts SRT timestamps', () => {
  const srt='1\r\n00:00:01,500 --> 00:00:02,400\r\nHello\r\n';
  assert.match(toVtt(srt), /^WEBVTT\n\n1\n00:00:01\.500 --> 00:00:02\.400/);
  assert.equal(toVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nHi'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi');
  assert.equal(detectSubtitleLang('Movie.Latino.srt'),'es');
});
