import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sw=fs.readFileSync(new URL('../public/sw.js', import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../public/offline-store.js', import.meta.url),'utf8');
test('offline shell cached but no API or video cached',()=>{assert.match(sw,/offline\.html/);assert.match(sw,/offline-store\.js/);assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);assert.match(sw,/url\.pathname\.startsWith\('\/stream\/'\)/);});
test('offline downloads are same origin user initiated and bounded',()=>{assert.match(store,/url\.origin !== location\.origin/);assert.match(store,/MAX_BYTES/);assert.match(store,/getDirectory/);assert.match(store,/signal\?\.aborted/);});
