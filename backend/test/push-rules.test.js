import test from 'node:test';import assert from 'node:assert/strict';
import {safePushEndpoint} from '../push-rules.js';
test('only HTTPS trusted push providers are permitted',()=>{
 for(const endpoint of ['https://fcm.googleapis.com/fcm/send/abc','https://web.push.apple.com/x','https://updates.push.services.mozilla.com/wpush/v2/xyz','https://wns2-bn3p.notify.windows.com/w/'])
   assert.equal(safePushEndpoint(endpoint),true,endpoint);
 for(const endpoint of ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.net/x','https://127.0.0.1/x','https://localhost/x','https://example.org/push','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','not a url'])
   assert.equal(safePushEndpoint(endpoint),false,endpoint);
});
