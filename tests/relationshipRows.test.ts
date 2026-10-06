import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relationshipRows } from '../src/utils/relationshipRows';

const figures = (count: number) => Array.from({ length: count }, (_, index) => `figure-${index}`);

test('medium desktop connections alternate three and two cards per row', () => {
  assert.deepEqual(relationshipRows(figures(13), 3).map(row => row.length), [3, 2, 3, 2, 3]);
});

test('wide desktop connections alternate four and three cards per row', () => {
  assert.deepEqual(relationshipRows(figures(18), 4).map(row => row.length), [4, 3, 4, 3, 4]);
});

test('final rows fill the available space instead of creating an extra singleton', () => {
  assert.deepEqual(relationshipRows(figures(6), 3).map(row => row.length), [3, 3]);
  assert.deepEqual(relationshipRows(figures(10), 4).map(row => row.length), [4, 3, 3]);
});

test('zero through many connections preserve every figure and its order at all viewport sizes', () => {
  for (const columns of [1, 2, 3, 4]) for (let count = 0; count <= 100; count++) {
    const input = figures(count);
    const rows = relationshipRows(input, columns);
    assert.deepEqual(rows.flat(), input);
    assert.ok(rows.every(row => row.length > 0 && row.length <= columns));
  }
});

test('narrow screens keep all related cards in a single column', () => {
  assert.deepEqual(relationshipRows(figures(8), 1).map(row => row.length), Array(8).fill(1));
});
