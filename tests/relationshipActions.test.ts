import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelationshipAction } from '../src/services/relationshipActions';
import { saveRelationshipMap } from '../src/utils/relationshipCache';
import { HistoricalFigure, IAIService } from '../src/types';
import { figure, MemoryStorage, relationship } from './helpers';

const candidate = (id: string): HistoricalFigure => ({ ...figure, id, name: id });
const mockService = (overrides: Partial<IAIService> = {}): IAIService => ({
  fetchHistoricalFigures: async () => [], fetchRelatedFigures: async () => [], discoverRelatedFigures: async () => [],
  fetchRelationshipExplanation: async () => relationship, fetchFigureDeepDive: async () => null,
  testConnection: async () => ({ success: true }), ...overrides,
});
const options = (service: IAIService, figures: HistoricalFigure[] = [figure]) => ({ service, source: figure, figures, action: 'map' as const,
  config: { start: 1800, end: 1900 }, knownIds: [], storage: new MemoryStorage(), signal: new AbortController().signal, onExpansionFallback: () => {} });

test('mapping falls back to expansion once and returns only verified new figures', async () => {
  const accepted = candidate('accepted');
  const rejected = candidate('rejected');
  let fallbacks = 0;
  let expansions = 0;
  const input = options(mockService({
    discoverRelatedFigures: async () => { expansions++; return [accepted, rejected]; },
    fetchRelationshipExplanation: async (_source, target) => target.id === accepted.id ? relationship : { ...relationship, isRelevant: false, evidence: '' },
  }));
  input.onExpansionFallback = () => { fallbacks++; };
  const result = await resolveRelationshipAction(input);
  assert.equal(fallbacks, 1);
  assert.equal(expansions, 1);
  assert.deepEqual(result.newFigures, [accepted]);
  assert.deepEqual(result.relatedIds, ['accepted']);
  assert.equal(result.expansionAttempted, true);
  saveRelationshipMap(figure, [...input.figures, ...result.newFigures], result.relatedIds, input.storage, true);
  const mapped = await resolveRelationshipAction({ ...input, figures: [...input.figures, ...result.newFigures] });
  assert.deepEqual(mapped.relatedIds, ['accepted']);
  assert.deepEqual(mapped.newFigures, []);
  assert.equal(expansions, 1);
});

test('empty mapping cache prevents repeated automatic expansion', async () => {
  const input = options(mockService({ discoverRelatedFigures: async () => { throw new Error('Unexpected expansion'); } }));
  saveRelationshipMap(figure, input.figures, [], input.storage, true);
  assert.deepEqual(await resolveRelationshipAction(input), { relatedIds: [], newFigures: [], expansionAttempted: true });
});

test('expansion includes existing relationships without duplicating their figures', async () => {
  const existing = candidate('existing');
  const fresh = candidate('fresh');
  const input = options(mockService({ discoverRelatedFigures: async () => [existing, { ...existing, id: 'duplicate', name: ' EXISTING ' }, fresh, fresh, { ...candidate('outside'), birthYear: 2000, deathYear: 2050 }] }), [figure, existing]);
  const result = await resolveRelationshipAction({ ...input, action: 'expand', knownIds: [existing.id] });
  assert.deepEqual(result.newFigures, [fresh]);
  assert.deepEqual(result.relatedIds, [existing.id, fresh.id]);
});

test('closing during discovery rejects late results from a provider that ignores abort', async () => {
  const controller = new AbortController();
  let release: (figures: HistoricalFigure[]) => void = () => {};
  const input = options(mockService({ discoverRelatedFigures: () => new Promise(resolve => { release = resolve; }) }));
  const pending = resolveRelationshipAction({ ...input, action: 'expand', signal: controller.signal });
  controller.abort(new Error('Overlay closed'));
  release([candidate('unseen')]);
  await assert.rejects(pending, /Overlay closed/);
  assert.equal(input.storage.length, 0);
  assert.deepEqual(input.figures, [figure]);
});

test('cancellation during mapping fallback prevents discovery and new figures', async () => {
  const controller = new AbortController();
  let discoveries = 0;
  const input = options(mockService({ discoverRelatedFigures: async () => { discoveries++; return [candidate('unseen')]; } }));
  await assert.rejects(resolveRelationshipAction({ ...input, action: 'map', signal: controller.signal, onExpansionFallback: () => controller.abort(new Error('Closed during fallback')) }), /Closed during fallback/);
  assert.equal(discoveries, 0);
});

test('cancellation during assessment prevents admitting new figures and retries can succeed', async () => {
  const controller = new AbortController();
  const fresh = candidate('fresh');
  let fail = true;
  const input = options(mockService({
    discoverRelatedFigures: async () => [fresh],
    fetchRelationshipExplanation: async () => {
      if (fail) controller.abort(new Error('Closed during assessment'));
      return relationship;
    },
  }));
  await assert.rejects(resolveRelationshipAction({ ...input, action: 'expand', signal: controller.signal }), /Closed during assessment/);
  assert.equal(input.storage.length, 0);
  fail = false;
  assert.deepEqual((await resolveRelationshipAction({ ...input, action: 'expand' })).newFigures, [fresh]);
});

test('a failed expansion leaves the timeline and map unchanged and can be retried', async () => {
  let fail = true;
  const input = options(mockService({ discoverRelatedFigures: async () => {
    if (fail) throw new Error('Service unavailable');
    return [candidate('fresh')];
  } }));
  await assert.rejects(resolveRelationshipAction({ ...input, action: 'expand' }), /Service unavailable/);
  assert.equal(input.storage.length, 0);
  assert.deepEqual(input.figures, [figure]);
  fail = false;
  assert.deepEqual((await resolveRelationshipAction({ ...input, action: 'expand' })).relatedIds, ['fresh']);
});
