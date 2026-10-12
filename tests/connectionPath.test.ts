import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConnection, classifyConnectionTarget, checkConnectionFeasibility, resolveConnectionTarget, type ConnectionSearchOptions } from '../src/services/connectionPath';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { figurePerson, identifyPerson, shortestContactPath, type ContactPerson } from '../src/services/connectionGraph';
import type { HistoricalFigure, IAIService } from '../src/types';
import { MemoryStorage } from './helpers';
import { pairKey } from '../src/services/pathService';

import { person, fakeContacts, A, B, M, N, proposal } from './connectionFixtures';
const run = (overrides: Partial<ConnectionSearchOptions> & Pick<ConnectionSearchOptions, 'service'>) => findConnection({ from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', ...overrides });

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
