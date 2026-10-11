import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discardRejectedFollowFigureCandidates, verifyFollowFigureConnections } from '../src/services/followFigureConnections';
import { assessRelationships, readRelationshipAssessment, RelationshipAssessmentError } from '../src/services/relationshipAssessment';
import type { HistoricalFigure, WeaveGenerationContext } from '../src/types';
import { figure, MemoryStorage, relationship, sections } from './helpers';

const context: WeaveGenerationContext = { mode: 'figure', query: figure.name, inferredStartYear: 1800,
  inferredEndYear: 1900, themeDescription: 'Ada Lovelace and her connections', activeCategories: ['ALL'] };
const connected = { ...figure, id: 'babbage', name: 'Charles Babbage', birthYear: 1791, deathYear: 1871 };
const unrelated = { ...figure, id: 'contemporary', name: 'Unrelated contemporary' };
const negative = { ...sections, isRelevant: false, evidence: '', summary: 'Only shared historical context is supported.' };

test('Follow a Figure keeps the focus and evidence-bearing connections, not generated contemporaries', async () => {
  const storage = new MemoryStorage();
  const candidates = [unrelated, figure, connected];
  const requested: string[] = [];
  const service = { fetchRelationshipExplanation: async (source: HistoricalFigure, target: HistoricalFigure) => {
    assert.equal(source, figure);
    requested.push(target.id);
    return target.id === connected.id ? relationship : negative;
  } };
  const result = await verifyFollowFigureConnections(service, candidates, context, storage);
  assert.deepEqual(result, { figures: [figure, connected], seedFigureId: figure.id, relatedIds: [connected.id] });
  assert.deepEqual(requested, [unrelated.id, connected.id]);
  assert.equal(readRelationshipAssessment(figure, unrelated, storage)?.isRelevant, false);
  assert.deepEqual(readRelationshipAssessment(figure, connected, storage), relationship);
  assert.deepEqual(candidates, [unrelated, figure, connected]);
  await verifyFollowFigureConnections(service, candidates, context, storage);
  assert.equal(requested.length, 2, 'the same verdicts and explanations are reused');
});

test('person-event connections use the same assessment gate', async () => {
  const event = { ...unrelated, category: 'EVENTS' as const };
  assert.deepEqual((await verifyFollowFigureConnections({ fetchRelationshipExplanation: async () => negative },
    [figure, event], context, new MemoryStorage())).figures, [figure]);
  assert.deepEqual((await verifyFollowFigureConnections({ fetchRelationshipExplanation: async () => relationship },
    [figure, event], context, new MemoryStorage())).figures, [figure, event]);
});

test('explicit rejections leave a valid focus-only canvas', async () => {
  const result = await verifyFollowFigureConnections({ fetchRelationshipExplanation: async () => negative },
    [figure, unrelated], context, new MemoryStorage());
  assert.deepEqual(result, { figures: [figure], seedFigureId: figure.id, relatedIds: [] });
});

test('missing evidence and unusable verdicts cannot produce an unchecked Follow a Figure canvas', async () => {
  for (const verdict of [sections, { ...relationship, evidence: '' }]) {
    await assert.rejects(verifyFollowFigureConnections({ fetchRelationshipExplanation: async () => verdict },
      [figure, connected], context, new MemoryStorage()), /model could not assess/);
  }
  const result = await verifyFollowFigureConnections({ fetchRelationshipExplanation: async (_source, target) => {
    if (target.id === unrelated.id) throw new RelationshipAssessmentError('Unusable verdict');
    return relationship;
  } }, [figure, unrelated, connected], context, new MemoryStorage());
  assert.deepEqual(result.figures, [figure, connected]);
});

test('missing or ambiguous focus identities fail before assessing a different source', async () => {
  const service = { fetchRelationshipExplanation: async () => { throw new Error('Unexpected assessment'); } };
  for (const figures of [[connected], [figure, { ...figure, id: 'duplicate' }], [{ ...figure, category: 'EVENTS' as const }]]) {
    await assert.rejects(verifyFollowFigureConnections(service, figures, context, new MemoryStorage()), /focus figure could not be identified/);
  }
});

test('other launcher modes keep their candidates without requesting relationship assessments', async () => {
  const service = { fetchRelationshipExplanation: async () => { throw new Error('Unexpected assessment'); } };
  const figures = [figure, unrelated];
  for (const mode of ['era', 'region', 'theme', 'time-span', 'freeform'] as const) {
    assert.equal((await verifyFollowFigureConnections(service, figures, { ...context, mode }, new MemoryStorage())).figures, figures);
  }
});

test('failed or cancelled verification never mutates its input or admits late results', async () => {
  const candidates = [figure, connected];
  await assert.rejects(verifyFollowFigureConnections({ fetchRelationshipExplanation: async () => { throw new Error('Service unavailable'); } },
    candidates, context, new MemoryStorage()), /Service unavailable/);
  const controller = new AbortController();
  const storage = new MemoryStorage();
  await assert.rejects(verifyFollowFigureConnections({ fetchRelationshipExplanation: async () => {
    controller.abort(new Error('Build cancelled'));
    return relationship;
  } }, candidates, context, storage, controller.signal), /Build cancelled/);
  assert.equal(storage.length, 0);
  assert.deepEqual(candidates, [figure, connected]);
});

test('legacy Follow a Figure caches discard scoped negative verdicts without deleting unassessed candidates', async () => {
  const storage = new MemoryStorage();
  await assessRelationships({ fetchRelationshipExplanation: async () => negative }, figure, [unrelated], storage);
  const figures = [figure, connected, unrelated];
  assert.deepEqual(discardRejectedFollowFigureCandidates(figures, context, storage), [figure, connected]);
  assert.equal(discardRejectedFollowFigureCandidates(figures, { ...context, mode: 'era' }, storage), figures);
  const changed = { ...unrelated, birthYear: 1700 };
  assert.deepEqual(discardRejectedFollowFigureCandidates([figure, changed], context, storage), [figure, changed]);
  assert.deepEqual(figures, [figure, connected, unrelated]);
});
