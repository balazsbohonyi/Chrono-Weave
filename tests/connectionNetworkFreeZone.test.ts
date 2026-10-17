import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkLayout, pushOutOfZone, type LayoutInput, type LayoutMode } from '../src/services/connectionNetworkLayout';

// Free zone: nobody but the endpoint stands within three endpoint radii of an endpoint's middle (and nobody's drawing reaches into it).
const ENDPOINT = 32, PERSON = 22, ZONE = 3 * ENDPOINT, SLACK = 0.01;
const ends: LayoutInput[] = [{ id: 'a', year: 1625, endpoint: 0, radius: ENDPOINT }, { id: 'b', year: 1825, endpoint: 1, radius: ENDPOINT }];
const crowd = (count: number): LayoutInput[] => Array.from({ length: count }, (_, index) =>
  ({ id: `p${index}`, year: 1630 + (index * 7) % 190, endpoint: null, radius: PERSON }));
const at = (layout: NetworkLayout, id: string) => layout.position(id)!;
const apart = (layout: NetworkLayout, from: string, to: string) => Math.hypot(at(layout, from).x - at(layout, to).x, at(layout, from).y - at(layout, to).y);
function build(mode: LayoutMode, people: LayoutInput[] = crowd(60), width = 1300) {
  const layout = new NetworkLayout();
  layout.setSize(width, 700); layout.setBounds(1625, 1825); layout.setMode(mode);
  layout.setGraph([...ends, ...people], [{ a: 'a', b: 'p0' }, { a: 'p0', b: 'p1' }, { a: 'p1', b: 'b' }]);
  layout.settle();
  return layout;
}
const intruders = (layout: NetworkLayout, ids: string[], reach = PERSON) => ids.filter(id => ['a', 'b'].some(end => apart(layout, id, end) < ZONE + reach - SLACK));

test('on the time line and in the free layout nobody enters an endpoint\'s zone', () => {
  for (const mode of ['time', 'free'] as const) {
    const layout = build(mode), ids = crowd(60).map(person => person.id);
    assert.deepEqual(intruders(layout, ids), [], `${mode}: people inside a zone`);
    // After more people arrive and the layout moves on, too.
    const more = Array.from({ length: 12 }, (_, index) => ({ id: `q${index}`, year: 1625 + index, endpoint: null, radius: PERSON } as LayoutInput));
    layout.setGraph([...ends, ...crowd(60), ...more], [{ a: 'a', b: 'q0' }]);
    layout.settle();
    assert.deepEqual(intruders(layout, [...ids, ...more.map(person => person.id)]), [], `${mode}: people inside a zone after new arrivals`);
  }
});

test('the zone is empty even for the people living in the endpoint\'s own years', () => {
  // Everybody lives within a few years of endpoint A, so the time line would pull them all onto it.
  const people = Array.from({ length: 14 }, (_, index) => ({ id: `n${index}`, year: 1625 + (index % 3), endpoint: null, radius: PERSON } as LayoutInput));
  const layout = build('time', people);
  assert.deepEqual(intruders(layout, people.map(person => person.id)), []);
});

test('time line: the push is vertical, so a person keeps their year while they clear the endpoint', () => {
  const layout = build('time', [{ id: 'same', year: 1625, endpoint: null, radius: PERSON }]);
  const a = at(layout, 'a'), same = at(layout, 'same');
  assert.ok(Math.abs(same.x - a.x) < 40, `x ${same.x} against the endpoint's ${a.x}`);
  assert.ok(Math.abs(same.y - a.y) >= ZONE + PERSON - 1, `${Math.abs(same.y - a.y)} above or below the endpoint`);
});

test('the endpoint\'s neighbour keeps its link and stands at the rim', () => {
  const layout = new NetworkLayout();
  layout.setSize(1300, 700); layout.setBounds(1625, 1825); layout.setMode('free');
  layout.setGraph([...ends, { id: 'near', year: 1640, endpoint: null, radius: PERSON }], [{ a: 'a', b: 'near' }]);
  layout.settle();
  const distance = apart(layout, 'near', 'a');
  assert.ok(distance >= ZONE + PERSON - SLACK, `${distance}`);
  assert.ok(distance < ZONE + PERSON + 130, `the link is not stretched far beyond the rim: ${distance}`);
});

test('a drawing that reaches beyond its disc (a "+n" badge) keeps that clear of the zone too', () => {
  const people: LayoutInput[] = Array.from({ length: 10 }, (_, index) => ({ id: `f${index}`, year: 1625 + index, endpoint: null, radius: PERSON, clearance: 20 }));
  const layout = build('free', people);
  assert.deepEqual(intruders(layout, people.map(person => person.id), PERSON + 20), []);
});

test('a dragged person stops at the rim, and an endpoint takes its zone along', () => {
  const layout = build('free', crowd(10));
  const a = at(layout, 'a');
  layout.dragStart('p3'); layout.dragTo('p3', a.x + 20, a.y + 5); layout.settle(10);
  const held = apart(layout, 'p3', 'a');
  assert.ok(held >= ZONE + PERSON - SLACK && held < ZONE + PERSON + 1, `held at ${held}`);
  layout.dragEnd('p3'); layout.settle();
  assert.ok(apart(layout, 'p3', 'a') >= ZONE + PERSON - SLACK);
  // Drop A onto somebody else: that person is moved out of its zone.
  const victim = at(layout, 'p7');
  layout.dragStart('a'); layout.dragTo('a', victim.x, victim.y); layout.settle(20); layout.dragEnd('a'); layout.settle();
  assert.deepEqual(intruders(layout, crowd(10).map(person => person.id)), []);
});

test('an endpoint cannot be dragged so near the other that the zones would meet at their smallest', () => {
  const layout = build('free', crowd(6));
  const b = at(layout, 'b');
  layout.dragStart('a'); layout.dragTo('a', b.x - 5, b.y); layout.settle(5); layout.dragEnd('a');
  assert.ok(apart(layout, 'a', 'b') >= 0.5 * ZONE * 2 - SLACK, `${apart(layout, 'a', 'b')}`);
});

test('two endpoints that are close shrink their zones together, down to a floor', () => {
  const [first, second] = build('free', [], 320).freeZones;
  // The endpoints rest 140px apart, less than the two zones need: both shrink, equally.
  assert.equal(first.radius, second.radius);
  assert.ok(first.radius < ZONE && first.radius > 0.5 * ZONE);
  assert.ok(Math.abs(first.radius * 2 - 140) < 1, `${first.radius}`);
  const [tight] = build('free', [], 200).freeZones;
  assert.equal(tight.radius, 0.5 * ZONE);
  const [roomy] = build('free', [], 1300).freeZones;
  assert.equal(roomy.radius, ZONE);
});

test('the arranged layouts keep their own slots and have no free zone', () => {
  for (const mode of ['cluster', 'columns', 'category', 'corridor'] as const) assert.deepEqual(build(mode, crowd(20)).freeZones, [], mode);
});

test('pushOutOfZone: radial or vertical to the rim, and nothing when clear', () => {
  const zone = { x: 100, y: 100, radius: 50 };
  assert.equal(pushOutOfZone({ x: 200, y: 100 }, zone, 10, false), null);
  assert.deepEqual(pushOutOfZone({ x: 130, y: 100 }, zone, 10, false), { x: 160, y: 100 });
  const up = pushOutOfZone({ x: 130, y: 90 }, zone, 10, true)!;
  assert.equal(up.x, 130);
  assert.ok(Math.abs(Math.hypot(up.x - 100, up.y - 100) - 60) < 1e-9 && up.y < 100);
  const exact = pushOutOfZone({ x: 100, y: 100 }, zone, 0, false, -1)!;
  assert.deepEqual(exact, { x: 50, y: 100 });
});
