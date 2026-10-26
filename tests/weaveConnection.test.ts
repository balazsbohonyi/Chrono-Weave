import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_LAYOUT_VERSION } from '../src/utils/canvasLayout';
import { extendConnectionRange, weaveConnectionIntoCanvas } from '../src/utils/weaveConnection';
import type { CanvasConfig, FigureCategory, HistoricalFigure } from '../src/types';

const person = (id: string, birthYear: number, deathYear: number, category: FigureCategory = 'ARTISTS'): HistoricalFigure =>
  ({ id, name: id, birthYear, deathYear, occupation: 'Painter', category });
const config = (overrides: Partial<CanvasConfig> = {}): CanvasConfig =>
  ({ start: 1500, end: 1700, layoutMode: 'timeline', layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'automatic', ...overrides });
const [a, b, c, d] = [person('a', 1500, 1560), person('b', 1520, 1590), person('c', 1540, 1610), person('d', 1580, 1650)];

test('the range only grows when new people fall outside it, with small padding', () => {
  const range = { start: 1500, end: 1700 };
  assert.deepEqual(extendConnectionRange(range, [person('in', 1550, 1650)]), range);
  assert.deepEqual(extendConnectionRange(range, []), range);
  assert.deepEqual(extendConnectionRange(range, [person('early', 1443, 1500)]), { start: 1420, end: 1700 });
  assert.deepEqual(extendConnectionRange(range, [person('late', 1650, 1727)]), { start: 1500, end: 1750 });
  assert.deepEqual(extendConnectionRange(range, [person('early', 1443, 1500), person('late', 1650, 1727)]), { start: 1420, end: 1750 });
});

test('weaving adds the new people once, as guests of the connection, and grows the range to fit them', () => {
  const far = person('far', 1690, 1750, 'SCIENTISTS');
  const woven = weaveConnectionIntoCanvas({
    figures: [a, d], config: config(), chain: [a, b, c, d, far], newFigures: [b, c, far, b], pathKey: 'path-1',
  });
  assert.deepEqual(woven.figures.map(figure => figure.id), ['a', 'd', 'b', 'c', 'far']);
  assert.deepEqual(woven.newIds, ['b', 'c', 'far']);
  assert.deepEqual(woven.config.guests, { b: ['path-1'], c: ['path-1'], far: ['path-1'] });
  assert.deepEqual([woven.config.start, woven.config.end], [1500, 1770]);
});

test('the canvas topic is left alone: a themed canvas keeps its categories', () => {
  const context = { mode: 'theme' as const, query: 'Painters', inferredStartYear: 1500, inferredEndYear: 1700, themeDescription: 'Painters', activeCategories: ['ARTISTS' as const] };
  const thinker = person('t', 1510, 1560, 'THINKERS');
  const woven = weaveConnectionIntoCanvas({ figures: [a], config: config({ weaveContext: context }), chain: [a, thinker], newFigures: [thinker], pathKey: 'p' });
  assert.deepEqual(woven.config.weaveContext?.activeCategories, ['ARTISTS']);
  assert.deepEqual(woven.config.guests, { t: ['p'] });
});

test('a guest of another connection on the chain becomes a guest of this one too; core people stay core', () => {
  const woven = weaveConnectionIntoCanvas({
    figures: [a, b, d], config: config({ guests: { b: ['first'] } }), chain: [a, b, c, d], newFigures: [c], pathKey: 'second',
  });
  assert.deepEqual(woven.config.guests, { b: ['first', 'second'], c: ['second'] });
  // Even with nobody new, a shared guest is recorded under the new connection.
  const shared = weaveConnectionIntoCanvas({ figures: [a, b], config: config({ guests: { b: ['first'] } }), chain: [a, b], newFigures: [], pathKey: 'third' });
  assert.deepEqual(shared.config.guests, { b: ['first', 'third'] });
  assert.deepEqual(shared.newIds, []);
});

test('weaving nobody new leaves the canvas exactly as it was', () => {
  const input = { figures: [a, b], config: config(), chain: [a, b], newFigures: [] as HistoricalFigure[], pathKey: 'p' };
  const woven = weaveConnectionIntoCanvas(input);
  assert.equal(woven.figures, input.figures);
  assert.equal(woven.config, input.config);
  assert.deepEqual(woven.newIds, []);
  assert.equal(weaveConnectionIntoCanvas({ ...input, newFigures: [a] }).figures, input.figures);
});
