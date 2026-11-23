import test from 'node:test';
import assert from 'node:assert/strict';
import {titleText,mediaType,positiveId,roomCode,roomSpec,playbackState} from '../community-rules.js';
import {parseMediaName} from '../local-media-rules.js';

test('collection names are bounded and reject empty titles',()=>{
  assert.equal(titleText('  Test movies  ',60),'Test movies');
  assert.throws(()=>titleText(' '.repeat(9),60));
  assert.throws(()=>titleText('x'.repeat(61),60));
  assert.throws(()=>titleText('one\ntwo',6));
});
test('only well-defined catalog titles and positive IDs are permitted',()=>{
  assert.equal(mediaType('movie'),'movie');
  assert.throws(()=>mediaType('raw'));
  assert.equal(positiveId('130'),130);
  assert.throws(()=>positiveId('1.5'));
  assert.throws(()=>positiveId('../file'));
});
test('rooms require a bounded, valid series episode and random code',()=>{
  assert.deepEqual(roomSpec({type:'tv',tmdbId:10,title:'Show',season:2,episode:3}),
    {type:'tv',tmdbId:10,title:'Show',season:2,episode:3});
  assert.throws(()=>roomSpec({type:'tv',tmdbId:10,title:'Show'}));
  assert.throws(()=>roomSpec({type:'movie',tmdbId:0,title:'Film'}));
  assert.equal(roomCode('abc123abc123'),'ABC123ABC123');
  assert.throws(()=>roomCode('short'));
});
test('untrusted playback position and state are validated',()=>{
  assert.deepEqual(playbackState({positionSeconds:12,playing:true}),{positionSeconds:12,playing:true});
  assert.throws(()=>playbackState({positionSeconds:-1}));
  assert.throws(()=>playbackState({positionSeconds:'Infinity'}));
  assert.equal(playbackState({positionSeconds:15,playing:'true'}).playing,false);
});
test('local file names yield readable movies, years and TV episodes',()=>{
  assert.deepEqual(parseMediaName('Spirited.Away.2001.1080p.mkv'),
    {title:'Spirited Away',type:'movie',year:'2001',season:null,episode:null});
  const episode=parseMediaName('My.Show.S02E03.720p.mp4');
  assert.equal(episode.title,'My Show');assert.equal(episode.type,'tv');
  assert.equal(episode.season,2);assert.equal(episode.episode,3);
});
