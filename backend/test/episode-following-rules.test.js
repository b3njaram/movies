import test from 'node:test';
import assert from 'node:assert/strict';
import {airedEpisode,isNewEpisode,showId} from '../episode-following-rules.js';

const today='2026-11-22';
const raw=(season,episode,date,name='Episode')=>({season_number:season,episode_number:episode,air_date:date,name});

test('air-date detection filters future and specials and rejects invalid dates',()=>{
  assert.deepEqual(airedEpisode(raw(2,3,'2026-11-21'),today),{season:2,episode:3,airDate:'2026-11-21',name:'Episode'});
  assert.equal(airedEpisode(raw(2,3,'2026-11-23'),today),null);
  assert.equal(airedEpisode(raw(0,3,'2026-11-21'),today),null);
  assert.equal(airedEpisode(raw(2,3,'2026-02-30'),today),null);
  assert.equal(airedEpisode(raw(2,3,'today'),today),null);
  assert.equal(airedEpisode(raw(2,0,'2026-11-21'),today),null);
  assert.equal(airedEpisode(null,today),null);
});

test('airing comparison respects season and episode order rather than metadata edits',()=>{
  const old={last_seen_season:2,last_seen_episode:9};
  assert.equal(isNewEpisode(airedEpisode(raw(2,9,'2026-11-22'),today),old),false);
  assert.equal(isNewEpisode(airedEpisode(raw(2,8,'2026-11-22'),today),old),false);
  assert.equal(isNewEpisode(airedEpisode(raw(2,10,'2026-11-22'),today),old),true);
  assert.equal(isNewEpisode(airedEpisode(raw(3,1,'2026-11-22'),today),old),true);
  assert.equal(isNewEpisode(airedEpisode(raw(2,10,'2026-11-23'),today),old),false);
  assert.equal(isNewEpisode(null,old),false);
  assert.equal(isNewEpisode(airedEpisode(raw(1,1,'2026-11-22'),today),{last_seen_season:0,last_seen_episode:0}),true);
});

test('TV show IDs reject injection strings and invalid values',()=>{
  assert.equal(showId('123'),123);
  for (const value of ['1 OR 1=1','0','-1','1.2','1e3','',null,undefined,Infinity,2147483648]){
    assert.throws(()=>showId(value),{status:400});
  }
});
