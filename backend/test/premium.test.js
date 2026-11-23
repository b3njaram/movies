import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedByRating, maxAgeValue, cleanMarkers, safeContentKey, cleanDiscoverFilters, selectFavoriteGenre } from '../premium.js';

test('age controls fail closed for unknown or unrated movies',()=>{
  assert.equal(allowedByRating('TV-Y7',7),true);
  assert.equal(allowedByRating('PG-13',10),false);
  assert.equal(allowedByRating(null,10),false);
  assert.equal(allowedByRating('R',18),true);
  assert.equal(maxAgeValue(18,true),13);
  assert.equal(maxAgeValue('garbage',true),10);
});
test('skip markers are bounded and internally ordered',()=>{
  assert.deepEqual(cleanMarkers({introStart:10,introEnd:85,creditsStart:500}),{introStart:10,introEnd:85,creditsStart:500});
  assert.throws(()=>cleanMarkers({introStart:40,introEnd:10}),/Intro end/);
  assert.throws(()=>cleanMarkers({introStart:10}),/both/);
  assert.throws(()=>cleanMarkers({creditsStart:-5}),/timestamp/);
  assert.equal(safeContentKey('tv:123:s1e2'),'tv:123:s1e2');
  assert.throws(()=>safeContentKey('raw:magnet'),/Invalid/);
});
test('discovery filters and preference scoring reject injected parameters',()=>{
  const cleaned=cleanDiscoverFilters({type:'secret',genre:'999',year:'2040',minRating:-1,sort:'bad'});
  assert.equal(cleaned.type,'movie'); assert.equal(cleaned.genre,''); assert.equal(cleaned.year,null);assert.equal(cleaned.minRating,0);
  assert.equal(selectFavoriteGenre([{genreIds:[28,12]},{genreIds:[28]},{genreIds:[35]}]),28);
});
