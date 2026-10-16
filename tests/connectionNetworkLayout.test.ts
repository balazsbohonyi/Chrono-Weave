import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisTicks, NetworkLayout, partitionPods, planCategories, planColumns, planCorridor, planOrbit, seededRandom, type LayoutInput } from '../src/services/connectionNetworkLayout';

const inputs: LayoutInput[] = [
  { id: 'a', year: 1625, endpoint: 0, radius: 32 },
  { id: 'x', year: 1660, endpoint: null, radius: 22 },
  { id: 'y', year: 1750, endpoint: null, radius: 22 },
  { id: 'u', year: 1790, endpoint: null, radius: 22 },
  { id: 'b', year: 1825, endpoint: 1, radius: 32 },
];
const links = [{ a: 'a', b: 'x' }, { a: 'x', b: 'y' }, { a: 'y', b: 'u' }, { a: 'u', b: 'b' }];
function build() {
  const layout = new NetworkLayout();
  layout.setSize(900, 600); layout.setBounds(1600, 1850); layout.setGraph(inputs, links); layout.settle();
  return layout;
}
const at = (layout: NetworkLayout, id: string) => layout.position(id)!;

test('time mode settles people near their year, with endpoints fixed on the line', () => {
  const layout = build();
  for (const input of inputs) {
    const wanted = layout.xOf(input.year), x = at(layout, input.id).x;
    if (input.endpoint !== null) assert.equal(x, wanted); else assert.ok(Math.abs(x - wanted) < 40, `${input.id} at ${x}, wanted ${wanted}`);
  }
  assert.ok(at(layout, 'a').x < at(layout, 'x').x && at(layout, 'x').x < at(layout, 'y').x && at(layout, 'y').x < at(layout, 'b').x);
});

test('the same graph always settles the same way', () => {
  const first = build(), second = build();
  for (const input of inputs) assert.deepEqual(at(first, input.id), at(second, input.id));
});

test('an endpoint only drags vertically, and keeps the dropped height', () => {
  const layout = build(), before = at(layout, 'a').x;
  layout.dragStart('a'); layout.dragTo('a', 700, 90); layout.settle(20); layout.dragEnd('a'); layout.settle();
  assert.equal(at(layout, 'a').x, before);
  assert.ok(Math.abs(at(layout, 'a').y - 90) < 1);
  assert.ok(layout.pinned.has('a'));
});

test('time mode: a dropped person keeps the height and drifts back to their year', () => {
  const layout = build();
  layout.dragStart('y'); layout.dragTo('y', 120, 60); layout.settle(10); layout.dragEnd('y'); layout.settle();
  const y = at(layout, 'y');
  assert.ok(Math.abs(y.y - 60) < 1, `height ${y.y}`);
  assert.ok(Math.abs(y.x - layout.xOf(1750)) < 40, `x ${y.x}`);
  assert.ok(layout.pinned.has('y'));
});

test('free mode: a dropped person is pinned where they land, until released', () => {
  const layout = build();
  layout.setMode('free'); layout.settle();
  layout.dragStart('y'); layout.dragTo('y', 321, 222); layout.settle(10); layout.dragEnd('y'); layout.settle();
  assert.deepEqual([Math.round(at(layout, 'y').x), Math.round(at(layout, 'y').y)], [321, 222]);
  layout.unpin('y'); layout.settle();
  assert.ok(!layout.pinned.has('y'));
  assert.notDeepEqual([Math.round(at(layout, 'y').x), Math.round(at(layout, 'y').y)], [321, 222]);
});

test('switching modes retargets: free pins the endpoints to the two sides, time returns them to their years', () => {
  const layout = build();
  layout.setMode('free'); layout.settle();
  assert.ok(at(layout, 'a').x < 120 && at(layout, 'b').x > 780);
  assert.ok(Math.abs(at(layout, 'a').y - 300) < 1 && Math.abs(at(layout, 'b').y - 300) < 1);
  layout.setMode('time'); layout.settle();
  assert.equal(at(layout, 'a').x, layout.xOf(1625));
  assert.ok(Math.abs(at(layout, 'x').x - layout.xOf(1660)) < 40);
});

test('a pin made in free mode keeps only its height after returning to time mode', () => {
  const layout = build();
  layout.setMode('free'); layout.settle();
  layout.dragStart('x'); layout.dragTo('x', 700, 480); layout.dragEnd('x'); layout.settle();
  layout.setMode('time'); layout.settle();
  assert.ok(Math.abs(at(layout, 'x').y - 480) < 1);
  assert.ok(Math.abs(at(layout, 'x').x - layout.xOf(1660)) < 40);
});

test('new people enter beside the contact that introduced them, and existing ones barely move', () => {
  const layout = build(), before = at(layout, 'y');
  layout.setGraph([...inputs, { id: 'n', year: 1752, endpoint: null, radius: 22 }], [...links, { a: 'y', b: 'n' }]);
  const start = at(layout, 'n');
  assert.ok(Math.hypot(start.x - before.x, start.y - before.y) < 120);
  assert.deepEqual(at(layout, 'y'), before);
  layout.settle();
  assert.ok(Math.hypot(at(layout, 'y').x - before.x, at(layout, 'y').y - before.y) < 60);
});

const crowd = (count: number, offset = 0): LayoutInput[] => Array.from({ length: count }, (_, index) =>
  ({ id: `p${offset + index}`, year: 1640 + ((offset + index) * 7) % 150, endpoint: null, radius: 22 }));
const minGap = (layout: NetworkLayout, ids: string[]) => {
  let gap = Infinity;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = at(layout, ids[i]), b = at(layout, ids[j]);
    gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return gap;
};

test('a crowd that arrives at once is seated before it is drawn: nothing is left to jump around', () => {
  for (const mode of ['time', 'free'] as const) {
    const layout = new NetworkLayout();
    layout.setSize(1300, 700); layout.setBounds(1625, 1825); layout.setMode(mode);
    const people = [...inputs.filter(input => input.endpoint !== null), ...crowd(45)];
    const ids = people.map(person => person.id);
    layout.setGraph(people, [{ a: 'a', b: 'p0' }, { a: 'p0', b: 'p1' }, { a: 'p1', b: 'b' }]);
    assert.equal(layout.active, false, `${mode}: already at rest`);
    assert.equal(layout.step(), false, `${mode}: no frame has anything left to move`);
    const seated = ids.map(id => at(layout, id));
    layout.settle();
    assert.deepEqual(ids.map(id => at(layout, id)), seated, `${mode}: settling again changes nothing`);
    // Nobody sits on top of anybody else (they have room for their disc, at the very least).
    assert.ok(minGap(layout, ids) > 30, `${mode}: closest pair is ${minGap(layout, ids).toFixed(1)}px apart`);
  }
});

test('a big round of new contacts finds its places beside the people already there, who stay where they are', () => {
  const layout = new NetworkLayout();
  layout.setSize(1300, 700); layout.setBounds(1625, 1825);
  const first = [...inputs.filter(input => input.endpoint !== null), ...crowd(10)];
  layout.setGraph(first, [{ a: 'a', b: 'p0' }]);
  layout.settle();
  const before = first.map(person => at(layout, person.id));
  const more = crowd(12, 100);
  layout.setGraph([...first, ...more], [{ a: 'a', b: 'p0' }, { a: 'p0', b: 'p100' }]);
  assert.deepEqual(first.map(person => at(layout, person.id)), before, 'the people already there did not move');
  assert.ok(minGap(layout, [...first, ...more].map(person => person.id)) > 25);
});

test('the year domain widens for people outside the endpoints lifespans, and removed people are forgotten', () => {
  const layout = build(), [from, to] = layout.yearDomain;
  layout.setGraph([...inputs, { id: 'old', year: 1400, endpoint: null, radius: 22 }], links);
  assert.ok(layout.yearDomain[0] < from && layout.yearDomain[0] <= 1400 && layout.yearDomain[1] === to);
  layout.setGraph(inputs, links);
  assert.equal(layout.position('old'), undefined);
});

test('years keep their own spacing: wider than a fit to the drawing, and not changed by resizing', () => {
  const layout = build(), spacing = layout.pixelsPerYear, [from, to] = layout.yearDomain;
  assert.ok(spacing > (900 - 180) / (to - from) * 2, `${spacing} px per year`);
  layout.setSize(1600, 700);
  assert.equal(layout.pixelsPerYear, spacing);
  assert.ok(Math.abs(layout.xOf(1700) - layout.xOf(1650) - spacing * 50) < 1e-6);
});

test('the spacing eases off for very long spans but never collapses, and caps for very short ones', () => {
  const long = new NetworkLayout(), short = new NetworkLayout();
  long.setBounds(-400, 1950); short.setBounds(1900, 1910);
  assert.equal(long.pixelsPerYear, 4);
  assert.equal(short.pixelsPerYear, 28);
});

test('axis steps follow the zoom: centuries far out, decades up close', () => {
  assert.deepEqual(axisTicks(1500, 1800, 0.3).every(year => year % 200 === 0 || year % 100 === 0), true);
  assert.ok(axisTicks(1600, 1700, 6).length > axisTicks(1600, 1700, 0.5).length);
  assert.ok(axisTicks(1600, 1700, 8).every(year => year % 10 === 0));
});

test('free mode: an endpoint drags anywhere, and stays where it was dropped through new people and resizing', () => {
  const layout = build();
  layout.setMode('free'); layout.settle();
  layout.dragStart('a'); layout.dragTo('a', 410, 140); layout.settle(20); layout.dragEnd('a'); layout.settle();
  assert.deepEqual([Math.round(at(layout, 'a').x), Math.round(at(layout, 'a').y)], [410, 140]);
  assert.ok(layout.pinned.has('a'));
  layout.setGraph([...inputs, { id: 'n', year: 1700, endpoint: null, radius: 22 }], [...links, { a: 'a', b: 'n' }]); layout.settle();
  layout.setSize(1100, 640); layout.settle();
  assert.deepEqual([Math.round(at(layout, 'a').x), Math.round(at(layout, 'a').y)], [410, 140]);
  layout.unpin('a'); layout.settle();
  assert.ok(at(layout, 'a').x < 120 && Math.abs(at(layout, 'a').y - 320) < 1, `back on its side: ${at(layout, 'a').x}, ${at(layout, 'a').y}`);
});

test('a pinned endpoint keeps its dropped height between layouts, but its place along the axis follows the layout', () => {
  const layout = build();
  layout.dragStart('a'); layout.dragTo('a', 700, 90); layout.settle(20); layout.dragEnd('a'); layout.settle();
  layout.setMode('free'); layout.settle();
  assert.ok(at(layout, 'a').x < 120, `on its side of the drawing, not at its year: ${at(layout, 'a').x}`);
  assert.ok(Math.abs(at(layout, 'a').y - 90) < 1);
  layout.dragStart('a'); layout.dragTo('a', 300, 200); layout.dragEnd('a'); layout.settle();
  layout.setMode('time'); layout.settle();
  assert.equal(at(layout, 'a').x, layout.xOf(1625));
  assert.ok(Math.abs(at(layout, 'a').y - 200) < 1);
});

test('unpin all releases every pinned person at once, endpoints included', () => {
  const layout = build();
  layout.setMode('free'); layout.settle();
  for (const [id, x, y] of [['a', 300, 90], ['x', 200, 500], ['y', 600, 100]] as const) { layout.dragStart(id); layout.dragTo(id, x, y); layout.dragEnd(id); }
  layout.settle();
  assert.equal(layout.pinned.size, 3);
  layout.unpinAll(); layout.settle();
  assert.equal(layout.pinned.size, 0);
  assert.ok(at(layout, 'a').x < 120 && Math.abs(at(layout, 'a').y - 300) < 1);
  assert.notDeepEqual([Math.round(at(layout, 'x').x), Math.round(at(layout, 'x').y)], [200, 500]);
  assert.doesNotThrow(() => layout.unpinAll());
});

// A small exploration: a reaches x1 and x2 (x3 through x1), b reaches y1 (y2 through y1), z is linked to nobody on either side.
const orbitWorld: LayoutInput[] = [
  { id: 'a', year: 1625, endpoint: 0, radius: 32, side: 'a', distance: 0 },
  { id: 'x1', year: 1650, endpoint: null, radius: 22, side: 'a', distance: 1, parent: 'a' },
  { id: 'x2', year: 1700, endpoint: null, radius: 22, side: 'a', distance: 1, parent: 'a' },
  { id: 'x3', year: 1720, endpoint: null, radius: 22, side: 'a', distance: 2, parent: 'x1' },
  { id: 'z', year: 1750, endpoint: null, radius: 22, side: 'none', distance: null },
  { id: 'y2', year: 1780, endpoint: null, radius: 22, side: 'b', distance: 2, parent: 'y1' },
  { id: 'y1', year: 1800, endpoint: null, radius: 22, side: 'b', distance: 1, parent: 'b' },
  { id: 'b', year: 1825, endpoint: 1, radius: 32, side: 'b', distance: 0 },
];
const orbitLinks = [{ a: 'a', b: 'x1' }, { a: 'a', b: 'x2' }, { a: 'x1', b: 'x3' }, { a: 'b', b: 'y1' }, { a: 'y1', b: 'y2' }];
const gap = (layout: NetworkLayout, p: string, q: string) => Math.hypot(at(layout, p).x - at(layout, q).x, at(layout, p).y - at(layout, q).y);
function clustered() {
  const layout = new NetworkLayout();
  layout.setSize(900, 600); layout.setBounds(1600, 1850); layout.setMode('cluster'); layout.setGraph(orbitWorld, orbitLinks); layout.settle();
  return layout;
}

test('cluster layout: everybody sits on the ring of their distance around the endpoint they are closest to', () => {
  const layout = clustered();
  assert.deepEqual(layout.rings.map(ring => [ring.anchor, ring.hops]), [['a', 1], ['a', 2], ['b', 1], ['b', 2]]);
  for (const [id, hub, hops] of [['x1', 'a', 1], ['x2', 'a', 1], ['x3', 'a', 2], ['y1', 'b', 1], ['y2', 'b', 2]] as const) {
    const ring = layout.rings.find(item => item.anchor === hub && item.hops === hops)!;
    assert.ok(Math.abs(gap(layout, id, hub) - ring.radius) < 12, `${id} is ${gap(layout, id, hub).toFixed(0)}px from ${hub}, its ring is ${ring.radius.toFixed(0)}`);
    assert.ok(gap(layout, id, hub) < gap(layout, id, hub === 'a' ? 'b' : 'a'), `${id} is closer to ${hub}`);
  }
  assert.ok(gap(layout, 'x1', 'a') < gap(layout, 'x3', 'a') && gap(layout, 'y1', 'b') < gap(layout, 'y2', 'b'), 'more links, farther out');
  // The two clusters are apart, with the person attached to neither between them.
  assert.ok(at(layout, 'a').x < at(layout, 'z').x && at(layout, 'z').x < at(layout, 'b').x);
  assert.ok(Math.abs(at(layout, 'a').y - at(layout, 'b').y) < 1);
  for (const person of orbitWorld) for (const other of orbitWorld) if (person.id < other.id) assert.ok(gap(layout, person.id, other.id) > 45, `${person.id} and ${other.id} overlap`);
});

test('cluster layout: dragging an endpoint carries its people, and the rings follow', () => {
  const layout = clustered(), before = at(layout, 'x3');
  layout.dragStart('a'); layout.dragTo('a', at(layout, 'a').x - 150, at(layout, 'a').y + 120); layout.settle(250); layout.dragEnd('a'); layout.settle();
  const ring = layout.rings.find(item => item.anchor === 'a' && item.hops === 2)!;
  assert.ok(Math.abs(gap(layout, 'x3', 'a') - ring.radius) < 12);
  assert.ok(Math.hypot(at(layout, 'x3').x - before.x, at(layout, 'x3').y - before.y) > 100, 'x3 moved with a');
  assert.ok(layout.pinned.has('a'));
  layout.unpinAll(); layout.settle();
  assert.ok(Math.abs(at(layout, 'a').y - at(layout, 'b').y) < 1, 'a is back in line with b');
});

test('cluster layout: a new contact lands on its ring, and a person who gets closer to an endpoint moves in', () => {
  const layout = clustered();
  const x4: LayoutInput = { id: 'x4', year: 1660, endpoint: null, radius: 22, side: 'a', distance: 1, parent: 'a' };
  layout.setGraph([...orbitWorld, x4], [...orbitLinks, { a: 'a', b: 'x4' }]); layout.settle();
  const first = layout.rings.find(item => item.anchor === 'a' && item.hops === 1)!;
  assert.ok(Math.abs(gap(layout, 'x4', 'a') - first.radius) < 12);
  // z is now one link from b: it leaves the middle for b's first ring.
  layout.setGraph([...orbitWorld.map(person => person.id === 'z' ? { ...person, side: 'b' as const, distance: 1, parent: 'b' } : person), x4],
    [...orbitLinks, { a: 'a', b: 'x4' }, { a: 'b', b: 'z' }]); layout.settle();
  const near = layout.rings.find(item => item.anchor === 'b' && item.hops === 1)!;
  assert.ok(Math.abs(gap(layout, 'z', 'b') - near.radius) < 12);
});

test('cluster layout: unverified contacts stay beside the person they belong to, and never move the endpoints', () => {
  const layout = clustered(), ends = [at(layout, 'a').x, at(layout, 'b').x], hub = at(layout, 'x1');
  // Nine unresolved contacts of x1 appear (selecting x1, or a legend chip), one of them has a contact of its own.
  const extras: LayoutInput[] = Array.from({ length: 9 }, (_, index) => ({ id: `u${index}`, year: 1660 + index, endpoint: null, radius: 22, side: 'none', distance: null }));
  const more = [...extras, { id: 'v', year: 1670, endpoint: null, radius: 22, side: 'none' as const, distance: null }];
  layout.setGraph([...orbitWorld, ...more], [...orbitLinks, ...extras.map(extra => ({ a: 'x1', b: extra.id })), { a: 'u0', b: 'v' }]); layout.settle();
  assert.deepEqual([at(layout, 'a').x, at(layout, 'b').x], ends, 'the endpoints stay where they were');
  for (const extra of extras) assert.ok(Math.hypot(at(layout, extra.id).x - hub.x, at(layout, extra.id).y - hub.y) < 330, `${extra.id} is beside x1`);
  assert.ok(gap(layout, 'v', 'u0') < gap(layout, 'v', 'b'), 'a contact of a contact follows it');
  for (const one of [...orbitWorld, ...more]) for (const other of [...orbitWorld, ...more]) if (one.id < other.id) assert.ok(gap(layout, one.id, other.id) > 40, `${one.id} and ${other.id} overlap`);
  // The selection clears: they are gone and nothing else has moved.
  layout.setGraph(orbitWorld, orbitLinks); layout.settle();
  assert.deepEqual([at(layout, 'a').x, at(layout, 'b').x], ends);
  // An unverified contact of an endpoint gets one more ring around it.
  layout.setGraph([...orbitWorld, extras[0]], [...orbitLinks, { a: 'a', b: 'u0' }]); layout.settle();
  assert.ok(gap(layout, 'u0', 'a') > gap(layout, 'x3', 'a') && gap(layout, 'u0', 'a') < gap(layout, 'u0', 'b'));
});

test('cluster layout: rings widen with the people on them, and endpoints are kept apart by the clusters they carry', () => {
  const people = (count: number) => [
    { id: 'a', year: 1625, endpoint: 0 as const, radius: 32, side: 'a' as const, distance: 0, parent: null }, { id: 'b', year: 1825, endpoint: 1 as const, radius: 32, side: 'b' as const, distance: 0, parent: null },
    ...Array.from({ length: count }, (_, index) => ({ id: `c${index}`, year: 1630 + index, endpoint: null, radius: 22, side: 'a' as const, distance: 1, parent: 'a' })),
  ];
  const plan = (count: number) => planOrbit(people(count), { x: 0, y: 0 });
  const small = plan(3), large = plan(30);
  assert.ok(large.rings[0].radius > small.rings[0].radius * 2.5, `${large.rings[0].radius} vs ${small.rings[0].radius}`);
  const apart = (p: ReturnType<typeof plan>) => p.home.get('b')!.x - p.home.get('a')!.x;
  assert.ok(apart(large) > apart(small));
  // Thirty people on one ring keep their distance from each other.
  const spots = [...large.offsets.values()];
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].dx - spots[j].dx, spots[i].dy - spots[j].dy) >= 99, 'room for each person');
});

test('entering the cluster layout lets go of every pin, endpoints included; pins made there survive leaving it', () => {
  const layout = build();
  layout.dragStart('y'); layout.dragTo('y', 120, 60); layout.dragEnd('y');
  layout.setMode('free'); layout.settle();
  layout.dragStart('a'); layout.dragTo('a', 500, 300); layout.dragEnd('a'); layout.settle();
  assert.deepEqual([...layout.pinned].sort(), ['a', 'y']);
  layout.setMode('cluster'); layout.settle();
  assert.equal(layout.pinned.size, 0);
  assert.ok(at(layout, 'a').x < at(layout, 'b').x && Math.abs(at(layout, 'a').y - at(layout, 'b').y) < 1, 'a is back in its place on the left, level with b');
  layout.dragStart('x'); layout.dragTo('x', 333, 111); layout.dragEnd('x'); layout.settle();
  layout.setMode('free'); layout.settle();
  assert.ok(layout.pinned.has('x'));
  assert.deepEqual([Math.round(at(layout, 'x').x), Math.round(at(layout, 'x').y)], [333, 111]);
  assert.equal(layout.rings.length, 0);
});

// ---- Columns layout ----------------------------------------------------------------------------------------------------
function columned(world: LayoutInput[] = orbitWorld, worldLinks = orbitLinks) {
  const layout = new NetworkLayout();
  layout.setSize(900, 600); layout.setBounds(1600, 1850); layout.setMode('columns'); layout.setGraph(world, worldLinks); layout.settle();
  return layout;
}
type PlanPerson = Parameters<typeof planColumns>[0][number];
const planPerson = (id: string, year: number, side: 'a' | 'b' | 'none', distance: number | null, parent: string | null, endpoint: 0 | 1 | null = null): PlanPerson =>
  ({ id, year, endpoint, radius: endpoint === null ? 22 : 32, side, distance, parent });
const ends: PlanPerson[] = [planPerson('a', 1625, 'a', 0, null, 0), planPerson('b', 1825, 'b', 0, null, 1)];
const offsetOf = (plan: ReturnType<typeof planColumns>, id: string) => plan.offsets.get(id)!;

test('columns plan: A counts links from the left, B from the right, one column per number of links', () => {
  const plan = planColumns(orbitWorld.map(item => planPerson(item.id, item.year, item.side ?? 'none', item.distance ?? null, item.parent ?? null, item.endpoint)), { x: 0, y: 0 });
  assert.deepEqual(plan.columns.map(column => [column.anchor, column.side, column.hops]), [['a', 'a', 1], ['a', 'a', 2], ['b', 'b', 1], ['b', 'b', 2]]);
  assert.equal(offsetOf(plan, 'x1').dx, offsetOf(plan, 'x2').dx, 'the same number of links share a column');
  assert.ok(offsetOf(plan, 'x1').dx > 0 && offsetOf(plan, 'x3').dx > offsetOf(plan, 'x1').dx, 'A: more links, farther right');
  assert.ok(offsetOf(plan, 'y1').dx < 0 && offsetOf(plan, 'y2').dx < offsetOf(plan, 'y1').dx, 'B: mirrored, more links, farther left');
  assert.equal(offsetOf(plan, 'x1').dx, -offsetOf(plan, 'y1').dx, 'first columns are equally far from their endpoints');
  assert.ok(plan.home.get('a')!.x < plan.home.get('b')!.x && plan.home.get('a')!.y === plan.home.get('b')!.y);
  for (const column of plan.columns) assert.ok(column.top < 0 && column.bottom > 0 && column.half > 0);
  // The first column clears the widest name pill under the endpoint (28 characters), the way the drawing makes it.
  assert.ok(offsetOf(plan, 'x1').dx - 22 > 28 * 7.6 / 2 + 10, `first column at ${offsetOf(plan, 'x1').dx}`);
  // Somebody linked to nobody is between the two sides, wherever the sides end.
  const z = offsetOf(plan, 'z');
  assert.equal(z.anchor, null);
  assert.ok(plan.home.get('a')!.x + offsetOf(plan, 'x3').dx < (plan.home.get('a')!.x + plan.home.get('b')!.x) / 2 + z.dx);
  assert.ok(plan.home.get('b')!.x + offsetOf(plan, 'y2').dx > (plan.home.get('a')!.x + plan.home.get('b')!.x) / 2 + z.dx);
});

test('columns plan: inside a column people follow their parent top to bottom, a slot apart, as near their parent as that allows', () => {
  // Two people in the first column (p2 is the older, so it is above p1); their children are ordered by parent first, then year.
  const world = [...ends, planPerson('p1', 1660, 'a', 1, 'a'), planPerson('p2', 1640, 'a', 1, 'a'),
    planPerson('c1', 1700, 'a', 2, 'p1'), planPerson('c2', 1690, 'a', 2, 'p2'), planPerson('c3', 1650, 'a', 2, 'p1'), planPerson('c4', 1710, 'a', 2, 'p2')];
  const plan = planColumns(world, { x: 0, y: 0 });
  const dy = (id: string) => offsetOf(plan, id).dy;
  assert.ok(dy('p2') < dy('p1'), 'by year when the parent is the same');
  assert.ok(Math.max(dy('c2'), dy('c4')) < Math.min(dy('c3'), dy('c1')), 'p2\'s children above p1\'s');
  assert.ok(dy('c2') < dy('c4') && dy('c3') < dy('c1'), 'then by year');
  const sorted = ['c2', 'c4', 'c3', 'c1'].map(dy);
  for (let index = 1; index < sorted.length; index++) assert.ok(sorted[index] - sorted[index - 1] >= 99.99, 'a slot apart');
  assert.ok(Math.abs(sorted.reduce((sum, value) => sum + value, 0)) < 1e-9, 'four children of two neighbouring parents share the room around them');
  // When there is room, each child stands level with its parent.
  const spread = planColumns([...ends, planPerson('q1', 1640, 'a', 1, 'a'), planPerson('q2', 1650, 'a', 1, 'a'), planPerson('q3', 1660, 'a', 1, 'a'),
    planPerson('r1', 1700, 'a', 2, 'q3'), planPerson('r2', 1710, 'a', 2, 'q1')], { x: 0, y: 0 });
  assert.equal(offsetOf(spread, 'r1').dy, offsetOf(spread, 'q3').dy);
  assert.equal(offsetOf(spread, 'r2').dy, offsetOf(spread, 'q1').dy);
  assert.ok(offsetOf(spread, 'r2').dy < offsetOf(spread, 'r1').dy, 'q1 is above q3, so is its child');
  // A parent without a place in the previous column does not break the order: the child falls back to year.
  const orphan = planColumns([...world, planPerson('o', 1500, 'a', 2, 'gone')], { x: 0, y: 0 });
  assert.equal(offsetOf(orphan, 'o').dx, offsetOf(orphan, 'c1').dx);
  assert.ok(Number.isFinite(offsetOf(orphan, 'o').dy));
});

test('columns plan: a crowded distance widens into lanes instead of growing tall, and the bands are one height', () => {
  const crowd = Array.from({ length: 30 }, (_, index) => planPerson(`c${String(index).padStart(2, '0')}`, 1630 + index, 'a', 1, 'a'));
  const plan = planColumns([...ends, ...crowd, planPerson('d', 1700, 'a', 2, 'c05')], { x: 0, y: 0 });
  const lanes = new Set(crowd.map(item => offsetOf(plan, item.id).dx)), rows = new Set(crowd.map(item => Math.round(offsetOf(plan, item.id).dy)));
  assert.equal(lanes.size, 3);
  assert.equal(rows.size, 10);
  const [first, second] = plan.columns;
  assert.equal(first.half, 3 * 124 / 2);
  assert.ok(second.dx - second.half > first.dx + first.half, 'groups do not touch');
  assert.equal(first.top, second.top);
  assert.equal(first.bottom, second.bottom);
  // Nobody shares a spot.
  const spots = [...plan.offsets.entries()].filter(([id]) => id !== 'a' && id !== 'b').map(([, offset]) => offset);
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].dx - spots[j].dx, spots[i].dy - spots[j].dy) >= 99.99, 'room for each person');
});

test('columns plan: unverified people never move anybody, and stand behind the endpoint of the person they link to', () => {
  const verified = [...ends, planPerson('x1', 1650, 'a', 1, 'a'), planPerson('x2', 1700, 'a', 1, 'a'), planPerson('x3', 1720, 'a', 2, 'x1'), planPerson('y1', 1800, 'b', 1, 'b'), planPerson('z', 1750, 'none', null, null)];
  const tentative = [...Array.from({ length: 9 }, (_, index) => planPerson(`u${index}`, 1660 + index, 'none', null, null)), planPerson('v', 1670, 'none', null, null), planPerson('w', 1671, 'none', null, null)];
  const links = new Map<string, string[]>([['v', ['u0']], ['w', ['a']], ...tentative.slice(0, 9).map(item => [item.id, ['x1']] as [string, string[]])]);
  const plain = planColumns(verified, { x: 0, y: 0 }), more = planColumns([...verified, ...tentative], { x: 0, y: 0 }, links);
  assert.deepEqual([...more.home], [...plain.home], 'the endpoints stay where they were');
  assert.deepEqual(more.columns, plain.columns, 'and so do the bands');
  for (const item of verified) assert.deepEqual(offsetOf(more, item.id), offsetOf(plain, item.id), `${item.id} has not moved`);
  for (const id of ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'v', 'w']) assert.ok(offsetOf(more, id).dx < 0 && offsetOf(more, id).anchor === 'a', `${id} is behind A`);
  assert.ok(offsetOf(more, 'v').dx < offsetOf(more, 'u0').dx, 'a contact of a contact follows it, farther out');
  assert.equal(offsetOf(more, 'w').dx, offsetOf(more, 'u0').dx, 'a contact of A shares the lane');
  // Nine of x1's contacts stand at x1's height: the lanes are centered on it.
  const heights = Array.from({ length: 9 }, (_, index) => offsetOf(more, `u${index}`).dy);
  assert.ok(Math.abs((Math.min(...heights) + Math.max(...heights)) / 2 - offsetOf(more, 'x1').dy) < 60);
  const spots = [...more.offsets.entries()].filter(([id]) => id !== 'a' && id !== 'b');
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const [, p] = spots[i], [, q] = spots[j];
    if (p.anchor === q.anchor) assert.ok(Math.hypot(p.dx - q.dx, p.dy - q.dy) >= 99.99, `${spots[i][0]} and ${spots[j][0]} share a spot`);
  }
});

test('columns layout: everybody settles in the column of their distance, A on the left and B on the right, endpoints level', () => {
  const layout = columned();
  const x = (id: string) => at(layout, id).x;
  assert.ok(Math.abs(x('x1') - x('x2')) < 6, 'one column');
  assert.ok(x('a') < x('x1') && x('x1') < x('x3'), 'A side: left to right');
  assert.ok(x('b') > x('y1') && x('y1') > x('y2'), 'B side: right to left');
  assert.ok(x('x3') < x('z') && x('z') < x('y2'), 'the unattached person is between the sides');
  assert.ok(Math.abs(at(layout, 'a').y - at(layout, 'b').y) < 1);
  assert.deepEqual(layout.columns.map(column => [column.anchor, column.hops]), [['a', 1], ['a', 2], ['b', 1], ['b', 2]]);
  assert.equal(layout.rings.length, 0, 'no rings in this layout');
  for (const person of orbitWorld) for (const other of orbitWorld) if (person.id < other.id) assert.ok(gap(layout, person.id, other.id) > 45, `${person.id} and ${other.id} overlap`);
});

test('columns layout: dragging an endpoint carries its columns, and unpinning all puts it back in line', () => {
  const layout = columned(), before = at(layout, 'x3'), guides = layout.columns;
  const beside = { x: before.x - at(layout, 'a').x, y: before.y - at(layout, 'a').y };
  layout.dragStart('a'); layout.dragTo('a', at(layout, 'a').x - 120, at(layout, 'a').y + 140); layout.settle(250); layout.dragEnd('a'); layout.settle();
  assert.ok(layout.pinned.has('a'));
  assert.ok(Math.abs(at(layout, 'x3').x - at(layout, 'a').x - beside.x) < 12 && Math.abs(at(layout, 'x3').y - at(layout, 'a').y - beside.y) < 12, 'x3 keeps its place relative to a');
  assert.ok(Math.hypot(at(layout, 'x3').x - before.x, at(layout, 'x3').y - before.y) > 100, 'x3 moved with a');
  assert.equal(layout.columns, guides, 'the bands are unchanged (they are measured from the endpoint)');
  layout.unpinAll(); layout.settle();
  assert.ok(Math.abs(at(layout, 'a').y - at(layout, 'b').y) < 1);
  assert.ok(Math.abs(at(layout, 'x3').x - before.x) < 12 && Math.abs(at(layout, 'x3').y - before.y) < 12, 'x3 is back');
});

test('columns layout: a new contact lands in its column, and one who gets closer to an endpoint moves over', () => {
  const layout = columned();
  const x4: LayoutInput = { id: 'x4', year: 1660, endpoint: null, radius: 22, side: 'a', distance: 1, parent: 'a' };
  layout.setGraph([...orbitWorld, x4], [...orbitLinks, { a: 'a', b: 'x4' }]); layout.settle();
  assert.ok(Math.abs(at(layout, 'x4').x - at(layout, 'x1').x) < 6, 'x4 joins the first column');
  // z is now one link from b: it leaves the middle for b's first column.
  layout.setGraph([...orbitWorld.map(person => person.id === 'z' ? { ...person, side: 'b' as const, distance: 1, parent: 'b' } : person), x4],
    [...orbitLinks, { a: 'a', b: 'x4' }, { a: 'b', b: 'z' }]); layout.settle();
  assert.ok(Math.abs(at(layout, 'z').x - at(layout, 'y1').x) < 6);
  for (const person of [...orbitWorld, x4]) for (const other of [...orbitWorld, x4]) if (person.id < other.id) assert.ok(gap(layout, person.id, other.id) > 45, `${person.id} and ${other.id} overlap`);
});

test('columns layout: unverified contacts neither move the endpoints nor anybody else, and leave nothing behind', () => {
  const layout = columned();
  const places = new Map(orbitWorld.map(person => [person.id, at(layout, person.id)]));
  const extras: LayoutInput[] = Array.from({ length: 9 }, (_, index) => ({ id: `u${index}`, year: 1660 + index, endpoint: null, radius: 22, side: 'none', distance: null }));
  layout.setGraph([...orbitWorld, ...extras], [...orbitLinks, ...extras.map(extra => ({ a: 'x1', b: extra.id }))]); layout.settle();
  for (const person of orbitWorld) assert.ok(Math.hypot(at(layout, person.id).x - places.get(person.id)!.x, at(layout, person.id).y - places.get(person.id)!.y) < 4, `${person.id} stayed put`);
  for (const one of [...orbitWorld, ...extras]) for (const other of [...orbitWorld, ...extras]) if (one.id < other.id) assert.ok(gap(layout, one.id, other.id) > 40, `${one.id} and ${other.id} overlap`);
  layout.setGraph(orbitWorld, orbitLinks); layout.settle();
  for (const person of orbitWorld) assert.ok(Math.hypot(at(layout, person.id).x - places.get(person.id)!.x, at(layout, person.id).y - places.get(person.id)!.y) < 4, `${person.id} is back`);
});

test('columns layout: entering it lets go of every pin, leaving it clears the bands, and the same graph settles the same way', () => {
  const layout = build();
  layout.setMode('free'); layout.settle();
  layout.dragStart('a'); layout.dragTo('a', 500, 300); layout.dragEnd('a'); layout.settle();
  assert.deepEqual([...layout.pinned], ['a']);
  layout.setMode('columns'); layout.settle();
  assert.equal(layout.pinned.size, 0);
  assert.ok(at(layout, 'a').x < at(layout, 'b').x && Math.abs(at(layout, 'a').y - at(layout, 'b').y) < 1);
  layout.setMode('cluster'); layout.settle();
  assert.equal(layout.columns.length, 0);
  layout.setMode('columns'); layout.settle();
  layout.setMode('free'); layout.settle();
  assert.equal(layout.columns.length, 0);
  assert.equal(layout.rings.length, 0);
  const first = columned(), second = columned();
  for (const person of orbitWorld) assert.deepEqual(at(first, person.id), at(second, person.id));
});

test('columns layout: 150 people in a few distances stay readable columns, none on top of another', () => {
  const people: LayoutInput[] = [{ id: 'a', year: 1625, endpoint: 0, radius: 32, side: 'a', distance: 0 }, { id: 'b', year: 1825, endpoint: 1, radius: 32, side: 'b', distance: 0 }];
  const edges: Array<{ a: string; b: string }> = [];
  const random = seededRandom(12345);
  const previous: Record<'a' | 'b', string[]> = { a: ['a'], b: ['b'] };
  for (const [side, sizes] of [['a', [9, 22, 21, 12, 6]], ['b', [8, 20, 25, 14, 8]]] as const) {
    let parents = previous[side];
    sizes.forEach((count, level) => {
      const born: string[] = [];
      for (let index = 0; index < count; index++) {
        const id = `${side}${level + 1}-${index}`, parent = parents[Math.floor(random() * parents.length)];
        people.push({ id, year: 1600 + Math.floor(random() * 250), endpoint: null, radius: 22, side, distance: level + 1, parent });
        edges.push({ a: parent, b: id }); born.push(id);
      }
      parents = born;
    });
  }
  assert.ok(people.length > 145);
  const layout = columned(people, edges);
  for (const person of people) {
    const offsetX = at(layout, person.id).x - at(layout, person.side === 'a' ? 'a' : 'b').x;
    if (person.endpoint === null) assert.ok(person.side === 'a' ? offsetX > 0 : offsetX < 0, `${person.id} is on its side`);
  }
  const guides = layout.columns;
  assert.equal(guides.length, 10);
  const xs = people.filter(person => person.endpoint === null);
  for (const guide of guides) {
    const anchor = at(layout, guide.anchor);
    for (const person of xs.filter(item => item.side === guide.side && item.distance === guide.hops)) {
      assert.ok(Math.abs(at(layout, person.id).x - (anchor.x + guide.dx)) <= guide.half + 6, `${person.id} sits in its band`);
    }
  }
  let overlapping = 0;
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) if (gap(layout, people[i].id, people[j].id) < 60) overlapping++;
  assert.equal(overlapping, 0);
  const tops = people.map(person => at(layout, person.id).y);
  assert.ok(Math.max(...tops) - Math.min(...tops) < 12 * 100 + 200, 'no taller than one lane of rows');
});

// A world with fields and a chain: a - m1 - m2 - b is the corridor (spine 0..3); m1 has three contacts, m2 one who has one of her own,
// and s is linked to nobody. Fields: scientists (a, m1, p1, p2, q1), writers (m2, p3, r1, s), b is an artist.
const person = (id: string, category: string, year: number, extra: Partial<LayoutInput> = {}): LayoutInput =>
  ({ id, year, endpoint: null, radius: 22, category, ...extra });
const fieldWorld: LayoutInput[] = [
  person('a', 'SCIENTISTS', 1625, { endpoint: 0, radius: 32, side: 'a', distance: 0, spine: 0 }),
  person('m1', 'SCIENTISTS', 1660, { side: 'a', distance: 1, parent: 'a', spine: 1 }),
  person('m2', 'WRITERS', 1740, { side: 'b', distance: 1, parent: 'b', spine: 2 }),
  person('b', 'ARTISTS', 1825, { endpoint: 1, radius: 32, side: 'b', distance: 0, spine: 3 }),
  person('p1', 'SCIENTISTS', 1655, { side: 'a', distance: 2, parent: 'm1' }),
  person('p2', 'SCIENTISTS', 1665, { side: 'a', distance: 2, parent: 'm1' }),
  person('p3', 'WRITERS', 1675, { side: 'a', distance: 2, parent: 'm1' }),
  person('q1', 'SCIENTISTS', 1745, { side: 'b', distance: 2, parent: 'm2' }),
  person('r1', 'WRITERS', 1750, { side: 'b', distance: 3, parent: 'q1' }),
  person('s', 'WRITERS', 1700),
];
const fieldLinks = [{ a: 'a', b: 'm1' }, { a: 'm1', b: 'm2' }, { a: 'm2', b: 'b' }, { a: 'm1', b: 'p1' }, { a: 'm1', b: 'p2' }, { a: 'm1', b: 'p3' }, { a: 'm2', b: 'q1' }, { a: 'q1', b: 'r1' }];
const arranged = (mode: 'category' | 'corridor', world = fieldWorld, links = fieldLinks) => {
  const layout = new NetworkLayout();
  layout.setSize(900, 600); layout.setBounds(1600, 1850); layout.setMode(mode); layout.setGraph(world, links); layout.settle();
  return layout;
};

test('categories plan: one pod per category, the biggest first, nobody in two pods and no two pods overlapping', () => {
  const plan = planCategories(fieldWorld.map(item => ({ side: 'none' as const, distance: null, parent: null, ...item })), { x: 0, y: 0 });
  assert.deepEqual(plan.categories.map(guide => [guide.category, guide.count]), [['SCIENTISTS', 4], ['WRITERS', 4], ['ARTISTS', 0]].filter(([, count]) => count).concat([]));
  // Endpoints belong to no pod: the scientists are m1, p1, p2, q1 and the writers m2, p3, r1, s.
  for (const guide of plan.categories) for (const other of plan.categories) if (guide.category < other.category) {
    assert.ok(guide.x + guide.width <= other.x || other.x + other.width <= guide.x || guide.y + guide.height <= other.y || other.y + other.height <= guide.y, `${guide.category} and ${other.category} overlap`);
  }
  for (const [id, offset] of plan.offsets) {
    const category = fieldWorld.find(item => item.id === id)!.category, guide = plan.categories.find(item => item.category === category)!;
    assert.ok(offset.dx >= guide.x && offset.dx <= guide.x + guide.width && offset.dy >= guide.y && offset.dy <= guide.y + guide.height, `${id} stands inside its own pod`);
  }
  assert.ok(plan.home.get('a')!.x < Math.min(...plan.categories.map(guide => guide.x)) && plan.home.get('b')!.x > Math.max(...plan.categories.map(guide => guide.x + guide.width)));
});

test('categories layout: everybody settles inside the pod of their category, the endpoints outside on each side, nobody on top of anybody', () => {
  const layout = arranged('category');
  for (const item of fieldWorld.filter(input => input.endpoint === null)) {
    const guide = layout.categories.find(pod => pod.category === item.category)!, at = layout.position(item.id)!;
    assert.ok(at.x > guide.x && at.x < guide.x + guide.width && at.y > guide.y && at.y < guide.y + guide.height, `${item.id} at ${at.x.toFixed(0)},${at.y.toFixed(0)} is inside the ${item.category} pod`);
  }
  assert.ok(layout.position('a')!.x < Math.min(...layout.categories.map(pod => pod.x)) && layout.position('b')!.x > Math.max(...layout.categories.map(pod => pod.x + pod.width)));
  for (const one of fieldWorld) for (const other of fieldWorld) if (one.id < other.id) assert.ok(gap(layout, one.id, other.id) > 45, `${one.id} and ${other.id} overlap`);
  assert.equal(layout.mode, 'category'); assert.equal(layout.rings.length, 0); assert.equal(layout.corridor, null);
});

test('categories layout: a big crowd of three fields packs into a block wider than tall, still with room for everyone', () => {
  const fields = ['SCIENTISTS', 'WRITERS', 'ARTISTS', 'THINKERS', 'BUSINESS'];
  const crowd: LayoutInput[] = [fieldWorld[0], fieldWorld[3], ...Array.from({ length: 120 }, (_, index) => person(`c${index}`, fields[index % fields.length], 1600 + (index * 3) % 240))];
  const layout = arranged('category', crowd, []);
  const pods = layout.categories, left = Math.min(...pods.map(pod => pod.x)), right = Math.max(...pods.map(pod => pod.x + pod.width));
  const top = Math.min(...pods.map(pod => pod.y)), bottom = Math.max(...pods.map(pod => pod.y + pod.height));
  assert.equal(pods.length, 5); assert.ok(right - left > bottom - top, 'wider than tall');
  const ids = crowd.map(item => item.id); let overlapping = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (gap(layout, ids[i], ids[j]) < 60) overlapping++;
  assert.equal(overlapping, 0);
});

test('categories layout: contacts between pods never pull anybody out of their own pod, even in a crowd of a thousand', () => {
  // The faint tie along contacts used by the other arranged layouts pulled people at a pod's edge across its border once the crowd
  // was big and well connected; the pods are strict containers, so the category layout has no such tie.
  const fields = ['SCIENTISTS', 'WRITERS', 'ARTISTS', 'THINKERS', 'BUSINESS', 'MILITARY'], random = seededRandom(11);
  const crowd: LayoutInput[] = [fieldWorld[0], fieldWorld[3], ...Array.from({ length: 1000 }, (_, index) => person(`c${index}`, fields[Math.floor(random() * random() * fields.length)], 1300 + Math.floor(random() * 700)))];
  const contacts = crowd.slice(2).flatMap(item => Array.from({ length: 4 }, () => ({ a: item.id, b: crowd[2 + Math.floor(random() * 1000)].id })).filter(link => link.a !== link.b));
  const layout = new NetworkLayout(seededRandom(11));
  layout.setSize(1500, 700); layout.setBounds(1452, 1889); layout.setMode('category'); layout.setGraph(crowd, contacts); layout.settle();
  const strays = crowd.filter(item => item.endpoint === null).filter(item => {
    const pod = layout.categories.find(guide => guide.category === item.category)!, at = layout.position(item.id)!;
    return at.x < pod.x || at.x > pod.x + pod.width || at.y < pod.y || at.y > pod.y + pod.height;
  });
  assert.deepEqual(strays.map(item => item.id), []);
});

test('categories plan: the pods partition one block edge to edge, with no hanging corners, however uneven the categories are', () => {
  for (const counts of [[46, 38, 3], [120, 1], [30, 30, 30, 5, 2, 1], [7], [12, 12, 12, 12], [200, 90, 60, 40, 25, 12, 5, 3, 1]]) {
    const { width, height, places } = partitionPods(counts, 100);
    assert.equal(places.length, counts.length);
    // The tiles add up to the block and none overlaps another: they fill it exactly.
    assert.ok(Math.abs(places.reduce((sum, box) => sum + box.width * box.height, 0) - width * height) < 1e-3 * width * height, `${counts} fill the block`);
    for (const one of places) {
      assert.ok(one.x >= -1e-6 && one.y >= -1e-6 && one.x + one.width <= width + 1e-6 && one.y + one.height <= height + 1e-6, `${counts} stay inside the block`);
      for (const other of places) if (one !== other) assert.ok(one.x + one.width <= other.x + 1e-6 || other.x + other.width <= one.x + 1e-6 || one.y + one.height <= other.y + 1e-6 || other.y + other.height <= one.y + 1e-6, `${counts} do not overlap`);
    }
    // Wider than tall in the end, or close to it, and not much bigger than the people need (a slot each, plus titles and gaps).
    assert.ok(width / height > 1 && width / height < 2.4, `${counts} are wider than tall: ${(width / height).toFixed(2)}`);
    assert.ok(width * height < 2.2 * (counts.reduce((sum, count) => sum + count, 0) * 100 * 100 + counts.length * 230 * 120 + 40000), `${counts} are packed`);
  }
  // The same through the plan: the pods share the block, so the space between them is just the gap.
  const plan = planCategories([['A', 46], ['B', 38], ['C', 3]].flatMap(([category, count]) => Array.from({ length: count as number }, (_, index) => ({ id: `${category}${index}`, year: 1900 + index, endpoint: null, radius: 22, category: category as string, side: 'none' as const, distance: null, parent: null }))), { x: 0, y: 0 });
  const left = Math.min(...plan.categories.map(guide => guide.x)), right = Math.max(...plan.categories.map(guide => guide.x + guide.width));
  const top = Math.min(...plan.categories.map(guide => guide.y)), bottom = Math.max(...plan.categories.map(guide => guide.y + guide.height));
  assert.ok(plan.categories.reduce((sum, guide) => sum + guide.width * guide.height, 0) / ((right - left) * (bottom - top)) > 0.85, 'the pods cover most of their bounding block');
});

test('corridor plan: the spine stands on the centre line in order, the ribs hang above and below their person, strays wait underneath', () => {
  const plan = planCorridor(fieldWorld.map(item => ({ side: 'none' as const, distance: null, parent: null, ...item })), { x: 0, y: 0 }, new Map(fieldLinks.flatMap(link => [[link.a, [link.b]], [link.b, [link.a]]] as Array<[string, string[]]>)
    .reduce((map, [key, list]) => map.set(key, [...(map.get(key) ?? []), ...list]), new Map<string, string[]>())));
  assert.deepEqual(plan.corridor, { from: 'a', to: 'b' });
  // The two endpoints are the ends of the line; the people between them are a fraction of the way along it.
  assert.ok(plan.home.get('a')!.x < 0 && plan.home.get('b')!.x > 0 && plan.home.get('a')!.y === 0);
  assert.ok(plan.offsets.get('m1')!.along! > 0 && plan.offsets.get('m1')!.along! < plan.offsets.get('m2')!.along! && plan.offsets.get('m2')!.along! < 1);
  // m1's three contacts hang from m1 on both sides (the first alternates above and below), one slot away; m2's chain goes straight down or up.
  const ribs = ['p1', 'p2', 'p3'].map(id => plan.offsets.get(id)!);
  assert.ok(ribs.every(offset => offset.anchor === 'm1' && Math.abs(offset.dy) === 100));
  assert.ok(ribs.some(offset => offset.dy < 0) && ribs.some(offset => offset.dy > 0), 'above and below');
  const q1 = plan.offsets.get('q1')!, r1 = plan.offsets.get('r1')!;
  assert.equal(q1.anchor, 'm2'); assert.equal(r1.anchor, 'm2'); assert.equal(Math.sign(r1.dy), Math.sign(q1.dy)); assert.equal(Math.abs(r1.dy), 200);
  // s is linked to nobody: it waits below the lowest rib, in the layout's own coordinates.
  const stray = plan.offsets.get('s')!;
  assert.equal(stray.anchor, '@center'); assert.ok(stray.dy > 200);
});

test('corridor layout: the spine settles on the centre line, everybody else stands beside the spine person they belong to', () => {
  const layout = arranged('corridor'), line = layout.position('a')!.y;
  assert.ok(Math.abs(layout.position('b')!.y - line) < 1);
  const spine = ['a', 'm1', 'm2', 'b'].map(id => layout.position(id)!);
  assert.ok(spine.every((at, index) => index === 0 || at.x > spine[index - 1].x), 'in order from A to B');
  for (const at of spine) assert.ok(Math.abs(at.y - line) < 15, 'on the line');
  for (const [id, owner] of [['p1', 'm1'], ['p2', 'm1'], ['p3', 'm1'], ['q1', 'm2'], ['r1', 'm2']] as const) {
    const others = ['a', 'm1', 'm2', 'b'].filter(spineId => spineId !== owner);
    assert.ok(others.every(other => gap(layout, id, owner) < gap(layout, id, other)), `${id} is nearer ${owner} than any other on the line`);
  }
  assert.ok(layout.position('s')!.y > Math.max(...['p1', 'p2', 'p3', 'q1', 'r1'].map(id => layout.position(id)!.y)), 's waits underneath');
  for (const one of fieldWorld) for (const other of fieldWorld) if (one.id < other.id) assert.ok(gap(layout, one.id, other.id) > 45, `${one.id} and ${other.id} overlap`);
  assert.deepEqual(layout.corridor, { from: 'a', to: 'b' }); assert.equal(layout.categories.length, 0);
});

test('corridor layout: dragging an endpoint carries the line and its ribs; a longer spine only moves the people on it', () => {
  const layout = arranged('corridor'), before = layout.position('p1')!;
  layout.dragStart('a'); layout.dragTo('a', layout.position('a')!.x - 120, layout.position('a')!.y + 90); layout.settle(300); layout.dragEnd('a'); layout.settle();
  assert.ok(Math.hypot(layout.position('p1')!.x - before.x, layout.position('p1')!.y - before.y) > 30, 'the ribs follow the line');
  assert.ok(layout.pinned.has('a'));
  // With only the two endpoints on the line, everybody belongs to whichever end they are nearer.
  const bare = fieldWorld.map(item => ({ ...item, spine: item.endpoint !== null ? (item.endpoint === 0 ? 0 : 1) : null }));
  const two = arranged('corridor', bare);
  assert.ok(gap(two, 'p1', 'a') < gap(two, 'p1', 'b') && gap(two, 'r1', 'b') < gap(two, 'r1', 'a'));
});

test('the arranged layouts all let go of pins and the same graph always settles the same way', () => {
  for (const mode of ['category', 'corridor'] as const) {
    const layout = build();
    layout.setMode('free'); layout.dragStart('x'); layout.dragTo('x', 300, 200); layout.dragEnd('x');
    assert.ok(layout.pinned.has('x'));
    layout.setMode(mode); layout.settle();
    assert.equal(layout.pinned.size, 0, `${mode} releases the pins`);
    const first = arranged(mode), second = arranged(mode);
    for (const item of fieldWorld) assert.deepEqual(first.position(item.id), second.position(item.id), `${mode}: ${item.id}`);
    layout.setMode('time'); layout.settle();
    assert.equal(layout.categories.length + (layout.corridor ? 1 : 0), 0);
  }
});
