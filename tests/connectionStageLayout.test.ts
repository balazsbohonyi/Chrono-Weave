import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestStageColumns, layoutStage, pointAlong, pointAtProgress, stageColumns, STAGE_CARD_HEIGHT, STAGE_CARD_WIDTH, STAGE_GAP_X, type Box } from '../src/utils/connectionStageLayout';

const COUNTS = Array.from({ length: 21 }, (_, index) => index + 2);
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('people stand in one row up to four, then in rows of four, and rows of five for long chains', () => {
  assert.deepEqual([2, 3, 4, 5, 8, 9, 22].map(stageColumns), [2, 3, 4, 4, 4, 5, 5]);
  const wide = layoutStage(4);
  assert.deepEqual(new Set(wide.cards.map(card => Math.round((card.y + STAGE_CARD_HEIGHT / 2) / 100))).size <= 2, true, 'a single row, give or take the wave');
  assert.equal(layoutStage(22).cards.filter(card => card.x === 0).length > 3, true);
});

test('the chain snakes: every card is next to the one before it, and a row change drops straight down', () => {
  for (const count of COUNTS) {
    const { cards, links } = layoutStage(count);
    assert.equal(cards.length, count); assert.equal(links.length, count - 1);
    cards.slice(1).forEach((card, offset) => {
      const before = cards[offset], dx = Math.abs(card.x - before.x), dy = Math.abs(card.y - before.y);
      const sideways = dx === STAGE_CARD_WIDTH + STAGE_GAP_X && dy <= 60, below = dx === 0 && card.y > before.y + STAGE_CARD_HEIGHT;
      assert.ok(sideways || below, `${count} people: card ${offset + 1} is not beside or below the one before`);
      assert.equal(links[offset].vertical, below);
    });
  }
});

test('nothing overlaps: no two cards, no caption on a card, and no two captions, for every chain length a search can return', () => {
  for (const count of COUNTS) {
    const { cards, links } = layoutStage(count);
    for (let first = 0; first < cards.length; first++) for (let second = first + 1; second < cards.length; second++) assert.ok(!overlap(cards[first], cards[second]), `${count}: cards ${first} and ${second}`);
    for (const link of links) for (const card of cards) assert.ok(!overlap(link.caption, card), `${count}: caption ${link.index} on card ${card.index}`);
    for (let first = 0; first < links.length; first++) for (let second = first + 1; second < links.length; second++) assert.ok(!overlap(links[first].caption, links[second].caption), `${count}: captions ${first} and ${second}`);
  }
});

test('a link runs from a side of one card to the facing side of the next, as a path of one curve', () => {
  const { cards, links } = layoutStage(6);
  // Sideways: right edge of the first card to the left edge of the second.
  assert.equal(links[0].from.x, cards[0].x + STAGE_CARD_WIDTH);
  assert.equal(links[0].to.x, cards[1].x);
  assert.equal(links[0].from.y, cards[0].y + STAGE_CARD_HEIGHT / 2);
  assert.match(links[0].d, /^M [\d.-]+ [\d.-]+ C [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
  // Back along the second row: leaves the left side, enters the right side.
  const back = links[4];
  assert.ok(back.to.x > cards[5].x && back.from.x === cards[4].x);
  // The row change: bottom of one card to the top of the card under it.
  const drop = links.find(link => link.vertical)!;
  assert.equal(drop.from.x, drop.to.x);
  assert.equal(drop.from.y, cards[drop.index].y + STAGE_CARD_HEIGHT);
  assert.equal(drop.to.y, cards[drop.index + 1].y);
});

test('positions along a link are found by arc length, from one end to the other', () => {
  const { links } = layoutStage(7);
  for (const link of links) {
    const { samples } = link;
    for (let index = 1; index < samples.length; index++) assert.ok(samples[index].at >= samples[index - 1].at, 'distances only grow');
    assert.equal(link.length, samples.at(-1)!.at);
    const start = pointAlong(link, 0), end = pointAlong(link, 1), middle = pointAlong(link, 0.5);
    assert.ok(Math.hypot(start.x - link.from.x, start.y - link.from.y) < 0.01);
    assert.ok(Math.hypot(end.x - link.to.x, end.y - link.to.y) < 0.01);
    // Half way by length is half way by distance travelled along the samples.
    const half = samples.reduce((best, sample) => Math.abs(sample.at - link.length / 2) < Math.abs(best.at - link.length / 2) ? sample : best);
    assert.ok(Math.hypot(middle.x - half.x, middle.y - half.y) < link.length / 40);
    // Out-of-range fractions stay on the link.
    assert.deepEqual(pointAlong(link, -3), start); assert.deepEqual(pointAlong(link, 9), end);
  }
});

test('a reveal progress maps to the link being drawn and how far along it is', () => {
  const layout = layoutStage(5);
  assert.deepEqual(pointAtProgress(layout, 0), pointAlong(layout.links[0], 0));
  assert.deepEqual(pointAtProgress(layout, 2.25), pointAlong(layout.links[2], 0.25));
  // The finished thread ends on the last link, however far over the progress is.
  assert.deepEqual(pointAtProgress(layout, 4), pointAlong(layout.links[3], 1));
  assert.deepEqual(pointAtProgress(layout, 40), pointAlong(layout.links[3], 1));
});

test('the bounds hold every card and caption, so a camera framing them shows the whole chain', () => {
  for (const count of COUNTS) {
    const { cards, links, bounds } = layoutStage(count);
    for (const box of [...cards, ...links.map(link => link.caption)]) {
      assert.ok(box.x >= bounds.x - 0.01 && box.y >= bounds.y - 0.01 && box.x + box.width <= bounds.x + bounds.width + 0.01 && box.y + box.height <= bounds.y + bounds.height + 0.01);
    }
  }
});

test('every row length from two to five snakes without overlaps, for every chain length', () => {
  for (const count of COUNTS) for (let columns = 2; columns <= Math.min(5, count); columns++) {
    const { cards, links } = layoutStage(count, columns);
    cards.slice(1).forEach((card, offset) => {
      const before = cards[offset], dx = Math.abs(card.x - before.x);
      assert.ok(dx === STAGE_CARD_WIDTH + STAGE_GAP_X || (dx === 0 && card.y > before.y + STAGE_CARD_HEIGHT), `${count} people in rows of ${columns}: card ${offset + 1}`);
    });
    for (let first = 0; first < cards.length; first++) for (let second = first + 1; second < cards.length; second++) assert.ok(!overlap(cards[first], cards[second]));
    for (const link of links) for (const card of cards) assert.ok(!overlap(link.caption, card), `${count}/${columns}: caption ${link.index} on card ${card.index}`);
    for (let first = 0; first < links.length; first++) for (let second = first + 1; second < links.length; second++) assert.ok(!overlap(links[first].caption, links[second].caption), `${count}/${columns}: captions ${first} and ${second}`);
  }
});

test('the stage picks long rows for a wide area and short rows for a tall, narrow one', () => {
  const wide = bestStageColumns(22, { width: 2400, height: 600 }), narrow = bestStageColumns(22, { width: 420, height: 800 });
  assert.ok(wide > narrow, `wide ${wide}, narrow ${narrow}`);
  assert.ok(wide >= 4 && narrow <= 3);
  // However odd the area, the answer is a row length that can be laid out, and a pair is always one row.
  for (const count of COUNTS) for (const area of [{ width: 300, height: 900 }, { width: 856, height: 624 }, { width: 3000, height: 500 }]) {
    const columns = bestStageColumns(count, area);
    assert.ok(columns >= 2 && columns <= Math.min(5, Math.max(2, count)));
  }
  assert.equal(bestStageColumns(2, { width: 400, height: 900 }), 2);
  // The size the whole snake gets is never worse than with the default row length.
  const scale = (count: number, columns: number, area: { width: number; height: number }) => { const { bounds } = layoutStage(count, columns); return Math.min(area.width / bounds.width, area.height / bounds.height); };
  for (const count of [6, 11, 16, 22]) {
    const area = { width: 856, height: 624 };
    assert.ok(scale(count, bestStageColumns(count, area), area) >= scale(count, stageColumns(count), area) * 0.97);
  }
});
