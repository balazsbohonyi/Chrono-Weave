import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordAllWorlds, recordWorld, traceWorlds } from './connectionTraceWorlds';
import { assertRequestAccounting } from './connectionFixtures';
import { CONNECTION_REQUEST_KINDS, PAIR_ASK_REASONS } from '../src/services/connectionGraph';

// The golden file was recorded from the engine as it was before request instrumentation. Counting
// requests must never change which requests are made: update it only for a deliberate behavior change.
const GOLDEN = fileURLToPath(new URL('./connectionRequestTrace.golden.json', import.meta.url));

test('golden trace: the (kind, batch size) sequence of every fake world is byte-identical to the uninstrumented engine', async () => {
  const actual = JSON.stringify(await recordAllWorlds(), null, 2) + '\n';
  assert.equal(actual, readFileSync(GOLDEN, 'utf8'));
});

test('engine counters equal what the service received, segment by segment, in every fake world', async () => {
  const sizes = (trace: string[], kind: string) => trace.filter(entry => entry.startsWith(`${kind} `)).map(entry => Number(entry.split(' ')[1]));
  for (const world of traceWorlds) {
    const { trace, results } = await recordWorld(world);
    // Every task makes exactly one service call, so each segment's calls are the next `tasks` entries.
    let offset = 0; const totals = Object.fromEntries(CONNECTION_REQUEST_KINDS.map(kind => [kind, 0])), asks = Object.fromEntries(PAIR_ASK_REASONS.map(reason => [reason, 0]));
    for (const [index, result] of results.entries()) {
      const d = result.session!.diagnostics, calls = trace.slice(offset, offset + d.tasks); offset += d.tasks;
      assertRequestAccounting(d);
      const label = `${world.name}, segment ${index + 1}`, r = d.requests!;
      assert.equal(calls.length, d.tasks, label);
      assert.equal(sizes(calls, 'seed').length, r.seed, label); assert.equal(sizes(calls, 'identity').length, r.identity, label);
      assert.equal(sizes(calls, 'assess').length, r.direct! + r.assess!, label); assert.equal(sizes(calls, 'discover').length, r.discover, label);
      assert.deepEqual(d.assessBatches, sizes(calls, 'assess'), label); assert.deepEqual(d.discoverSources, sizes(calls, 'discover'), label);
      for (const kind of CONNECTION_REQUEST_KINDS) totals[kind] += r[kind]!;
      for (const reason of PAIR_ASK_REASONS) asks[reason] += d.pairAsks![reason];
      assert.deepEqual(d.total!.requests, totals, label); assert.deepEqual(d.total!.pairAsks, asks, label); assert.equal(d.total!.segments, index + 1, label);
    }
    assert.equal(offset, trace.length, `${world.name}: no service call is left uncounted`);
  }
});
