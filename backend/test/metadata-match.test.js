import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalTitle,matchConfidence,chooseAutomaticMatch} from '../metadata-match.js';
import {textSubtitleTracks} from '../local-subtitles.js';
test('normalizes release labels and accents',()=>{
  assert.equal(canonicalTitle('Amélie.2001.1080p.BluRay.x265'),'amelie 2001');
});
test('automatic matches reject wrong years and media types',()=>{
  const local={title:'The Matrix',type:'movie',year:'1999'};
  assert.equal(chooseAutomaticMatch(local,[{id:4,title:'The Matrix',year:'2021',type:'movie'}]),null);
  assert.equal(chooseAutomaticMatch(local,[{id:4,title:'The Matrix',year:'1999',type:'tv'}]),null);
  assert.equal(chooseAutomaticMatch(local,[{id:1,title:'The Matrix',year:'1999',type:'movie'}])?.id,1);
});
test('ambiguous identical titles do not auto-select',()=>{
  const local={title:'Hamlet',type:'movie',year:null};
  assert.equal(chooseAutomaticMatch(local,[{id:1,title:'Hamlet',type:'movie'},{id:2,title:'Hamlet',type:'movie'}]),null);
});
test('matching is conservative for partial names',()=>{
  assert.ok(matchConfidence({title:'Star Wars Rogue One',type:'movie'},{title:'Star Wars',type:'movie'})<.94);
});
test('only recognized text subtitle codecs are extractable',()=>{
  const got=textSubtitleTracks({streams:[{index:0,codec_type:'video',codec_name:'h264'},
    {index:1,codec_type:'subtitle',codec_name:'hdmv_pgs_subtitle'},
    {index:2,codec_type:'subtitle',codec_name:'ass',tags:{language:'spa',title:'Spanish SDH'}}]});
  assert.deepEqual(got,[{index:2,lang:'es',codec:'ass',title:'Spanish SDH'}]);
});
