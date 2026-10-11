import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryThread, timelineThread } from '../src/utils/connectionThread';
import { BASE_PIXELS_PER_YEAR, ROW_HEIGHT, timelineFigureBounds } from '../src/utils/timelineLayout';
import { galleryCardBounds, GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from '../src/utils/galleryLayout';
import type { HistoricalFigure } from '../src/types';

const person = (id: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name: id, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const numbers = (path: string) => path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
const BAR = 60 + 46;

test('the timeline thread has one path per link and crosses where the two lives overlapped', () => {
  const chain = [{ figure: person('a', 1500, 1560), level: 0 }, { figure: person('b', 1540, 1600), level: 2 }, { figure: person('c', 1580, 1650), level: 1 }];
  const paths = timelineThread(chain, 1400);
  assert.equal(paths.length, 2);
  const [first, second] = paths.map(numbers);
  // a and b overlapped from 1540 to 1560, so the crossing is at 1550.
  const crossing = (1550 - 1400) * BASE_PIXELS_PER_YEAR;
  assert.deepEqual([first[0], first[1]], [crossing, BAR]);
  assert.deepEqual(first.slice(-2), [crossing, 2 * ROW_HEIGHT + BAR]);
  // b and c overlapped from 1580 to 1600: the second link starts on b's bar where the first one arrived.
  const next = (1590 - 1400) * BASE_PIXELS_PER_YEAR;
  assert.deepEqual([second[0], second[1]], [crossing, 2 * ROW_HEIGHT + BAR]);
  assert.deepEqual(second.slice(-2), [next, ROW_HEIGHT + BAR]);
});

test('a link between people on the same crossing column is a plain vertical line', () => {
  const paths = timelineThread([{ figure: person('a', 1500, 1600), level: 0 }, { figure: person('b', 1500, 1600), level: 1 }], 1500);
  assert.equal(paths.length, 1);
  assert.deepEqual(numbers(paths[0]), [500, BAR, 500, ROW_HEIGHT + BAR]);
});

test('a chain of fewer than two people has no thread', () => {
  assert.deepEqual(timelineThread([], 1500), []);
  assert.deepEqual(timelineThread([{ figure: person('a', 1500, 1600), level: 0 }], 1500), []);
  assert.deepEqual(galleryThread([{ x: 0, y: 0 }]), []);
});

test('the gallery thread runs between card centres, one arc per link', () => {
  const paths = galleryThread([{ x: 0, y: 0 }, { x: 352, y: 0 }, { x: 352, y: 156 }]);
  assert.equal(paths.length, 2);
  const start = numbers(paths[0]);
  assert.deepEqual([start[0], start[1]], [GALLERY_CARD_WIDTH / 2, GALLERY_CARD_HEIGHT / 2]);
  assert.deepEqual(start.slice(-2), [352 + GALLERY_CARD_WIDTH / 2, GALLERY_CARD_HEIGHT / 2]);
  assert.deepEqual(numbers(paths[1]).slice(-2), [352 + GALLERY_CARD_WIDTH / 2, 156 + GALLERY_CARD_HEIGHT / 2]);
  assert.ok(paths.every(path => path.includes(' Q ')));
});

test('figure bounds point the camera at the same box the layouts draw', () => {
  const bounds = timelineFigureBounds({ figure: person('a', 1500, 1560), level: 2 }, 1400);
  assert.deepEqual(bounds, { left: 1000, top: 2 * ROW_HEIGHT + 60, width: 600, height: 120 });
  // Very short lives keep a minimum width so a camera can still frame them.
  assert.equal(timelineFigureBounds({ figure: person('b', 1500, 1500), level: 0 }, 1400).width, 4);
  assert.deepEqual(galleryCardBounds({ x: 10, y: 20 }), { left: 10, top: 20, width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT });
});
