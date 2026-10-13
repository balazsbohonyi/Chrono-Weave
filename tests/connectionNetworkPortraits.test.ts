import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNetworkPortraits } from '../src/hooks/useNetworkPortraits';
import { createSuccessHold } from '../src/services/connectionSuccessHold';

test('portraits are looked up by name for the people asked about, once', async () => {
  const cache = new Map<string, string | null>(), calls: string[][] = [];
  const fetcher = async (names: string[]) => { calls.push(names); return new Map(names.filter(name => name !== 'Nobody').map(name => [name, `https://img/${name}`])); };
  const people = [{ id: 'sd2-a', name: 'Isaac Newton' }, { id: 'sd2-b', name: 'Nobody' }];
  const first = await loadNetworkPortraits(people, fetcher, cache);
  assert.deepEqual([...first], [['sd2-a', 'https://img/Isaac Newton']]);
  assert.deepEqual(calls, [['Isaac Newton', 'Nobody']]);
  // Known people, including known misses, are not asked again; only the newcomer is.
  const second = await loadNetworkPortraits([...people, { id: 'sd2-c', name: 'Robert Hooke' }], fetcher, cache);
  assert.deepEqual(calls[1], ['Robert Hooke']);
  assert.equal(second.size, 2);
});

test('a failed lookup falls back quietly and is retried later', async () => {
  const cache = new Map<string, string | null>(), warn = console.warn;
  console.warn = () => {};
  try {
    const result = await loadNetworkPortraits([{ id: 'p', name: 'Pat' }], async () => { throw new Error('offline'); }, cache);
    assert.equal(result.size, 0);
    assert.equal(cache.has('p'), false);
    const retried = await loadNetworkPortraits([{ id: 'p', name: 'Pat' }], async names => new Map(names.map(name => [name, 'u'])), cache);
    assert.equal(retried.get('p'), 'u');
  } finally { console.warn = warn; }
});

test('an empty request makes no lookup', async () => {
  let called = false;
  const result = await loadNetworkPortraits([], async () => { called = true; return new Map(); }, new Map());
  assert.equal(result.size, 0); assert.equal(called, false);
});

function fakeTimers() {
  const pending = new Map<number, () => void>(); let next = 1;
  return {
    timers: { set: (callback: () => void) => { pending.set(next, callback); return next++; }, clear: (handle: unknown) => { pending.delete(handle as number); } },
    fire: () => { for (const [id, callback] of [...pending]) { pending.delete(id); callback(); } },
    get size() { return pending.size; },
  };
}

test('the success hold hands over once when its time is up', () => {
  const fake = fakeTimers(), hold = createSuccessHold(fake.timers);
  let handovers = 0;
  hold.begin(1500, () => { handovers++; });
  assert.equal(hold.active, true);
  fake.fire();
  assert.equal(handovers, 1); assert.equal(hold.active, false);
  fake.fire(); assert.equal(handovers, 1);
});

test('skipping hands over immediately and cancels the timer', () => {
  const fake = fakeTimers(), hold = createSuccessHold(fake.timers);
  let handovers = 0;
  hold.begin(1500, () => { handovers++; });
  assert.equal(hold.skip(), true);
  assert.equal(handovers, 1); assert.equal(fake.size, 0);
  assert.equal(hold.skip(), false);
  fake.fire(); assert.equal(handovers, 1);
});

test('abandoning drops the hand-over, as when the canvas changed during the hold', () => {
  const fake = fakeTimers(), hold = createSuccessHold(fake.timers);
  let handovers = 0;
  hold.begin(1500, () => { handovers++; });
  hold.abandon();
  fake.fire();
  assert.equal(handovers, 0); assert.equal(hold.skip(), false);
});

test('a new hold replaces the previous one', () => {
  const fake = fakeTimers(), hold = createSuccessHold(fake.timers), seen: string[] = [];
  hold.begin(1500, () => seen.push('first'));
  hold.begin(1500, () => seen.push('second'));
  fake.fire();
  assert.deepEqual(seen, ['second']);
});
