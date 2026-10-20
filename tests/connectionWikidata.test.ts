import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConnection, type ConnectionResult, type ConnectionSearchOptions } from '../src/services/connectionPath';
import { figurePerson, identifyPerson, samePerson, sessionKey, type ConnectionSession, type ContactAssessment, type ContactPerson } from '../src/services/connectionGraph';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { wikidataKey, type WikidataResolver } from '../src/services/wikidataService';
import { A, B, M, N, BRIDGE, BRIDGE_TWIN, CLEAN_BRIDGE, ambiguousBridgeRepository, assertRequestAccounting, fakeContacts, fakeWikidata, person, TWIN_RIGHT, TWIN_WRONG, twinDiscovery, twinWikidata } from './connectionFixtures';
import { recordService } from './connectionTraceWorlds';

const zed = person('Zed', 1540, 1620);
const connected = (result: ConnectionResult) => { assert.equal(result.status, 'connected'); return result as Extract<ConnectionResult, { status: 'connected' }>; };
const search = (overrides: Partial<ConnectionSearchOptions> & Pick<ConnectionSearchOptions, 'service'>) =>
  findConnection({ from: A, to: zed, figures: [A, zed], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', ...overrides });
const accepted = (a: ContactPerson, b: ContactPerson): ContactAssessment => ({ pair: [a.id, b.id], verdict: 'accepted', interactionType: 'correspondence',
  evidence: `${a.name} and ${b.name} exchanged letters about their joint research.`, provenance: { provider: 'fake', model: 'fake', version: 2, assessedAt: 1 } });

test('both forms of a name the model proposes are one person, assessed once, recorded with Wikidata\'s years', async () => {
  const fake = fakeContacts([[A, TWIN_WRONG], [TWIN_WRONG, zed]], twinDiscovery), wikidata = twinWikidata();
  const result = connected(await search({ service: fake.service, wikidata: wikidata.resolver }));
  assert.deepEqual(result.chain.map(p => p.name), ['Alpha', 'Robert Twin', 'Zed']);
  assert.deepEqual([result.chain[1].birthYear, result.chain[1].deathYear], [1504, 1590], 'the figure woven in has the right years');
  assert.deepEqual(fake.calls.assessments.filter(pair => pair.includes('J. Robert')), [], 'the other form of the name was never put to the model');
  const twins = result.session!.people.filter(p => p.qid === 'Q100');
  assert.equal(twins.length, 1);
  assert.equal(samePerson(twins[0], figurePerson(TWIN_WRONG)) && samePerson(twins[0], figurePerson(TWIN_RIGHT)), true, 'both forms still find him');
  assert.deepEqual(result.session!.diagnostics.wikidata, { lookups: 4, resolved: 2, merged: 1, corrected: 1, failed: 0 });
  assertRequestAccounting(result.session!.diagnostics);
});

test('a person alone with the wrong years is recorded with the right ones, and the shared knowledge keeps them', async () => {
  const repository = new MemoryConnectionRepository(), fake = fakeContacts([[A, TWIN_WRONG], [TWIN_WRONG, zed]]);
  const result = connected(await search({ service: fake.service, repository, wikidata: twinWikidata().resolver }));
  assert.deepEqual(result.chain.map(p => [p.name, p.birthYear]), [['Alpha', 1500], ['Robert Twin', 1504], ['Zed', 1540]]);
  const stored = (await repository.loadKnowledge()).people.find(p => p.qid === 'Q100')!;
  assert.deepEqual([stored.name, stored.birthYear, stored.variants], ['Robert Twin', 1504, [{ name: 'Robert Twin', birthYear: 1506, deathYear: 1590 }]]);
  assert.equal((await repository.loadKnowledge()).people.find(p => p.name === 'Alpha')!.qidCheckedAt !== undefined, true, 'Wikidata had no one for Alpha: not asked again for a while');
});

test('nobody is asked twice: a second search finds everyone already identified and never calls Wikidata', async () => {
  const repository = new MemoryConnectionRepository(), first = twinWikidata();
  await search({ service: fakeContacts([[A, TWIN_WRONG], [TWIN_WRONG, zed]]).service, repository, wikidata: first.resolver });
  assert.ok(first.asked.length > 0);
  const second = twinWikidata();
  connected(await search({ service: fakeContacts([]).service, repository, wikidata: second.resolver }));
  assert.deepEqual(second.asked, []);
});

test('the duplicates a saved knowledge already holds, each with half of a chain, become one person when searched again, with no model request', async () => {
  const repository = new MemoryConnectionRepository(), people: ContactPerson[] = [];
  const [a, z, wrong, right] = [A, zed, TWIN_WRONG, TWIN_RIGHT].map(p => identifyPerson(people, figurePerson(p)));
  await repository.checkpoint({ people, contacts: [accepted(a, wrong), accepted(right, z)] }, {} as ConnectionSession);
  const fake = fakeContacts([]), result = connected(await search({ service: fake.service, repository, wikidata: twinWikidata().resolver }));
  assert.deepEqual(result.chain.map(p => p.name), ['Alpha', 'J. Robert Twin', 'Zed'], 'the record whose years were right survives');
  assert.deepEqual([fake.calls.seeds, fake.calls.discovery.length, fake.calls.assessments.length], [0, 0, 0]);
  assert.equal(result.session!.diagnostics.wikidata!.merged, 1);
  const knowledge = await repository.loadKnowledge();
  assert.equal(knowledge.people.filter(p => !p.canonicalId && p.qid === 'Q100').length, 1);
  assert.equal(knowledge.people.filter(p => p.canonicalId).length, 1, 'the other is retired, not deleted');
});

test('a search that Wikidata cannot help is exactly the search without it: failures never change the outcome', async () => {
  const links: Array<[typeof A, typeof A]> = [[A, TWIN_WRONG], [TWIN_WRONG, zed]];
  const baseline = connected(await search({ service: fakeContacts(links).service }));
  for (const resolver of [{ resolve: async () => new Map() }, { resolve: async () => { throw new Error('offline'); } }] as WikidataResolver[]) {
    const result = connected(await search({ service: fakeContacts(links).service, wikidata: resolver }));
    assert.deepEqual(result.chain.map(p => [p.name, p.birthYear]), baseline.chain.map(p => [p.name, p.birthYear]));
    assert.ok(result.session!.diagnostics.wikidata!.failed >= 1);
    assert.ok(result.session!.people.every(p => p.qid === undefined && p.qidCheckedAt === undefined), 'a failure is not remembered as an answer');
  }
  assert.equal(baseline.session!.diagnostics.wikidata, undefined, 'no resolver, no counters');
});

test('cancelling the search while Wikidata is being asked stops it cleanly', async () => {
  const controller = new AbortController();
  const hang: WikidataResolver = { resolve: (inputs, signal) => inputs.some(input => input.name.includes('Twin'))
    ? new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))) : Promise.resolve(new Map(inputs.map(input => [wikidataKey(input), 'miss' as const]))) };
  setTimeout(() => controller.abort(new DOMException('Search stopped.', 'AbortError')), 30);
  const result = await search({ service: fakeContacts([[A, TWIN_WRONG], [TWIN_WRONG, zed]]).service, wikidata: hang, signal: controller.signal });
  assert.equal(result.status, 'paused');
  assert.equal(result.session!.diagnostics.stopReason, 'cancelled');
});

// The model is asked whether two names are one person only when Wikidata cannot say.
const identityRequests = async (wikidata?: WikidataResolver) => {
  const trace: string[] = [], oldName = person('Charles Contact', 1600, 1730), alias = person('Charles C. Contact', 1600, 1730), fake = fakeContacts([[A, M], [M, oldName], [alias, B]]);
  fake.service.resolveFigure = async name => name.includes('Charles') ? figurePerson(oldName) : null;
  await findConnection({ from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', service: recordService(fake.service, trace), wikidata });
  return trace.filter(entry => entry.startsWith('identity')).length;
};
test('the model is not asked whether two names are one person when Wikidata knows them as two', async () => {
  assert.ok(await identityRequests() >= 2, 'without Wikidata, it is asked');
  const apart = fakeWikidata(input => input.name.includes('Charles') ? { qid: input.name === 'Charles Contact' ? 'Q1' : 'Q2', birthYear: 1600, deathYear: 1730 } : 'miss');
  assert.equal(await identityRequests(apart.resolver), 0);
});

test('nor is it asked which dates are right for a name recorded twice when both records are different Wikidata items', async () => {
  const requests = async (wikidata?: WikidataResolver) => {
    const trace: string[] = [], fake = fakeContacts([]); fake.service.resolveFigure = async () => figurePerson(BRIDGE);
    await findConnection({ from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: await ambiguousBridgeRepository(true), canvasId: 'one', service: recordService(fake.service, trace), wikidata });
    return trace.filter(entry => entry.startsWith('identity')).length;
  };
  assert.equal(await requests(), 1, 'without Wikidata, one request settles it');
  const distinct = fakeWikidata(input => input.name === 'Bridge' ? { qid: input.birthYear === BRIDGE.birthYear ? 'Q1' : 'Q2', birthYear: input.birthYear, deathYear: input.deathYear } : 'miss');
  assert.equal(await requests(distinct.resolver), 0);
  assert.ok(BRIDGE_TWIN && CLEAN_BRIDGE && N);
});

test('a saved search resumes even when another record of its endpoint already holds the Wikidata item', async () => {
  // Another search found the item first, on a record of the same person with other years; the saved search names the record it was made with.
  const repository = new MemoryConnectionRepository(), people: ContactPerson[] = [];
  const [x, z, y] = [TWIN_WRONG, zed, TWIN_RIGHT].map(p => identifyPerson(people, figurePerson(p)));
  y.qid = 'Q100';
  const [xId, yId, zId] = [x.id, y.id, z.id];
  const saved: ConnectionSession = { version: 2, key: sessionKey('one', xId, zId), canvasId: 'one', endpoints: [xId, zId], people: structuredClone([x, z]), candidates: [], rounds: [], attempts: {},
    segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 1, updatedAt: Date.now(), diagnostics: { tasks: 0, people: 0, pairs: 0 } };
  await repository.checkpoint({ people, contacts: [] }, saved);
  const result = await search({ service: fakeContacts([]).service, from: TWIN_WRONG, to: zed, figures: [TWIN_WRONG, zed], repository, session: (await repository.loadSession(saved.key))!, wikidata: twinWikidata().resolver, limits: { tasks: 2 } });
  assert.notEqual(result.status, 'error', result.session?.error);
  assert.deepEqual(result.session!.endpoints, [xId, zId]);
  const knowledge = await repository.loadKnowledge();
  assert.equal(knowledge.people.find(p => p.id === yId)!.canonicalId, xId, 'the other record is retired into the endpoint, which keeps its id and takes the item');
  assert.deepEqual([knowledge.people.find(p => p.id === xId)!.qid, knowledge.people.find(p => p.id === xId)!.birthYear], ['Q100', 1504]);
});

test('two endpoints that are one person are refused', async () => {
  await assert.rejects(search({ service: fakeContacts([]).service, from: TWIN_WRONG, to: TWIN_RIGHT, figures: [TWIN_WRONG, TWIN_RIGHT], wikidata: twinWikidata().resolver }), /same person/);
});

test('when Wikidata answers nothing at all it is not asked again for the rest of the segment', async () => {
  let calls = 0;
  const silent: WikidataResolver = { resolve: async () => { calls++; return new Map(); } };
  const result = connected(await search({ service: fakeContacts([[A, TWIN_WRONG], [TWIN_WRONG, zed]]).service, wikidata: silent }));
  assert.equal(calls, 1);
  assert.deepEqual(result.session.diagnostics.wikidata, { lookups: 2, resolved: 0, merged: 0, corrected: 0, failed: 2 });
});
