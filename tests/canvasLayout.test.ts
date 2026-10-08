import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_LAYOUT_VERSION, SMALL_GALLERY_MAX_FIGURES, getCanvasFocusFigure, measureTimelineDensityBounds, prepareCanvasLayout, resolveSeedFigureId, selectCanvasLayoutMode } from '../src/utils/canvasLayout';
import { GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from '../src/utils/galleryLayout';
import { calculateTimelineLayout } from '../src/utils/timelineLayout';
import type { HistoricalFigure, WeaveGenerationContext } from '../src/types';
import { figure } from './helpers';

const people = (count: number, spacing = 0): HistoricalFigure[] => Array.from({ length: count }, (_, index) => ({
  ...figure, id: `person-${index}`, name: `Person ${index}`, birthYear: 1800 + spacing * index, deathYear: 1850 + spacing * index,
}));

test('the density switch for larger datasets is height greater than width, with equality retaining timeline', () => {
  assert.equal(selectCanvasLayoutMode({ width: 1000, height: 1001 }), 'gallery');
  assert.equal(selectCanvasLayoutMode({ width: 1000, height: 1000 }), 'timeline');
  assert.equal(selectCanvasLayoutMode({ width: 1000, height: 999 }), 'timeline');
  assert.equal(selectCanvasLayoutMode({ width: 0, height: 0 }), 'timeline');
});

test('contemporaries use gallery while a horizontal dataset retains its dry-run timeline placements', () => {
  assert.equal(prepareCanvasLayout(people(13)).mode, 'gallery');
  const spread = people(13, 100);
  const prepared = prepareCanvasLayout(spread);
  assert.equal(prepared.mode, 'timeline');
  assert.deepEqual(prepared.timeline, calculateTimelineLayout(spread));
});

test('one through twelve figures default to gallery regardless of horizontal spread', () => {
  assert.equal(SMALL_GALLERY_MAX_FIGURES, 12);
  for (const count of [1, 3, 10, 12]) {
    const prepared = prepareCanvasLayout(people(count, 100));
    assert.equal(prepared.mode, 'gallery');
    assert.equal(prepared.selection, 'automatic');
    assert.equal(prepared.timeline, null);
  }
  assert.equal(prepareCanvasLayout(people(13, 100)).mode, 'timeline');
  assert.equal(prepareCanvasLayout([]).mode, 'timeline');
});

test('the small-dataset rule counts eligible cards rather than filtered-out events', () => {
  const hiddenEvents = people(10, 100).map(person => ({ ...person, category: 'EVENTS' as const, deathYear: person.birthYear + 1 }));
  assert.equal(prepareCanvasLayout([...people(3, 100), ...hiddenEvents]).mode, 'gallery');
});

test('the three-person Marco Polo canvas defaults to gallery even with wider density bounds', () => {
  const polo: HistoricalFigure[] = [
    { ...figure, id: 'niccolo', name: 'Niccolò Polo', birthYear: 1230, deathYear: 1294 },
    { ...figure, id: 'maffeo', name: 'Maffeo Polo', birthYear: 1235, deathYear: 1309 },
    { ...figure, id: 'marco', name: 'Marco Polo', birthYear: 1254, deathYear: 1324 },
  ];
  const bounds = measureTimelineDensityBounds(calculateTimelineLayout(polo).layoutData);
  assert.ok(bounds.width > bounds.height);
  assert.equal(prepareCanvasLayout(polo).mode, 'gallery');
});

const surpriseFigures: HistoricalFigure[] = [
  ['Ida B. Wells', 1862, 1931], ['Alice Dunbar-Nelson', 1875, 1935],
  ['Nannie Helen Burroughs', 1879, 1961], ['Zora Neale Hurston', 1891, 1960],
  ['Gwendolyn B. Bennett', 1902, 1981], ['Dorothy West', 1907, 1998], ['Ethel Payne', 1911, 1991],
].map(([name, birthYear, deathYear], index) => ({ ...figure, id: `surprise-${index}`, name: String(name),
  birthYear: Number(birthYear), deathYear: Number(deathYear), category: 'WRITERS', occupation: 'Journalist' }));

test('the Surprise Me vertical stack uses gallery despite long lifespan bars', () => {
  const timeline = calculateTimelineLayout(surpriseFigures);
  assert.equal(timeline.totalRows, 7);
  const bounds = measureTimelineDensityBounds(timeline.layoutData);
  assert.equal(bounds.width, (1911 - 1862) * 10 + GALLERY_CARD_WIDTH);
  assert.equal(bounds.height, 6 * 180 + GALLERY_CARD_HEIGHT);
  assert.equal(prepareCanvasLayout(surpriseFigures).mode, 'gallery');
  assert.equal(prepareCanvasLayout(surpriseFigures.slice(0, 2)).mode, 'gallery');
});

test('a saved mode remains authoritative after discoveries change the dataset shape', () => {
  assert.equal(prepareCanvasLayout(people(50), 'timeline', CANVAS_LAYOUT_VERSION).mode, 'timeline');
  const savedGallery = prepareCanvasLayout(people(1), 'gallery');
  assert.equal(savedGallery.mode, 'gallery');
  assert.equal(savedGallery.timeline, null);
  assert.equal(prepareCanvasLayout(people(12), 'unknown').mode, 'gallery');
});

test('older timeline decisions are updated once while saved galleries are preserved', () => {
  const updated = prepareCanvasLayout(surpriseFigures, 'timeline');
  assert.equal(updated.mode, 'gallery');
  assert.equal(updated.version, CANVAS_LAYOUT_VERSION);
  assert.equal(prepareCanvasLayout(surpriseFigures, 'timeline', CANVAS_LAYOUT_VERSION - 1).mode, 'gallery');
  const horizontal = prepareCanvasLayout(people(13, 100), 'timeline');
  assert.equal(horizontal.mode, 'timeline');
  assert.equal(horizontal.version, CANVAS_LAYOUT_VERSION);
  assert.equal(prepareCanvasLayout(people(12, 100), 'gallery').mode, 'gallery');
});

test('manual layout choices survive policy updates and new builds resume automatic selection', () => {
  const small = people(3, 100);
  const manual = prepareCanvasLayout(small, 'timeline', CANVAS_LAYOUT_VERSION - 1, 'manual');
  assert.equal(manual.mode, 'timeline');
  assert.equal(manual.selection, 'manual');
  assert.deepEqual(manual.timeline, calculateTimelineLayout(small));
  assert.equal(prepareCanvasLayout(small, 'gallery', undefined, 'manual').selection, 'manual');
  assert.equal(prepareCanvasLayout(small).mode, 'gallery');
  assert.equal(prepareCanvasLayout(small).selection, 'automatic');
});

test('the small-dataset upgrade preserves larger version-2 decisions after discovery', () => {
  assert.equal(prepareCanvasLayout(people(50), 'timeline', 2).mode, 'timeline');
  const small = prepareCanvasLayout(people(3, 100), 'timeline', 2);
  assert.equal(small.mode, 'gallery');
  assert.equal(small.version, CANVAS_LAYOUT_VERSION);
  assert.equal(small.selection, 'automatic');
});

test('bounds ignore world origin, year-range padding, and empty trailing rows', () => {
  const first = measureTimelineDensityBounds([{ figure, level: 3 }]);
  const shifted = measureTimelineDensityBounds([{ figure: { ...figure, birthYear: figure.birthYear + 500, deathYear: figure.deathYear + 500 }, level: 30 }]);
  assert.equal(first.width, shifted.width);
  assert.equal(first.height, GALLERY_CARD_HEIGHT);
  assert.equal(shifted.height, first.height);
  assert.deepEqual(measureTimelineDensityBounds([]), { left: 0, top: 0, width: 0, height: 0 });
});

test('long titles and lifespan bars do not inflate horizontal figure distribution', () => {
  const shortLife = { ...figure, birthYear: 1800, deathYear: 1801 };
  const narrow = measureTimelineDensityBounds([{ figure: shortLife, level: 0 }]);
  const wide = measureTimelineDensityBounds([{ figure: { ...shortLife, deathYear: 2000, name: 'A'.repeat(100) }, level: 0 }]);
  assert.deepEqual(wide, narrow);
  assert.equal(narrow.width, GALLERY_CARD_WIDTH);
});

test('short events use their floating label positions for the density check', () => {
  const event = { ...figure, category: 'EVENTS' as const, birthYear: 1800, deathYear: 1804 };
  const other = { figure: { ...figure, birthYear: 1800 }, level: 0 };
  const bar = measureTimelineDensityBounds([other, { figure: event, level: 0 }]);
  const labeled = measureTimelineDensityBounds([other, { figure: event, level: 0, labelLevel: 0.5, labelYearOffset: 20 }]);
  assert.equal(bar.width, GALLERY_CARD_WIDTH);
  assert.equal(bar.height, GALLERY_CARD_HEIGHT);
  assert.ok(labeled.width > bar.width);
  assert.ok(labeled.height > bar.height);
  const fullRowLabel = measureTimelineDensityBounds([other, { figure: event, level: 0, labelLevel: 2, labelYearOffset: 20 }]);
  assert.ok(fullRowLabel.height > labeled.height);
});

test('seed highlighting resolves an unambiguous normalized name and never guesses from result order', () => {
  const context: WeaveGenerationContext = { mode: 'figure', query: '  ADA   LOVELACE ', inferredStartYear: 1800,
    inferredEndYear: 1900, themeDescription: 'Computing', activeCategories: ['SCIENTISTS'] };
  assert.equal(resolveSeedFigureId([...people(2), figure], context), figure.id);
  assert.equal(resolveSeedFigureId(people(2), context), undefined);
  assert.equal(resolveSeedFigureId([figure, { ...figure, id: 'duplicate' }], context), undefined);
  assert.equal(resolveSeedFigureId([figure], { ...context, mode: 'theme' }), undefined);
});

test('focus resolution accepts unique whole-word names but abstains on ambiguous names', () => {
  const context: WeaveGenerationContext = { mode: 'figure', query: 'Lovelace', inferredStartYear: 1800,
    inferredEndYear: 1900, themeDescription: 'Computing', activeCategories: ['SCIENTISTS'] };
  assert.equal(resolveSeedFigureId([figure], context), figure.id);
  assert.equal(resolveSeedFigureId([figure], { ...context, query: 'Ada Lovelace and contemporaries' }), figure.id);
  assert.equal(resolveSeedFigureId([figure], { ...context, query: 'Love' }), undefined);
  assert.equal(resolveSeedFigureId([figure], { ...context, query: ' ' }), undefined);
  const other = { ...figure, id: 'other', name: 'Anne Lovelace' };
  assert.equal(resolveSeedFigureId([figure, other], context), undefined);
  assert.equal(resolveSeedFigureId([figure, other], { ...context, query: 'Ada Lovelace' }), figure.id);
});

test('only Follow a Figure supplies a canvas focus, preserving a saved identity across discovery', () => {
  const context: WeaveGenerationContext = { mode: 'figure', query: 'Lovelace', inferredStartYear: 1800,
    inferredEndYear: 1900, themeDescription: 'Computing', activeCategories: ['SCIENTISTS'] };
  const other = { ...figure, id: 'other', name: 'Anne Lovelace' };
  assert.equal(getCanvasFocusFigure([figure, other], context, figure.id), figure);
  assert.equal(getCanvasFocusFigure([figure], context, 'removed'), figure);
  assert.equal(getCanvasFocusFigure([figure, other], context), undefined);
  for (const mode of ['era', 'region', 'theme', 'time-span', 'freeform'] as const) {
    assert.equal(getCanvasFocusFigure([figure], { ...context, mode }, figure.id), undefined);
  }
  assert.equal(getCanvasFocusFigure([figure], undefined, figure.id), undefined);
});
