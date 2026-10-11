import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PATH_INTERMEDIATES, MAX_PATH_REPAIRS, PATH_CATALOG_LIMIT } from '../src/constants';
import {
  buildPathCatalog, checkConnectionFeasibility, classifyConnectionTarget, findConnection, newPersonToFigure, resolveConnectionTarget,
  type ConnectionProgress, type ConnectionSearchOptions,
} from '../src/services/connectionPath';
import type { ConnectionPathOptions, ConnectionPathProposal, HistoricalFigure, IAIService, NewPerson } from '../src/types';
import { MemoryStorage } from './helpers';

const person = (id: string, name: string, birthYear: number, deathYear: number, category: HistoricalFigure['category'] = 'ARTISTS'): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category });
// A and B never lived at the same time, so only a chain through M and N can connect them.
const A = person('a', 'Anna Alpha', 1500, 1560);
const M = person('m', 'Marco Middle', 1520, 1590);
const N = person('n', 'Nora Next', 1540, 1610);
const B = person('b', 'Bruno Beta', 1580, 1650);
const canvas = [A, M, N, B];

const proposal = (...nodes: Array<HistoricalFigure | NewPerson>): ConnectionPathProposal => ({
  nodes: nodes.map(node => 'id' in node ? { id: node.id } : node), links: nodes.slice(1).map(() => ({ claim: 'The model says they met.' })),
});
const fresh = (name: string, birthYear = 1560, deathYear = 1620): NewPerson =>
  ({ name, birthYear, deathYear, occupation: 'Scholar', category: 'THINKERS', description: 'A scholar.' });
const pairs = (list: Array<[{ id: string }, { id: string }]>) => list.map(([x, y]) => [x.id, y.id].sort().join('|')).sort();

// A fake service: `rejected` lists unordered pairs the verification refuses; proposals come from a queue.
function fakeService(proposals: Array<ConnectionPathProposal | null>, rejected: string[] = []) {
  const calls = { paths: [] as Array<{ from: string; to: string; options: ConnectionPathOptions }>, assessed: [] as string[] };
  const refused = new Set(rejected.map(pair => pair.split('|').sort().join('|')));
  const service: Pick<IAIService, 'fetchConnectionPath' | 'fetchRelationshipExplanation'> = {
    fetchConnectionPath: async (from, to, options) => {
      calls.paths.push({ from: from.id, to: to.id, options });
      return proposals.shift() ?? null;
    },
    fetchRelationshipExplanation: async (first, second) => {
      calls.assessed.push(`${first.id}|${second.id}`);
      return refused.has([first.id, second.id].sort().join('|'))
        ? { isRelevant: false, evidence: '', summary: 'No link.', sections: [{ title: 'Assessment', content: 'None.' }] }
        : { isRelevant: true, evidence: `${first.name} and ${second.name} worked together.`, summary: 'They worked together.', sections: [{ title: 'Work', content: 'Details.' }] };
    },
  };
  return { service, calls };
}

const search = (service: ReturnType<typeof fakeService>['service'], overrides: Partial<ConnectionSearchOptions> = {}) =>
  findConnection({ service, from: A, to: B, figures: canvas, storage: new MemoryStorage(), signal: new AbortController().signal, ...overrides });

test('a direct link short-circuits to one degree without proposing a path', async () => {
  const { service, calls } = fakeService([]);
  const result = await search(service, { to: M });
  assert.equal(result.status, 'connected');
  assert.equal(result.status === 'connected' && result.degrees, 1);
  assert.deepEqual(result.chain.map(figure => figure.id), ['a', 'm']);
  assert.equal(calls.paths.length, 0);
});

test('a rejected direct link is remembered and the proposal avoids it', async () => {
  const { service, calls } = fakeService([proposal(A, N, M)], ['a|m']);
  const result = await search(service, { to: M });
  assert.equal(result.status, 'connected');
  assert.deepEqual(pairs(calls.paths[0].options.avoidPairs), ['a|m']);
  assert.equal(calls.paths[0].options.maxIntermediates, MAX_PATH_INTERMEDIATES);
});

test('people who never overlapped are not checked for a direct link', async () => {
  const { service, calls } = fakeService([proposal(A, M, B)]);
  const updates: ConnectionProgress[] = [];
  await search(service, { onProgress: progress => updates.push(structuredClone(progress)) });
  assert.ok(!calls.assessed.includes('a|b'));
  assert.ok(!updates.some(update => update.label.startsWith('Checking for a direct link')));
  assert.deepEqual(calls.paths[0].options.avoidPairs, []);
});

test('every link is verified, and success reports the verified evidence rather than the model claim', async () => {
  const { service } = fakeService([proposal(A, M, N, B)]);
  const result = await search(service);
  assert.equal(result.status, 'connected');
  if (result.status !== 'connected') return;
  assert.equal(result.degrees, 3);
  assert.deepEqual(result.chain.map(figure => figure.id), ['a', 'm', 'n', 'b']);
  assert.deepEqual(result.links.map(link => link.status), ['verified', 'verified', 'verified']);
  assert.deepEqual(result.links.map(link => link.evidence), [
    'Anna Alpha and Marco Middle worked together.', 'Marco Middle and Nora Next worked together.', 'Nora Next and Bruno Beta worked together.',
  ]);
  assert.ok(result.links.every(link => !link.evidence?.includes('The model says')));
  assert.deepEqual(result.newFigures, []);
});

test('a rejected link never appears as connected and verification does not stop at the first failure', async () => {
  const { service, calls } = fakeService([proposal(A, M, N, B), null, null, null], ['a|m', 'n|b']);
  const result = await search(service);
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') return;
  assert.equal(result.reason, 'unverified');
  assert.deepEqual(result.links.map(link => link.status), ['unverified', 'verified', 'unverified']);
  assert.deepEqual(result.links.map(link => link.evidence), [undefined, 'Marco Middle and Nora Next worked together.', undefined]);
  // All three proposed links were assessed even though the first one failed.
  assert.deepEqual(calls.assessed, ['a|m', 'm|n', 'n|b']);
  assert.deepEqual(pairs(result.avoidPairs), ['a|m', 'b|n']);
});

test('no proposal is a failed search with one marked gap, not an error', async () => {
  const { service } = fakeService([null]);
  const result = await search(service);
  assert.equal(result.status, 'failed');
  assert.equal(result.status === 'failed' && result.reason, 'no-path');
  assert.deepEqual(result.links.map(link => [link.from.id, link.to.id, link.status]), [['a', 'b', 'unverified']]);
});

test('repair keeps verified links, honours the known-bad pairs and the remaining budget', async () => {
  const { service, calls } = fakeService([proposal(A, M, B), proposal(M, N, B)], ['m|b']);
  const result = await search(service);
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.chain.map(figure => figure.id), ['a', 'm', 'n', 'b']);
  assert.equal(calls.assessed.filter(pair => pair === 'a|m').length, 1);
  const repair = calls.paths[1];
  assert.deepEqual([repair.from, repair.to], ['m', 'b']);
  assert.equal(repair.options.maxIntermediates, MAX_PATH_INTERMEDIATES - 1);
  assert.deepEqual(pairs(repair.options.avoidPairs), ['b|m']);
  assert.deepEqual(repair.options.exclude?.map(entry => entry.id), ['a']);
  assert.ok(!repair.options.catalog.some(entry => ['a', 'm', 'b'].includes(entry.id)));
});

test('repair stops after the repair budget and keeps the failed link as a gap', async () => {
  const [one, two, three, four] = ['One', 'Two', 'Three', 'Four'].map(name => newPersonToFigure(fresh(name)));
  const { service, calls } = fakeService([
    proposal(A, M, B), proposal(M, fresh('One'), B), proposal(one, fresh('Two'), B), proposal(two, fresh('Three'), B), proposal(three, fresh('Four'), B),
  ], ['m|b', `${one.id}|b`, `${two.id}|b`, `${three.id}|b`, `${four.id}|b`]);
  const result = await search(service);
  assert.equal(result.status, 'failed');
  assert.equal(calls.paths.length, 1 + MAX_PATH_REPAIRS);
  assert.deepEqual(result.chain.map(figure => figure.name), ['Anna Alpha', 'Marco Middle', 'One', 'Two', 'Three', 'Bruno Beta']);
  assert.deepEqual(result.links.map(link => link.status), ['verified', 'verified', 'verified', 'verified', 'unverified']);
});

test('a repair that finds nothing is not retried for the same link', async () => {
  const { service, calls } = fakeService([proposal(A, M, B), null], ['m|b']);
  const result = await search(service);
  assert.equal(result.status, 'failed');
  assert.equal(calls.paths.length, 2);
});

test('a repair is not attempted once the intermediate budget is spent', async () => {
  const many = Array.from({ length: MAX_PATH_INTERMEDIATES }, (_, index) => fresh(`Link ${index}`, 1500, 1650));
  const last = newPersonToFigure(many[many.length - 1]).id;
  const { service, calls } = fakeService([proposal(A, ...many, B)], [`${last}|b`]);
  const result = await search(service);
  assert.equal(result.status, 'failed');
  assert.equal(calls.paths.length, 1);
  assert.equal(result.chain.length, MAX_PATH_INTERMEDIATES + 2);
});

test('new names that match canvas people are mapped to them instead of being added again', async () => {
  const { service } = fakeService([proposal(A, fresh('MARCO  middle', 1520, 1590), fresh('Nora Next', 1540, 1610), fresh('Pia Plus'), B)]);
  const result = await search(service);
  assert.equal(result.status, 'connected');
  if (result.status !== 'connected') return;
  assert.deepEqual(result.chain.map(figure => figure.id).slice(0, 3), ['a', 'm', 'n']);
  assert.deepEqual(result.newFigures.map(figure => figure.name), ['Pia Plus']);
  assert.equal(result.newFigures[0].id, 'w-p-pia%20plus-1560-1620');
  assert.equal(result.newFigures[0].shortDescription, 'A scholar.');
});

test('a typed name that is not on the canvas is woven in with the intermediates', async () => {
  const outsider = newPersonToFigure(fresh('Henry Hidden', 1590, 1660));
  const { service } = fakeService([proposal(A, M, outsider)]);
  const result = await search(service, { to: outsider });
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.status === 'connected' && result.newFigures.map(figure => figure.id), [outsider.id]);
});

test('a proposal that repeats a person is treated as no path', async () => {
  const { service } = fakeService([proposal(A, M, fresh('Marco Middle', 1520, 1590), B)]);
  const result = await search(service);
  assert.equal(result.status === 'failed' && result.reason, 'no-path');
});

test('neighbours who never overlapped are never confirmed, whatever the model said', async () => {
  const early = person('early', 'Early Eve', 1300, 1350);
  const { service, calls } = fakeService([proposal(A, early, B)]);
  const result = await search(service, { figures: [...canvas, early] });
  assert.equal(result.status, 'failed');
  assert.ok(!calls.assessed.includes('a|early'));
  assert.ok(result.links.every(link => link.status === 'unverified'));
});

test('cached assessments in either direction cost no requests', async () => {
  const storage = new MemoryStorage();
  const first = fakeService([proposal(A, M, B)]);
  assert.equal((await search(first.service, { storage })).status, 'connected');
  assert.equal(first.calls.assessed.length, 2);
  // Searching in the other direction reuses every assessment.
  const second = fakeService([proposal(B, M, A)]);
  const reversed = await search(second.service, { storage, from: B, to: A });
  assert.equal(reversed.status, 'connected');
  assert.equal(second.calls.assessed.length, 0);
  assert.equal(reversed.status === 'connected' && reversed.degrees, 2);
});

test('try again keeps the known-bad pairs and reuses cached assessments', async () => {
  const storage = new MemoryStorage();
  const first = fakeService([proposal(A, M, B), null], ['m|b']);
  const failed = await search(first.service, { storage });
  assert.equal(failed.status, 'failed');
  if (failed.status !== 'failed') return;
  const retry = fakeService([proposal(A, M, N, B)], ['m|b']);
  const result = await search(retry.service, { storage, avoidPairs: failed.avoidPairs });
  assert.equal(result.status, 'connected');
  assert.deepEqual(retry.calls.assessed, ['m|n', 'n|b']);
  assert.deepEqual(pairs(retry.calls.paths[0].options.avoidPairs), ['b|m']);
});

test('progress lists each link as it is checked and ends with the verdicts', async () => {
  const { service } = fakeService([proposal(A, M, B)], ['m|b']);
  const updates: ConnectionProgress[] = [];
  await search(service, { onProgress: progress => updates.push(structuredClone(progress)) });
  assert.deepEqual(updates.map(update => update.label).filter((label, index, all) => all.indexOf(label) === index),
    ['Proposing a path…', 'Verifying each link…', 'Repairing Marco Middle → Bruno Beta…']);
  assert.deepEqual(updates.at(-1)!.links.map(link => [link.from, link.to, link.status]), [
    ['Anna Alpha', 'Marco Middle', 'verified'], ['Marco Middle', 'Bruno Beta', 'rejected'],
  ]);
  assert.ok(updates.some(update => update.links.some(link => link.status === 'checking')));
});

test('cancelling leaves the canvas untouched, and completed assessments stay cached', async () => {
  const controller = new AbortController();
  const storage = new MemoryStorage();
  const figures = structuredClone(canvas);
  const { service, calls } = fakeService([proposal(A, M, N, B)]);
  const original = service.fetchRelationshipExplanation;
  service.fetchRelationshipExplanation = async (first, second, signal) => {
    if (calls.assessed.length === 1) controller.abort(new Error('Cancelled by the user'));
    return original(first, second, signal);
  };
  await assert.rejects(search(service, { storage, figures, signal: controller.signal }), /Cancelled by the user/);
  assert.deepEqual(figures, canvas);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)!);
  assert.equal(keys.length, 1);
  assert.ok(keys[0].startsWith('chrono_assessment_'));
  assert.ok(!keys.some(key => key.startsWith('chrono_path_')));
});

test('cancelling before the search starts makes no request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Already cancelled'));
  const { service, calls } = fakeService([proposal(A, M, B)]);
  await assert.rejects(search(service, { signal: controller.signal }), /Already cancelled/);
  assert.equal(calls.paths.length + calls.assessed.length, 0);
});

test('feasibility compares the gap with the longest chain the limits allow', () => {
  const limit = MAX_PATH_INTERMEDIATES * 40;
  const early = person('early', 'Early', 1000, 1050);
  assert.deepEqual(checkConnectionFeasibility(early, person('exactly', 'Exactly', 1050 + limit, 1600)), { feasible: true, gapYears: limit, peopleNeeded: 10, message: null });
  const beyond = checkConnectionFeasibility(person('late', 'Late', 1050 + limit + 1, 1600), early);
  assert.equal(beyond.feasible, false);
  assert.equal(beyond.peopleNeeded, 11);
  assert.equal(checkConnectionFeasibility(person('overlap', 'Overlap', 1020, 1100), early).gapYears, 0);
});

test('an honest refusal names both people and the real numbers', () => {
  const cleopatra = person('cleopatra', 'Cleopatra', -69, -30, 'LEADERS & BADDIES');
  const einstein = person('einstein', 'Albert Einstein', 1879, 1955, 'SCIENTISTS');
  const verdict = checkConnectionFeasibility(einstein, cleopatra);
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.message, 'Cleopatra and Albert Einstein lived about 1,900 years apart. A chain of personal contacts would need about 48 people, more than the limit of 10.');
});

test('living people use the current year as their death year', () => {
  assert.equal(checkConnectionFeasibility(person('living', 'Living', 1950, 2026), person('born', 'Born', 1990, 2026), 2026).gapYears, 0);
  // A death year in the future is clamped to the current year rather than overlapping everyone.
  assert.equal(checkConnectionFeasibility(person('future', 'Future', 1500, 9999), person('later', 'Later', 3000, 3010), 2026).gapYears, 974);
});

test('target classification refuses the source, events, and people too far away without an AI call', () => {
  const verdict = (candidate: HistoricalFigure) => { const status = classifyConnectionTarget(A, candidate); return 'reason' in status ? status.reason : 'ok'; };
  assert.deepEqual(classifyConnectionTarget(A, A), { ok: false, reason: 'self', message: 'Choose someone other than Anna Alpha.' });
  assert.equal(verdict(person('twin', 'anna  ALPHA', 1500, 1560)), 'self');
  assert.equal(verdict(person('war', 'A War', 1500, 1520, 'EVENTS')), 'event');
  assert.equal(verdict(person('far', 'Far Future', 2200, 2250)), 'too-far');
  assert.equal(verdict(B), 'ok');
});

test('the catalog keeps people near the span between the endpoints, closest first, without events or endpoints', () => {
  const from = person('from', 'From', 1450, 1500);
  const to = person('to', 'To', 1600, 1650);
  const inside = person('inside', 'Inside', 1520, 1590);
  const justOutside = person('edge', 'Edge', 1400, 1451);
  const tooEarly = person('early', 'Early', 1300, 1449);
  const tooLate = person('late', 'Late', 1701, 1760);
  const event = person('war', 'War', 1520, 1590, 'EVENTS');
  const catalog = buildPathCatalog([to, from, tooLate, event, justOutside, tooEarly, inside], from, to);
  assert.deepEqual(catalog.map(entry => entry.id), ['inside', 'edge']);
  assert.deepEqual(catalog[0], { id: 'inside', name: 'Inside', birthYear: 1520, deathYear: 1590 });
  // The same span in either direction yields the same candidates.
  assert.deepEqual(buildPathCatalog([from, to, inside, justOutside], to, from).map(entry => entry.id), ['inside', 'edge']);
});

test('the catalog is capped and prefers people closest to the middle of the span', () => {
  const from = person('from', 'From', 1000, 1050);
  const to = person('to', 'To', 1400, 1450);
  const crowd = Array.from({ length: PATH_CATALOG_LIMIT + 40 }, (_, index) => person(`p${String(index).padStart(3, '0')}`, `Person ${index}`, 1100 + index, 1160 + index));
  const ids = buildPathCatalog(crowd, from, to).map(entry => entry.id);
  assert.equal(ids.length, PATH_CATALOG_LIMIT);
  assert.ok(!ids.includes('p000') && !ids.includes('p189') && ids.includes('p095'));
  assert.equal(buildPathCatalog(crowd, from, to, 5).length, 5);
  assert.equal(buildPathCatalog(crowd, from, to, 0).length, 0);
});

const resolver = (answer: NewPerson | null) => {
  const names: string[] = [];
  return { names, service: { resolveFigure: async (name: string) => { names.push(name); return answer; } } };
};
const resolve = (service: ReturnType<typeof resolver>['service'], name: string, figures = canvas) =>
  resolveConnectionTarget(service, name, A, figures, new AbortController().signal);

test('a typed name that is already on the canvas needs no request', async () => {
  const { service, names } = resolver(null);
  assert.deepEqual(await resolve(service, '  marco   MIDDLE '), { figure: M });
  assert.deepEqual(names, []);
});

test('a typed name is identified by the model and matched against the canvas by its canonical name', async () => {
  const { service, names } = resolver(fresh('Nora Next', 1540, 1610));
  assert.deepEqual(await resolve(service, 'nora of the next valley'), { figure: N });
  assert.deepEqual(names, ['nora of the next valley']);
  const stranger = resolver(fresh('Henry Hidden', 1590, 1660));
  const result = await resolve(stranger.service, 'Henry');
  assert.deepEqual(result, { figure: newPersonToFigure(fresh('Henry Hidden', 1590, 1660)) });
});

test('names the model cannot identify, events, the source, and people too far away show an inline error', async () => {
  assert.deepEqual(await resolve(resolver(null).service, 'Zzyzx'), { message: "Couldn't identify that person. Try their full name." });
  const war = person('war', 'The Long War', 1500, 1520, 'EVENTS');
  assert.deepEqual(await resolve(resolver(null).service, 'the long war', [...canvas, war]), { message: 'Connections link people, not events.' });
  assert.deepEqual(await resolve(resolver(fresh('Anna Alpha', 1500, 1560)).service, 'Anna'), { message: 'Choose someone other than Anna Alpha.' });
  const far = await resolve(resolver(fresh('Far Future', 2200, 2250)).service, 'Far');
  assert.ok('message' in far && /years apart/.test(far.message));
});

test('cancelling stops name resolution before and after the model answers', async () => {
  const controller = new AbortController();
  const slow = { resolveFigure: async () => { controller.abort(new Error('Cancelled')); return fresh('Henry Hidden', 1590, 1660); } };
  await assert.rejects(resolveConnectionTarget(slow, 'Henry', A, canvas, controller.signal), /Cancelled/);
  await assert.rejects(resolveConnectionTarget(slow, 'Henry', A, canvas, controller.signal), /Cancelled/);
});
