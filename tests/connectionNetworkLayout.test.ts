import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisTicks, NetworkLayout, type LayoutInput } from '../src/services/connectionNetworkLayout';

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
  assert.equal(long.pixelsPerYear, 2);
  assert.equal(short.pixelsPerYear, 14);
});

test('axis steps follow the zoom: centuries far out, decades up close', () => {
  assert.deepEqual(axisTicks(1500, 1800, 0.3).every(year => year % 200 === 0 || year % 100 === 0), true);
  assert.ok(axisTicks(1600, 1700, 6).length > axisTicks(1600, 1700, 0.5).length);
  assert.ok(axisTicks(1600, 1700, 8).every(year => year % 10 === 0));
});
