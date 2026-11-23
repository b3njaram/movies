import test from 'node:test';
import assert from 'node:assert/strict';
import {excludeCompletedMovies,uniqueTitles} from '../src/home-personalization.js';

test('Only completed movies are hidden; a partially watched TV show stays visible',()=>{
  const items=[{type:'movie',id:11},{type:'tv',id:22},{type:'movie',id:33}];
  assert.deepEqual(excludeCompletedMovies(items,[11,22],true),[items[1],items[2]]);
  assert.deepEqual(excludeCompletedMovies(items,[11],false),items);
  assert.deepEqual(excludeCompletedMovies(null,[1],true),[]);
});
test('Repeated recommendations show only once per type and ID',()=>{
  const x=[{type:'movie',id:1},{type:'movie',id:1},{type:'tv',id:1},{type:'movie',id:2}];
  assert.deepEqual(uniqueTitles(x),[x[0],x[2],x[3]]);
});
