import type { FigureCategory, HistoricalFigure } from '../types';
import type { LayoutBounds } from './canvasLayout';
import type { CameraBounds } from './canvasCamera';
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

export interface GallerySection {
  label: string;
  count: number;
  // World-space top of the section header, which sits in the gap above the section's first tier.
  y: number;
}

export interface GalleryLayout {
  placements: GalleryPlacement[];
  bounds: LayoutBounds;
  sections: GallerySection[];
}

// Room above the guest block for its header, on top of the usual gap between tiers.
export const GALLERY_SECTION_GAP = 120;
export const GUEST_SECTION_LABEL = 'From connections';

// One block of staggered tiers, starting at the top left.
// With `brick` every tier sits half a card off the one above (its cards between theirs, like bricks), as close to its centred
// place as that allows; the tiers keep their alternating full and shorter lengths, without the spare-card transfer.
function packBoard(figures: HistoricalFigure[], brick = false): { placements: GalleryPlacement[]; width: number; height: number; tiers: number } {
  if (!figures.length) return { placements: [], width: 0, height: 0, tiers: 0 };
  const ordered = [...figures].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
  const pitchX = GALLERY_CARD_WIDTH + GALLERY_COLUMN_GAP;
  const pitchY = GALLERY_CARD_HEIGHT + GALLERY_TIER_GAP;
  const columns = Math.min(figures.length, Math.max(3, Math.ceil(Math.sqrt(figures.length * pitchY * 2 / pitchX))));
  const counts = relationshipRows(ordered, columns).map(row => row.length);
  const last = counts.length - 1;
  // Avoid a lonely final card when the other tiers can share their spare cards.
  for (let tier = 0; !brick && tier < last && counts[last] < 3; tier++) {
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
  const offsets: number[] = [];
  const placements = rows.flatMap((row, tier) => {
    // Short tiers are centered; equal-length adjacent tiers still get a stagger.
    const centered = (widestRow - row.length) * pitchX / 2;
    let offset = centered + (tier % 2 && row.length === rows[tier - 1].length ? pitchX / 2 : 0);
    const previous = offsets[tier - 1];
    if (brick && previous !== undefined) {
      // The places half a card off the tier above are previous + half + k * pitch; take the one nearest the centred place.
      offset = previous + pitchX / 2 + Math.round((centered - previous - pitchX / 2) / pitchX) * pitchX;
      if (offset < 0) offset += pitchX;
    } else if (brick) offset = centered;
    offsets.push(offset);
    return row.map((figure, column) => ({ figure, tier, x: offset + column * pitchX, y: tier * pitchY }));
  });
  return { placements, width: Math.max(...placements.map(item => item.x + GALLERY_CARD_WIDTH)),
    height: rows.length * pitchY - GALLERY_TIER_GAP, tiers: rows.length };
}

// The viewport frames this board; it never limits its rows or columns. Guests of Six Degrees connections get a
// block of their own below everyone else, under a header, both blocks centred on the wider one.
export function calculateGalleryLayout(figures: HistoricalFigure[], guestIds: ReadonlySet<string> = new Set()): GalleryLayout {
  const core = packBoard(figures.filter(figure => !guestIds.has(figure.id)));
  const guests = packBoard(figures.filter(figure => guestIds.has(figure.id)), true);
  if (!guests.placements.length) return { placements: core.placements, sections: [],
    bounds: { left: 0, top: 0, width: core.width, height: core.height } };
  const width = Math.max(core.width, guests.width);
  const top = core.placements.length ? core.height + GALLERY_SECTION_GAP : GALLERY_SECTION_GAP - GALLERY_TIER_GAP;
  const shift = (block: typeof core, dy: number, tiers: number) => block.placements.map(item =>
    ({ ...item, x: item.x + (width - block.width) / 2, y: item.y + dy, tier: item.tier + tiers }));
  return {
    placements: [...shift(core, 0, 0), ...shift(guests, top, core.tiers)],
    sections: [{ label: GUEST_SECTION_LABEL, count: guests.placements.length, y: top - GALLERY_SECTION_GAP / 2 - 12 }],
    bounds: { left: 0, top: 0, width, height: top + guests.height },
  };
}

// World-space box around a card, used to point the camera at it.
export const galleryCardBounds = ({ x, y }: Pick<GalleryPlacement, 'x' | 'y'>): CameraBounds => ({ left: x, top: y, width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT });
