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

test('the success hold waits until it is asked to reveal, then hands over once', async () => {
  const hold = createSuccessHold();
  let handovers = 0;
  hold.begin(() => { handovers++; });
  assert.equal(hold.active, true);
  // Nothing happens on its own, however long the chain stays lit.
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(handovers, 0); assert.equal(hold.active, true);
  assert.equal(hold.reveal(), true);
  assert.equal(handovers, 1); assert.equal(hold.active, false);
  assert.equal(hold.reveal(), false); assert.equal(handovers, 1);
});

test('abandoning drops the hand-over, as when the canvas changed or the user left without revealing', () => {
  const hold = createSuccessHold();
  let handovers = 0;
  hold.begin(() => { handovers++; });
  hold.abandon();
  assert.equal(hold.active, false);
  assert.equal(hold.reveal(), false); assert.equal(handovers, 0);
});

test('a new hold replaces the previous one', () => {
  const hold = createSuccessHold(), seen: string[] = [];
  hold.begin(() => seen.push('first'));
  hold.begin(() => seen.push('second'));
  hold.reveal();
  assert.deepEqual(seen, ['second']);
});
