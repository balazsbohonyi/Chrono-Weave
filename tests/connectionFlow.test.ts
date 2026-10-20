import { saveTestConnectionPath as saveConnectionPath } from './connectionFixtures';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideConnectionStart, finishedExploration, reconcileSession, runConnectionSearch, settleConnection, savedConnectionView, type CanvasState, type ConnectionFlowEffects } from '../src/services/connectionFlow';
import { figurePerson, identifyPerson, sessionKey, type ConnectionSession, type ContactAssessment, type ContactPerson } from '../src/services/connectionGraph';
import type { WikidataResolver } from '../src/services/wikidataService';
import { findConnection } from '../src/services/connectionPath';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { connectionPathKey, listConnectionPaths, readConnectionPath,  wovenFigureIds } from '../src/utils/connectionPaths';
import { MemoryStorage } from './helpers';
import { A, B, M, N, TWIN_RIGHT, TWIN_WRONG, assertRequestAccounting, fakeContacts, person, twinWikidata } from './connectionFixtures';
import type { IAIService } from '../src/types';

// Every session handed to the exploration effect (live snapshots and restored checkpoints) must have consistent request
// accounting. runConnectionSearch passes that effect in as onSnapshot, where a throw would become an error status, so the
// failure is kept and thrown by verify() once the search is over.
function recorder(current = true) {
  let failure: unknown;
  const log: string[] = [], canvas: CanvasState = { figures: [A, B], config: { start: 1400, end: 1800, layoutMode: 'timeline', layoutVersion: 3, layoutSelection: 'manual' } };
  const effects: ConnectionFlowEffects = { isCurrent: () => current, progress: () => {}, canvas: () => canvas,
    applyWoven: woven => { log.push('weave'); canvas.figures = woven.figures; canvas.config = woven.config; }, pathsChanged: () => log.push('paths'), show: () => log.push('show'),
    exploration: session => { try { assertRequestAccounting(session.diagnostics); } catch (error) { failure ??= error; } log.push(session.status); }, failPicking: () => log.push('picker'), notify: (_message, type) => log.push(type) };
  return { effects, log, canvas, verify: () => { if (failure) throw failure; } };
}
const search = async () => {
  const result = await findConnection({ service: fakeContacts([[A, M], [M, N], [N, B]]).service, from: A, to: B, figures: [A, B], signal: new AbortController().signal });
  assertRequestAccounting(result.session!.diagnostics); return result;
};
test('settlement validates accepted contacts, uses the current canvas and persists replay evidence', async () => {
  const result = await search(), storage = new MemoryStorage(), r = recorder();
  // Another operation has already added M under a different canvas id while the model ran.
  r.canvas.figures.push({ ...M, id: 'canvas-middle' });
  settleConnection({ result, request: { from: A, to: B }, storage, effects: r.effects });
  assert.deepEqual(r.log, ['weave', 'paths', 'show', 'success']);
  assert.equal(r.canvas.figures.filter(p => p.name === M.name).length, 1);
  const saved = readConnectionPath(storage, r.canvas.figures, A.id, B.id)!;
  assert.ok(saved); assert.equal(saved.contacts?.length, 3); assert.equal(wovenFigureIds(storage).size, 1);
  // The person woven in is a guest of this connection; the endpoints and the person already on the canvas are not.
  const woven = [...wovenFigureIds(storage)][0];
  assert.deepEqual(r.canvas.config.guests, { [woven]: [connectionPathKey(A.id, B.id)] });
  assert.equal(savedConnectionView(saved).links[0].contact?.verdict, 'accepted');
});
test('stale, incomplete, structurally invalid and nonconnected results never weave or save', async () => {
  const result = await search(); assert.equal(result.status, 'connected');
  const storage = new MemoryStorage(), stale = recorder(false);
  settleConnection({ result, request: { from: A, to: B }, storage, effects: stale.effects }); assert.deepEqual(stale.log, []);
  if (result.status !== 'connected') throw Error('expected connection');
  const broken = recorder(); settleConnection({ result: { ...result, links: [] }, request: { from: A, to: B }, storage, effects: broken.effects });
  assert.deepEqual(broken.log, ['error']); assert.equal(storage.length, 0);
  const paused = recorder(); settleConnection({ result: { status: 'paused', session: { ...result.session!, status: 'paused' } }, request: { from: A, to: B }, storage, effects: paused.effects });
  assert.deepEqual(paused.log, ['paused']); assert.equal(storage.length, 0);
});
test('saved versioned paths replay in either orientation without model work', () => {
  const storage = new MemoryStorage(); saveConnectionPath(storage, [A, M, N, B], ['a', 'b', 'c']);
  const decision = decideConnectionStart(B, { name: A.name }, [A, M, N, B], storage); assert.equal(decision.kind, 'replay');
  if (decision.kind === 'replay') assert.deepEqual(decision.saved.figures.map(p => p.name), [B.name, N.name, M.name, A.name]);
});
test('matching unfinished checkpoint is offered without automatically searching', async () => {
  const repository = new MemoryConnectionRepository(), fake = fakeContacts([[A, M], [M, N], [N, B]]);
  const first = await findConnection({ service: fake.service, from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository, canvasId: 'one', limits: { tasks: 2 } });
  assertRequestAccounting(first.session!.diagnostics);
  const before = fake.calls.seeds + fake.calls.discovery.length + fake.calls.assessments.length, r = recorder();
  await runConnectionSearch({ service: fake.service as IAIService, from: B, target: { figure: A }, figures: [A, B], storage: new MemoryStorage(), signal: new AbortController().signal, repository, canvasId: 'one', effects: r.effects });
  r.verify(); assert.equal(fake.calls.seeds + fake.calls.discovery.length + fake.calls.assessments.length, before); assert.deepEqual(r.log, ['paused']);
});
test('cancelled or stale search has no canvas side effects or error toast', async () => {
  const controller = new AbortController(), fake = fakeContacts([[A, M]]), r = recorder();
  r.effects.isCurrent = () => !controller.signal.aborted;
  fake.service.discoverPersonalContacts = async () => { controller.abort(); return []; };
  const storage = new MemoryStorage();
  await runConnectionSearch({ service: fake.service as IAIService, from: A, target: { figure: B }, figures: [A, B], storage, signal: controller.signal, effects: r.effects });
  r.verify();
  assert.ok(!r.log.includes('weave') && !r.log.includes('error')); assert.equal(listConnectionPaths(storage, r.canvas.figures).length, 0);
});
test('events and invalid identities are refused, distant real people remain eligible', () => {
  const storage = new MemoryStorage(); assert.equal(decideConnectionStart(A, { figure: { ...B, category: 'EVENTS' } }, [A, B], storage).kind, 'refuse');
  assert.equal(decideConnectionStart(A, { figure: person('Ancient', -1000, -900) }, [A, B], storage).kind, 'search');
});

// A connection that was made can be reopened as an exploration: the saved search when the store still has it, otherwise one rebuilt from the saved path.
async function madeConnection() {
  const repository = new MemoryConnectionRepository(), storage = new MemoryStorage(), r = recorder();
  const result = await findConnection({ service: fakeContacts([[A, M], [M, N], [N, B]]).service, from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository, canvasId: 'one' });
  settleConnection({ result, request: { from: A, to: B }, storage, effects: r.effects });
  return { repository, storage, figures: r.canvas.figures };
}
test('a finished connection reopens as its saved exploration, with the chain it was made of lit', async () => {
  const { repository, storage, figures } = await madeConnection();
  const entry = readConnectionPath(storage, figures, A.id, B.id)!;
  const opened = (await finishedExploration({ repository, canvasId: 'one', entry }))!;
  assert.ok(opened);
  assert.equal(opened.session.status, 'connected');
  assert.deepEqual(opened.session.endpoints, [opened.chain[0], opened.chain[3]]);
  assert.equal(opened.chain.length, 4);
  const names = opened.chain.map(id => opened.session.people.find(p => p.id === id)!.name);
  assert.deepEqual(names, [A.name, M.name, N.name, B.name]);
  assert.equal(opened.session.candidates.filter(c => c.status === 'accepted').length, 3);
  // The other way round: the same exploration, its chain and endpoints turned the same way.
  const reversed = (await finishedExploration({ repository, canvasId: 'one', entry: readConnectionPath(storage, figures, B.id, A.id)! }))!;
  assert.deepEqual(reversed.chain, [...opened.chain].reverse());
  assert.deepEqual(reversed.session.endpoints, [opened.chain[3], opened.chain[0]]);
});
test('when the saved search is gone, or no longer holds the chain, the exploration is rebuilt from the saved connection', async () => {
  const { storage, figures } = await madeConnection();
  const entry = readConnectionPath(storage, figures, A.id, B.id)!;
  const rebuilt = (await finishedExploration({ repository: new MemoryConnectionRepository(), canvasId: 'one', entry }))!;
  assert.ok(rebuilt);
  assert.equal(rebuilt.session.status, 'connected'); assert.equal(rebuilt.session.people.length, 4);
  assert.deepEqual(rebuilt.session.candidates.map(c => c.status), ['accepted', 'accepted', 'accepted']);
  assert.ok(rebuilt.session.candidates.every(c => c.assessment?.verdict === 'accepted'));
  assert.deepEqual(rebuilt.chain, entry.identityIds);
  // A later search of the same pair that holds none of the links does not pass for the connection.
  const other = new MemoryConnectionRepository(), stray = { ...rebuilt.session, candidates: [], status: 'paused' as const };
  await other.checkpoint({ people: stray.people, contacts: [] }, stray);
  const fallback = (await finishedExploration({ repository: other, canvasId: 'one', entry }))!;
  assert.equal(fallback.session.status, 'connected'); assert.equal(fallback.session.candidates.length, 3);
  // Without the identities a connection was saved with there is nothing to open.
  assert.equal(await finishedExploration({ repository: other, canvasId: 'one', entry: { ...entry, identityIds: undefined } }), null);
});

// A made connection whose middle person the model recorded twice (two forms of the name, two birth years): the shared knowledge and the saved
// search each hold both records, and one of them carries the chain. Wikidata knows them as one person.
const zed = person('Zed', 1540, 1620);
async function savedWithTwins(saveSession = true) {
  const repository = new MemoryConnectionRepository(), people: ContactPerson[] = [];
  const [a, z, wrong, right, fermi] = [A, zed, TWIN_WRONG, TWIN_RIGHT, person('Enrico Fermi', 1520, 1600)].map(p => identifyPerson(people, figurePerson(p)));
  const accepted = (x: ContactPerson, y: ContactPerson): ContactAssessment => ({ pair: [x.id, y.id], verdict: 'accepted', interactionType: 'correspondence',
    evidence: `${x.name} and ${y.name} corresponded.`, provenance: { provider: 'fake', model: 'fake', version: 2, assessedAt: 1 } });
  const contacts = [accepted(a, wrong), accepted(wrong, z), accepted(right, fermi)];
  const session: ConnectionSession = { version: 2, key: sessionKey('one', a.id, z.id), canvasId: 'one', endpoints: [a.id, z.id], people: structuredClone([a, z, wrong, right, fermi]),
    candidates: contacts.map(contact => ({ from: contact.pair[0], to: contact.pair[1], claim: '', status: 'accepted' as const, assessment: structuredClone(contact) })),
    rounds: [], attempts: {}, segment: 2, status: 'connected', phase: 'Accepted chain found', elapsedMs: 5, updatedAt: Date.now(), diagnostics: { tasks: 0, people: 0, pairs: 0 } };
  if (saveSession) await repository.checkpoint({ people, contacts }, session);
  else await repository.checkpoint({ people, contacts }, { ...session, key: 'someone-else', endpoints: [a.id, fermi.id] } as ConnectionSession);
  return { repository, session, ids: { a: a.id, z: z.id, wrong: wrong.id, right: right.id, fermi: fermi.id } };
}

test('reopening a saved exploration asks Wikidata about its people, merges the duplicate, follows the chain onto the survivor and saves it all', async () => {
  const { repository, session, ids } = await savedWithTwins(), wikidata = twinWikidata();
  const chain = [ids.a, ids.wrong, ids.z];
  const reconciled = await reconcileSession({ repository, wikidata: wikidata.resolver, session, chain });
  assert.equal(reconciled.changed, true);
  const people = reconciled.session.people.filter(p => !p.canonicalId);
  assert.deepEqual(people.filter(p => p.qid === 'Q100').map(p => p.id), [ids.right], 'the record whose years were right survives');
  assert.equal(people.length, 4, 'one Twin, not two');
  assert.deepEqual(reconciled.chain, [ids.a, ids.right, ids.z], 'the chain runs through the survivor');
  assert.ok(reconciled.session.candidates.every(c => c.from !== c.to && [c.from, c.to].every(id => id !== ids.wrong)));
  assert.equal(reconciled.session.candidates.filter(c => c.status === 'accepted').length, 3);
  assert.equal(session.people.length, 5, 'the session that was passed in is left as it was');
  // What was learnt is saved, under the status the saved search has.
  const stored = (await repository.loadSession(session.key))!, knowledge = await repository.loadKnowledge();
  assert.equal(stored.status, 'connected');
  assert.equal(stored.people.filter(p => p.qid === 'Q100').length, 1);
  assert.equal(knowledge.people.filter(p => !p.canonicalId && p.qid === 'Q100').length, 1);
  // Nobody is asked twice.
  const again = twinWikidata(), second = await reconcileSession({ repository, wikidata: again.resolver, session: stored, chain: reconciled.chain });
  assert.deepEqual([second.changed, again.asked], [false, []]);
});

test('an exploration that cannot be checked is shown as it was', async () => {
  const { repository, session } = await savedWithTwins();
  for (const resolve of [async () => new Map(), async () => { throw new Error('offline'); }] as WikidataResolver['resolve'][]) {
    const result = await reconcileSession({ repository, wikidata: { resolve }, session, chain: ['x'] });
    assert.deepEqual([result.changed, result.session === session, result.chain], [false, true, ['x']]);
  }
  assert.equal((await repository.loadKnowledge()).people.some(p => p.qid), false, 'nothing was learnt, nothing saved');
});

test('an exploration rebuilt from a saved connection (never saved as a search) is corrected for display, and saves nothing', async () => {
  const { repository, session } = await savedWithTwins(false);
  const result = await reconcileSession({ repository, wikidata: twinWikidata().resolver, session });
  assert.equal(result.changed, true);
  assert.equal(result.session.people.filter(p => p.qid === 'Q100').length, 1);
  assert.equal(await repository.loadSession(session.key), null);
  assert.equal((await repository.loadKnowledge()).people.some(p => p.qid), false);
});

test('a made connection reopens as the whole exploration every time, also after one of its people was merged into another record', async () => {
  const { repository, session, ids } = await savedWithTwins();
  const [first, second] = session.candidates.slice(0, 2).map(candidate => candidate.assessment!);
  const entry = { key: 'k', figures: [], evidence: [first.evidence, second.evidence], createdAt: 1, contacts: [first, second], identityIds: [ids.a, ids.wrong, ids.z],
    people: session.people.filter(p => [ids.a, ids.wrong, ids.z].includes(p.id)) } as unknown as Parameters<typeof finishedExploration>[0]['entry'];
  const opened = (await finishedExploration({ repository, canvasId: 'one', entry }))!;
  assert.deepEqual([opened.chain, opened.session.people.length], [[ids.a, ids.wrong, ids.z], 5]);
  await reconcileSession({ repository, wikidata: twinWikidata().resolver, session: opened.session, chain: opened.chain });
  const again = (await finishedExploration({ repository, canvasId: 'one', entry }))!;
  assert.deepEqual(again.chain, [ids.a, ids.right, ids.z], 'the chain runs through the survivor');
  assert.equal(again.session.people.length, 4, 'the saved exploration, not a small one rebuilt from the chain');
  assert.equal(again.session.status, 'connected');
});
