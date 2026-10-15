import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConnection, assessmentPairsFor, SEARCH_LIMITS, type ConnectionSearchOptions } from '../src/services/connectionPath';
import { parseContactAssessments, parseContactAssessmentsPartial, requestContactAssessment, type ContactPair } from '../src/services/connectionAI';
import { buildContactDiscoveryPrompt } from '../src/services/prompts';
import { figurePerson, identifyPerson, migrateAttemptContext, type ConnectionSession, type ContactAssessment, type ContactPerson } from '../src/services/connectionGraph';
import { MemoryConnectionRepository, recoverSession } from '../src/utils/connectionKnowledge';
import type { JsonGenerator } from '../src/services/weaveService';
import type { HistoricalFigure } from '../src/types';
import { pairKey } from '../src/services/pathService';
import { A, B, M, person, proposal, fakeContacts } from './connectionFixtures';

const run = (overrides: Partial<ConnectionSearchOptions> & Pick<ConnectionSearchOptions, 'service'>) =>
  findConnection({ from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', ...overrides });

// ----------------------------------------------------------------------------------------------- D: partial replies
const people: ContactPerson[] = [];
const first = identifyPerson(people, figurePerson(person('Ada', 1815, 1852))), second = identifyPerson(people, figurePerson(person('Babbage', 1791, 1871)));
const third = identifyPerson(people, figurePerson(person('Clara', 1800, 1860)));
const pairs: ContactPair[] = [{ first, second }, { first, second: third }, { first: second, second: third }];
const accepted = (ref: string) => ({ ref, verdict: 'accepted', interactionType: 'correspondence', evidence: 'They exchanged letters.', year: null });
const unresolved = (ref: string) => ({ ref, verdict: 'unresolved', evidence: '', uncertainty: 'Nothing specific is known.' });

test('D: a partial reply keeps its valid items and names the pairs that failed', () => {
  const reply = [accepted('p1'), { ref: 'p2', verdict: 'accepted', interactionType: 'correspondence', evidence: '' }, unresolved('p3')];
  const { results, failed } = parseContactAssessmentsPartial(reply, pairs);
  assert.deepEqual(results.map(r => r.verdict), ['accepted', 'unresolved']); assert.deepEqual(failed, [1]);
  assert.deepEqual(results[0].pair, [first.id, second.id]);
  // A missing item, a duplicate and an unknown reference are all just "not assessed" for the pairs they concern.
  assert.deepEqual(parseContactAssessmentsPartial([accepted('p1'), accepted('p3')], pairs).failed, [1]);
  assert.deepEqual(parseContactAssessmentsPartial([accepted('p1'), unresolved('p1'), accepted('p2'), accepted('p9')], pairs).failed, [0, 2], 'a contradictory duplicate is dropped entirely');
  // No valid item, or no array, is still an error, and the strict parser is unchanged.
  assert.throws(() => parseContactAssessmentsPartial([{ ref: 'p1', verdict: 'maybe' }], pairs)); assert.throws(() => parseContactAssessmentsPartial({ ref: 'p1' }, pairs));
  assert.throws(() => parseContactAssessmentsPartial([], pairs)); assert.throws(() => parseContactAssessments(reply, pairs));
});

function scripted(replies: unknown[]) {
  const prompts: string[] = [];
  const generate = (async (prompt: string, validate: (value: unknown) => unknown) => {
    prompts.push(prompt);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return validate(reply);
  }) as unknown as JsonGenerator;
  return { generate, prompts };
}
const askedPairs = (prompt: string) => JSON.parse(prompt.split('\n').find(l => l.startsWith('Pairs: '))!.slice('Pairs: '.length)) as Array<{ ref: string; first: { name: string }; second: { name: string } }>;

test('D: failed pairs get one targeted follow-up carrying only them; a healthy reply makes no follow-up', async () => {
  const healthy = scripted([[accepted('p1'), unresolved('p2'), unresolved('p3')]]);
  assert.equal((await requestContactAssessment(healthy.generate, pairs)).length, 3); assert.equal(healthy.prompts.length, 1);
  const partial = scripted([[accepted('p1'), unresolved('p3')], [accepted('p1')]]);
  const results = await requestContactAssessment(partial.generate, pairs);
  assert.equal(partial.prompts.length, 2); assert.equal(results.length, 3);
  const followUp = askedPairs(partial.prompts[1]);
  assert.deepEqual(followUp.map(p => [p.ref, p.first.name, p.second.name]), [['p1', 'Ada', 'Clara']], 'only the failed pair, renumbered');
  assert.deepEqual(results.map(r => pairKey(...r.pair)).sort(), pairs.map(p => pairKey(p.first.id, p.second.id)).sort());
});

test('D: a follow-up that yields nothing keeps the first reply; transport errors and cancellation still end the task', async () => {
  const unusable = scripted([[accepted('p1'), unresolved('p3')], new Error('The model returned unusable data after a retry: Missing evidence.')]);
  assert.equal((await requestContactAssessment(unusable.generate, pairs)).length, 2);
  const transport = scripted([[accepted('p1'), unresolved('p3')], new Error('Ollama request failed (HTTP 500).')]);
  await assert.rejects(requestContactAssessment(transport.generate, pairs), /HTTP 500/);
  const controller = new AbortController();
  const cancelled = scripted([[accepted('p1'), unresolved('p3')], new Error('The model returned unusable data after a retry: x')]); controller.abort();
  await assert.rejects(requestContactAssessment(cancelled.generate, pairs, controller.signal));
});

test('D: a pair the model never answers validly is not assessed: nothing is stored, no attempt, asked again, given up after two tries, asked afresh next segment', async () => {
  const to = person('Contemporary'), repository = new MemoryConnectionRepository(), real = fakeContacts([[A, to]]);
  let answer = false; const asked: number[] = [];
  const service = { ...real.service, assessPersonalContacts: async (batch: ContactPair[], signal?: AbortSignal) => { asked.push(batch.length); return answer ? real.service.assessPersonalContacts(batch, signal) : []; } };
  const stalled = await run({ service, to, figures: [A, to], repository, limits: { tasks: 6 } });
  assert.notEqual(stalled.status, 'connected'); assert.notEqual(stalled.status, 'error', 'an unanswered pair is not an error');
  const d = stalled.session!.diagnostics;
  assert.equal(asked.filter(n => n === 1).length, 2, 'the endpoint check, then one more try as a join pair, then given up for this segment');
  assert.equal(d.pairs, 0, 'a pair that was never assessed is not a tried pair'); assert.deepEqual(stalled.session!.attempts, {});
  assert.deepEqual((await repository.loadKnowledge()).contacts, [], 'no verdict, not even a negative one, is stored');
  assert.equal(stalled.session!.candidates.find(c => c.claim === 'Direct endpoint contact candidate')?.status, 'proposed');
  answer = true;
  const saved = await repository.loadSession(stalled.session!.key);
  const next = await run({ service, to, figures: [A, to], repository, session: saved! });
  assert.equal(next.status, 'connected', 'a later segment asks the pair afresh');
});

test('D: an accepted item that contradicts the supplied lifespans is not assessed instead of failing the whole search', async () => {
  const to = person('Contemporary'), real = fakeContacts([]);
  const service = { ...real.service, assessPersonalContacts: async (batch: ContactPair[]) => batch.map(p => ({ pair: [p.first.id, p.second.id] as [string, string], verdict: 'accepted' as const,
    interactionType: 'meeting' as const, evidence: 'They met.', year: 3 })) };
  const result = await run({ service, to, figures: [A, to], limits: { tasks: 5 } });
  assert.notEqual(result.status, 'error'); assert.notEqual(result.status, 'connected');
});

// ------------------------------------------------------------------------------------------ the scripted fake model
interface ScriptedWorld { proposals: Record<string, HistoricalFigure[]>; supported: Array<[HistoricalFigure, HistoricalFigure]> }
function scriptedWorld({ proposals, supported }: ScriptedWorld) {
  const ok = new Set(supported.map(([a, b]) => pairKey(a.name, b.name)));
  const log: string[] = [], asks: Array<Array<{ pair: string; focused: boolean }>> = [], discoveries: Array<Array<{ source: string; goal: string }>> = [];
  const service = {
    resolveFigure: async () => null, fetchConnectionPath: async () => null,
    discoverPersonalContacts: async (request) => {
      log.push('discover'); discoveries.push(request.sources.map(s => ({ source: s.person.name, goal: (s.goal ?? request.target).name })));
      return request.sources.flatMap(s => (proposals[s.person.name] ?? []).filter(p => !s.previous.some(q => q.name === p.name))
        .map(p => ({ sourceId: s.person.id, person: proposal(p), claim: 'They exchanged letters.' })));
    },
    assessPersonalContacts: async batch => {
      log.push('assess'); asks.push(batch.map(p => ({ pair: `${p.first.name}-${p.second.name}`, focused: !!p.focused })));
      return batch.map(p => ok.has(pairKey(p.first.name, p.second.name))
        ? { pair: [p.first.id, p.second.id] as [string, string], verdict: 'accepted' as const, interactionType: 'correspondence' as const, evidence: `${p.first.name} and ${p.second.name} exchanged letters.` }
        : { pair: [p.first.id, p.second.id] as [string, string], verdict: 'unresolved' as const, evidence: '', uncertainty: 'No specific interaction established.' });
    },
  } as ConnectionSearchOptions['service'];
  return { service, log, asks, discoveries };
}
const early = (name: string) => person(name, 1520, 1600), N = person('Next', 1630, 1710);
// Distinct names and dates, so the search never mistakes two of them for one person and spends identity requests on them.
const mids = ['Carew', 'Dorset', 'Egerton', 'Fairfax', 'Grey'].map((name, i) => person(name, 1550 + i, 1640 - i));

// -------------------------------------------------------------------------------------------- B: one assessment pool
function poolWorld(secondLevel: HistoricalFigure, beta: HistoricalFigure[] = [N], midToNext = true) {
  const filler = person('Hartley', 1521, 1601);
  return scriptedWorld({
    proposals: { Alpha: [...mids, filler], Beta: beta, Carew: [secondLevel] },
    supported: [...mids.map(m => [A, m] as [HistoricalFigure, HistoricalFigure]), ...(beta.length ? [[B, N] as [HistoricalFigure, HistoricalFigure]] : []), ...(midToNext ? [[mids[0], N] as [HistoricalFigure, HistoricalFigure]] : [])],
  });
}
test('B: a pair that would join the two clusters is sent at once, even with a short pool and unexpanded people waiting', async () => {
  const w = poolWorld(N), result = await run({ service: w.service });
  assert.equal(result.status, 'connected');
  assert.deepEqual(w.log, ['discover', 'assess', 'discover', 'assess'], 'no extra discovery before the join pair');
  // Every pair between the clusters goes first (the cross-frontier ones too), and the one promising re-ask rides along in the same request.
  assert.equal(w.asks[1][0].pair, 'Carew-Next'); assert.deepEqual(w.asks[1].at(-1), { pair: 'Alpha-Hartley', focused: true });
  assert.ok(w.asks[1].slice(0, -1).every(a => !a.focused && a.pair.endsWith('-Next')) && w.asks[1].length < 8, 'a short request, sent without waiting for a full batch');
});
test('B: otherwise a short pool waits for the next discovery, which reaches people not expanded before', async () => {
  const w = poolWorld(person('Ingram', 1522, 1602), [], false), result = await run({ service: w.service, limits: { tasks: 6 } });
  assert.notEqual(result.status, 'connected');
  assert.deepEqual(w.log.slice(0, 4), ['discover', 'assess', 'discover', 'discover'], `a two-pair pool does not go out while Grey is still waiting to be expanded: ${JSON.stringify(w.log)} ${result.status} ${result.session!.diagnostics.stopReason} ${JSON.stringify(w.discoveries)} ${JSON.stringify(w.asks)}`);
  const mixed = w.asks[1];
  assert.ok(mixed.some(a => a.focused) && mixed.some(a => !a.focused), 'the re-ask and the new pairs share one request');
});
test('B: the first round is sent at once when the next discovery would only re-expand the endpoints', async () => {
  const w = poolWorld(N); await run({ service: w.service });
  assert.equal(w.asks[0].length, 7, 'six from Alpha and one from Beta in one request, no waiting'); assert.ok(w.asks[0].every(a => !a.focused));
});
test('B: nothing is lost when the search ends: a final short pool is drained, and a pair is re-asked at most once per segment', async () => {
  const w = poolWorld(person('Ingram', 1522, 1602), [], false), result = await run({ service: w.service, limits: { tasks: 6 } });
  const last = w.asks.at(-1)!;
  assert.ok(last.length >= 1); assert.equal(result.session!.diagnostics.tasks, 6);
  const reasked = w.asks.flat().filter(a => a.focused).map(a => a.pair);
  assert.equal(new Set(reasked).size, reasked.length, 'no pair is re-asked twice in one segment');
});

// ------------------------------------------------------------------------------------------------ C: batch size
test('C: Ollama sends larger assessment batches; other providers keep the default; an explicit limit always wins', async () => {
  assert.equal(assessmentPairsFor('ollama'), 16); assert.equal(assessmentPairsFor('gemini'), SEARCH_LIMITS.assessmentPairs); assert.equal(assessmentPairsFor('openrouter'), 8);
  const many = Array.from({ length: 6 }, (_, i) => early(`Early ${i}`)), late = Array.from({ length: 6 }, (_, i) => person(`Late ${i}`, 1690, 1770));
  const world = () => scriptedWorld({ proposals: { Alpha: many, Beta: late }, supported: [] });
  const ollama = world(); await run({ service: ollama.service, provenance: { provider: 'ollama', model: 'm' }, limits: { tasks: 4 } });
  assert.equal(ollama.asks[0].length, 12, 'all twelve pairs of the first round in one request');
  const gemini = world(); await run({ service: gemini.service, provenance: { provider: 'gemini', model: 'm' }, limits: { tasks: 4 } });
  assert.deepEqual(gemini.asks.slice(0, 2).map(a => a.length), [8, 8], 'eight, then the last four fresh pairs with four promising re-asks');
  assert.equal(gemini.asks[1].filter(a => a.focused).length, 4);
  const explicit = world(); await run({ service: explicit.service, provenance: { provider: 'ollama', model: 'm' }, limits: { tasks: 4, assessmentPairs: 5 } });
  assert.equal(explicit.asks[0].length, 5);
});

// ------------------------------------------------------------------------------------------ E: both ends in one request
test('E: one discovery request carries sources from both ends, each with the opposite endpoint as its goal', async () => {
  const w = poolWorld(N); await run({ service: w.service });
  assert.deepEqual(w.discoveries[0], [{ source: 'Alpha', goal: 'Beta' }, { source: 'Beta', goal: 'Alpha' }]);
  const second = w.discoveries[1];
  assert.ok(second.filter(s => s.goal === 'Beta').length >= 4 && second.some(s => s.source === 'Next' && s.goal === 'Alpha'), JSON.stringify(second));
  assert.equal(w.discoveries.length, 2, 'two discovery requests, not one per end');
});
test('E: the discovery prompt gives each source its own goal only when the goals differ', () => {
  const a = identifyPerson([], figurePerson(A)), b = identifyPerson([], figurePerson(B)), m = identifyPerson([], figurePerson(M));
  const mixed = buildContactDiscoveryPrompt({ sources: [{ person: a, round: 1, previous: [], goal: b }, { person: b, round: 1, previous: [], goal: a }], target: b, references: [], limit: 6 });
  assert.match(mixed, /Each source has its own goal/); assert.doesNotMatch(mixed, /Goal on the opposite side:/);
  const sources = JSON.parse(mixed.split('\n').find(l => l.startsWith('Sources: '))!.slice('Sources: '.length));
  assert.deepEqual(sources.map((s: { goal: { name: string } }) => s.goal.name), ['Beta', 'Alpha']);
  const shared = buildContactDiscoveryPrompt({ sources: [{ person: a, round: 1, previous: [] }, { person: m, round: 1, previous: [], goal: b }], target: b, references: [], limit: 6 });
  assert.match(shared, /Goal on the opposite side: .*Beta/); assert.ok(!('goal' in JSON.parse(shared.split('\n').find(l => l.startsWith('Sources: '))!.slice('Sources: '.length))[0]));
});

// ------------------------------------------------------------------------------- G: the attempt cache key and migration
test('G: a new accepted neighbor elsewhere in the graph does not make an identical question look new', async () => {
  const filler = person('Hartley', 1521, 1601), world = scriptedWorld({ proposals: { Alpha: [filler], Beta: [] }, supported: [] }), repository = new MemoryConnectionRepository();
  const first = await run({ service: world.service, repository, limits: { tasks: 3 } });
  assert.ok(world.asks.flat().some(a => a.pair === 'Alpha-Hartley'));
  // Between segments another search teaches the shared graph an accepted contact of Alpha.
  const knowledge = await repository.loadKnowledge(), alpha = knowledge.people.find(p => p.name === 'Alpha')!;
  const neighbor = identifyPerson(knowledge.people, figurePerson(person('Neighbor', 1510, 1570)));
  const contact: ContactAssessment = { pair: [alpha.id, neighbor.id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met.', provenance: { provider: 'configured', model: 'configured', version: 2, assessedAt: 1 } };
  await repository.checkpoint({ people: knowledge.people, contacts: [contact] }, first.session!);
  const asksBefore = world.asks.length;
  const next = await run({ service: world.service, repository, session: (await repository.loadSession(first.session!.key))!, limits: { tasks: 3 } });
  assert.equal(world.asks.slice(asksBefore).flat().filter(a => a.pair === 'Alpha-Hartley').length, 0, 'the unchanged question is not asked again');
  assert.equal(next.session!.diagnostics.pairAsks!.contextChange, 0);
});
test('G: stored attempt contexts lose the accepted-neighbors element once, and nothing else', () => {
  const old = JSON.stringify(['configured', 'configured', 'Alpha', [], 'Beta', [], ['a\u0000b']]), current = JSON.stringify(['configured', 'configured', 'Alpha', [], 'Beta', []]);
  assert.equal(migrateAttemptContext(old), current); assert.equal(migrateAttemptContext(current), current); assert.equal(migrateAttemptContext(migrateAttemptContext(old)), current);
  assert.equal(migrateAttemptContext('not json'), 'not json'); assert.equal(migrateAttemptContext('{"a":1}'), '{"a":1}');
  const people: ContactPerson[] = [], a = identifyPerson(people, figurePerson(A)), b = identifyPerson(people, figurePerson(B));
  const session: ConnectionSession = { version: 2, key: `one:${pairKey(a.id, b.id)}`, canvasId: 'one', endpoints: [a.id, b.id], people, candidates: [], rounds: [],
    attempts: { [pairKey(a.id, b.id)]: { context: old, segment: 1, count: 1 } }, segment: 1, status: 'paused', phase: 'x', elapsedMs: 1, updatedAt: Date.now(), diagnostics: { tasks: 0, people: 0, pairs: 0 } };
  assert.equal(recoverSession(session)!.attempts[pairKey(a.id, b.id)].context, current, 'a saved session is migrated on load, so an upgrade does not re-ask its pairs');
});
