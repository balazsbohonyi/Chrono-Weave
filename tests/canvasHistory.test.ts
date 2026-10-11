import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateCanvas, CanvasCache, CANVAS_HISTORY_KEY, canvasHistoryDetails, createCanvasSnapshot,
  LEGACY_CONFIG_KEY, LEGACY_DATA_KEY, loadCanvasHistory, saveCanvasHistory } from '../src/utils/canvasHistory';
import { CANVAS_LAYOUT_VERSION } from '../src/utils/canvasLayout';
import { CLUSTER_STORAGE_KEY, serializeClusters } from '../src/utils/discoveryClusters';
import { readRelationshipMap, saveRelationshipMap } from '../src/utils/relationshipCache';
import type { CanvasSnapshot } from '../src/types';
import { figure, MemoryStorage } from './helpers';

const canvas = (index: number): CanvasSnapshot => ({ ...createCanvasSnapshot([figure], {
  start: 1800, end: 1900, layoutMode: 'timeline', layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'manual',
  weaveContext: { mode: 'figure', query: 'Ada Lovelace', inferredStartYear: 1815, inferredEndYear: 1852,
    themeDescription: 'Ada Lovelace and early computing', activeCategories: ['ALL'] },
}), id: `canvas-${index}`, createdAt: index });

test('canvas creation also works when randomUUID is unavailable on a LAN origin', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  try {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
    const first = createCanvasSnapshot([figure], canvas(0).config);
    const second = createCanvasSnapshot([figure], canvas(0).config);
    assert.ok(first.id);
    assert.notEqual(first.id, second.id);
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor);
    else Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
  }
});

test('retains twenty previous canvases plus the active canvas, newest-created first, including after reload', () => {
  let record = { version: 1 as const, current: null as CanvasSnapshot | null, history: [] as CanvasSnapshot[] };
  for (let index = 0; index < 25; index++) record = activateCanvas(record.history, record.current, canvas(index));
  assert.equal(record.current?.id, 'canvas-24');
  const expected = Array.from({ length: 20 }, (_, index) => `canvas-${23 - index}`);
  assert.deepEqual(record.history.map(entry => entry.id), expected);
  assert.ok(!record.history.some(entry => entry.id === record.current?.id));
  const storage = new MemoryStorage();
  saveCanvasHistory(storage, record);
  assert.deepEqual(loadCanvasHistory(storage).history.map(entry => entry.id), expected);
});

test('revisiting swaps the active canvas without duplication, reordering, or refreshing retention', () => {
  const original = Array.from({ length: 21 }, (_, index) => canvas(index));
  const outgoing = { ...original[20], figures: [figure, { ...figure, id: 'new-discovery' }] };
  const revisited = activateCanvas(original.slice(0, 20), outgoing, original[0]);
  assert.equal(revisited.history.length, 20);
  const expected = Array.from({ length: 20 }, (_, index) => 20 - index);
  assert.deepEqual(revisited.history.map(entry => entry.createdAt), expected);
  assert.equal(revisited.history[0].figures.length, 2);
  const next = activateCanvas(revisited.history, revisited.current, canvas(21));
  assert.deepEqual(next.history.map(entry => entry.createdAt), expected);
  assert.ok(!next.history.some(entry => entry.id === original[0].id));
  const same = activateCanvas(revisited.history, revisited.current, revisited.current!);
  assert.deepEqual(same.history, revisited.history);
});

test('round-trips discoveries, layout, view, selections, search, sidebar, and cached relationships', () => {
  const storage = new MemoryStorage();
  const saved = canvas(1);
  saved.figures.push({ ...figure, id: 'discovered', name: 'Charles Babbage' });
  saved.clusters = { clusters: [{ sourceId: figure.id, memberIds: [figure.id, 'discovered'] }],
    placements: { [figure.id]: { level: 1 }, discovered: { level: 2 } } };
  saved.view = { ...saved.view, cameras: { timeline: { x: -430, y: 87, scale: 1.7 }, gallery: { x: 12, y: 50, scale: 0.8 } },
    selectedYear: 1830, selectedFigureIds: [figure.id], selectedCategories: ['SCIENTISTS'], isSidebarCollapsed: true,
    isLegendOpen: true, sidebar: { mode: 'EVENTS', scrollPositions: { FIGURES: 310, EVENTS: 55 } },
    searchQuery: 'Ada', highlightedFigureIds: [figure.id], currentSearchIndex: 0 };
  saved.cache = { chrono_deepdive_ada: '{"summary":"Saved biography"}', chrono_map_ada: 'Saved map' };
  saveCanvasHistory(storage, activateCanvas([], canvas(0), saved));
  const loaded = loadCanvasHistory(storage);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.current)), saved);
  assert.equal(loaded.history[0].id, 'canvas-0');
  assert.deepEqual(canvasHistoryDetails(saved), { title: 'Follow a Figure', prompt: 'Ada Lovelace', start: 1815, end: 1852,
    figures: 2, events: 0, verifiedConnections: 0 });
});

test('canvas caches isolate overlapping figure IDs and ignore provider credentials', () => {
  const target = { ...figure, id: 'babbage', name: 'Charles Babbage' };
  const oldCache = new CanvasCache();
  const nextCache = new CanvasCache();
  saveRelationshipMap(figure, [figure, target], [target.id], oldCache);
  saveRelationshipMap(figure, [figure, target], [], nextCache);
  const archived = oldCache.snapshot();
  // Simulate an operation holding the old cache after switching canvases.
  oldCache.setItem('chrono_deepdive_ada', 'late result');
  assert.equal(nextCache.getItem('chrono_deepdive_ada'), null);
  assert.equal(archived.chrono_deepdive_ada, undefined);
  assert.deepEqual(readRelationshipMap(figure, [figure, target], new CanvasCache(archived))?.relatedIds, [target.id]);
  assert.deepEqual(readRelationshipMap(figure, [figure, target], nextCache)?.relatedIds, []);
  nextCache.setItem('chrono_api_key', 'secret');
  assert.equal(nextCache.getItem('chrono_api_key'), null);
});

test('migrates the existing single canvas and its caches without removing settings', () => {
  const storage = new MemoryStorage();
  const legacy = canvas(0);
  storage.setItem(LEGACY_DATA_KEY, JSON.stringify(legacy.figures));
  storage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(legacy.config));
  storage.setItem(CLUSTER_STORAGE_KEY, serializeClusters(legacy.figures, legacy.clusters));
  storage.setItem('chrono_deepdive_ada', 'existing biography');
  storage.setItem('chrono_api_key', 'keep settings');
  storage.setItem('chrono_theme', 'dark');
  const loaded = loadCanvasHistory(storage);
  assert.deepEqual(loaded.current?.figures, legacy.figures);
  assert.equal(loaded.current?.cache.chrono_deepdive_ada, 'existing biography');
  assert.equal(loaded.history.length, 0);
  assert.ok(storage.getItem(LEGACY_DATA_KEY));
  saveCanvasHistory(storage, loaded);
  assert.equal(storage.getItem(LEGACY_DATA_KEY), null);
  assert.equal(storage.getItem('chrono_deepdive_ada'), null);
  assert.equal(storage.getItem('chrono_api_key'), 'keep settings');
  assert.equal(storage.getItem('chrono_theme'), 'dark');
  assert.deepEqual(loadCanvasHistory(storage), loaded);
});

test('a failed atomic write preserves the last save and all legacy data', () => {
  const storage = new MemoryStorage();
  const record = activateCanvas([], null, canvas(0));
  saveCanvasHistory(storage, record);
  const previous = storage.getItem(CANVAS_HISTORY_KEY);
  storage.setItem(LEGACY_DATA_KEY, 'preserve');
  storage.setItem('chrono_rel_ada_babbage', 'preserve');
  storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  assert.throws(() => saveCanvasHistory(storage, activateCanvas([], record.current, canvas(1))));
  assert.equal(storage.getItem(CANVAS_HISTORY_KEY), previous);
  assert.equal(storage.getItem(LEGACY_DATA_KEY), 'preserve');
  assert.equal(storage.getItem('chrono_rel_ada_babbage'), 'preserve');
});

test('malformed entries are isolated and valid history recovers a damaged active canvas', () => {
  const storage = new MemoryStorage();
  const valid = canvas(2);
  storage.setItem(CANVAS_HISTORY_KEY, JSON.stringify({ version: 1, current: { broken: true },
    history: [null, canvas(1), valid, valid, { ...canvas(3), figures: [null] }] }));
  const loaded = loadCanvasHistory(storage);
  assert.equal(loaded.current?.id, valid.id);
  assert.deepEqual(loaded.history.map(entry => entry.id), ['canvas-1']);
  storage.setItem(CANVAS_HISTORY_KEY, '{broken json');
  assert.equal(loadCanvasHistory(storage).current, null);
});

test('invalid view metadata cannot inject unknown figure IDs, categories, or extreme cameras', () => {
  const storage = new MemoryStorage();
  const saved = canvas(1);
  saved.view = { ...saved.view, selectedFigureIds: ['missing', figure.id, figure.id], selectedCategories: ['INVALID'] as never,
    cameras: { timeline: { x: 0, y: 0, scale: 1e20 } }, currentSearchIndex: 42,
    sidebar: { mode: 'EVENTS', scrollPositions: { FIGURES: -4, EVENTS: 5 } } };
  storage.setItem(CANVAS_HISTORY_KEY, JSON.stringify({ version: 1, current: saved, history: [] }));
  const view = loadCanvasHistory(storage).current!.view;
  assert.deepEqual(view.selectedFigureIds, [figure.id]);
  assert.deepEqual(view.selectedCategories, []);
  assert.deepEqual(view.cameras, {});
  assert.equal(view.currentSearchIndex, 0);
  assert.deepEqual(view.sidebar.scrollPositions, { FIGURES: 0, EVENTS: 5 });
});

test('history summaries count all saved figures and events independently of active filters', () => {
  const saved = canvas(1);
  saved.figures.push({ ...figure, id: 'event', category: 'EVENTS', name: 'An event' });
  saved.view.selectedCategories = ['ARTISTS'];
  assert.equal(canvasHistoryDetails(saved).figures, 1);
  assert.equal(canvasHistoryDetails(saved).events, 1);
  assert.equal(canvasHistoryDetails(saved).verifiedConnections, 0);
});
