import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, scoreRelease } from '../sources.js';

const GiB = 1024 ** 3;
const want = { type: 'tv', season: 1, episode: 1, lang: 'en' };

test('oversized season packs receive a bounded size penalty for episode playback', () => {
  const pack = parseRelease('Mr.Robot.S01.1080p.WEB-DL.x264.AAC');
  assert.equal(pack.pack, true);
  const small = scoreRelease(pack, 20, 4 * GiB, want);
  const large = scoreRelease(pack, 20, 28 * GiB, want);
  assert.ok(large < small, 'large pack should rank below the same small pack');
  assert.ok(small - large <= 50, 'size penalty must remain bounded');
});

test('individual episodes are not penalized for large file sizes', () => {
  const episode = parseRelease('Mr.Robot.S01E01.1080p.WEB-DL.x264.AAC');
  assert.equal(episode.pack, false);
  assert.equal(scoreRelease(episode, 20, 28 * GiB, want), scoreRelease(episode, 20, 4 * GiB, want));
});

test('matching episodes outrank otherwise identical season packs with equal seeds', () => {
  const episode = parseRelease('Mr.Robot.S01E01.1080p.WEB-DL.x264.AAC');
  const pack = parseRelease('Mr.Robot.S01.1080p.WEB-DL.x264.AAC');
  assert.ok(scoreRelease(episode, 20, 1 * GiB, want) > scoreRelease(pack, 20, 28 * GiB, want));
});
