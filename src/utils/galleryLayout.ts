import type { FigureCategory, HistoricalFigure } from '../types';
import type { LayoutBounds } from './canvasLayout';
import { relationshipRows } from './relationshipRows';

export const GALLERY_CARD_WIDTH = 320;
export const GALLERY_CARD_HEIGHT = 116;
export const GALLERY_COLUMN_GAP = 32;
export const GALLERY_TIER_GAP = 40;

const CATEGORY_ORDER: FigureCategory[] = [
  'WRITERS', 'THINKERS', 'SCIENTISTS', 'ARTISTS', 'ENTERTAINERS',
  'BUSINESS', 'LEADERS & BADDIES', 'EXPLORERS', 'EVENTS',
];

export interface GalleryPlacement {
  figure: HistoricalFigure;
  tier: number;
  x: number;
  y: number;
}

export interface GalleryLayout {
  placements: GalleryPlacement[];
  bounds: LayoutBounds;
}

// The viewport frames this board; it never limits its rows or columns.
export function calculateGalleryLayout(figures: HistoricalFigure[]): GalleryLayout {
  if (!figures.length) return { placements: [], bounds: { left: 0, top: 0, width: 0, height: 0 } };
  const ordered = [...figures].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
  const pitchX = GALLERY_CARD_WIDTH + GALLERY_COLUMN_GAP;
  const pitchY = GALLERY_CARD_HEIGHT + GALLERY_TIER_GAP;
  const columns = Math.min(figures.length, Math.max(3, Math.ceil(Math.sqrt(figures.length * pitchY * 2 / pitchX))));
  const counts = relationshipRows(ordered, columns).map(row => row.length);
  const last = counts.length - 1;
  // Avoid a lonely final card when the other tiers can share their spare cards.
  for (let tier = 0; tier < last && counts[last] < 3; tier++) {
    const transfer = Math.min(Math.max(0, counts[tier] - 3), 3 - counts[last]);
    counts[tier] -= transfer;
    counts[last] += transfer;
  }
  let cursor = 0;
  const rows = counts.map(count => {
    const row = ordered.slice(cursor, cursor + count);
    cursor += count;
    return row;
  });
  const widestRow = Math.max(...rows.map(row => row.length));
  const placements = rows.flatMap((row, tier) => {
    // Short tiers are centered; equal-length adjacent tiers still get a stagger.
    const offset = (widestRow - row.length) * pitchX / 2
      + (tier % 2 && row.length === rows[tier - 1].length ? pitchX / 2 : 0);
    return row.map((figure, column) => ({ figure, tier, x: offset + column * pitchX, y: tier * pitchY }));
  });
  return {
    placements,
    bounds: { left: 0, top: 0,
      width: Math.max(...placements.map(item => item.x + GALLERY_CARD_WIDTH)),
      height: rows.length * pitchY - GALLERY_TIER_GAP },
  };
}
