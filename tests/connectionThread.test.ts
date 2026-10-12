import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryThread, manhattanThread, timelineThread, timelineThreadBox, type ThreadBox } from '../src/utils/connectionThread';
import { BASE_PIXELS_PER_YEAR, ROW_HEIGHT, timelineFigureBounds } from '../src/utils/timelineLayout';
import { galleryCardBounds, GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from '../src/utils/galleryLayout';
import type { HistoricalFigure } from '../src/types';

const person = (id: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name: id, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const numbers = (path: string) => path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
const BAR = 60 + 46;

const box = (left: number, right: number, y: number): ThreadBox => ({ left, right, y });
const endpoints = (path: string) => { const values = numbers(path); return { start: values.slice(0, 2), end: values.slice(-2) }; };

test('bars apart in time are linked from the near side of one to the near side of the next, with a vertical run between', () => {
  const [path] = manhattanThread([box(0, 100, 10), box(200, 300, 50)]);
  assert.deepEqual(endpoints(path), { start: [0 + 100, 10], end: [200, 50] });
  // The vertical run sits halfway through the gap, and corners are rounded.
  assert.ok(numbers(path).includes(150));
  assert.ok(path.includes(' Q '));
  // Walking backwards in time leaves the left side and enters the right side.
  assert.deepEqual(endpoints(manhattanThread([box(200, 300, 50), box(0, 100, 10)])[0]), { start: [200, 50], end: [100, 10] });
});

test('bars that overlap are linked on the same side, out past both and back in, never across a bar', () => {
  const [path] = manhattanThread([box(0, 100, 10), box(50, 150, 50)]);
  // Equal routes go out on the right; the turn is cleared of both bars and every run is horizontal or vertical.
  assert.deepEqual(endpoints(path), { start: [100, 10], end: [150, 50] });
  assert.ok(numbers(path).includes(150 + 28));
  // A bar that reaches far to the right makes the left side the shorter way round.
  const [left] = manhattanThread([box(0, 100, 10), box(-10, 400, 50)]);
  assert.deepEqual(endpoints(left), { start: [0, 10], end: [-10, 50] });
  assert.ok(numbers(left).includes(-10 - 28));
});

test('a person in the middle keeps the thread on the side it arrived from when the other side is no shorter', () => {
  const paths = manhattanThread([box(0, 50, 0), box(100, 200, 40), box(120, 180, 80)]);
  // The first link arrives on the left of the second bar, so the second link leaves from that same side. The two
  // lines sit either side of the middle of the bar's edge (arriving from above, leaving downwards).
  assert.deepEqual(endpoints(paths[0]).end, [100, 40 - 6]);
  assert.deepEqual(endpoints(paths[1]), { start: [100, 40 + 6], end: [120, 80] });
});

test('people on the same row are joined by one straight run', () => {
  assert.deepEqual(numbers(manhattanThread([box(0, 100, 10), box(200, 300, 10)])[0]), [100, 10, 200, 10]);
});

// Walks a path and returns every straight run as [from, to]; a rounded corner counts as the two runs
// that meet at its control point.
function runs(path: string): Array<[number[], number[]]> {
  const found: Array<[number[], number[]]> = [];
  let at: number[] = [];
  for (const [, command, rest] of path.matchAll(/([MLQ]) ([^MLQ]+)/g)) {
    const values = numbers(rest);
    if (command === 'M') at = values;
    else if (command === 'L') { found.push([at, values]); at = values; }
    else { found.push([at, values.slice(0, 2)], [values.slice(0, 2), values.slice(2)]); at = values.slice(2); }
  }
  return found;
}

test('every run of a route is horizontal or vertical', () => {
  const paths = [
    ...manhattanThread([box(0, 100, 10), box(50, 150, 50), box(20, 60, 90), box(300, 400, 10)]),
    ...timelineThread([{ figure: person('a', 1500, 1560), level: 0 }, { figure: person('b', 1540, 1600), level: 2 }, { figure: person('c', 1580, 1650), level: 1 }], 1400),
    ...galleryThread([{ x: 0, y: 0 }, { x: 352, y: 156 }, { x: 0, y: 312 }]),
  ];
  for (const path of paths) {
    const all = runs(path);
    assert.ok(all.length > 0);
    for (const [from, to] of all) assert.ok(from[0] === to[0] || from[1] === to[1], `${path} has a diagonal run`);
  }
});

// The horizontal runs of a path that touch a given x, as [y, farthest x] pairs: where the line arrives or leaves.
const stub = (path: string, side: 'start' | 'end') => {
  const all = runs(path);
  const [from, to] = side === 'start' ? all[0] : all[all.length - 1];
  return { y: side === 'start' ? from[1] : to[1], reach: side === 'start' ? to[0] : from[0] };
};

test('a thread that arrives and leaves on the same side keeps its two lines apart', () => {
  // Down the left, doubling back up: from above to above. The arriving line turns nearer to the bar.
  const [arrive, leave] = manhattanThread([box(0, 100, 0), box(0, 100, 200), box(0, 100, 100)]);
  const arriving = stub(arrive, 'end'), leaving = stub(leave, 'start');
  assert.notEqual(arriving.y, leaving.y, 'the two lines do not share a row');
  assert.ok(arriving.y < leaving.y, 'arriving above, leaving below, so they do not cross at the bar');
  assert.ok(Math.abs(0 - arriving.reach) < Math.abs(0 - leaving.reach), 'the arriving line turns nearer');
  assert.ok(Math.abs(Math.abs(0 - leaving.reach) - Math.abs(0 - arriving.reach)) >= 18, 'and the turns are clearly apart');

  // Up the left and back down: both going down, so the leaving line turns nearer.
  const [up, down] = manhattanThread([box(0, 100, 300), box(0, 100, 200), box(0, 100, 400)]);
  const upArriving = stub(up, 'end'), downLeaving = stub(down, 'start');
  assert.notEqual(upArriving.y, downLeaving.y);
  assert.ok(Math.abs(0 - downLeaving.reach) < Math.abs(0 - upArriving.reach), 'the leaving line turns nearer');

  // From below to above the two swap, so they still do not cross at the bar.
  const [from, to] = manhattanThread([box(0, 100, 300), box(0, 100, 200), box(0, 100, 0)]);
  assert.ok(stub(from, 'end').y > stub(to, 'start').y, 'arriving below, leaving above');
});

test('people the thread passes through on different sides need no separation', () => {
  const [first, second] = manhattanThread([box(0, 50, 0), box(100, 200, 40), box(300, 400, 80)]);
  assert.deepEqual(endpoints(first).end, [100, 40]);
  assert.deepEqual(endpoints(second).start, [200, 40]);
});

test('the timeline thread attaches to the sides of the bars the layout draws', () => {
  const a = person('a', 1500, 1560), b = person('b', 1540, 1600);
  const paths = timelineThread([{ figure: a, level: 0 }, { figure: b, level: 2 }], 1400);
  assert.equal(paths.length, 1);
  const first = timelineThreadBox({ figure: a, level: 0 }, 1400), second = timelineThreadBox({ figure: b, level: 2 }, 1400);
  assert.equal(first.y, BAR);
  assert.equal(second.y, 2 * ROW_HEIGHT + BAR);
  // The bar starts at the row's padding and is as wide as the lifespan.
  assert.equal(first.right - first.left, 60 * BASE_PIXELS_PER_YEAR);
  // The lives overlap, so the link leaves and re-enters on one side (here the shorter one, the right).
  assert.deepEqual(endpoints(paths[0]), { start: [first.right, first.y], end: [second.right, second.y] });
});

test('a chain of fewer than two people has no thread', () => {
  assert.deepEqual(timelineThread([], 1500), []);
  assert.deepEqual(timelineThread([{ figure: person('a', 1500, 1600), level: 0 }], 1500), []);
  assert.deepEqual(galleryThread([{ x: 0, y: 0 }]), []);
});

test('the gallery thread uses the same side-to-side routes between cards', () => {
  const middle = GALLERY_CARD_HEIGHT / 2;
  const paths = galleryThread([{ x: 0, y: 0 }, { x: 352, y: 0 }, { x: 352, y: 156 }]);
  assert.equal(paths.length, 2);
  // Neighbours in a row: a straight run from the right edge of one to the left edge of the next.
  assert.deepEqual(numbers(paths[0]), [GALLERY_CARD_WIDTH, middle, 352, middle]);
  // Cards stacked in a column share their horizontal extent, so the thread goes out one side and back in. It
  // arrived on the left of the middle card, so it stays on the left.
  // The row neighbour arrives in a straight line, so only the leaving thread moves aside, below it.
  assert.deepEqual(endpoints(paths[1]), { start: [352, middle + 6], end: [352, 156 + middle] });
  assert.ok(numbers(paths[1]).includes(352 - 28));
});

test('figure bounds point the camera at the same box the layouts draw', () => {
  const bounds = timelineFigureBounds({ figure: person('a', 1500, 1560), level: 2 }, 1400);
  assert.deepEqual(bounds, { left: 1000, top: 2 * ROW_HEIGHT + 60, width: 600, height: 120 });
  // Very short lives keep a minimum width so a camera can still frame them.
  assert.equal(timelineFigureBounds({ figure: person('b', 1500, 1500), level: 0 }, 1400).width, 4);
  assert.deepEqual(galleryCardBounds({ x: 10, y: 20 }), { left: 10, top: 20, width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT });
});
