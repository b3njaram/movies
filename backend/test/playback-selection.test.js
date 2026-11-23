import test from 'node:test';
import assert from 'node:assert/strict';
import {isLikelyVideoRelease,pickPlayableFile,isBrowserIncompatibleContainer} from '../playback-selection.js';

test('excludes 40 KB .srt source from automatic playback', () => {
  assert.equal(isLikelyVideoRelease('Mr Robot S01E04 HDTV x264 KILLERS spanish srt',40*1024),false);
  assert.equal(isLikelyVideoRelease('Show.S01E04.720p.English.srt',8*1024*1024),false);
  assert.equal(isLikelyVideoRelease('Show.S01E04.720p.mkv',343*1024*1024),true);
  assert.equal(isLikelyVideoRelease('Show.S01E04.720p',null),true);
});
test('excludes torrent with only subtitle files even if its torrent appears in search', () => {
  const files=[{id:1,path:'Mr.Robot.S01E04.es.srt',length:40960},{id:2,path:'readme.txt',length:100}];
  assert.equal(pickPlayableFile(files,1,4),null);
});
test('season packs pick matching video, never subtitles or another episode', () => {
  const files=[{id:1,path:'s01/Show.S01E02.mkv',length:600000000},{id:2,path:'s01/Show.S01E04.mkv',length:650000000},{id:3,path:'s01/Show.S01E04.en.srt',length:70000}];
  assert.equal(pickPlayableFile(files,1,4).id,2);
  assert.equal(pickPlayableFile(files,1,3),null);
  assert.equal(pickPlayableFile([{id:2,path:'Show.S01E05.avi',length:300000000}],1,4),null);
});
test('keeps untagged single-file video and rejects tiny sample', () => {
  assert.equal(pickPlayableFile([{id:1,path:'mystery.mp4',length:500000000}],1,4).id,1);
  assert.equal(pickPlayableFile([{id:1,path:'sample.mp4',length:500000000}],null,null),null);
  assert.equal(pickPlayableFile([{id:1,path:'video.mkv',length:10000}],null,null),null);
  assert.equal(isBrowserIncompatibleContainer('Show.avi'),true);
  assert.equal(isBrowserIncompatibleContainer('Show.mp4'),false);
});
