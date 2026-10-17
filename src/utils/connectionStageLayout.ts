import { GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from './galleryLayout';

// Where the people of a connection stand on the connection stage, and the smooth thread between them.
//
// The stage shows only the chain, so the cards are free to go anywhere: they follow a snaking path, rows of
// four or five running left to right and then right to left like a conveyor belt, and a row change is a
// straight drop onto the card below. Nothing overlaps by construction and the thread never has to be routed
// round anything. Cards sit alternately a little higher and a little lower so the links between them are
// gentle S-curves. The layout depends only on how many people there are.

export const STAGE_CARD_WIDTH = GALLERY_CARD_WIDTH;
export const STAGE_CARD_HEIGHT = GALLERY_CARD_HEIGHT;
// Empty room between cards: wide enough for a caption in the gap beside a link, tall enough for one between rows.
export const STAGE_GAP_X = 260;
export const STAGE_GAP_Y = 210;
const WAVE = 22;
export const CAPTION_WIDTH = 230;
export const CAPTION_HEIGHT = 96;
// Space between a thread and its caption.
const CAPTION_MARGIN = 16;
const SAMPLES = 48;

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }
export interface StageCard extends Box { index: number }
export interface StageLink {
  index: number;
  // The thread as an SVG path (one cubic Bézier), from a side of one card to a side of the next.
  d: string;
  from: Point; to: Point;
  vertical: boolean;
  length: number;
  // Points along the curve with the distance travelled to each, so a position can be found by arc length.
  samples: Array<Point & { at: number }>;
  caption: Box;
}
export interface StageLayout { cards: StageCard[]; links: StageLink[]; bounds: Box }

// Four people or fewer stand in one row; more wrap into rows of four, and long chains into rows of five.
export const stageColumns = (count: number) => count <= 4 ? Math.max(1, count) : count <= 8 ? 4 : 5;

const round = (value: number) => Math.round(value * 10) / 10;

function cubicPoint(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y };
}

// `columns` is how many people stand in a row; the stage picks it from its own shape (see `bestStageColumns`).
export function layoutStage(count: number, columns = stageColumns(count)): StageLayout {
  const cards: StageCard[] = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns), step = index % columns;
    const column = row % 2 === 0 ? step : columns - 1 - step;
    return { index, x: column * (STAGE_CARD_WIDTH + STAGE_GAP_X), width: STAGE_CARD_WIDTH, height: STAGE_CARD_HEIGHT,
      y: row * (STAGE_CARD_HEIGHT + STAGE_GAP_Y) + (index % 2 === 0 ? -WAVE : WAVE) };
  });

  const links: StageLink[] = cards.slice(1).map((to, offset) => {
    const from = cards[offset], vertical = from.x === to.x;
    let start: Point, end: Point, first: Point, second: Point;
    if (vertical) {
      start = { x: from.x + from.width / 2, y: from.y + from.height }; end = { x: to.x + to.width / 2, y: to.y };
      const reach = (end.y - start.y) / 2;
      first = { x: start.x, y: start.y + reach }; second = { x: end.x, y: end.y - reach };
    } else {
      const east = to.x > from.x;
      start = { x: east ? from.x + from.width : from.x, y: from.y + from.height / 2 };
      end = { x: east ? to.x : to.x + to.width, y: to.y + to.height / 2 };
      const reach = Math.abs(end.x - start.x) / 2 * (east ? 1 : -1);
      first = { x: start.x + reach, y: start.y }; second = { x: end.x - reach, y: end.y };
    }
    const samples: StageLink['samples'] = [];
    let travelled = 0, previous = start;
    for (let step = 0; step <= SAMPLES; step++) {
      const point = cubicPoint(start, first, second, end, step / SAMPLES);
      travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
      samples.push({ ...point, at: travelled }); previous = point;
    }
    const middle = samples[SAMPLES / 2];
    // A caption sits above a sideways link, and beside a drop on the outer side of the board, away from the other captions.
    const outerLeft = vertical && from.x === 0;
    const caption: Box = vertical
      ? { x: outerLeft ? middle.x - CAPTION_MARGIN - CAPTION_WIDTH : middle.x + CAPTION_MARGIN, y: middle.y - CAPTION_HEIGHT / 2, width: CAPTION_WIDTH, height: CAPTION_HEIGHT }
      : { x: middle.x - CAPTION_WIDTH / 2, y: middle.y - CAPTION_MARGIN - CAPTION_HEIGHT, width: CAPTION_WIDTH, height: CAPTION_HEIGHT };
    return { index: offset, vertical, from: start, to: end, length: travelled, samples, caption,
      d: `M ${round(start.x)} ${round(start.y)} C ${round(first.x)} ${round(first.y)} ${round(second.x)} ${round(second.y)} ${round(end.x)} ${round(end.y)}` };
  });

  const boxes: Box[] = [...cards, ...links.map(link => link.caption)];
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { cards, links, bounds: { x: left, y: top, width: right - left, height: bottom - top } };
}

// How many people to put in a row so that the whole snake, framed in an area of this size, is as large as it can be.
// A wide area takes long rows, a tall narrow one (a phone, or a laptop with the sidebar open) shorter rows.
export function bestStageColumns(count: number, area: { width: number; height: number }): number {
  let best = stageColumns(count), bestScale = -1;
  for (let columns = Math.min(count, 5); columns >= 2; columns--) {
    const { bounds } = layoutStage(count, columns);
    const scale = Math.min(area.width / bounds.width, area.height / bounds.height);
    // A little room for longer rows, which read better, before a taller snake wins.
    if (scale > bestScale * 1.03) { best = columns; bestScale = scale; }
  }
  return best;
}

// The point `fraction` (0..1) of the way along a link by length, which is how the thread is drawn in.
export function pointAlong(link: StageLink, fraction: number): Point {
  const wanted = Math.max(0, Math.min(1, fraction)) * link.length;
  const { samples } = link;
  let index = 1;
  while (index < samples.length - 1 && samples[index].at < wanted) index++;
  const before = samples[index - 1], after = samples[index];
  const span = after.at - before.at || 1, share = (wanted - before.at) / span;
  return { x: before.x + (after.x - before.x) * share, y: before.y + (after.y - before.y) * share };
}

// The point reached by a reveal `progress` (links drawn so far, with the next one part-way), or the last card's
// edge once the whole thread has been drawn.
export function pointAtProgress(layout: StageLayout, progress: number): Point {
  const last = layout.links.length - 1;
  const index = Math.min(last, Math.max(0, Math.floor(progress)));
  return pointAlong(layout.links[index], progress - index);
}
