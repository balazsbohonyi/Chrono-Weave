import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_LAYOUT_VERSION } from '../src/utils/canvasLayout';
import { connectionClusterRuns, extendConnectionRange, weaveConnectionIntoCanvas } from '../src/utils/weaveConnection';
import { emptyClusters } from '../src/utils/discoveryClusters';
import type { CanvasConfig, FigureCategory, HistoricalFigure } from '../src/types';

const person = (id: string, birthYear: number, deathYear: number, category: FigureCategory = 'ARTISTS'): HistoricalFigure =>
  ({ id, name: id, birthYear, deathYear, occupation: 'Painter', category });
const config = (overrides: Partial<CanvasConfig> = {}): CanvasConfig =>
  ({ start: 1500, end: 1700, layoutMode: 'timeline', layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'automatic', ...overrides });
const [a, b, c, d, e] = [person('a', 1500, 1560), person('b', 1520, 1590), person('c', 1540, 1610), person('d', 1580, 1650), person('e', 1600, 1680)];

test('each consecutive run of new people is anchored on the existing node just before it', () => {
  assert.deepEqual(connectionClusterRuns([a, b, c, d, e], new Set(['b', 'c', 'e'])), [
    { sourceId: 'a', memberIds: ['b', 'c'] }, { sourceId: 'd', memberIds: ['e'] },
  ]);
  assert.deepEqual(connectionClusterRuns([a, b, c], new Set()), []);
  assert.deepEqual(connectionClusterRuns([a, b, c], new Set(['b'])), [{ sourceId: 'a', memberIds: ['b'] }]);
  // A run at the very start has no earlier node to hang from.
  assert.deepEqual(connectionClusterRuns([a, b], new Set(['a'])), []);
});

test('the range only grows when new people fall outside it, with small padding', () => {
  const range = { start: 1500, end: 1700 };
  assert.deepEqual(extendConnectionRange(range, [person('in', 1550, 1650)]), range);
  assert.deepEqual(extendConnectionRange(range, []), range);
  assert.deepEqual(extendConnectionRange(range, [person('early', 1443, 1500)]), { start: 1420, end: 1700 });
  assert.deepEqual(extendConnectionRange(range, [person('late', 1650, 1727)]), { start: 1500, end: 1750 });
  assert.deepEqual(extendConnectionRange(range, [person('early', 1443, 1500), person('late', 1650, 1727)]), { start: 1420, end: 1750 });
});

test('weaving adds the new people once, one cluster per run, and leaves nothing out of range or filtered', () => {
  const woven = weaveConnectionIntoCanvas({
    figures: [a, d], config: config(), clusters: emptyClusters(), placements: { a: { level: 2 }, d: { level: 0 } },
    selectedCategories: new Set<FigureCategory>(['ARTISTS']), chain: [a, b, c, d, person('far', 1690, 1750, 'SCIENTISTS')],
    newFigures: [b, c, person('far', 1690, 1750, 'SCIENTISTS'), b],
  });
  assert.deepEqual(woven.figures.map(figure => figure.id), ['a', 'd', 'b', 'c', 'far']);
  assert.deepEqual(woven.newIds, ['b', 'c', 'far']);
  assert.deepEqual(woven.clusters.clusters, [
    { sourceId: 'a', memberIds: ['a', 'b', 'c'] }, { sourceId: 'd', memberIds: ['d', 'far'] },
  ]);
  assert.deepEqual(woven.clusters.placements, { a: { level: 2 }, d: { level: 0 } });
  assert.deepEqual([woven.config.start, woven.config.end], [1500, 1770]);
  assert.deepEqual([...woven.selectedCategories].sort(), ['ARTISTS', 'SCIENTISTS']);
});

test('gallery canvases are appended without clusters, like discovery', () => {
  const woven = weaveConnectionIntoCanvas({
    figures: [a, d], config: config({ layoutMode: 'gallery' }), clusters: emptyClusters(), placements: {},
    selectedCategories: new Set(), chain: [a, b, d], newFigures: [b],
  });
  assert.deepEqual(woven.figures.map(figure => figure.id), ['a', 'd', 'b']);
  assert.deepEqual(woven.clusters, emptyClusters());
  assert.equal(woven.selectedCategories.size, 0);
});

test('a themed canvas widens its scope to include the categories of the people woven in', () => {
  const context = { mode: 'theme' as const, query: 'Painters', inferredStartYear: 1500, inferredEndYear: 1700, themeDescription: 'Painters', activeCategories: ['ARTISTS' as const] };
  const woven = weaveConnectionIntoCanvas({
    figures: [a], config: config({ weaveContext: context }), clusters: emptyClusters(), placements: {},
    selectedCategories: new Set(), chain: [a, person('t', 1510, 1560, 'THINKERS')], newFigures: [person('t', 1510, 1560, 'THINKERS')],
  });
  assert.deepEqual(woven.config.weaveContext?.activeCategories, ['ARTISTS', 'THINKERS']);
  const all = weaveConnectionIntoCanvas({
    figures: [a], config: config({ weaveContext: { ...context, activeCategories: ['ALL'] } }), clusters: emptyClusters(), placements: {},
    selectedCategories: new Set(), chain: [a, b], newFigures: [b],
  });
  assert.deepEqual(all.config.weaveContext?.activeCategories, ['ALL']);
});

test('weaving nobody new leaves the canvas exactly as it was', () => {
  const input = { figures: [a, b], config: config(), clusters: emptyClusters(), placements: {}, selectedCategories: new Set<FigureCategory>(), chain: [a, b], newFigures: [] as HistoricalFigure[] };
  const woven = weaveConnectionIntoCanvas(input);
  assert.equal(woven.figures, input.figures);
  assert.equal(woven.config, input.config);
  assert.equal(woven.clusters, input.clusters);
  assert.deepEqual(woven.newIds, []);
  assert.equal(weaveConnectionIntoCanvas({ ...input, newFigures: [a] }).figures, input.figures);
});
