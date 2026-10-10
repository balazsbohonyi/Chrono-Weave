import { CATEGORY_LIST, KEEP_DISCOVERY_CLUSTERS } from '../constants';
import type { CanvasConfig, CanvasHistoryRecord, CanvasSnapshot, CanvasViewSnapshot, HistoricalFigure } from '../types';
import { CANVAS_LAYOUT_VERSION, prepareCanvasLayout } from './canvasLayout';
import { CLUSTER_STORAGE_KEY, emptyClusters, restoreClusters, serializeClusters } from './discoveryClusters';
import { filterTimelineFigures } from './timelineFigures';
import { normalizeWeaveContext } from './weave';
import { countVerifiedConnections } from '../services/relationshipAssessment';

export const CANVAS_HISTORY_KEY = 'chrono_canvas_history';
export const CANVAS_HISTORY_LIMIT = 20;
export const LEGACY_DATA_KEY = 'chrono_timeline_data';
export const LEGACY_CONFIG_KEY = 'chrono_timeline_config';

const isCanvasCacheKey = (key: string) => ['chrono_map_', 'chrono_assessment_', 'chrono_rel_', 'chrono_deepdive_']
  .some(prefix => key.startsWith(prefix));
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const createCanvasId = () => globalThis.crypto?.randomUUID?.() ?? `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Each operation holds its canvas's cache, even after another canvas is opened.
// A cancelled request can never overwrite the next canvas's relationship data.
export class CanvasCache implements Storage {
  private values: Map<string, string>;
  constructor(initial: Record<string, string> = {}, private onChange: () => void = () => {}) {
    this.values = new Map(Object.entries(initial).filter(([key, value]) => isCanvasCacheKey(key) && typeof value === 'string'));
  }
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (!isCanvasCacheKey(key) || this.values.get(key) === String(value)) return;
    this.values.set(key, String(value));
    this.onChange();
  }
  removeItem(key: string) { if (this.values.delete(key)) this.onChange(); }
  clear() { if (this.values.size) { this.values.clear(); this.onChange(); } }
  snapshot() { return Object.fromEntries(this.values); }
}

export const defaultCanvasView = (): CanvasViewSnapshot => ({
  cameras: {}, selectedYear: null, selectedFigureIds: [], selectedCategories: [],
  isSidebarCollapsed: false, isLegendOpen: false,
  sidebar: { mode: 'FIGURES', scrollPositions: { FIGURES: 0, EVENTS: 0 } },
  searchQuery: '', highlightedFigureIds: [], currentSearchIndex: 0,
});

export function createCanvasSnapshot(figures: HistoricalFigure[], config: CanvasConfig, cache: Record<string, string> = {}): CanvasSnapshot {
  return { id: createCanvasId(), createdAt: Date.now(), figures, config, cache, clusters: emptyClusters(), view: defaultCanvasView() };
}

export function activateCanvas(history: CanvasSnapshot[], outgoing: CanvasSnapshot | null, incoming: CanvasSnapshot): CanvasHistoryRecord {
  const entries = new Map(history.map(canvas => [canvas.id, canvas]));
  if (outgoing && outgoing.id !== incoming.id) entries.set(outgoing.id, outgoing);
  entries.delete(incoming.id);
  return { version: 1, current: incoming,
    history: [...entries.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, CANVAS_HISTORY_LIMIT) };
}

function normalizeView(value: unknown, figures: HistoricalFigure[]): CanvasViewSnapshot {
  const view = defaultCanvasView();
  if (!isObject(value)) return view;
  const ids = new Set(figures.map(figure => figure.id));
  const validIds = (input: unknown): string[] => Array.isArray(input)
    ? [...new Set(input.filter((id): id is string => typeof id === 'string' && ids.has(id)))] : [];
  view.selectedYear = typeof value.selectedYear === 'number' && Number.isFinite(value.selectedYear) ? value.selectedYear : null;
  view.selectedFigureIds = validIds(value.selectedFigureIds);
  view.highlightedFigureIds = validIds(value.highlightedFigureIds);
  view.selectedCategories = Array.isArray(value.selectedCategories)
    ? CATEGORY_LIST.filter(category => (value.selectedCategories as unknown[]).includes(category)) : [];
  view.isSidebarCollapsed = value.isSidebarCollapsed === true;
  view.isLegendOpen = value.isLegendOpen === true;
  view.searchQuery = typeof value.searchQuery === 'string' ? value.searchQuery.slice(0, 2000) : '';
  view.currentSearchIndex = Number.isSafeInteger(value.currentSearchIndex) && (value.currentSearchIndex as number) >= 0
    && (value.currentSearchIndex as number) < view.highlightedFigureIds.length ? value.currentSearchIndex as number : 0;
  if (isObject(value.cameras)) for (const mode of ['timeline', 'gallery'] as const) {
    const camera = value.cameras[mode];
    if (isObject(camera) && typeof camera.x === 'number' && typeof camera.y === 'number' && typeof camera.scale === 'number'
        && Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.scale) && camera.scale >= 0.1 && camera.scale <= 10) {
      view.cameras[mode] = { x: camera.x, y: camera.y, scale: camera.scale };
    }
  }
  if (isObject(value.sidebar)) {
    view.sidebar.mode = value.sidebar.mode === 'EVENTS' ? 'EVENTS' : 'FIGURES';
    if (isObject(value.sidebar.scrollPositions)) for (const mode of ['FIGURES', 'EVENTS'] as const) {
      const position = value.sidebar.scrollPositions[mode];
      if (typeof position === 'number' && Number.isFinite(position) && position >= 0) view.sidebar.scrollPositions[mode] = position;
    }
  }
  return view;
}

function normalizeSnapshot(value: unknown): CanvasSnapshot | null {
  try {
    if (!isObject(value) || typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.createdAt)
        || (value.createdAt as number) < 0 || !isObject(value.config) || !Array.isArray(value.figures)) return null;
    const config = value.config;
    if (!Number.isSafeInteger(config.start) || !Number.isSafeInteger(config.end) || (config.start as number) >= (config.end as number)
        || !Number.isSafeInteger((config.end as number) - (config.start as number))) return null;
    const context = config.weaveContext ? normalizeWeaveContext(config.weaveContext as CanvasConfig['weaveContext']) : undefined;
    const seen = new Set<string>();
    const figures = filterTimelineFigures(value.figures.filter((figure): figure is HistoricalFigure => {
      if (!isObject(figure) || typeof figure.id !== 'string' || !figure.id || seen.has(figure.id)
          || typeof figure.name !== 'string' || !figure.name.trim() || typeof figure.occupation !== 'string'
          || !Number.isSafeInteger(figure.birthYear) || !Number.isSafeInteger(figure.deathYear)
          || !CATEGORY_LIST.includes(figure.category as HistoricalFigure['category'])) return false;
      seen.add(figure.id);
      return !context || context.activeCategories.includes('ALL') || context.activeCategories.includes(figure.category as HistoricalFigure['category']);
    }));
    if (!figures.length) return null;
    const cache = isObject(value.cache) ? Object.fromEntries(Object.entries(value.cache)
      .filter(([key, data]) => isCanvasCacheKey(key) && typeof data === 'string')) as Record<string, string> : {};
    return {
      id: value.id, createdAt: value.createdAt as number, figures, cache,
      config: { start: config.start as number, end: config.end as number,
        layoutMode: config.layoutMode === 'gallery' ? 'gallery' : 'timeline',
        layoutVersion: Number.isSafeInteger(config.layoutVersion) ? config.layoutVersion as number : 0,
        layoutSelection: config.layoutSelection === 'manual' ? 'manual' : 'automatic',
        ...(context ? { weaveContext: context } : {}),
        ...(typeof config.seedFigureId === 'string' && figures.some(figure => figure.id === config.seedFigureId) ? { seedFigureId: config.seedFigureId } : {}),
      },
      clusters: restoreClusters(isObject(value.clusters) ? serializeClusters(figures, value.clusters as unknown as CanvasSnapshot['clusters']) : null,
        figures, KEEP_DISCOVERY_CLUSTERS),
      view: normalizeView(value.view, figures),
    };
  } catch { return null; }
}

export function loadCanvasHistory(storage: Storage): CanvasHistoryRecord {
  const empty: CanvasHistoryRecord = { version: 1, current: null, history: [] };
  try {
    const saved = JSON.parse(storage.getItem(CANVAS_HISTORY_KEY) || 'null');
    if (isObject(saved) && saved.version === 1 && Array.isArray(saved.history)) {
      const current = normalizeSnapshot(saved.current);
      const history = saved.history.map(normalizeSnapshot).filter((canvas): canvas is CanvasSnapshot => canvas !== null);
      if (current) return activateCanvas(history, null, current);
      // A damaged active entry must not make intact history inaccessible.
      history.sort((a, b) => b.createdAt - a.createdAt);
      if (history[0]) return activateCanvas(history, null, history[0]);
    }
  } catch { /* Fall back to the previous single-canvas save. */ }
  try {
    const figures = JSON.parse(storage.getItem(LEGACY_DATA_KEY) || 'null');
    const config = JSON.parse(storage.getItem(LEGACY_CONFIG_KEY) || 'null');
    const cache: Record<string, string> = {};
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && isCanvasCacheKey(key)) cache[key] = storage.getItem(key)!;
    }
    const canvas = normalizeSnapshot({ id: createCanvasId(), createdAt: Date.now(), figures, config, cache });
    if (!canvas) return empty;
    const layout = prepareCanvasLayout(canvas.figures, config.layoutMode, config.layoutVersion, config.layoutSelection);
    canvas.config = { ...canvas.config, layoutMode: layout.mode, layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: layout.selection };
    canvas.clusters = restoreClusters(storage.getItem(CLUSTER_STORAGE_KEY), canvas.figures, KEEP_DISCOVERY_CLUSTERS);
    return { version: 1, current: canvas, history: [] };
  } catch { return empty; }
}

// One atomic write preserves the previous save if browser storage is full.
// Remove old duplicated data only after migration is durably saved.
export function saveCanvasHistory(storage: Storage, record: CanvasHistoryRecord): void {
  storage.setItem(CANVAS_HISTORY_KEY, JSON.stringify(record));
  const obsolete: string[] = [LEGACY_DATA_KEY, LEGACY_CONFIG_KEY, CLUSTER_STORAGE_KEY];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && isCanvasCacheKey(key)) obsolete.push(key);
  }
  for (const key of obsolete) storage.removeItem(key);
}

export function canvasHistoryDetails(canvas: CanvasSnapshot) {
  const context = canvas.config.weaveContext;
  const titles = { 'time-span': 'Strict Time Span', era: 'Historical Era', figure: 'Follow a Figure',
    region: 'Region & Culture', theme: 'Theme or Discipline', freeform: 'Freeform / Custom' };
  return { title: context ? titles[context.mode] : 'Strict Time Span',
    verifiedConnections: countVerifiedConnections(canvas.figures, new CanvasCache(canvas.cache)),
    prompt: context?.query || `${canvas.config.start} to ${canvas.config.end}`,
    start: context?.inferredStartYear ?? canvas.config.start, end: context?.inferredEndYear ?? canvas.config.end,
    figures: canvas.figures.filter(figure => figure.category !== 'EVENTS').length,
    events: canvas.figures.filter(figure => figure.category === 'EVENTS').length };
}
