import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideConnectionStart, retryRequest, runConnectionSearch, savedConnectionView, settleConnection,
  type CanvasState, type ConnectionFlowEffects, type ConnectionView,
} from '../src/services/connectionFlow';
import type { ConnectionResult } from '../src/services/connectionPath';
import type { ConnectionPathOptions, ConnectionPathProposal, FigureCategory, HistoricalFigure, IAIService, NewPerson } from '../src/types';
import { CANVAS_LAYOUT_VERSION } from '../src/utils/canvasLayout';
import { readConnectionPath, saveConnectionPath, wovenFigureIds } from '../src/utils/connectionPaths';
import { emptyClusters } from '../src/utils/discoveryClusters';
import { MemoryStorage } from './helpers';

const person = (id: string, name: string, birthYear: number, deathYear: number, category: FigureCategory = 'ARTISTS'): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category });
const A = person('a', 'Anna Alpha', 1500, 1560);
const M = person('m', 'Marco Middle', 1520, 1590);
const N = person('n', 'Nora Next', 1540, 1610);
const B = person('b', 'Bruno Beta', 1580, 1650);
const event = person('war', 'The Long War', 1500, 1520, 'EVENTS');
const fresh = (name: string, birthYear: number, deathYear: number): NewPerson =>
  ({ name, birthYear, deathYear, occupation: 'Scholar', category: 'THINKERS', description: 'A scholar.' });

const canvasState = (figures: HistoricalFigure[]): CanvasState => ({
  figures, placements: {}, clusters: emptyClusters(), selectedCategories: new Set<FigureCategory>(),
  config: { start: 1400, end: 1800, layoutMode: 'timeline', layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'automatic' },
});

// Records everything a search does to the outside world, in order.
function recorder(figures: HistoricalFigure[], isCurrent: () => boolean = () => true) {
  const log: string[] = [];
  const shown: ConnectionView[] = [];
  const woven: Array<{ ids: string[] }> = [];
  const canvas = canvasState(figures);
  const effects: ConnectionFlowEffects = {
    isCurrent,
    progress: progress => log.push(`progress:${progress.label}`),
    canvas: () => canvas,
    applyWoven: next => { log.push('weave'); woven.push({ ids: next.newIds }); },
    pathsChanged: () => log.push('paths'),
    show: view => { log.push(`show:${view.status}`); shown.push(view); },
    failPicking: message => log.push(`picking:${message}`),
    notify: (message, type) => log.push(`notify:${type}:${message}`),
  };
  return { effects, log, shown, woven, canvas };
}

const proposal = (...nodes: Array<HistoricalFigure | NewPerson>): ConnectionPathProposal => ({
  nodes: nodes.map(node => 'id' in node ? { id: node.id } : node), links: nodes.slice(1).map(() => ({ claim: 'They met.' })),
});

// A fake provider: proposals come from a queue, verification refuses the listed unordered pairs, and every request is counted.
function fakeService(proposals: Array<ConnectionPathProposal | null> = [], refused: string[] = [], resolved: NewPerson | null = null) {
  const calls = { paths: [] as ConnectionPathOptions[], assessed: 0, resolved: 0 };
  const service = {
    fetchConnectionPath: async (_from: HistoricalFigure, _to: HistoricalFigure, options: ConnectionPathOptions) => { calls.paths.push(options); return proposals.shift() ?? null; },
    fetchRelationshipExplanation: async (first: HistoricalFigure, second: HistoricalFigure, _signal?: AbortSignal, options?: { contactOnly?: boolean }) => {
      calls.assessed++;
      if (!options?.contactOnly) throw new Error('Six Degrees must verify contact only');
      return refused.includes([first.id, second.id].sort().join('|'))
        ? { isRelevant: false, evidence: '', summary: 'No link.', sections: [{ title: 'Assessment', content: 'None.' }] }
        : { isRelevant: true, evidence: `${first.name} and ${second.name} worked together.`, summary: 'They worked together.', sections: [{ title: 'Work', content: 'Details.' }] };
    },
    resolveFigure: async () => { calls.resolved++; return resolved; },
  } as unknown as IAIService;
  return { service, calls };
}

const run = (overrides: Partial<Parameters<typeof runConnectionSearch>[0]> & Pick<Parameters<typeof runConnectionSearch>[0], 'service' | 'effects'>) =>
  runConnectionSearch({ storage: new MemoryStorage(), figures: [A, M, N, B], from: A, target: { figure: B }, signal: new AbortController().signal, ...overrides });

test('a success weaves first, then saves the path and the woven-in people once, then shows and announces it', async () => {
  const storage = new MemoryStorage();
  const stranger = fresh('Cara Gamma', 1550, 1620);
  const { service } = fakeService([proposal(A, M, stranger, B)]);
  const { effects, log, shown, woven } = recorder([A, M, B]);
  await run({ service, effects, storage, figures: [A, M, B] });
  const order = log.filter(entry => !entry.startsWith('progress:'));
  assert.deepEqual(order.map(entry => entry.split(':')[0]), ['weave', 'paths', 'show', 'notify']);
  assert.equal(woven.length, 1);
  assert.equal(woven[0].ids.length, 1);
  assert.match(order[3], /notify:success:Wove in 1 person to connect Anna Alpha and Bruno Beta: Cara Gamma/);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].status, 'connected');
  assert.deepEqual(shown[0].chain.map(figure => figure.name), ['Anna Alpha', 'Marco Middle', 'Cara Gamma', 'Bruno Beta']);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)!);
  assert.equal(keys.filter(key => key.startsWith('chrono_path_')).length, 1);
  assert.deepEqual([...wovenFigureIds(storage)], woven[0].ids);
});

test('a failed search shows the pieces and a message, and neither weaves nor saves anything', async () => {
  const storage = new MemoryStorage();
  const { service } = fakeService([proposal(A, M, B), null], ['b|m']);
  const { effects, log, shown, woven, canvas } = recorder([A, M, N, B]);
  const before = structuredClone(canvas);
  await run({ service, effects, storage });
  assert.deepEqual(woven, []);
  assert.ok(!log.includes('weave') && !log.includes('paths'));
  assert.deepEqual(shown.map(view => view.status), ['failed']);
  assert.deepEqual(shown[0].avoidPairs?.map(([first, second]) => [first.id, second.id].sort().join('|')), ['b|m']);
  assert.match(log.at(-1)!, /notify:info:We couldn't verify a chain of personal contacts between Anna Alpha and Bruno Beta\./);
  assert.deepEqual(canvas, before);
  assert.ok(Array.from({ length: storage.length }, (_, index) => storage.key(index)!).every(key => key.startsWith('chrono_contact_')));
  assert.equal(wovenFigureIds(storage).size, 0);
});

test('a search that was cancelled or replaced while it ran never weaves, saves, or shows anything', async () => {
  const storage = new MemoryStorage();
  let current = true;
  const { service } = fakeService([proposal(A, M, fresh('Cara Gamma', 1550, 1620), B)]);
  const original = service.fetchConnectionPath;
  // The user cancels while the model is still working; the answer arrives anyway.
  service.fetchConnectionPath = async (...args) => { const result = await original(...args); current = false; return result; };
  const { effects, log, shown, woven } = recorder([A, M, B], () => current);
  await run({ service, effects, storage, figures: [A, M, B] });
  assert.deepEqual(woven, []);
  assert.deepEqual(shown, []);
  assert.ok(!log.some(entry => /^(weave|paths|show|notify|picking)/.test(entry)), log.join(', '));
  assert.ok(Array.from({ length: storage.length }, (_, index) => storage.key(index)!).every(key => !key.startsWith('chrono_path_') && !key.startsWith('chrono_woven_')));

  // The same holds for a result that is settled after the search has gone stale.
  const stale = recorder([A, M, B], () => false);
  const result: ConnectionResult = { status: 'connected', chain: [A, B], links: [{ from: A, to: B, status: 'verified', evidence: 'x' }], degrees: 1, newFigures: [] };
  settleConnection({ result, request: { from: A, to: B }, storage, effects: stale.effects });
  assert.deepEqual(stale.log, []);
  assert.equal(readConnectionPath(storage, [A, B], 'a', 'b'), null);
});

test('an aborted signal ends the search quietly: no toast, no weave, no save', async () => {
  const controller = new AbortController();
  const { service } = fakeService([proposal(A, M, B)]);
  const original = service.fetchRelationshipExplanation;
  service.fetchRelationshipExplanation = async (...args) => { controller.abort(new DOMException('Cancelled', 'AbortError')); return original(...args); };
  const storage = new MemoryStorage();
  let current = true;
  const { effects, log } = recorder([A, M, B], () => current && !controller.signal.aborted);
  await run({ service, effects, storage, figures: [A, M, B], signal: controller.signal });
  current = false;
  assert.ok(!log.some(entry => /^(weave|paths|show|notify|picking)/.test(entry)), log.join(', '));
  assert.equal(Array.from({ length: storage.length }, (_, index) => storage.key(index)!).filter(key => key.startsWith('chrono_path_')).length, 0);
});

test('a connection between people already on the canvas weaves nothing and says how many degrees apart', async () => {
  const { service } = fakeService([proposal(A, M, B)]);
  const storage = new MemoryStorage();
  const { effects, log, woven } = recorder([A, M, B]);
  await run({ service, effects, storage, figures: [A, M, B] });
  assert.deepEqual(woven[0].ids, []);
  assert.match(log.at(-1)!, /notify:success:Anna Alpha and Bruno Beta are 2 degrees apart\./);
  assert.equal(wovenFigureIds(storage).size, 0, 'nobody was woven in, so nobody is recorded');
  assert.ok(readConnectionPath(storage, [A, M, B], 'a', 'b'));
});

test('a saved path replays with no AI call, in either direction, both for picked and typed people', () => {
  const storage = new MemoryStorage();
  saveConnectionPath(storage, [A, M, B], ['Anna and Marco.', 'Marco and Bruno.'], 1);
  const figures = [A, M, B];
  const forward = decideConnectionStart(A, { figure: B }, figures, storage);
  assert.equal(forward.kind, 'replay');
  assert.deepEqual(forward.kind === 'replay' && forward.saved.figures.map(figure => figure.id), ['a', 'm', 'b']);
  const backward = decideConnectionStart(B, { figure: A }, figures, storage);
  assert.deepEqual(backward.kind === 'replay' && backward.saved.figures.map(figure => figure.id), ['b', 'm', 'a']);
  assert.deepEqual(backward.kind === 'replay' && backward.saved.evidence, ['Marco and Bruno.', 'Anna and Marco.']);
  const typed = decideConnectionStart(B, { name: '  anna ALPHA ' }, figures, storage);
  assert.equal(typed.kind, 'replay');
  assert.deepEqual(savedConnectionView(backward.kind === 'replay' ? backward.saved : { figures: [], evidence: [] }).request, { from: B, to: A });
});

test('a typed name that is on the canvas is classified like a picked person before any search starts', () => {
  const storage = new MemoryStorage();
  const figures = [A, M, B, event, person('far', 'Far Future', 2200, 2250)];
  assert.deepEqual(decideConnectionStart(A, { name: 'marco middle' }, figures, storage), { kind: 'search', target: { figure: M } });
  assert.deepEqual(decideConnectionStart(A, { name: 'the long war' }, figures, storage), { kind: 'refuse', message: 'Connections link people, not events.' });
  assert.deepEqual(decideConnectionStart(A, { name: 'ANNA alpha' }, figures, storage), { kind: 'refuse', message: 'Choose someone other than Anna Alpha.' });
  const far = decideConnectionStart(A, { name: 'Far Future' }, figures, storage);
  assert.ok(far.kind === 'refuse' && /years apart/.test(far.message));
  // A name that is not on the canvas still needs the model.
  assert.deepEqual(decideConnectionStart(A, { name: 'Henry' }, figures, storage), { kind: 'search', target: { name: 'Henry' } });
  assert.deepEqual(decideConnectionStart(A, { figure: event }, figures, storage), { kind: 'refuse', message: 'Connections link people, not events.' });
});

test('a typed name that is not on the canvas is resolved, refused inline, or replayed from a saved path', async () => {
  const storage = new MemoryStorage();
  const unknown = fakeService([], [], null);
  const none = recorder([A, M, B]);
  await run({ service: unknown.service, effects: none.effects, storage, figures: [A, M, B], target: { name: 'Zzyzx' } });
  assert.deepEqual(none.log, ['progress:Identifying Zzyzx…', "picking:Couldn't identify that person. Try their full name."]);
  assert.equal(unknown.calls.paths.length + unknown.calls.assessed, 0);

  const failing = { ...unknown.service, resolveFigure: async () => { throw new Error('unusable data'); } } as IAIService;
  const broken = recorder([A, M, B]);
  await run({ service: failing, effects: broken.effects, storage, figures: [A, M, B], target: { name: 'Zzyzx' } });
  assert.equal(broken.log.filter(entry => entry.startsWith('picking:')).length, 1);
  assert.ok(!broken.log.some(entry => entry.startsWith('notify:')), 'a name that cannot be identified is an inline error, not a toast');

  // Identified as someone with a saved path: replayed, with no search.
  saveConnectionPath(storage, [A, M, B], ['x', 'y'], 1);
  const known = fakeService([], [], fresh('Bruno Beta', 1580, 1650));
  const replayed = recorder([A, M, B]);
  await run({ service: known.service, effects: replayed.effects, storage, figures: [A, M, B], target: { name: 'Bruno' } });
  assert.deepEqual(replayed.shown.map(view => view.status), ['connected']);
  assert.equal(known.calls.paths.length + known.calls.assessed, 0);
});

test('try again passes the known-bad pairs to the next search and only exists for a failed one', async () => {
  const { service } = fakeService([proposal(A, M, B), null], ['b|m']);
  const first = recorder([A, M, N, B]);
  await run({ service, effects: first.effects });
  const failed = first.shown[0];
  assert.equal(failed.status, 'failed');
  const request = retryRequest(failed);
  assert.ok(request);
  assert.deepEqual(request!.from, A);
  assert.deepEqual(request!.target, { figure: B });
  assert.equal(request!.avoidPairs.length, 1);

  const retry = fakeService([proposal(A, M, N, B)], ['b|m']);
  const second = recorder([A, M, N, B]);
  await run({ service: retry.service, effects: second.effects, target: request!.target, avoidPairs: request!.avoidPairs });
  assert.deepEqual(retry.calls.paths[0].avoidPairs.map(([x, y]) => [x.id, y.id].sort().join('|')), ['b|m']);
  assert.equal(second.shown[0].status, 'connected');

  assert.equal(retryRequest(null), null);
  assert.equal(retryRequest(savedConnectionView({ figures: [A, B], evidence: ['x'] })), null);
});
