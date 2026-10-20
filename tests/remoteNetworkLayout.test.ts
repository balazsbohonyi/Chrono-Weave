import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkLayout, type LayoutInput, type LayoutLinkInput } from '../src/services/connectionNetworkLayout';
import { createLayoutHost } from '../src/services/networkLayoutHost';
import { RemoteNetworkLayout, type LayoutCommand, type LayoutFrame } from '../src/services/remoteNetworkLayout';

// A worker stand-in: commands queue up until `flush` runs them through the real host, as a worker would between frames.
function fakeWorker() {
  const queue: LayoutCommand[] = [];
  const spawned: Array<{ terminated: boolean }> = [];
  let handle: (command: LayoutCommand) => void = () => {};
  const worker = {
    onmessage: null as ((event: MessageEvent<LayoutFrame>) => void) | null,
    postMessage(command: LayoutCommand) { queue.push(structuredClone(command)); },
    terminate() { spawned[spawned.length - 1].terminated = true; },
  };
  const spawn = () => {
    spawned.push({ terminated: false });
    queue.length = 0;
    handle = createLayoutHost(frame => worker.onmessage?.({ data: structuredClone(frame) } as MessageEvent<LayoutFrame>));
    return worker as unknown as Worker;
  };
  const flush = () => { while (queue.length) handle(queue.shift()!); };
  return { spawn, flush, queue, spawned };
}

const ends: LayoutInput[] = [{ id: 'a', year: 1625, endpoint: 0, radius: 32 }, { id: 'b', year: 1825, endpoint: 1, radius: 32 }];
const crowd = (count: number): LayoutInput[] => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, year: 1630 + (index * 7) % 190, endpoint: null, radius: 22 }));
const links: LayoutLinkInput[] = [{ a: 'a', b: 'p0' }, { a: 'p0', b: 'p1' }, { a: 'p1', b: 'b' }];

function start(people = crowd(40)) {
  const fake = fakeWorker(), remote = new RemoteNetworkLayout(fake.spawn);
  remote.setSize(1300, 700); remote.setBounds(1625, 1825); remote.setMode('free');
  remote.setGraph([...ends, ...people], links);
  return { fake, remote };
}
// Runs frames until the worker says it is at rest, as the explorer's animation loop does.
function run(fake: ReturnType<typeof fakeWorker>, remote: RemoteNetworkLayout, limit = 1000) {
  let frames = 0;
  while (remote.step() && frames++ < limit) fake.flush();
  return frames;
}

test('the remote layout lands every person where the same layout in this thread does', () => {
  const { fake, remote } = start();
  run(fake, remote);
  const local = new NetworkLayout();
  local.setSize(1300, 700); local.setBounds(1625, 1825); local.setMode('free');
  local.setGraph([...ends, ...crowd(40)], links);
  while (local.step());
  for (const person of [...ends, ...crowd(40)]) assert.deepEqual(remote.position(person.id), local.position(person.id), person.id);
  assert.equal(remote.active, false);
  assert.deepEqual(remote.yearDomain, local.yearDomain);
  assert.equal(remote.xOf(1700), local.xOf(1700));
});

test('people the worker has not placed yet have no position, so the drawing keeps them out of sight', () => {
  const { fake, remote } = start();
  assert.equal(remote.position('p0'), undefined);
  run(fake, remote);
  assert.ok(remote.position('p0'));
  remote.setGraph([...ends, ...crowd(40), { id: 'late', year: 1700, endpoint: null, radius: 22 }], links);
  assert.equal(remote.position('late'), undefined);
  assert.ok(remote.position('p0'), 'people already placed keep their position meanwhile');
  run(fake, remote);
  assert.ok(remote.position('late'));
});

test('a change made while a frame is on its way keeps the animation going', () => {
  const { fake, remote } = start();
  run(fake, remote);
  assert.equal(remote.step(), false, 'at rest, no frame is asked for');
  // A change that moves nobody, then a tick; a new person arrives before the worker answers it.
  remote.setBounds(1625, 1825);
  assert.equal(remote.step(), true, 'a tick is asked for');
  remote.setGraph([...ends, ...crowd(41)], links);
  // The frame answering that tick says the layout was at rest, but the new person was sent after it, so the loop must go on.
  fake.flush();
  assert.equal(remote.step(), true);
  run(fake, remote);
  assert.ok(remote.position('p40'));
});

test('pins change at once on the main thread, and a dragged person follows the pointer without waiting for a frame', () => {
  const { fake, remote } = start();
  run(fake, remote);
  remote.dragStart('p3');
  remote.dragTo('p3', 400, 300);
  assert.deepEqual(remote.position('p3'), { x: 400, y: 300 });
  remote.dragEnd('p3');
  assert.ok(remote.pinned.has('p3'));
  run(fake, remote);
  assert.ok(remote.pinned.has('p3'), 'the worker agrees');
  remote.unpin('p3');
  assert.equal(remote.pinned.has('p3'), false);
  remote.dragStart('p4'); remote.dragTo('p4', 200, 200); remote.dragEnd('p4');
  remote.unpinAll();
  assert.equal(remote.pinned.size, 0);
  remote.dragStart('p5'); remote.dragTo('p5', 300, 200); remote.dragEnd('p5');
  remote.setMode('cluster');
  assert.equal(remote.pinned.size, 0, 'an arranged layout lets go of every pin');
});

test('a dragged person stops at the rim of an endpoint\'s free zone here as in the worker', () => {
  const { fake, remote } = start();
  run(fake, remote);
  const end = remote.position('a')!;
  remote.dragStart('p3');
  remote.dragTo('p3', end.x + 1, end.y);
  const held = remote.position('p3')!;
  assert.ok(Math.hypot(held.x - end.x, held.y - end.y) >= 3 * 32 + 22 - 0.01);
  fake.flush(); remote.step(); fake.flush();
  const placed = remote.position('p3')!;
  assert.ok(Math.abs(placed.x - held.x) < 0.01 && Math.abs(placed.y - held.y) < 0.01, 'the worker clamps to the same point');
});

test('the guides of an arranged layout reach the drawing, and keep their identity while they do not change', () => {
  const people = crowd(20).map((person, index) => ({ ...person, side: index % 2 ? 'a' as const : 'b' as const, distance: 1 + (index % 3), parent: index % 2 ? 'a' : 'b' }));
  const { fake, remote } = start(people);
  remote.setMode('cluster');
  run(fake, remote);
  const rings = remote.rings;
  assert.ok(rings.length > 0);
  remote.dragStart('a'); remote.dragTo('a', 300, 300); remote.dragEnd('a');
  run(fake, remote);
  assert.equal(remote.rings, rings, 'the same rings, so the drawing is not re-rendered on every frame');
  remote.setMode('columns');
  run(fake, remote);
  assert.ok(remote.columns.length > 0);
  assert.equal(remote.rings.length, 0);
});

test('a stopped layout starts a fresh worker on the next change and gives it the size, bounds and layout it had', () => {
  const { fake, remote } = start();
  run(fake, remote);
  remote.stop();
  assert.equal(fake.spawned[0].terminated, true);
  remote.setGraph([...ends, ...crowd(40)], links);
  assert.equal(fake.spawned.length, 2);
  assert.deepEqual(fake.queue.slice(0, 3).map(command => command.type), ['bounds', 'mode', 'size']);
  run(fake, remote);
  assert.ok(remote.position('p0'));
});
