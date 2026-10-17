import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portraitWidth, sizedPortrait } from '../src/utils/portraitSize';

const THUMB = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/400px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=en.wikipedia.org&utm_content=thumbnail';
const FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/Portrait%20of%20Beta.jpg?width=400';

test('the smallest standard Wikimedia width that covers the box on this screen', () => {
  assert.equal(portraitWidth(64, 1, 1), 120);
  assert.equal(portraitWidth(64, 1, 2), 250);
  assert.equal(portraitWidth(56, 1, 1), 60);
  assert.equal(portraitWidth(112, 1, 1.5), 250);
  assert.equal(portraitWidth(64, 5, 2), 960);
});

test('a Wikimedia thumbnail is asked for at that width, keeping the file name and the query', () => {
  assert.equal(sizedPortrait(THUMB, 64, 1, 1),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/120px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=en.wikipedia.org&utm_content=thumbnail');
  assert.equal(sizedPortrait(FILE_PATH, 80, 1, 1), 'https://commons.wikimedia.org/wiki/Special:FilePath/Portrait%20of%20Beta.jpg?width=120');
});

test('never wider than the stored thumbnail, and anything that is not a Wikimedia thumbnail is left alone', () => {
  // Zoomed far in: the stored 400px picture is the sharpest there is (the original may be no bigger).
  assert.equal(sizedPortrait(THUMB, 64, 5, 2), THUMB);
  assert.equal(sizedPortrait(FILE_PATH, 300, 1, 2), FILE_PATH);
  const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Small_portrait.jpg';
  assert.equal(sizedPortrait(original, 64, 1, 1), original);
  assert.equal(sizedPortrait('https://example.org/thumb/x/400px-a.jpg', 64, 1, 1), 'https://example.org/thumb/x/400px-a.jpg');
  assert.equal(sizedPortrait('blob:http://localhost/abc', 64, 1, 1), 'blob:http://localhost/abc');
  assert.equal(sizedPortrait(undefined, 64), undefined);
  assert.equal(sizedPortrait(null, 64), null);
});
