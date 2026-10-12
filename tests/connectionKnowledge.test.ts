import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IndexedConnectionRepository, MemoryConnectionRepository, recoverKnowledge, recoverSession, KNOWLEDGE_LIMITS } from '../src/utils/connectionKnowledge';
import { figurePerson, identifyPerson, sessionKey, type ConnectionSession, type ContactPerson } from '../src/services/connectionGraph';
import { migrateLegacyConnectionMembers, connectionFigureIds, listConnectionPaths, saveWovenFigureIds } from '../src/utils/connectionPaths';
import { CanvasCache } from '../src/utils/canvasHistory';
import { discardRejectedFollowFigureCandidates } from '../src/services/followFigureConnections';
import { saveRelationshipMap } from '../src/utils/relationshipCache';
import { MemoryStorage } from './helpers';
import { A, B } from './connectionFixtures';

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
