import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConnection, classifyConnectionTarget, checkConnectionFeasibility, resolveConnectionTarget, type ConnectionSearchOptions } from '../src/services/connectionPath';
import type { ConnectionSession } from '../src/services/connectionGraph';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { acceptedDistances, ambiguousBridge, duplicateKeeper, figurePerson, identifyPerson, resolvableDuplicates, routeDistances, shortestContactPath, type ContactAssessment, type ContactPerson } from '../src/services/connectionGraph';
import type { HistoricalFigure, IAIService } from '../src/types';
import { MemoryStorage } from './helpers';
import { pairKey } from '../src/services/pathService';
import { waitToRetry } from '../src/services/utils';

import { person, fakeContacts, ambiguousBridgeRepository, A, B, M, N, BRIDGE, BRIDGE_TWIN, CLEAN_BRIDGE, proposal, assertRequestAccounting } from './connectionFixtures';
// Every snapshot and every finished segment must keep the request accounting consistent. A failure inside
// onSnapshot would be swallowed as a transport error, so it is kept and thrown once the search is over.
const run = async (overrides: Partial<ConnectionSearchOptions> & Pick<ConnectionSearchOptions, 'service'>) => {
  let failure: unknown;
  const result = await findConnection({ from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', ...overrides,
    onSnapshot: session => { try { assertRequestAccounting(session.diagnostics); } catch (error) { failure ??= error; } overrides.onSnapshot?.(session); } });
  if (failure) throw failure;
  if (result.session) assertRequestAccounting(result.session.diagnostics);
  return result;
};

test('null seed falls through to both frontiers and discovers an off-canvas cross-generation route', async () => {
  const { service, calls } = fakeContacts([[A, M], [M, N], [N, B]]);
  const result = await run({ service }); assert.equal(result.status, 'connected');
  if (result.status !== 'connected') throw Error('expected connection');
  assert.deepEqual(result.chain.map(p => p.name), [A.name, M.name, N.name, B.name]);
  assert.equal(result.newFigures.length, 2); assert.ok(calls.discovery.includes(A.name) && calls.discovery.includes(B.name));
  assert.equal(calls.seeds, 1); assert.ok(result.links.every(l => l.contact?.verdict === 'accepted'));
});
test('lifespan overlap alone never admits a contact; general and legacy negatives never veto new tasks', async () => {
  const to = person('Contemporary'); const { service } = fakeContacts([]); const storage = new MemoryStorage();
  storage.setItem('chrono_assessment_Alpha_Contemporary', JSON.stringify({ isRelevant: false }));
  assert.notEqual((await run({ service, to, storage })).status, 'connected');
  assert.equal((await run({ service: fakeContacts([[A, to]]).service, to, storage })).status, 'connected');
  assert.equal(storage.length, 1, 'new contact search never touches legacy/general caches');
});
test('accepted pieces survive across canvases and models, and graph lookup precedes model tasks', async () => {
  const repo = new MemoryConnectionRepository(); const { service } = fakeContacts([[A, M], [M, N], [N, B]]);
  assert.equal((await run({ service, repository: repo, provenance: { provider: 'old', model: 'old' } })).status, 'connected');
  const second = fakeContacts([]);
  const result = await run({ service: second.service, repository: repo, canvasId: 'two', provenance: { provider: 'new', model: 'new' }, from: B, to: A });
  assert.equal(result.status, 'connected'); assert.equal(second.calls.seeds + second.calls.assessments.length + second.calls.discovery.length, 0);
  if (result.status === 'connected') assert.deepEqual(result.chain.map(p => p.name), [B.name, N.name, M.name, A.name]);
});
test('task budgets pause; reverse-oriented explicit continuation keeps queued work and seed deduplication', async () => {
  const repo = new MemoryConnectionRepository(); const { service, calls } = fakeContacts([[A, M], [M, N], [N, B]]);
  const first = await run({ service, repository: repo, limits: { tasks: 2 } }); assert.equal(first.status, 'paused');
  const saved = await repo.loadSession(first.session!.key); assert.ok(saved);
  const second = await run({ service, repository: repo, session: saved!, from: B, to: A }); assert.equal(second.status, 'connected');
  assert.equal(calls.seeds, 1); assert.equal(second.session!.endpoints[0], first.session!.endpoints[1]);
});
test('later rounds exclude pairs, keeping known people and opposite-frontier bridges eligible', async () => {
  let returnedLate = false;
  const { service } = fakeContacts([[A, M], [M, N], [N, B]], async request => request.sources.flatMap(s => {
    if (s.person.name === A.name && s.round >= 2) { returnedLate = true; return [{ sourceId: s.person.id, person: proposal(M), claim: 'Correspondence' }]; }
    if (s.person.name === B.name) return [{ sourceId: s.person.id, person: proposal(N), claim: 'Correspondence' }];
    if (s.person.name === M.name) { assert.ok(request.references.some(p => p.name === N.name)); return [{ sourceId: s.person.id, person: proposal(N), claim: 'Correspondence' }]; }
    return [];
  }));
  assert.equal((await run({ service })).status, 'connected'); assert.ok(returnedLate);
});
test('chronological detours are allowed and unsupported seed links do not lock the solver to one route', async () => {
  const detour = person('Detour', 1490, 1555), bridge = person('Bridge', 1540, 1640);
  const { service } = fakeContacts([[A, detour], [detour, bridge], [bridge, N], [N, B]]);
  service.fetchConnectionPath = async () => ({ nodes: [{ id: A.id }, proposal(M), proposal(N), { id: B.id }], links: [{ claim: 'A claim' }, { claim: 'A claim' }, { claim: 'A claim' }] });
  const result = await run({ service }); assert.equal(result.status, 'connected');
  if (result.status === 'connected') assert.ok(result.chain.some(p => p.name === detour.name));
});
test('one focused reassessment per promising uncertainty context; unresolved never becomes a successful edge', async () => {
  const to = person('Contemporary'); const fake = fakeContacts([]); let assessments = 0;
  fake.service.assessPersonalContacts = async pairs => { assessments++; return pairs.map(p => ({ pair: [p.first.id, p.second.id], verdict: 'unresolved', evidence: '', uncertainty: 'Conflicting account.' })); };
  const first = await run({ service: fake.service, to, limits: { tasks: 4 } }); assert.notEqual(first.status, 'connected'); assert.equal(assessments, 2);
  await run({ service: fake.service, to, session: first.session! }); assert.equal(assessments, 2);
});
test('deadline covers ignored transports and cancellation discards late results', async () => {
  let complete: (value: any) => void = () => {}; const { service } = fakeContacts([]);
  service.fetchConnectionPath = () => new Promise(resolve => { complete = resolve; });
  const result = await run({ service, limits: { wallMs: 10 } }); assert.equal(result.status, 'paused');
  complete({ nodes: [{ id: A.id }, proposal(M), { id: B.id }], links: [] });
  assert.equal(result.session!.people.length, 2); assert.equal(result.session!.diagnostics.stopReason, 'time-budget');
});
test('cancelling after a completed accepted batch preserves that contact', async () => {
  const controller = new AbortController(), repo = new MemoryConnectionRepository(); const { service } = fakeContacts([[A, M]]);
  const result = await run({ service, repository: repo, signal: controller.signal, onSnapshot: session => { if (session.candidates.some(c => c.status === 'accepted')) controller.abort(); } });
  assert.equal(result.status, 'paused'); assert.equal((await repo.loadKnowledge()).contacts.filter(c => c.verdict === 'accepted').length, 1);
});
test('transport failure saves useful frontier state and exposes a recoverable error', async () => {
  const fake = fakeContacts([]); fake.service.discoverPersonalContacts = async () => { throw new Error('Authentication failed'); };
  const result = await run({ service: fake.service }); assert.equal(result.status, 'error'); assert.match(result.session!.error!, /access key and account permissions/);
});
test('identity requires exact normalized names or explicit aliases and compatible dates', () => {
  const people: ContactPerson[] = [];
  const first = identifyPerson(people, { ...figurePerson(person('Niccolò Machiavelli')), aliases: ['Niccolo Machiavelli'] });
  assert.equal(identifyPerson(people, figurePerson(person('Niccolo  Machiavelli'))).id, first.id);
  assert.notEqual(identifyPerson(people, figurePerson(person('Machiavelli'))).id, first.id);
  assert.notEqual(identifyPerson(people, figurePerson(person('Niccolo Machiavelli', 1501))).id, first.id);
  const alice = identifyPerson(people, { ...figurePerson(person('Alice Brown')), aliases: ['Brown', 'Bob Brown'] });
  const bob = identifyPerson(people, { ...figurePerson(person('Bob Brown')), aliases: ['Brown'] });
  assert.notEqual(alice.id, bob.id, 'unverified discovery aliases and shared surnames cannot substitute a different person');
});
test('21-link boundary, cycles and shortest accepted route are enforced', () => {
  const people: ContactPerson[] = []; for (let i = 0; i < 23; i++) identifyPerson(people, figurePerson(person(`Person ${i}`, 1500 + i, 1600 + i)));
  const contacts = people.slice(1).map((p, i) => ({ pair: [people[i].id, p.id] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const,
    evidence: 'They met at a research conference.', provenance: { provider: 'fake', model: 'fake', version: 2, assessedAt: Date.now() } }));
  assert.equal(shortestContactPath(people[0].id, people[21].id, people, contacts)?.length, 22);
  assert.equal(shortestContactPath(people[0].id, people[22].id, people, contacts), null);
  contacts.push({ ...contacts[0], pair: [people[0].id, people[21].id] }); assert.equal(shortestContactPath(people[0].id, people[21].id, people, contacts)?.length, 2);
});
test('historical gaps are eligible; events, self-links, invalid dates and conflicting identities are blocked', () => {
  assert.ok(checkConnectionFeasibility(person('Ancient', -1000, -920), B).feasible);
  assert.deepEqual(classifyConnectionTarget(A, person('Distant', 1900, 2000)), { ok: true });
  assert.equal(classifyConnectionTarget(A, { ...B, category: 'EVENTS' }).ok, false); assert.equal(classifyConnectionTarget(A, A).ok, false);
  assert.equal(classifyConnectionTarget(A, { ...B, birthYear: 1800 }).ok, false);
  assert.equal(classifyConnectionTarget(A, { ...A, id: 'different', birthYear: 1499 }).ok, false);
});
test('typed resolution never substitutes an incompatible canvas identity', async () => {
  const canvas = person('Other', 1510, 1570), service = { resolveFigure: async () => figurePerson(person('Other', 1520, 1580)) };
  const result = await resolveConnectionTarget(service, 'Alias', A, [A, canvas], new AbortController().signal);
  assert.ok('figure' in result); if ('figure' in result) assert.equal(result.figure.birthYear, 1520);
});

test('promising cross-frontier aliases need matching canonical resolutions and persist across reload', async () => {
  const oldName = person('Charles Contact', 1600, 1730), alias = person('Charles C. Contact', 1600, 1730);
  const fake = fakeContacts([[A, M], [M, oldName], [alias, B]]);
  fake.service.resolveFigure = async name => name.includes('Charles') ? figurePerson(oldName) : null;
  const repo = new MemoryConnectionRepository();
  const result = await run({ service: fake.service, repository: repo }); assert.equal(result.status, 'connected');
  const knowledge = await repo.loadKnowledge();
  assert.equal(identifyPerson(knowledge.people, figurePerson(alias)).id, identifyPerson(knowledge.people, figurePerson(oldName)).id);
  const reused = await run({ service: fakeContacts([]).service, repository: repo, canvasId: 'another' }); assert.equal(reused.status, 'connected');
});

test('cancelled focused reassessment is returned to its queue on explicit resume', async () => {
  const to = person('Contemporary'), repo = new MemoryConnectionRepository(), controller = new AbortController();
  const fake = fakeContacts([]); let focused = 0;
  fake.service.assessPersonalContacts = async pairs => {
    if (pairs.some(p => p.focused)) { focused++; controller.abort(); return new Promise(() => {}); }
    return pairs.map(p => ({ pair: [p.first.id,p.second.id], verdict: 'unresolved', evidence: '', uncertainty: 'A promising uncertain encounter.' }));
  };
  const first = await run({ service: fake.service, to, repository: repo, signal: controller.signal });
  assert.equal(first.status, 'paused'); assert.equal(focused, 1); assert.equal(first.session!.candidates[0].pendingFocused, true);
  const saved = await repo.loadSession(first.session!.key); assert.ok(saved);
  fake.service.assessPersonalContacts = async pairs => pairs.map(p => {
    if (p.focused) focused++;
    return { pair: [p.first.id,p.second.id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met to discuss a research project.' };
  });
  const second = await run({ service: fake.service, to, repository: repo, session: saved! });
  assert.equal(second.status, 'connected'); assert.equal(focused, 2, 'the interrupted focused task ran once in the fresh segment');
});

test('request counters name each model request by kind, with batch sizes and a reason for every pair', async () => {
  const chain = await run({ service: fakeContacts([[A, M], [M, N], [N, B]]).service });
  const d = chain.session!.diagnostics;
  // One discovery request serves both ends (two sources), then the first round's two pairs go out in one batch.
  assert.deepEqual(d.requests, { seed: 1, direct: 0, assess: 2, discover: 2, identity: 0 }); assert.equal(d.tasks, 5);
  assert.deepEqual(d.assessBatches, [2, 1]); assert.deepEqual(d.discoverSources, [2, 4]);
  assert.deepEqual(d.pairAsks, { fresh: 3, focused: 0, contextChange: 0 }); assert.equal(d.validationRetries, 0);
  assert.equal(d.total!.segments, 1); assert.deepEqual(d.total!.requests, d.requests); assert.deepEqual(d.total!.pairAsks, d.pairAsks);
  // The endpoint check is its own kind, and carries the only pair when the endpoints could have met.
  const contemporary = person('Contemporary'), direct = await run({ service: fakeContacts([[A, contemporary]]).service, to: contemporary, figures: [A, contemporary] });
  assert.deepEqual(direct.session!.diagnostics.requests, { seed: 0, direct: 1, assess: 0, discover: 0, identity: 0 });
  assert.deepEqual(direct.session!.diagnostics.assessBatches, [1]);
  // Identity checks are two requests each.
  const oldName = person('Charles Contact', 1600, 1730), alias = person('Charles C. Contact', 1600, 1730), fake = fakeContacts([[A, M], [M, oldName], [alias, B]]);
  fake.service.resolveFigure = async name => name.includes('Charles') ? figurePerson(oldName) : null;
  assert.equal((await run({ service: fake.service })).session!.diagnostics.requests!.identity, 2);
});
test('a pair is counted as focused when re-asked on its own segment, never as a context change', async () => {
  const to = person('Contemporary'), fake = fakeContacts([]);
  fake.service.assessPersonalContacts = async pairs => pairs.map(p => ({ pair: [p.first.id, p.second.id], verdict: 'unresolved', evidence: '', uncertainty: 'Conflicting account.' }));
  const first = await run({ service: fake.service, to, limits: { tasks: 4 } }), d = first.session!.diagnostics;
  assert.deepEqual(d.requests, { seed: 1, direct: 1, assess: 1, discover: 1, identity: 0 });
  assert.deepEqual(d.assessBatches, [1, 1]); assert.deepEqual(d.pairAsks, { fresh: 1, focused: 1, contextChange: 0 });
});
test('a changed attempt context re-asks an earlier pair and counts it as a context change inside the direct check', async () => {
  const to = person('Contemporary'), repo = new MemoryConnectionRepository(), fake = fakeContacts([]);
  fake.service.assessPersonalContacts = async pairs => pairs.map(p => ({ pair: [p.first.id, p.second.id], verdict: 'unresolved', evidence: '', uncertainty: 'Conflicting account.' }));
  const first = await run({ service: fake.service, to, repository: repo, provenance: { provider: 'test', model: 'first' }, limits: { tasks: 1 } });
  assert.equal(first.status, 'paused'); assert.deepEqual(first.session!.diagnostics.pairAsks, { fresh: 1, focused: 0, contextChange: 0 });
  const saved = await repo.loadSession(first.session!.key); assert.ok(saved);
  // Same model and names: the stored attempt still applies, so the pair is not asked again.
  const same = await run({ service: fake.service, to, repository: repo, provenance: { provider: 'test', model: 'first' }, session: saved! });
  assert.equal(same.session!.diagnostics.requests!.direct, 0); assert.equal(same.session!.diagnostics.pairAsks!.contextChange, 0);
  // Another model changes the context: the same pair is asked again in an ordinary batch, not as a focused re-ask.
  const changed = await run({ service: fake.service, to, repository: repo, provenance: { provider: 'test', model: 'second' }, session: saved! });
  const d = changed.session!.diagnostics;
  assert.equal(d.requests!.direct, 1); assert.equal(d.assessBatches![0], 1); assert.equal(d.pairAsks!.contextChange, 1);
  assert.equal(d.pairAsks!.fresh, 0, 'the pair was asked before, so it is not fresh');
});
test('segment counters restart on every continuation while the session total accumulates, and old sessions count from zero', async () => {
  const repo = new MemoryConnectionRepository(), { service } = fakeContacts([[A, M], [M, N], [N, B]]);
  const first = await run({ service, repository: repo, limits: { tasks: 2 } }); assert.equal(first.status, 'paused');
  const saved = await repo.loadSession(first.session!.key); assert.ok(saved);
  assert.deepEqual(saved!.diagnostics.total!.requests, first.session!.diagnostics.total!.requests, 'counters survive storage');
  const second = await run({ service, repository: repo, session: saved! }), a = first.session!.diagnostics, b = second.session!.diagnostics;
  assert.equal(second.status, 'connected'); assert.equal(b.total!.segments, 2);
  assert.equal(b.requests!.discover! + a.requests!.discover!, b.total!.requests.discover); assert.equal(b.tasks + a.tasks, Object.values(b.total!.requests).reduce((x, y) => x + y, 0));
  assert.notDeepEqual(b.assessBatches, a.assessBatches, 'per-segment arrays belong to the last segment only');
  assert.ok(b.total!.elapsedMs >= a.total!.elapsedMs);
  // A session saved before instrumentation has none of the fields; the new segment starts counting without it.
  const legacy = structuredClone(saved!); legacy.diagnostics = { tasks: 2, people: 0, pairs: 0 };
  const continued = await run({ service, repository: new MemoryConnectionRepository(), session: legacy });
  assert.equal(continued.session!.diagnostics.total!.segments, 1); assert.equal(continued.session!.version, 2);
});

// ---------------------------------------------------------------------------- people recorded twice with conflicting dates
test('a chain through a person with conflicting date records is not a route: both ends keep expanding until a clean bridge is found', async () => {
  // The twin record is in the shared store only (no contact, so no session holds it): the rule must be read from the store, not the session.
  const fake = fakeContacts([[M, CLEAN_BRIDGE], [CLEAN_BRIDGE, N]]);
  const result = await run({ service: fake.service, repository: await ambiguousBridgeRepository() });
  assert.equal(result.status, 'connected');
  if (result.status !== 'connected') throw Error('expected connection');
  assert.deepEqual(result.chain.map(p => p.name), [A.name, M.name, CLEAN_BRIDGE.name, N.name, B.name], 'the clean bridge, never the ambiguous one');
  assert.ok(result.session!.diagnostics.requests!.discover! >= 1, 'before the fix both ends looked reachable from each other and nothing was expanded');
  assert.ok(fake.calls.discovery.includes(M.name) && fake.calls.discovery.includes(N.name), 'the people on each side of the ambiguous bridge are expanded');
  assert.ok(!fake.calls.discovery.includes(BRIDGE.name), 'a person no route may use is never expanded');
});
test('a chain only through conflicting date records ends explored with the ambiguity named, and resuming repeats it without requests', async () => {
  const fake = fakeContacts([]), repository = await ambiguousBridgeRepository(true);
  const first = await run({ service: fake.service, repository });
  assert.equal(first.status, 'explored'); assert.equal(first.session!.diagnostics.stopReason, 'frontier-explored');
  assert.ok(first.session!.diagnostics.requests!.discover! >= 2, 'both ends were expanded until nothing was left');
  assert.match(first.session!.phase, /Bridge \(1540–1640 or 1545–1645\)/); assert.match(first.session!.phase, /conflicting dates/);
  const second = await run({ service: fake.service, repository, session: first.session! });
  assert.equal(second.status, 'explored'); assert.equal(second.session!.diagnostics.tasks, 0); assert.equal(second.session!.phase, first.session!.phase);
});
test('an exhausted search with no ambiguous bridge keeps the generic message', async () => {
  const result = await run({ service: fakeContacts([]).service });
  assert.equal(result.status, 'explored'); assert.equal(result.session!.phase, 'This exploration did not establish a chain');
});
test('route reach shares the ambiguity rule of shortestContactPath, keeps an endpoint identity, and acceptedDistances stays unfiltered', () => {
  const people: ContactPerson[] = [], [a, m, bridge, twin, n, b] = [A, M, BRIDGE, BRIDGE_TWIN, N, B].map(p => identifyPerson(people, figurePerson(p)));
  const accept = (first: ContactPerson, second: ContactPerson): ContactAssessment => ({ pair: [first.id, second.id], verdict: 'accepted', interactionType: 'meeting',
    evidence: 'They met at a research conference.', provenance: { provider: 'fake', model: 'fake', version: 2, assessedAt: Date.now() } });
  const contacts = [accept(a, m), accept(m, bridge), accept(bridge, n), accept(n, b)];
  assert.deepEqual([...acceptedDistances(a.id, people, contacts).keys()], [a.id, m.id, bridge.id, n.id, b.id], 'what is shown and saved still follows every accepted contact');
  assert.deepEqual([...routeDistances(a.id, people, contacts, [a.id, b.id]).keys()], [a.id, m.id]);
  assert.deepEqual([...routeDistances(b.id, people, contacts, [a.id, b.id]).keys()], [b.id, n.id]);
  assert.equal(shortestContactPath(a.id, b.id, people, contacts), null);
  // A requested endpoint keeps its own identity: the other record of the name is the one that is left out.
  assert.deepEqual([...routeDistances(bridge.id, people, contacts, [bridge.id, b.id]).keys()], [bridge.id, m.id, n.id, a.id, b.id]);
  assert.deepEqual(shortestContactPath(bridge.id, b.id, people, contacts), [bridge.id, n.id, b.id]);
  // Reach and route agree for every ordered pair, so a join found by the frontier is a chain the solver can return.
  const ids = people.map(p => p.id);
  for (const first of ids) for (const second of ids) if (first !== second) {
    assert.equal(routeDistances(first, people, contacts, [first, second]).has(second), shortestContactPath(first, second, people, contacts) !== null, `${first} -> ${second}`);
  }
  // The only accepted bridge runs through the ambiguous name, and the records of that name are listed with their dates.
  const found = ambiguousBridge(a.id, b.id, people, contacts)!;
  assert.deepEqual(found.route, [a.id, m.id, bridge.id, n.id, b.id]);
  assert.deepEqual(found.identities.map(i => [i.name, i.records.map(r => [r.birthYear, r.deathYear])]), [['Bridge', [[1540, 1640], [1545, 1645]]]]);
  assert.equal(ambiguousBridge(bridge.id, b.id, people, contacts), null, 'a route exists, so there is nothing to explain');
  assert.equal(ambiguousBridge(a.id, b.id, people.filter(p => p.id !== twin.id), contacts), null, 'a name with one record is not ambiguous');
  contacts.push(accept(m, n)); assert.equal(ambiguousBridge(a.id, b.id, people, contacts), null, 'a clean route exists');
});

// ------------------------------------------------------- resolving the duplicate records on an accepted bridge (one identity request)
test('one identity request settles the name on the only accepted bridge: the named record survives, the other is retired into it, the chain is found', async () => {
  for (const [keeper, retired] of [[BRIDGE, BRIDGE_TWIN], [BRIDGE_TWIN, BRIDGE]]) {
    const fake = fakeContacts([]), asked: string[] = [];
    fake.service.resolveFigure = async name => { asked.push(name); return figurePerson(keeper); };
    const repository = await ambiguousBridgeRepository(true), result = await run({ service: fake.service, repository });
    assert.equal(result.status, 'connected'); assert.deepEqual(asked, ['Bridge']);
    if (result.status !== 'connected') throw Error('expected connection');
    assert.deepEqual(result.session!.diagnostics.requests, { seed: 0, direct: 0, assess: 0, discover: 0, identity: 1 }, 'nothing was spent before the identity check, and nothing after it');
    assert.deepEqual(result.chain.map(p => p.name), [A.name, M.name, 'Bridge', N.name, B.name]);
    assert.deepEqual([result.chain[2].birthYear, result.chain[2].deathYear], [keeper.birthYear, keeper.deathYear]);
    const knowledge = await repository.loadKnowledge(), survivors = knowledge.people.filter(p => p.name === 'Bridge' && !p.canonicalId);
    assert.equal(survivors.length, 1); assert.deepEqual([survivors[0].birthYear, survivors[0].deathYear], [keeper.birthYear, keeper.deathYear]);
    assert.equal(knowledge.people.find(p => p.name === 'Bridge' && p.birthYear === retired.birthYear)!.canonicalId, survivors[0].id, 'the other record stays in the store, pointing at the survivor');
    assert.equal(identifyPerson(knowledge.people, figurePerson(retired)).id, survivors[0].id, 'the retired dates proposed again land on the survivor');
    // The store keeps the answer: another canvas and model finds the same chain with no request at all.
    const later = fakeContacts([]); later.service.resolveFigure = async () => { throw new Error('asked again'); };
    const again = await run({ service: later.service, repository, canvasId: 'two', provenance: { provider: 'new', model: 'new' } });
    assert.equal(again.status, 'connected'); assert.equal(again.session!.diagnostics.tasks, 0);
  }
});
test('an answer that does not name exactly one record settles nothing: the records stay separate and the ambiguity is still reported', async () => {
  const answers: Array<[string, (name: string) => ReturnType<typeof figurePerson> | null]> = [
    ['unknown person', () => null], ['dates matching no record', () => figurePerson(person('Bridge', 1550, 1650))],
    ['a different person with one record dates', () => figurePerson(person('Somebody Else', 1540, 1640))],
  ];
  for (const [label, answer] of answers) {
    const fake = fakeContacts([]); fake.service.resolveFigure = async name => answer(name);
    const repository = await ambiguousBridgeRepository(true), result = await run({ service: fake.service, repository });
    assert.equal(result.status, 'explored', label); assert.equal(result.session!.diagnostics.requests!.identity, 1, label);
    assert.match(result.session!.phase, /Bridge \(1540–1640 or 1545–1645\)/, label);
    assert.equal((await repository.loadKnowledge()).people.filter(p => p.name === 'Bridge' && !p.canonicalId).length, 2, label);
  }
});
test('records too far apart, a spent allowance or an endpoint are never sent to the resolver; each name is asked once per model', async () => {
  const unasked = fakeContacts([]); let asked = 0; unasked.service.resolveFigure = async () => { asked++; return null; };
  const far = await run({ service: unasked.service, repository: await ambiguousBridgeRepository(false, person('Bridge', 1590, 1690)) });
  assert.equal(far.status, 'explored'); assert.equal(asked, 0, 'a namesake of another generation is not a duplicate');
  assert.match(far.session!.phase, /Bridge \(1540–1640 or 1590–1690\)/);
  const none = await run({ service: unasked.service, repository: await ambiguousBridgeRepository(true), limits: { identityChecks: 0 } });
  assert.equal(none.status, 'explored'); assert.equal(asked, 0);
  // Asked again only when the model or the records change.
  const repository = await ambiguousBridgeRepository(true), count = fakeContacts([]); let identity = 0;
  count.service.resolveFigure = async () => { identity++; return null; };
  const first = await run({ service: count.service, repository, provenance: { provider: 'test', model: 'first' } }); assert.equal(identity, 1);
  await run({ service: count.service, repository, session: first.session!, provenance: { provider: 'test', model: 'first' } }); assert.equal(identity, 1, 'resuming does not repeat the question');
  await run({ service: count.service, repository, session: first.session!, provenance: { provider: 'test', model: 'second' } }); assert.equal(identity, 2, 'another model is asked');
});
test('duplicate records are resolvable only when close and never an endpoint; an answer must name exactly one record', () => {
  const people: ContactPerson[] = [], [x, y, far] = [person('Bridge', 1540, 1640), person('Bridge', 1545, 1645), person('Bridge', 1560, 1700)].map(p => identifyPerson(people, figurePerson(p)));
  assert.equal(resolvableDuplicates([x, y], []), true); assert.equal(resolvableDuplicates([x, y, far], []), false, 'a death year 60 years away');
  assert.equal(resolvableDuplicates([x], []), false); assert.equal(resolvableDuplicates([x, y], [y.id]), false, 'an endpoint is never merged');
  assert.equal(duplicateKeeper([x, y], figurePerson(person('Bridge', 1545, 1645))), y);
  assert.equal(duplicateKeeper([x, y], figurePerson(person('Sir Bridge Nobleman', 1545, 1645))), y, 'a fuller form of the name still names the record');
  assert.equal(duplicateKeeper([x, y], figurePerson(person('Bridge', 1550, 1650))), undefined); assert.equal(duplicateKeeper([x, y], figurePerson(person('Other', 1545, 1645))), undefined);
  assert.equal(duplicateKeeper([x, { ...y, birthYear: 1540, deathYear: 1640 }], figurePerson(person('Bridge', 1540, 1640))), undefined, 'two records with the dates is not an answer');
});
test('a record retired by a merge never replaces the figure that was asked for, and a session saved before the merge keeps working', async () => {
  const repository = await ambiguousBridgeRepository(true), twin = BRIDGE_TWIN;
  // A search that starts from the twin cannot merge it (an endpoint is never merged) and pauses on its budget.
  const saved = await run({ service: fakeContacts([]).service, repository, from: twin, figures: [twin, B], limits: { tasks: 1 } });
  assert.equal(saved.status, 'paused'); assert.equal(saved.session!.diagnostics.requests!.identity, 0);
  // Another search retires the twin into the other record.
  const resolving = fakeContacts([]); resolving.service.resolveFigure = async () => figurePerson(BRIDGE);
  assert.equal((await run({ service: resolving.service, repository })).status, 'connected');
  const survivor = (await repository.loadKnowledge()).people.find(p => p.name === 'Bridge' && !p.canonicalId)!;
  assert.deepEqual([survivor.birthYear, survivor.deathYear], [BRIDGE.birthYear, BRIDGE.deathYear]);
  // The retired figure as an endpoint: the chain starts with that very figure, nothing is woven next to it.
  const fresh = await run({ service: fakeContacts([]).service, repository, canvasId: 'two', from: twin, figures: [twin, B] });
  assert.equal(fresh.status, 'connected'); if (fresh.status !== 'connected') throw Error('expected connection');
  assert.equal(fresh.chain[0].id, twin.id); assert.deepEqual([fresh.chain[0].birthYear, fresh.chain[0].deathYear], [twin.birthYear, twin.deathYear]);
  assert.ok(!fresh.newFigures.some(f => f.id === twin.id || f.id === B.id), 'neither endpoint is woven as a second figure');
  // The session saved before the merge names the retired record: it resumes on the survivor instead of failing on its old key.
  const resumed = await run({ service: fakeContacts([]).service, repository, from: twin, figures: [twin, B], session: saved.session! });
  assert.equal(resumed.status, 'connected'); assert.equal(resumed.session!.key.includes(survivor.id), true); assert.deepEqual(resumed.session!.retiredKeys, [saved.session!.key]);
  if (resumed.status === 'connected') assert.equal(resumed.chain[0].id, twin.id);
});
test('the session says what the running request is about, including a wait for a rate limit, and never keeps it', async () => {
  const { service } = fakeContacts([[A, M], [M, N], [N, B]]);
  const discover = service.discoverPersonalContacts.bind(service);
  service.discoverPersonalContacts = async (request, signal) => { await waitToRetry(1, signal); return discover(request, signal); };
  const seen: Array<NonNullable<ConnectionSession['activity']>> = [];
  const repository = new MemoryConnectionRepository();
  const result = await run({ service, repository, onSnapshot: session => { if (session.activity) seen.push(structuredClone(session.activity)); } });
  assert.equal(result.status, 'connected');
  const kinds = new Set(seen.map(activity => activity.kind));
  for (const kind of ['seed', 'discover', 'assess']) assert.ok(kinds.has(kind as never), `${kind} request announced`);
  const asked = seen.find(activity => activity.kind === 'discover')!;
  assert.deepEqual(asked.people.map(person => person.side).sort(), ['a', 'b']);
  assert.ok(seen.some(activity => activity.kind === 'discover' && activity.waitUntil), 'the wait is announced');
  assert.ok(seen.some(activity => activity.kind === 'discover' && !activity.waitUntil), 'and ends');
  assert.ok(seen.filter(activity => activity.kind === 'assess').every(activity => activity.pairs?.length));
  assert.equal(result.session?.activity, undefined);
  assert.ok(!JSON.stringify(await repository.loadSession(result.session!.key)).includes('activity'));
});
