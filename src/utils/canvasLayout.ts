import type { CanvasLayoutMode, CanvasLayoutSelection, HistoricalFigure, LayoutData, WeaveGenerationContext } from '../types';
import { BASE_PIXELS_PER_YEAR, ROW_HEIGHT, calculateTimelineLayout } from './timelineLayout';
import { GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from './galleryLayout';
import { isTimelineFigureVisible } from './timelineFigures';

export const CANVAS_LAYOUT_VERSION = 3;
export const SMALL_GALLERY_MAX_FIGURES = 12;

export interface LayoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Measure the distribution of figures with a consistent readable footprint.
// Lifespan lengths and unwrapped titles must not make a vertical stack look wide.
export function measureTimelineDensityBounds(layout: LayoutData[]): LayoutBounds {
  if (!layout.length) return { left: 0, top: 0, width: 0, height: 0 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (x: number, y: number, width: number, height: number) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  };

  for (const { figure, level, labelLevel, labelYearOffset } of layout) {
    const x = figure.birthYear * BASE_PIXELS_PER_YEAR;
    const y = level * ROW_HEIGHT + 60;
    if (figure.category === 'EVENTS' && figure.deathYear - figure.birthYear < 15 && labelLevel !== undefined) {
      const labelY = labelLevel % 1 !== 0
        ? Math.floor(labelLevel) * ROW_HEIGHT + 175
        : labelLevel * ROW_HEIGHT + 45;
      include(x + (labelYearOffset ?? 10) * BASE_PIXELS_PER_YEAR, labelY,
        GALLERY_CARD_WIDTH, GALLERY_CARD_HEIGHT);
    } else {
      include(x, y, GALLERY_CARD_WIDTH, GALLERY_CARD_HEIGHT);
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function selectCanvasLayoutMode(bounds: Pick<LayoutBounds, 'width' | 'height'>): CanvasLayoutMode {
  return bounds.height > bounds.width ? 'gallery' : 'timeline';
}

// Preserve current decisions and explicit manual choices. Upgrade older small
// timelines once; version-2 larger canvases already use the same density policy.
export function prepareCanvasLayout(figures: HistoricalFigure[], savedMode?: unknown, savedVersion?: unknown,
  savedSelection?: unknown) {
  const selection: CanvasLayoutSelection = savedSelection === 'manual' && (savedMode === 'gallery' || savedMode === 'timeline')
    ? 'manual' : 'automatic';
  const figureCount = figures.filter(isTimelineFigureVisible).length;
  const keepTimeline = savedMode === 'timeline' && (selection === 'manual' || savedVersion === CANVAS_LAYOUT_VERSION
    || (savedVersion === 2 && figureCount > SMALL_GALLERY_MAX_FIGURES));
  if (savedMode === 'gallery' || (!keepTimeline && figureCount > 0 && figureCount <= SMALL_GALLERY_MAX_FIGURES)) {
    return { mode: 'gallery' as const, timeline: null, version: CANVAS_LAYOUT_VERSION, selection };
  }
  const timeline = calculateTimelineLayout(figures);
  const mode = keepTimeline ? 'timeline' : selectCanvasLayoutMode(measureTimelineDensityBounds(timeline.layoutData));
  return { mode, timeline: mode === 'timeline' ? timeline : null, version: CANVAS_LAYOUT_VERSION, selection };
}

export function resolveSeedFigureId(figures: HistoricalFigure[], context?: WeaveGenerationContext): string | undefined {
  if (context?.mode !== 'figure') return undefined;
  const normalize = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const query = normalize(context.query);
  if (!query) return undefined;
  const exact = figures.filter(figure => normalize(figure.name) === query);
  if (exact.length) return exact.length === 1 ? exact[0].id : undefined;
  // Accept a unique whole-name/whole-word match (e.g. Einstein -> Albert Einstein),
  // but never select an arbitrary result when several figures fit the query.
  const matches = figures.filter(figure => {
    const name = normalize(figure.name);
    return name && (` ${name} `.includes(` ${query} `) || ` ${query} `.includes(` ${name} `));
  });
  return matches.length === 1 ? matches[0].id : undefined;
}

export function getCanvasFocusFigure(figures: HistoricalFigure[], context?: WeaveGenerationContext,
  savedSeedId?: string): HistoricalFigure | undefined {
  if (context?.mode !== 'figure') return undefined;
  const seedId = figures.some(figure => figure.id === savedSeedId) ? savedSeedId : resolveSeedFigureId(figures, context);
  return figures.find(figure => figure.id === seedId);
}
