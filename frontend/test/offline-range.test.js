import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentRange,evaluateDownloadResponse,validOfflineSource,normalizedBudgetGb,MAX_OFFLINE_BYTES} from '../public/offline-range.js';

test('parses valid byte ranges and rejects malformed/unsatisfiable headers',()=>{
  assert.deepEqual(parseContentRange('bytes 512-1023/2048'),{start:512,end:1023,total:2048});
  for(const bad of ['bytes */1000','bytes 10-5/20','bytes 5-21/20','bytes 0-1/*','bytes 0-01/10','bytes 0-1/0'])assert.equal(parseContentRange(bad),null);
});
test('resume accepts exact 206 response only and preserves previous length',()=>{
  const p=evaluateDownloadResponse({status:206,contentRange:'bytes 512-1023/1024',contentLength:'512',offset:512,previousTotal:1024});
  assert.deepEqual(p,{offset:512,total:1024,resumed:true});
  for(const change of [{contentRange:'bytes 0-511/1024'},{contentRange:'bytes 512-1023/1200'}, {contentLength:'511'}]){
    assert.throws(()=>evaluateDownloadResponse({status:206,contentRange:'bytes 512-1023/1024',contentLength:'512',offset:512,previousTotal:1024,...change}));
  }
});
test('200 full response requires truncating the old bytes',()=>{
  assert.deepEqual(evaluateDownloadResponse({status:200,contentLength:'1000',offset:500,previousTotal:1200}),{offset:0,total:1000,resumed:false});
  assert.throws(()=>evaluateDownloadResponse({status:416,offset:500}));
});
test('file limit and device storage budget are validated',()=>{
  assert.throws(()=>evaluateDownloadResponse({status:200,contentLength:String(MAX_OFFLINE_BYTES+1),offset:0}));
  for(const gb of [2,5,10,20,40])assert.equal(normalizedBudgetGb(gb),gb);
  for(const gb of [0,1,11,-1,41,100])assert.throws(()=>normalizedBudgetGb(gb));
});
test('only approved same-origin media URLs may become persistent offline sources',()=>{
  const o='https://movies.example.com';
  assert.equal(validOfflineSource('/api/library/stream/12',o),o+'/api/library/stream/12');
  assert.equal(validOfflineSource('/api/download?hash=abc',o),o+'/api/download?hash=abc');
  for(const bad of ['https://example.org/api/download','/api/admin/users','/api/local-media/stream/../../admin','/api/library/stream/0','/stream/something','/api/cast/media/1','//evil.com/api/download'])assert.throws(()=>validOfflineSource(bad,o));
});
