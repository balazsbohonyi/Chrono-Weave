import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGalleryLayout, GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from '../src/utils/galleryLayout';
import { CATEGORY_LIST } from '../src/constants';
import type { HistoricalFigure } from '../src/types';
import { figure } from './helpers';

const people = (count: number): HistoricalFigure[] => Array.from({ length: count }, (_, index) => ({
  ...figure, id: `figure-${index}`, name: `Figure ${index}`, category: CATEGORY_LIST[index % CATEGORY_LIST.length],
}));

test('zero through large datasets keep every card exactly once, with no overlaps and complete bounds', () => {
  for (let count = 0; count <= 120; count++) {
    const input = people(count);
    const { placements, bounds } = calculateGalleryLayout(input);
    assert.deepEqual(new Set(placements.map(item => item.figure.id)), new Set(input.map(item => item.id)));
    assert.equal(placements.length, input.length);
    for (const [index, item] of placements.entries()) {
      assert.ok(item.x >= 0 && item.y >= 0);
      assert.ok(item.x + GALLERY_CARD_WIDTH <= bounds.width);
      assert.ok(item.y + GALLERY_CARD_HEIGHT <= bounds.height);
      for (const other of placements.slice(index + 1)) {
        const overlap = item.x < other.x + GALLERY_CARD_WIDTH && item.x + GALLERY_CARD_WIDTH > other.x
          && item.y < other.y + GALLERY_CARD_HEIGHT && item.y + GALLERY_CARD_HEIGHT > other.y;
        assert.equal(overlap, false, `${count} cards: ${item.figure.id}, ${other.figure.id}`);
      }
    }
  }
});

test('dense boards are horizontal compositions with multi-card tiers rather than vertical stacks', () => {
  for (const count of [12, 18, 30, 100, 300]) {
    const { placements, bounds } = calculateGalleryLayout(people(count));
    assert.ok(bounds.width > bounds.height);
    const rows = new Map<number, typeof placements>();
    for (const item of placements) rows.set(item.tier, [...(rows.get(item.tier) ?? []), item]);
    assert.ok(rows.size > 1 && rows.size < count / 2);
    for (const row of rows.values()) assert.ok(row.length >= 3);
    assert.ok(new Set([...rows.values()].map(row => row[0].x)).size > 1, 'tiers should stagger');
  }
});

test('packing is deterministic, preserves category zones, and leaves input order unchanged', () => {
  const input = people(60);
  const original = [...input];
  const layout = calculateGalleryLayout(input);
  assert.deepEqual(calculateGalleryLayout([...input].reverse()), layout);
  assert.deepEqual(input, original);
  const completed = new Set<string>();
  let lastCategory: string | undefined;
  for (const { figure } of layout.placements) {
    if (lastCategory !== figure.category) {
      assert.equal(completed.has(figure.category), false, 'a category must remain in one contiguous zone');
      if (lastCategory) completed.add(lastCategory);
      lastCategory = figure.category;
    }
  }
});

test('dates, text length, and portraits never change card geometry', () => {
  const original = people(30);
  const changed = original.map(item => ({ ...item, birthYear: -3000, deathYear: 2000,
    name: item.name + ' an exceptionally long name', occupation: 'An exceptionally long occupation', imageUrl: 'portrait.jpg' }));
  const geometry = (items: HistoricalFigure[]) => calculateGalleryLayout(items).placements.map(({ figure, ...position }) => ({ id: figure.id, ...position }));
  assert.deepEqual(geometry(changed), geometry(original));
});
