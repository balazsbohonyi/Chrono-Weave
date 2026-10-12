import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_REVEAL_MAX_MS, MAX_PATH_INTERMEDIATES } from '../src/constants';
import { isRevealedAt, revealLinkMs, revealTotalMs } from '../src/hooks/useConnectionReveal';

test('the whole reveal fits the time cap for every chain length a search can return', () => {
  for (let links = 1; links <= MAX_PATH_INTERMEDIATES + 1; links++) {
    assert.ok(revealTotalMs(links) <= CONNECTION_REVEAL_MAX_MS + 1, `${links} links take ${revealTotalMs(links)}ms`);
  }
});

test('each link gets less time on long chains, within sensible bounds', () => {
  assert.equal(revealLinkMs(1), 1400, 'a short chain is not stretched past the per-link maximum');
  assert.ok(revealLinkMs(4) > revealLinkMs(11));
  assert.ok(revealLinkMs(11) >= 250);
  for (let links = 1; links <= MAX_PATH_INTERMEDIATES + 1; links++) assert.ok(revealLinkMs(links) >= 250 && revealLinkMs(links) <= 1400);
  // An absurdly long chain stops shrinking at the minimum instead of flickering by.
  assert.equal(revealLinkMs(200), 250);
  assert.ok(Number.isFinite(revealLinkMs(0)));
});

test('people fade in as the thread reaches them: the first at once, the others just before their link ends', () => {
  assert.equal(isRevealedAt(0, 0), true);
  assert.equal(isRevealedAt(0, 1), false);
  assert.equal(isRevealedAt(0.6, 1), false);
  assert.equal(isRevealedAt(0.75, 1), true, 'a little before the thread arrives');
  assert.equal(isRevealedAt(1, 2), false);
  assert.equal(isRevealedAt(1.8, 2), true);
  // A finished reveal (progress = links) shows everyone.
  for (let index = 0; index <= 11; index++) assert.equal(isRevealedAt(11, index), true);
});
