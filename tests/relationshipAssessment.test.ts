import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRelationships, generateRelationshipAssessment, parseRelationshipAssessment, readRelationshipAssessment, RelationshipAssessmentError } from '../src/services/relationshipAssessment';
import { figure, MemoryStorage, relationship, sections } from './helpers';
import { RELATIONSHIP_NARRATIVE_VERSION } from '../src/constants';

test('a discovery claim does not admit Bunyan–Watts when the assessment finds only shared tradition', async () => {
  const source = { ...figure, id: 'bunyan', name: 'John Bunyan', birthYear: 1628, deathYear: 1688 };
  const target = { ...figure, id: 'watts', name: 'Isaac Watts', birthYear: 1674, deathYear: 1748,
    shortDescription: "Influenced by Bunyan's Pilgrim's Progress." };
  const storage = new MemoryStorage();
  // A legacy cached link/explanation is not an evidence-bearing assessment.
  storage.setItem('chrono_rel_bunyan_watts', JSON.stringify({ explanation: sections }));
  let calls = 0;
  const service = { fetchRelationshipExplanation: async () => {
    calls++;
    return { ...sections, isRelevant: false, evidence: '', summary: 'Only broad theological context is established.' };
  } };
  assert.equal((await assessRelationships(service, source, [target], storage)).size, 0);
  assert.equal(calls, 1);
  assert.equal(readRelationshipAssessment(source, target, storage)?.isRelevant, false);
  assert.equal((await assessRelationships(service, source, [target], storage)).size, 0);
  assert.equal(calls, 1);
  assert.ok(storage.getItem('chrono_rel_bunyan_watts'));
});

test('concrete positive assessments retain only accepted IDs and reuse the same explanation', async () => {
  const accepted = { ...figure, id: 'babbage', name: 'Charles Babbage' };
  const rejected = { ...figure, id: 'unrelated', name: 'Unrelated candidate' };
  const storage = new MemoryStorage();
  const requested: string[] = [];
  const service = { fetchRelationshipExplanation: async (_source: typeof figure, target: typeof figure) => {
    requested.push(target.id);
    return target.id === accepted.id ? relationship : { ...sections, isRelevant: false, evidence: '' };
  } };
  const result = await assessRelationships(service, figure, [figure, accepted, accepted, rejected], storage);
  assert.deepEqual([...result.keys()], [accepted.id]);
  assert.deepEqual(requested, [accepted.id, rejected.id]);
  assert.deepEqual(result.get(accepted.id), relationship);
  assert.deepEqual(readRelationshipAssessment(figure, accepted, storage), relationship);
  await assessRelationships(service, figure, [accepted], storage);
  assert.equal(requested.length, 2);
  await assessRelationships(service, figure, [{ ...accepted, birthYear: 1791 }], storage);
  assert.equal(requested.length, 3);
});

test('missing verdicts, ambiguous verdicts, and positives without evidence cannot admit a connection', async () => {
  const target = { ...figure, id: 'other' };
  for (const result of [null, sections, { ...sections, isRelevant: 'possibly', evidence: 'Something' },
    { ...sections, isRelevant: true, evidence: '   ' }]) {
    const storage = new MemoryStorage();
    const service = { fetchRelationshipExplanation: async () => result as typeof relationship };
    await assert.rejects(assessRelationships(service, figure, [target], storage), /model could not assess/);
    assert.equal(storage.length, 0);
  }
});

test('explicit rejections need no evidence or narrative sections and are reusable', async () => {
  const storage = new MemoryStorage();
  const target = { ...figure, id: 'other' };
  const service = { fetchRelationshipExplanation: async () => ({ isRelevant: false } as typeof relationship) };
  assert.equal((await assessRelationships(service, figure, [target], storage)).size, 0);
  assert.equal(readRelationshipAssessment(figure, target, storage)?.isRelevant, false);
  assert.equal(readRelationshipAssessment(figure, target, storage)?.sections.length, 1);
});

test('older positive prose is refreshed once without clearing timeline, map, or biography caches', async () => {
  const storage = new MemoryStorage();
  const target = { ...figure, id: 'babbage', name: 'Charles Babbage' };
  await assessRelationships({ fetchRelationshipExplanation: async () => relationship }, figure, [target], storage);
  const cacheKey = 'chrono_assessment_ada_babbage';
  const legacy = JSON.parse(storage.getItem(cacheKey)!);
  delete legacy.narrativeVersion;
  storage.setItem(cacheKey, JSON.stringify(legacy));
  for (const key of ['chrono_timeline_data', 'chrono_map_ada', 'chrono_deepdive_ada']) storage.setItem(key, 'preserved');
  assert.equal(readRelationshipAssessment(figure, target, storage), null);

  const expanded = { ...relationship, summary: 'A fuller story of their work. The explanation describes why it mattered.',
    sections: [{ title: 'Working on the engine', content: 'The setting for their work.\n\nTheir contributions and its consequences.' }] };
  let calls = 0;
  const service = { fetchRelationshipExplanation: async () => { calls++; return expanded; } };
  assert.deepEqual((await assessRelationships(service, figure, [target], storage)).get(target.id), expanded);
  assert.deepEqual(readRelationshipAssessment(figure, target, storage), expanded);
  assert.equal(JSON.parse(storage.getItem(cacheKey)!).narrativeVersion, RELATIONSHIP_NARRATIVE_VERSION);
  await assessRelationships(service, figure, [target], storage);
  assert.equal(calls, 1);
  for (const key of ['chrono_timeline_data', 'chrono_map_ada', 'chrono_deepdive_ada']) assert.equal(storage.getItem(key), 'preserved');
});

test('legacy negative verdicts remain cached when only the narrative style changes', async () => {
  const storage = new MemoryStorage();
  const target = { ...figure, id: 'unrelated' };
  await assessRelationships({ fetchRelationshipExplanation: async () => ({ ...relationship, isRelevant: false, evidence: '' }) }, figure, [target], storage);
  const cacheKey = 'chrono_assessment_ada_unrelated';
  const legacy = JSON.parse(storage.getItem(cacheKey)!);
  delete legacy.narrativeVersion;
  storage.setItem(cacheKey, JSON.stringify(legacy));
  assert.equal(readRelationshipAssessment(figure, target, storage)?.isRelevant, false);
  await assessRelationships({ fetchRelationshipExplanation: async () => { throw new Error('Should reuse the rejection'); } }, figure, [target], storage);
});

test('presentation differences do not invalidate explicit evidence-bearing positives', () => {
  const result = parseRelationshipAssessment({ isRelevant: ' true ', evidence: [relationship.evidence], sections: [] });
  assert.equal(result.isRelevant, true);
  assert.equal(result.evidence, relationship.evidence);
  assert.equal(result.summary, relationship.evidence);
  assert.equal(result.sections[0].content, relationship.evidence);
  assert.equal(parseRelationshipAssessment({ isRelevant: 'false', evidence: null }).isRelevant, false);
});

test('one malformed candidate does not discard accepted candidates or cache a rejection', async () => {
  const bad = { ...figure, id: 'malformed' };
  const good = { ...figure, id: 'accepted' };
  const storage = new MemoryStorage();
  const service = { fetchRelationshipExplanation: async (_source: typeof figure, target: typeof figure) => {
    if (target.id === bad.id) throw new RelationshipAssessmentError('Missing relevance verdict');
    return relationship;
  } };
  const result = await assessRelationships(service, figure, [bad, good], storage);
  assert.deepEqual([...result.keys()], [good.id]);
  assert.equal(readRelationshipAssessment(figure, bad, storage), null);
});

test('malformed verdicts receive one specific correction and transport errors propagate', async () => {
  let calls = 0;
  const result = await generateRelationshipAssessment(async correction => {
    calls++;
    if (calls === 1) return sections;
    assert.match(correction!, /isRelevant as true or false/);
    return relationship;
  });
  assert.equal(calls, 2);
  assert.equal(result.isRelevant, true);
  calls = 0;
  await assert.rejects(generateRelationshipAssessment(async () => {
    calls++;
    throw new Error('Authentication failed');
  }), /Authentication failed/);
  assert.equal(calls, 1);
});

test('cancellation during review prevents caching or accepting its answer', async () => {
  const controller = new AbortController();
  const storage = new MemoryStorage();
  const service = { fetchRelationshipExplanation: async () => {
    controller.abort(new Error('Review cancelled'));
    return relationship;
  } };
  await assert.rejects(assessRelationships(service, figure, [{ ...figure, id: 'other' }], storage, controller.signal), /Review cancelled/);
  assert.equal(storage.length, 0);
});

test('unavailable storage does not bypass relationship assessment', async () => {
  const storage = { getItem: () => { throw new Error('Unavailable'); }, setItem: () => { throw new Error('Unavailable'); } } as unknown as Storage;
  const service = { fetchRelationshipExplanation: async () => relationship };
  const result = await assessRelationships(service, figure, [{ ...figure, id: 'other' }], storage);
  assert.deepEqual([...result.keys()], ['other']);
});
