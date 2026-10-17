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

test('the gallery thread joins row neighbours side to side and stacked cards top to bottom', () => {
  const middle = GALLERY_CARD_HEIGHT / 2;
  const paths = galleryThread([{ x: 0, y: 0 }, { x: 352, y: 0 }, { x: 352, y: 156 }]);
  assert.equal(paths.length, 2);
  // Neighbours in a row: a straight run from the right edge of one to the left edge of the next.
  assert.deepEqual(numbers(paths[0]), [GALLERY_CARD_WIDTH, middle, 352, middle]);
  // The next card is straight below: out of the bottom, into the top, a short vertical run through the gutter.
  const centre = 352 + GALLERY_CARD_WIDTH / 2;
  assert.deepEqual(numbers(paths[1]), [centre, GALLERY_CARD_HEIGHT, centre, 156]);
});

test('figure bounds point the camera at the same box the layouts draw', () => {
  const bounds = timelineFigureBounds({ figure: person('a', 1500, 1560), level: 2 }, 1400);
  assert.deepEqual(bounds, { left: 1000, top: 2 * ROW_HEIGHT + 60, width: 600, height: 120 });
  // Very short lives keep a minimum width so a camera can still frame them.
  assert.equal(timelineFigureBounds({ figure: person('b', 1500, 1500), level: 0 }, 1400).width, 4);
  assert.deepEqual(galleryCardBounds({ x: 10, y: 20 }), { left: 10, top: 20, width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT });
});

// ---- The gallery router on real boards ----
import { calculateGalleryLayout } from '../src/utils/galleryLayout';
import type { GalleryPlacement } from '../src/utils/galleryLayout';

const people = (count: number): HistoricalFigure[] => Array.from({ length: count }, (_, index) => ({
  id: `p${index}`, name: `Person ${String(index).padStart(3, '0')}`, birthYear: 1500, deathYear: 1600, occupation: 'Painter',
  category: (['ARTISTS', 'WRITERS', 'THINKERS', 'SCIENTISTS'] as const)[index % 4],
}));
// A small deterministic generator, so the chains are the same on every run.
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const chainOf = (board: GalleryPlacement[], length: number, random: () => number) => {
  const pool = [...board], chain: GalleryPlacement[] = [];
  while (chain.length < length && pool.length) chain.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return chain;
};
type Rect = { x: number; y: number };
// Whether a straight, axis-aligned run goes through the inside of a card.
const crosses = (from: number[], to: number[], card: Rect) => {
  const left = Math.min(from[0], to[0]), right = Math.max(from[0], to[0]), top = Math.min(from[1], to[1]), bottom = Math.max(from[1], to[1]);
  return right > card.x + 0.5 && left < card.x + GALLERY_CARD_WIDTH - 0.5 && bottom > card.y + 0.5 && top < card.y + GALLERY_CARD_HEIGHT - 0.5;
};
// The side of a card a point lies on.
const sideOf = (point: number[], card: Rect) => {
  if (Math.abs(point[0] - (card.x + GALLERY_CARD_WIDTH)) < 0.01) return 'right';
  if (Math.abs(point[0] - card.x) < 0.01) return 'left';
  if (Math.abs(point[1] - (card.y + GALLERY_CARD_HEIGHT)) < 0.01) return 'bottom';
  if (Math.abs(point[1] - card.y) < 0.01) return 'top';
  return 'nowhere';
};

test('on real boards a thread never runs through a card of its chain, and meets each card on a side', () => {
  const sides = new Set<string>();
  for (const [count, seed] of [[24, 1], [60, 2], [140, 3], [300, 4]] as const) {
    const board = calculateGalleryLayout(people(count)).placements, random = seeded(seed);
    for (let attempt = 0; attempt < 6; attempt++) {
      const chain = chainOf(board, 3 + Math.floor(random() * 7), random);
      const paths = galleryThread(chain, board);
      assert.equal(paths.length, chain.length - 1);
      paths.forEach((path, link) => {
        const walked = runs(path);
        // Every run is horizontal or vertical, and none enters a card of the chain, not even the two it joins.
        for (const [from, to] of walked) {
          assert.ok(from[0] === to[0] || from[1] === to[1], 'a diagonal run');
          chain.forEach(card => assert.ok(!crosses(from, to, card), `link ${link} runs through the card at ${card.x},${card.y} on a ${count}-card board`));
        }
        // The start and end are on the sides of the cards they join.
        const start = walked[0][0], end = walked[walked.length - 1][1];
        assert.notEqual(sideOf(start, chain[link]), 'nowhere');
        assert.notEqual(sideOf(end, chain[link + 1]), 'nowhere');
        sides.add(sideOf(start, chain[link])); sides.add(sideOf(end, chain[link + 1]));
      });
    }
  }
  // All four sides get used somewhere, not just left and right.
  assert.deepEqual([...sides].sort(), ['bottom', 'left', 'right', 'top']);
});

test('a card is entered and left on different sides', () => {
  const board = calculateGalleryLayout(people(120)).placements, random = seeded(9);
  for (let attempt = 0; attempt < 8; attempt++) {
    const chain = chainOf(board, 6, random), paths = galleryThread(chain, board).map(runs);
    for (let link = 1; link < paths.length; link++) {
      const arrived = sideOf(paths[link - 1].at(-1)![1], chain[link]), left = sideOf(paths[link][0][0], chain[link]);
      assert.notEqual(arrived, left, `card ${link} is entered and left on the ${arrived}`);
    }
  }
});

test('the thread does not retrace a gutter an earlier link already used, when there is a clear alternative', () => {
  // Three cards in a column with the chain going down, then up past the middle one: the two long links must not share a run.
  const board = calculateGalleryLayout(people(40)).placements;
  const column = board.filter(card => card.x === board[0].x).slice(0, 4);
  assert.ok(column.length >= 3);
  const [one, two, three] = [column[0], column[2], column[1]];
  const paths = galleryThread([one, two, three], board).map(runs);
  const keys = (links: Array<[number[], number[]]>) => links.filter(([from, to]) => from[0] === to[0] || from[1] === to[1])
    .map(([from, to]) => from.join() + '>' + to.join());
  const first = new Set(keys(paths[0]));
  assert.ok(keys(paths[1]).every(key => !first.has(key)), 'the second link reuses a run of the first');
});

test('a long chain on a large board is routed quickly', () => {
  const board = calculateGalleryLayout(people(400)).placements, chain = chainOf(board, 22, seeded(5));
  const started = performance.now();
  const paths = galleryThread(chain, board);
  assert.equal(paths.length, 21);
  assert.ok(performance.now() - started < 3000, `took ${Math.round(performance.now() - started)}ms`);
});

// ---- No spikes ----
const bendsOf = (path: string) => (path.match(/ Q /g) ?? []).length;
const PITCH_X = GALLERY_CARD_WIDTH + 32, PITCH_Y = GALLERY_CARD_HEIGHT + 40;
const centreX = (card: Rect) => card.x + GALLERY_CARD_WIDTH / 2;

test('two cards far apart are joined with a single bend: out sideways, to the middle of the other card, then up or down into it', () => {
  const random = seeded(21);
  for (const count of [60, 150]) {
    const board = calculateGalleryLayout(people(count)).placements;
    let checked = 0;
    for (let attempt = 0; attempt < 500 && checked < 80; attempt++) {
      const [a, b] = chainOf(board, 2, random);
      if (Math.abs(b.x - a.x) < 2 * PITCH_X || a.y === b.y) continue;
      const [path] = galleryThread([a, b], board), walked = runs(path), first = walked[0], last = walked[walked.length - 1];
      assert.equal(bendsOf(path), 1, `from ${a.x},${a.y} to ${b.x},${b.y}`);
      assert.equal(first[0][1], first[1][1], 'the first run is horizontal');
      assert.equal(sideOf(first[0], a), b.x > a.x ? 'right' : 'left');
      assert.equal(last[0][0], last[1][0], 'the last run is vertical');
      assert.equal(last[1][0], centreX(b), 'it ends at the middle of the other card');
      assert.equal(sideOf(last[1], b), b.y < a.y ? 'bottom' : 'top');
      checked++;
    }
    assert.ok(checked >= 30, `only ${checked} pairs on a ${count}-card board`);
  }
});

// A chain on a board: the first card, then each next card given as tiers up (negative: down) and columns across.
test('a thread that has to leave a card by its top, because the thread arriving there took the side, climbs straight to the level of the next card and runs in', () => {
  const board = calculateGalleryLayout(people(120)).placements;
  let checked = 0;
  // Lennon to Dylan along a row; Dylan to Warhol one tier up and a few columns across (as in the reported chain).
  for (const dylan of board) for (const lennon of board) {
    if (checked >= 8) break;
    if (lennon.y !== dylan.y || lennon.x - dylan.x < 1.5 * PITCH_X || lennon.x - dylan.x > 3 * PITCH_X) continue;
    const warhol = board.find(card => card.y === dylan.y - PITCH_Y && Math.abs(card.x - (dylan.x + 3 * PITCH_X)) < PITCH_X / 2 + 1 && card.x > lennon.x - PITCH_X * 1.5);
    if (!warhol) continue;
    const paths = galleryThread([lennon, dylan, warhol], board), second = runs(paths[1]);
    // Lennon arrives at Dylan's right side, so Dylan's thread cannot leave there.
    assert.equal(sideOf(runs(paths[0]).at(-1)![1], dylan), 'right');
    assert.equal(bendsOf(paths[1]), 1);
    assert.equal(sideOf(second[0][0], dylan), 'top');
    assert.equal(second[0][0][0], second[0][1][0], 'up first');
    assert.equal(sideOf(second.at(-1)![1], warhol), 'left');
    assert.equal(second.at(-1)![1][1], warhol.y + GALLERY_CARD_HEIGHT / 2, 'and then straight in at its level');
    checked++;
  }
  assert.ok(checked >= 3, `only ${checked} matching chains`);
});

test('with a free side to leave by, the thread runs horizontally to the middle of the next card and then up into it (Kennedy to Marilyn)', () => {
  const board = calculateGalleryLayout(people(120)).placements;
  let checked = 0;
  for (const kennedy of board) for (const marilyn of board) {
    if (checked >= 8) break;
    const dx = marilyn.x - kennedy.x;
    if (marilyn.y !== kennedy.y - 2 * PITCH_Y || dx < 3.5 * PITCH_X || dx > 4.5 * PITCH_X) continue;
    // Oppenheimer far up on the left: his thread arrives at Kennedy from the side or the top, but the right is free.
    const oppenheimer = board.find(card => card.y <= kennedy.y - 3 * PITCH_Y && card.x < kennedy.x);
    if (!oppenheimer) continue;
    const paths = galleryThread([oppenheimer, kennedy, marilyn], board), last = runs(paths[1]);
    assert.notEqual(sideOf(runs(paths[0]).at(-1)![1], kennedy), 'right');
    assert.equal(bendsOf(paths[1]), 1);
    assert.equal(sideOf(last[0][0], kennedy), 'right');
    assert.equal(last[0][0][1], last[0][1][1], 'out horizontally');
    assert.equal(last.at(-1)![1][0], centreX(marilyn), 'to the middle of Marilyn');
    assert.equal(sideOf(last.at(-1)![1], marilyn), 'bottom');
    checked++;
  }
  assert.ok(checked >= 3, `only ${checked} matching chains`);
});

test('routes rarely have a short jog or hook, and where they do it is to keep clear of an earlier thread', () => {
  const random = seeded(5);
  let multi = 0, jogs = 0;
  for (const count of [24, 60, 150, 300]) {
    const board = calculateGalleryLayout(people(count)).placements;
    for (let attempt = 0; attempt < 70; attempt++) {
      const chain = chainOf(board, 2 + (attempt % 7), random);
      for (const path of galleryThread(chain, board)) {
        // Straight runs between corners (the rounded corner is a bend, so count the Q's control points).
        const corners = [...path.matchAll(/([MLQ]) ([^MLQ]+)/g)].map(([, command, rest]) => ({ command, values: numbers(rest) }));
        const points: number[][] = [];
        corners.forEach((item, index) => {
          if (item.command === 'M') points.push(item.values);
          else if (item.command === 'Q') points.push(item.values.slice(0, 2));
          else if (corners[index + 1]?.command !== 'Q') points.push(item.values);
        });
        const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
        if (lengths.length >= 3) { multi++; if (lengths.slice(1, -1).some(length => length < 100)) jogs++; }
      }
    }
  }
  assert.ok(multi > 100);
  assert.ok(jogs / multi < 0.08, `${jogs} of ${multi} multi-bend routes have a jog`);
});

// ---- Curling one way, lanes, and crowded boards ----
test('a thread that arrives at a card going up carries straight on up through it instead of zigzagging', () => {
  const board = calculateGalleryLayout(people(120)).placements;
  let checked = 0;
  for (const middle of board) {
    if (checked >= 6) break;
    // Two tiers below (same column), reached by a straight vertical line; the last card up and far to the right.
    const below = board.find(card => card.x === middle.x && card.y === middle.y + 2 * PITCH_Y);
    const last = board.find(card => card.y === middle.y - PITCH_Y && card.x - middle.x > 3 * PITCH_X && card.x - middle.x < 4.5 * PITCH_X);
    if (!below || !last) continue;
    const paths = galleryThread([below, middle, last], board), second = runs(paths[1]);
    assert.equal(bendsOf(paths[0]), 0, 'the first link is a straight vertical line');
    assert.equal(sideOf(runs(paths[0]).at(-1)![1], middle), 'bottom');
    // Leaving sideways would turn right and then left (an S). Going on up and then turning right keeps one way.
    assert.equal(sideOf(second[0][0], middle), 'top');
    assert.equal(bendsOf(paths[1]), 1);
    assert.equal(sideOf(second.at(-1)![1], last), 'left');
    checked++;
  }
  assert.ok(checked >= 3, `only ${checked} matching chains`);
});

test('chains do not zigzag more than they must', () => {
  const random = seeded(77);
  let reversals = 0, chains = 0;
  for (const count of [24, 60, 150]) {
    const board = calculateGalleryLayout(people(count)).placements;
    for (let attempt = 0; attempt < 60; attempt++) {
      const chain = chainOf(board, 3 + (attempt % 6), random), headings: number[] = [];
      let last = 0;
      chains++;
      galleryThread(chain, board).forEach((path, link) => {
        const walked = runs(path), heads = walked.map(([from, to]) => Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]) ? (to[0] > from[0] ? 0 : 2) : (to[1] > from[1] ? 1 : 3));
        // Merge rounded corners (two runs meeting at a control point) back into the straight runs they belong to.
        const merged = heads.filter((heading, index) => index === 0 || heading !== heads[index - 1]);
        const turns = [...(link > 0 ? [(merged[0] - headings.at(-1)! + 4) % 4] : []), ...merged.slice(1).map((heading, index) => (heading - merged[index] + 4) % 4)]
          .map(d => d === 1 ? 1 : d === 3 ? -1 : 0).filter(d => d !== 0);
        for (const t of turns) { if (last !== 0 && t !== last) reversals++; last = t; }
        headings.push(merged.at(-1)!);
      });
    }
  }
  assert.ok(reversals / chains < 2.3, `${(reversals / chains).toFixed(2)} S-bends per chain`);
});

test('two threads are not laid on top of each other: one is moved into a lane beside the other', () => {
  const random = seeded(8);
  let pairs = 0, overlapping = 0;
  for (const count of [24, 60, 150]) {
    const board = calculateGalleryLayout(people(count)).placements;
    for (let attempt = 0; attempt < 80; attempt++) {
      const walked = galleryThread(chainOf(board, 3 + (attempt % 7), random), board).map(runs);
      for (let first = 0; first < walked.length; first++) for (let second = first + 1; second < walked.length; second++) {
        pairs++;
        const lying = walked[first].some(([a1, a2]) => walked[second].some(([b1, b2]) => {
          const horizontal = a1[1] === a2[1];
          if (horizontal !== (b1[1] === b2[1]) || (horizontal ? Math.abs(a1[1] - b1[1]) : Math.abs(a1[0] - b1[0])) > 0.5) return false;
          const k = horizontal ? 0 : 1, a = [a1[k], a2[k]].sort((x, y) => x - y), b = [b1[k], b2[k]].sort((x, y) => x - y);
          return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1;
        }));
        if (lying) overlapping++;
      }
    }
  }
  assert.ok(overlapping / pairs < 0.005, `${overlapping} of ${pairs} pairs of links lie on top of each other`);
});

test('on a crowded board, where no simple shape is clear, the thread still keeps out of the cards of the chain', () => {
  // Ten of 24 cards in the chain: the way to some cards is a staircase through the gaps between staggered rows.
  const board = calculateGalleryLayout(people(24)).placements, random = seeded(101);
  for (let attempt = 0; attempt < 60; attempt++) {
    const chain = chainOf(board, 8 + (attempt % 3), random);
    galleryThread(chain, board).forEach((path, link) => {
      for (const [from, to] of runs(path)) chain.forEach(card => assert.ok(!crosses(from, to, card), `link ${link} runs through the card at ${card.x},${card.y}`));
    });
  }
});
