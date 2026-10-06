import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDiscoveryCluster, emptyClusters, restoreClusters, serializeClusters } from '../src/utils/discoveryClusters';
import { calculateTimelineLayout } from '../src/utils/timelineLayout';
import { ClusterPlacement, DiscoveryClusterState, HistoricalFigure, LayoutData } from '../src/types';
import { figure } from './helpers';

const person = (id: string, birthYear = 1815): HistoricalFigure => ({ ...figure, id, name: id, birthYear, deathYear: birthYear + 50 });
const placementsOf = (layout: LayoutData[]): Record<string, ClusterPlacement> => Object.fromEntries(layout.map(({ figure, level, labelLevel, labelYearOffset }) => [figure.id, { level, labelLevel, labelYearOffset }]));
const capture = (figures: HistoricalFigure[], state: DiscoveryClusterState) => {
  const resolved = placementsOf(calculateTimelineLayout(figures, state.clusters, state.placements).layoutData);
  return { ...state, placements: Object.fromEntries([...new Set(state.clusters.flatMap(cluster => cluster.memberIds))].map(id => [id, resolved[id]])) };
};

test('further expansions keep all prior rows, including a shared source, without overlapping bars', () => {
  let figures = [person('ordinary'), person('source')];
  let state = addDiscoveryCluster(emptyClusters(), 'source', ['first', 'second'], placementsOf(calculateTimelineLayout(figures).layoutData));
  figures = [...figures, person('first'), person('second')];
  state = capture(figures, state);
  const original = { ...state.placements };
  state = addDiscoveryCluster(state, 'first', ['third'], state.placements);
  figures = [...figures, person('third')];
  state = capture(figures, state);
  state = addDiscoveryCluster(state, 'source', ['fourth'], state.placements);
  figures = [...figures, person('fourth')];
  state = capture(figures, state);
  for (const id of Object.keys(original)) assert.deepEqual(state.placements[id], original[id]);
  const layout = calculateTimelineLayout(figures, state.clusters, state.placements).layoutData;
  assert.equal(new Set(layout.map(item => item.figure.id)).size, figures.length);
  assert.equal(new Set(layout.map(item => item.level)).size, figures.length);
  assert.equal(state.clusters[1].memberIds.filter(id => id === 'first').length, 1);
});

test('retained placements survive restoration and only source plus new figures are members', () => {
  const figures = [person('existing-related'), person('source'), person('new')];
  const state = capture(figures, addDiscoveryCluster(emptyClusters(), 'source', ['new'], {}));
  const restored = restoreClusters(serializeClusters(figures, state), figures, true);
  assert.deepEqual(restored, state);
  assert.deepEqual(restored.clusters[0].memberIds, ['source', 'new']);
  assert.deepEqual(placementsOf(calculateTimelineLayout(figures, restored.clusters, restored.placements).layoutData), placementsOf(calculateTimelineLayout(figures, state.clusters, state.placements).layoutData));
  assert.deepEqual(addDiscoveryCluster(state, 'existing-related', [], {}), state);
});

test('metadata from another timeline, malformed data, and disabled retention are ignored', () => {
  const figures = [figure, person('new')];
  const state = capture(figures, addDiscoveryCluster(emptyClusters(), figure.id, ['new'], {}));
  const saved = serializeClusters(figures, state);
  assert.deepEqual(restoreClusters(saved, figures, false), emptyClusters());
  assert.deepEqual(restoreClusters(saved, [{ ...figure, birthYear: 1800 }, figures[1]], true), emptyClusters());
  assert.deepEqual(restoreClusters('{bad JSON', figures, true), emptyClusters());
  const invalid = JSON.parse(saved);
  invalid.clusters.push(null, { sourceId: 'missing', memberIds: ['new'] });
  invalid.placements.new.level = 1e12;
  invalid.placements.unrelated = { level: 0 };
  const restored = restoreClusters(JSON.stringify(invalid), figures, true);
  assert.equal(restored.clusters.length, 1);
  assert.equal(restored.placements.new, undefined);
  assert.equal(restored.placements.unrelated, undefined);
});

test('temporary cluster layout releases when membership is cleared and ordinary figures can move', () => {
  const figures = [person('ordinary', 1800), person('source', 1815), person('new', 1820)];
  const normal = calculateTimelineLayout(figures).layoutData;
  const state = capture(figures, addDiscoveryCluster(emptyClusters(), 'source', ['new'], {}));
  assert.notEqual(state.placements.source.level, normal.find(item => item.figure.id === 'source')!.level);
  assert.deepEqual(calculateTimelineLayout(figures, [], {}).layoutData, normal);
});

test('new members use free space near a retained source instead of restarting at row zero', () => {
  const figures = [person('source', 1800), person('new', 1900), person('ordinary', 1800)];
  const state = addDiscoveryCluster(emptyClusters(), 'source', ['new'], { source: { level: 4 } });
  const layout = calculateTimelineLayout(figures, state.clusters, state.placements).layoutData;
  assert.equal(layout.find(item => item.figure.id === 'source')!.level, 4);
  assert.equal(layout.find(item => item.figure.id === 'new')!.level, 4);
  assert.equal(layout.find(item => item.figure.id === 'ordinary')!.level, 0);
});

test('retained short-event labels keep their placement as new events are added', () => {
  const event = { ...person('short-event'), category: 'EVENTS' as const, deathYear: 1820 };
  const figures = [person('source'), event];
  const state = capture(figures, addDiscoveryCluster(emptyClusters(), 'source', [event.id], {}));
  const moreFigures = [...figures, { ...event, id: 'second-event', name: 'Second Event' }];
  const next = addDiscoveryCluster(state, 'source', ['second-event'], state.placements);
  const layout = calculateTimelineLayout(moreFigures, next.clusters, next.placements).layoutData;
  assert.deepEqual(placementsOf(layout)[event.id], state.placements[event.id]);
  assert.ok(layout.find(item => item.figure.id === 'second-event')!.labelLevel !== undefined);
});

test('conflicting saved rows are repaired without skipping short-event label placement', () => {
  const event = { ...person('event'), category: 'EVENTS' as const, deathYear: 1820 };
  const figures = [person('source'), event];
  const layout = calculateTimelineLayout(figures, [{ sourceId: 'source', memberIds: ['source', 'event'] }], { source: { level: 0 }, event: { level: 0 } }).layoutData;
  assert.equal(layout.find(item => item.figure.id === 'source')!.level, 0);
  assert.notEqual(layout.find(item => item.figure.id === 'event')!.level, 0);
  assert.ok(layout.find(item => item.figure.id === 'event')!.labelLevel !== undefined);
});
