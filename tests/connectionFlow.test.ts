import { saveTestConnectionPath as saveConnectionPath } from './connectionFixtures';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideConnectionStart, runConnectionSearch, settleConnection, savedConnectionView, type CanvasState, type ConnectionFlowEffects } from '../src/services/connectionFlow';
import { findConnection } from '../src/services/connectionPath';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { listConnectionPaths, readConnectionPath,  wovenFigureIds } from '../src/utils/connectionPaths';
import { emptyClusters } from '../src/utils/discoveryClusters';
import { MemoryStorage } from './helpers';
import { A, B, M, N, fakeContacts, person } from './connectionFixtures';
import type { IAIService } from '../src/types';

function recorder(current = true) {
  const log: string[] = [], canvas: CanvasState = { figures: [A, B], config: { start: 1400, end: 1800, layoutMode: 'timeline', layoutVersion: 3, layoutSelection: 'manual' },
    clusters: emptyClusters(), placements: {}, selectedCategories: new Set() };
  const effects: ConnectionFlowEffects = { isCurrent: () => current, progress: () => {}, canvas: () => canvas,
    applyWoven: woven => { log.push('weave'); canvas.figures = woven.figures; }, pathsChanged: () => log.push('paths'), show: () => log.push('show'),
    exploration: session => log.push(session.status), failPicking: () => log.push('picker'), notify: (_message, type) => log.push(type) };
  return { effects, log, canvas };
}
const search = async () => findConnection({ service: fakeContacts([[A, M], [M, N], [N, B]]).service, from: A, to: B, figures: [A, B], signal: new AbortController().signal });
test('settlement validates accepted contacts, uses the current canvas and persists replay evidence', async () => {
  const result = await search(), storage = new MemoryStorage(), r = recorder();
  // Another operation has already added M under a different canvas id while the model ran.
  r.canvas.figures.push({ ...M, id: 'canvas-middle' });
  settleConnection({ result, request: { from: A, to: B }, storage, effects: r.effects });
  assert.deepEqual(r.log, ['weave', 'paths', 'show', 'success']);
  assert.equal(r.canvas.figures.filter(p => p.name === M.name).length, 1);
  const saved = readConnectionPath(storage, r.canvas.figures, A.id, B.id)!;
  assert.ok(saved); assert.equal(saved.contacts?.length, 3); assert.equal(wovenFigureIds(storage).size, 1);
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
  await findConnection({ service: fake.service, from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository, canvasId: 'one', limits: { tasks: 2 } });
  const before = fake.calls.seeds + fake.calls.discovery.length + fake.calls.assessments.length, r = recorder();
  await runConnectionSearch({ service: fake.service as IAIService, from: B, target: { figure: A }, figures: [A, B], storage: new MemoryStorage(), signal: new AbortController().signal, repository, canvasId: 'one', effects: r.effects });
  assert.equal(fake.calls.seeds + fake.calls.discovery.length + fake.calls.assessments.length, before); assert.deepEqual(r.log, ['paused']);
});
test('cancelled or stale search has no canvas side effects or error toast', async () => {
  const controller = new AbortController(), fake = fakeContacts([[A, M]]), r = recorder();
  r.effects.isCurrent = () => !controller.signal.aborted;
  fake.service.discoverPersonalContacts = async () => { controller.abort(); return []; };
  const storage = new MemoryStorage();
  await runConnectionSearch({ service: fake.service as IAIService, from: A, target: { figure: B }, figures: [A, B], storage, signal: controller.signal, effects: r.effects });
  assert.ok(!r.log.includes('weave') && !r.log.includes('error')); assert.equal(listConnectionPaths(storage, r.canvas.figures).length, 0);
});
test('events and invalid identities are refused, distant real people remain eligible', () => {
  const storage = new MemoryStorage(); assert.equal(decideConnectionStart(A, { figure: { ...B, category: 'EVENTS' } }, [A, B], storage).kind, 'refuse');
  assert.equal(decideConnectionStart(A, { figure: person('Ancient', -1000, -900) }, [A, B], storage).kind, 'search');
});
