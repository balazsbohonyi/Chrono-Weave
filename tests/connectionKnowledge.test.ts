import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IndexedConnectionRepository, MemoryConnectionRepository, fitSession, recoverKnowledge, recoverSession, KNOWLEDGE_LIMITS } from '../src/utils/connectionKnowledge';
import { figurePerson, identifyPerson, sessionKey, type ConnectionSession, type ContactPerson } from '../src/services/connectionGraph';
import { migrateLegacyConnectionMembers, connectionFigureIds, listConnectionPaths, saveWovenFigureIds } from '../src/utils/connectionPaths';
import { CanvasCache } from '../src/utils/canvasHistory';
import { discardRejectedFollowFigureCandidates } from '../src/services/followFigureConnections';
import { saveRelationshipMap } from '../src/utils/relationshipCache';
import { MemoryStorage } from './helpers';
import { A, B, M, fakeContacts, person } from './connectionFixtures';
import { findConnection } from '../src/services/connectionPath';

function fixture(canvasId = 'one'): ConnectionSession {
  const people: ContactPerson[] = [], a = identifyPerson(people, figurePerson(A)), b = identifyPerson(people, figurePerson(B));
  return { version: 2, key: sessionKey(canvasId, a.id, b.id), canvasId, endpoints: [a.id, b.id], people,
    candidates: [{ from: a.id, to: b.id, claim: 'Hypothesis', status: 'checking' }], rounds: [], attempts: {}, segment: 1,
    status: 'searching', phase: 'Assessing', elapsedMs: 10, updatedAt: Date.now(), diagnostics: { tasks: 1, people: 0, pairs: 0 } };
}
test('checkpoints restore pending operations to the queue and are canvas-scoped; memory fallback remains usable', async () => {
  const repo = new IndexedConnectionRepository(undefined); const session = fixture();
  assert.equal(await repo.checkpoint({ people: session.people, contacts: [] }, session), false);
  const saved = await repo.loadSession(session.key); assert.equal(saved?.status, 'paused'); assert.equal(saved?.candidates[0].status, 'proposed');
  assert.equal((await repo.listSessions('other')).length, 0); assert.equal((await repo.listSessions('one')).length, 1);
});
test('malformed persistence is isolated and record recovery omits arbitrary credential/settings fields', () => {
  const session = fixture(); assert.equal(recoverSession({ ...session, endpoints: ['missing', 'also missing'] }), null);
  const recovered = recoverSession({ ...session, apiKey: 'secret', diagnostics: { ...session.diagnostics, authorization: 'secret' }, people: [...session.people, { name: 'Broken' }] });
  assert.ok(recovered); assert.equal(JSON.stringify(recovered).includes('secret'), false); assert.equal(recovered?.people.length, 2);
  assert.deepEqual(recoverKnowledge({ people: [null, { ...session.people[0], name: 42 }], contacts: [{ verdict: 'accepted' }] }), { people: [], contacts: [] });
  assert.equal(recoverSession({ ...session, candidates: [{ ...session.candidates[0], status: 'accepted' }] })?.candidates[0].status, 'proposed');
});
test('checkpoint retention is bounded and has no access to canvas caches or figures', async () => {
  const repo = new MemoryConnectionRepository();
  for (let i = 0; i < KNOWLEDGE_LIMITS.sessions + 5; i++) { const session = fixture(`canvas-${i}`); await repo.checkpoint({ people: session.people, contacts: [] }, session); }
  assert.equal((await repo.listSessions('canvas-0')).length, 0); assert.equal((await repo.listSessions('canvas-34')).length, 1);
});
test('fresh-start logically retires legacy paths while permanently preserving path/woven membership and general caches', () => {
  const storage = new CanvasCache(); storage.setItem('chrono_path_Alpha_Beta', JSON.stringify({ version: 1, ids: [A.id, B.id], evidence: ['old'], createdAt: 1 }));
  saveWovenFigureIds(storage, ['retained']); storage.setItem('chrono_rel_untouched', 'unchanged');
  assert.equal(migrateLegacyConnectionMembers(storage), true); assert.equal(migrateLegacyConnectionMembers(storage), true);
  const reloaded = new CanvasCache(storage.snapshot()); assert.equal(listConnectionPaths(reloaded, [A, B]).length, 0);
  assert.deepEqual(connectionFigureIds(reloaded), new Set([A.id, B.id, 'retained'])); assert.equal(reloaded.getItem('chrono_rel_untouched'), 'unchanged');
  assert.equal(reloaded.getItem('chrono_path_Alpha_Beta'), storage.getItem('chrono_path_Alpha_Beta'));
});
test('failed migration writes leave legacy protection intact, including Follow a Figure pruning', () => {
  const storage = new MemoryStorage(), figures = [A, B];
  const context = { mode: 'figure' as const, query: A.name, inferredStartYear: 1500, inferredEndYear: 1760, themeDescription: A.name, activeCategories: ['ALL' as const] };
  storage.setItem('chrono_path_old', JSON.stringify({ version: 1, ids: [A.id, B.id], evidence: ['old'], createdAt: 1 }));
  saveRelationshipMap(A, figures, [], storage);
  storage.setItem(`chrono_assessment_${A.id}_${B.id}`, JSON.stringify({ scope: JSON.stringify(figures.map(({ id, name, birthYear, deathYear, occupation, category }) => [id, name, birthYear, deathYear, occupation, category])),
    narrativeVersion: 1, explanation: { isRelevant: false, evidence: '', summary: 'None.', sections: [{ title: 'Assessment', content: 'None.' }] } }));
  storage.setItem = () => { throw Error('Full'); }; assert.equal(migrateLegacyConnectionMembers(storage), false);
  assert.deepEqual(discardRejectedFollowFigureCandidates(figures, context, storage, A.id).map(p => p.id), [A.id, B.id]);
});

test('a late checkpoint from a cancelled run cannot overwrite a newer explicit search', async () => {
  const repo = new MemoryConnectionRepository(), session = fixture();
  await repo.checkpoint({ people: session.people, contacts: [] }, { ...session, runStartedAt: 200 });
  await repo.checkpoint({ people: session.people, contacts: [] }, { ...session, runStartedAt: 100, phase: 'Late cancellation' });
  assert.equal((await repo.loadSession(session.key))?.runStartedAt, 200);
});

test('request counters are whitelisted on recovery: valid ones are kept, old or malformed ones read as absent', async () => {
  const base = fixture(), fields = ['requests', 'assessBatches', 'discoverSources', 'pairAsks', 'validationRetries', 'total'] as const;
  const old = recoverSession(base)!; assert.equal(old.version, 2);
  for (const field of fields) assert.equal(field in old.diagnostics, false, `a session saved before instrumentation has no ${field}`);
  const requests = { seed: 1, direct: 0, assess: 2, discover: 3, identity: 0 }, pairAsks = { fresh: 7, focused: 1, contextChange: 2 };
  const valid = { requests, assessBatches: [1, 8], discoverSources: [1, 2, 4], pairAsks, validationRetries: 1,
    total: { segments: 2, requests, pairAsks, elapsedMs: 1234 }, authorization: 'secret' };
  const kept = recoverSession({ ...base, diagnostics: { ...base.diagnostics, ...valid } })!;
  for (const field of fields) assert.deepEqual(kept.diagnostics[field], valid[field], field);
  assert.equal(JSON.stringify(kept).includes('secret'), false);
  // Anything malformed is dropped on its own; the rest of the diagnostics and the session survive.
  const broken = recoverSession({ ...base, diagnostics: { ...base.diagnostics, requests: 'many', assessBatches: [1, -2], discoverSources: Array(300).fill(1), pairAsks: { fresh: 1 },
    validationRetries: 1.5, total: { segments: 1, requests: { seed: 1 }, pairAsks, elapsedMs: 0 } } })!;
  for (const field of fields) assert.equal(field in broken.diagnostics, false, `malformed ${field} is dropped`);
  assert.equal(broken.diagnostics.tasks, 1);
  assert.deepEqual(recoverSession({ ...base, diagnostics: { ...base.diagnostics, requests: { seed: 2, assess: -1, bogus: 4, discover: 'x' } } })!.diagnostics.requests, { seed: 2 });
  assert.equal('total' in recoverSession({ ...base, diagnostics: { ...base.diagnostics, total: { ...valid.total, elapsedMs: -1 } } })!.diagnostics, false);
  // Counters survive a checkpoint and reload, which is what lets a continued search keep adding to its total.
  const repo = new MemoryConnectionRepository(), session = { ...base, diagnostics: { ...base.diagnostics, ...valid } };
  await repo.checkpoint({ people: session.people, contacts: [] }, session);
  assert.deepEqual((await repo.loadSession(session.key))?.diagnostics.total, valid.total);
});

// A long search outgrows the saved-session limits. It used to be refused outright, so saving silently stopped and reopening showed an
// older copy (less time, fewer people). It is now cut down to fit, keeping the endpoints, the accepted network and the elapsed time.
const provenance = { provider: 'synthetic', model: 'synthetic', version: 2, assessedAt: 1 };
function bigSession(extraPeople: number, blocked: number): ConnectionSession {
  const people: ContactPerson[] = [];
  const named = (name: string) => identifyPerson(people, figurePerson(person(name, 1500, 1560)));
  const a = named('Endpoint A'), b = named('Endpoint B'), bridge = named('Bridge');
  const accepted = (from: ContactPerson, to: ContactPerson) => ({ from: from.id, to: to.id, claim: '', status: 'accepted' as const,
    assessment: { pair: [from.id, to.id] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const, evidence: 'They met in Paris.', provenance } });
  // Built directly: identifying thousands of people one by one is quadratic and has nothing to do with what is tested here.
  const crowd = Array.from({ length: extraPeople }, (_, i): ContactPerson => ({ ...a, id: `crowd-${i}`, name: `Crowd ${i}`, aliases: [], proposedAliases: [] }));
  people.push(...crowd);
  const candidates = [accepted(a, bridge), accepted(bridge, b),
    ...Array.from({ length: blocked }, (_, i) => ({ from: a.id, to: crowd[i % crowd.length].id, claim: `claim ${i}`, status: 'blocked' as const, blockedReason: 'No overlap' }))];
  return { version: 2, key: sessionKey('big', a.id, b.id), canvasId: 'big', endpoints: [a.id, b.id], people, candidates,
    rounds: [{ personId: a.id, round: 3, proposed: [], emptyRounds: 0, lastExpanded: 1 }], attempts: {}, segment: 20, status: 'paused', phase: 'Search budget reached',
    elapsedMs: 61 * 60_000, updatedAt: Date.now(), diagnostics: { tasks: 5, people: 5, pairs: 5 } };
}
test('a session larger than the limits is trimmed to fit instead of not being saved: time, endpoints and the accepted network survive', async () => {
  // More people than a session may hold, and more contacts than it may hold.
  for (const [extraPeople, blocked] of [[KNOWLEDGE_LIMITS.sessionPeople + 100, 50], [300, KNOWLEDGE_LIMITS.sessionPairs + 100]]) {
    const session = bigSession(extraPeople, blocked);
    assert.equal(recoverSession(session), null, 'the raw session is over a limit');
    const repo = new MemoryConnectionRepository();
    await repo.checkpoint({ people: session.people, contacts: [] }, session);
    const saved = (await repo.loadSession(session.key))!;
    assert.ok(saved, 'a checkpoint is saved');
    assert.equal(saved.elapsedMs, 61 * 60_000); assert.equal(saved.segment, 20);
    assert.deepEqual(saved.endpoints, session.endpoints);
    assert.deepEqual(saved.candidates.filter(c => c.status === 'accepted').length, 2);
    assert.ok(saved.people.length <= KNOWLEDGE_LIMITS.sessionPeople && saved.candidates.length <= KNOWLEDGE_LIMITS.sessionPairs);
    assert.ok(['Endpoint A', 'Endpoint B', 'Bridge'].every(name => saved.people.some(p => p.name === name)));
    // Nothing in the saved copy points at somebody who was left out.
    const ids = new Set(saved.people.map(p => p.id));
    assert.ok(saved.candidates.every(c => ids.has(c.from) && ids.has(c.to)));
  }
});
test('a session within the limits is saved exactly as it is, and the least useful contacts are the ones a trim drops first', () => {
  const small = bigSession(10, 5);
  assert.equal(fitSession(small), small);
  const trimmed = fitSession(bigSession(10, KNOWLEDGE_LIMITS.sessionPairs + 5));
  assert.equal(trimmed.candidates.length, KNOWLEDGE_LIMITS.sessionPairs);
  assert.equal(trimmed.candidates.filter(c => c.status === 'accepted').length, 2);
  // The accepted ones stay ahead of the blocked ones in the order they had.
  assert.deepEqual(trimmed.candidates.slice(0, 2).map(c => c.status), ['accepted', 'accepted']);
});

test('a running search reports when its latest progress could not be saved, but not when saving never worked', async () => {
  class Storage extends MemoryConnectionRepository {
    constructor(private works: boolean, private expected: boolean) { super(); }
    get persistent() { return this.expected; }
    async checkpoint(knowledge: Parameters<MemoryConnectionRepository['checkpoint']>[0], session: ConnectionSession) { await super.checkpoint(knowledge, session); return this.works; }
  }
  const run = async (repository: Storage) => (await findConnection({ service: fakeContacts([[A, M], [M, B]]).service, from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository })).session!;
  assert.equal((await run(new Storage(true, true))).saveIssue, undefined);
  assert.equal((await run(new Storage(false, true))).saveIssue, 'failed');
  assert.equal((await run(new Storage(false, false))).saveIssue, undefined, 'storage that was never there has its own message');
  // Whatever the flag says, it is a note for the screen and is not saved.
  const repository = new Storage(false, true), session = await run(repository);
  assert.equal('saveIssue' in (await repository.loadSession(session.key))!, false);
});
