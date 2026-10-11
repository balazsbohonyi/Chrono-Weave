import type { HistoricalFigure } from '../types';
import { GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from './galleryLayout';
import { BASE_PIXELS_PER_YEAR, ROW_HEIGHT } from './timelineLayout';

// Path geometry for the glowing thread that links a chain of people, one path per link, in the
// world coordinates of the layout it is drawn in. Each path is drawn from its start to its end.

// Vertical centre of a person's bar below the top of its row.
const BAR_CENTER = 46;
const CORNER_RADIUS = 14;

const round = (value: number) => Math.round(value * 10) / 10;

// A horizontal run along the current bar, then a vertical drop to the next one, with a rounded corner.
function elbow(x0: number, y0: number, x1: number, y1: number): string {
  if (x0 === x1 || y0 === y1) return `M ${round(x0)} ${round(y0)} L ${round(x1)} ${round(y1)}`;
  const radius = Math.min(CORNER_RADIUS, Math.abs(x1 - x0), Math.abs(y1 - y0) / 2);
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  return `M ${round(x0)} ${round(y0)} L ${round(x1 - sx * radius)} ${round(y0)} Q ${round(x1)} ${round(y0)} ${round(x1)} ${round(y0 + sy * radius)} L ${round(x1)} ${round(y1)}`;
}

// The thread passes between two people where their lives overlapped: it runs along each person's
// bar to the middle of the years shared with the next, then crosses to the next person's bar.
export function timelineThread(chain: ReadonlyArray<{ figure: HistoricalFigure; level: number }>, startYear: number): string[] {
  const rows = chain.map(({ level }) => level * ROW_HEIGHT + 60 + BAR_CENTER);
  const contacts = chain.slice(1).map(({ figure }, index) => {
    const previous = chain[index].figure;
    const from = Math.max(previous.birthYear, figure.birthYear), to = Math.min(previous.deathYear, figure.deathYear);
    const year = from <= to ? (from + to) / 2
      : (previous.birthYear + previous.deathYear + figure.birthYear + figure.deathYear) / 4;
    return (year - startYear) * BASE_PIXELS_PER_YEAR;
  });
  return contacts.map((x, index) => elbow(index === 0 ? x : contacts[index - 1], rows[index], x, rows[index + 1]));
}

// A gentle arc between card centres. The cards sit above the thread, so it shows in the gaps between them.
export function galleryThread(cards: ReadonlyArray<{ x: number; y: number }>): string[] {
  const centres = cards.map(({ x, y }) => ({ x: x + GALLERY_CARD_WIDTH / 2, y: y + GALLERY_CARD_HEIGHT / 2 }));
  return centres.slice(1).map((end, index) => {
    const start = centres[index];
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const bow = Math.min(60, length * 0.12);
    const control = { x: (start.x + end.x) / 2 - dy / length * bow, y: (start.y + end.y) / 2 + dx / length * bow };
    return `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`;
  });
}
