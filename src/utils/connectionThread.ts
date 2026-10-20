import type { HistoricalFigure } from '../types';
import { GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH, GALLERY_COLUMN_GAP, GALLERY_TIER_GAP } from './galleryLayout';
import { BASE_PIXELS_PER_YEAR, ROW_HEIGHT } from './timelineLayout';
import { routeThread, type RouterRect } from './threadRouter';

// Path geometry for the thread that links a chain of people, one path per link, in the world
// coordinates of the layout it is drawn in. Each path is drawn from its start to its end.
// The timeline routes side to side, horizontally, so the thread never runs across the bar it connects.
// The gallery has the router in `threadRouter.ts`, which uses all four sides of a card and the gutters
// between cards; the side-to-side routing here is what it falls back to if no route is found.

// Vertical centre of a person's bar below the top of its row, and the padding between a row's
// left edge and its bar.
const BAR_CENTER = 46;
const BAR_INSET = 4;
const CORNER_RADIUS = 14;
// How far a same-side route leaves the pair before turning, and the shortest horizontal run out of a side.
const CLEARANCE = 28;
// A route that has to return to the side it left is only worth it over the other side when clearly shorter.
const SIDE_CONTINUITY_BONUS = 60;
// Where a thread enters and leaves one side of the same person: how far each line sits from the middle of the edge,
// and how much further out the second one turns.
const SHARED_SIDE_SHIFT = 6;
const TURN_STEP = 18;

const round = (value: number) => Math.round(value * 10) / 10;

type Side = 'left' | 'right';
interface Point { x: number; y: number }
// The horizontal extent of a person on screen and the height of the line a thread attaches to.
export interface ThreadBox { left: number; right: number; y: number }

// A polyline with rounded corners: each turn is cut short by its radius and joined by a curve.
function roundedPath(points: Point[], radius = CORNER_RADIUS): string {
  const corners = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (corners.length < 2) return '';
  const unit = (from: Point, to: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: (to.x - from.x) / length, y: (to.y - from.y) / length, length };
  };
  let d = `M ${round(corners[0].x)} ${round(corners[0].y)}`;
  for (let index = 1; index < corners.length - 1; index++) {
    const before = unit(corners[index], corners[index - 1]), after = unit(corners[index], corners[index + 1]);
    const straight = Math.abs(before.x + after.x) < 1e-6 && Math.abs(before.y + after.y) < 1e-6;
    const r = straight ? 0 : Math.min(radius, before.length / 2, after.length / 2);
    const { x, y } = corners[index];
    if (r < 1) { d += ` L ${round(x)} ${round(y)}`; continue; }
    d += ` L ${round(x + before.x * r)} ${round(y + before.y * r)} Q ${round(x)} ${round(y)} ${round(x + after.x * r)} ${round(y + after.y * r)}`;
  }
  const last = corners[corners.length - 1];
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

// Everything about a link except its exact ends: the sides it uses and where it turns.
interface LinkPlan {
  from: ThreadBox; to: ThreadBox; out: Side; into: Side; turn: number;
  // A route that turns just past both people can be pushed further out; one that turns in the gap between them is
  // fixed by the gap.
  pastBoth: boolean;
  // Vertical shift of the two ends, so a thread that comes in and goes out on the same side does not run over itself.
  startDy: number; endDy: number;
}

// Where a link goes between two people. Apart horizontally, it leaves the near side of one and enters the
// near side of the other. Overlapping horizontally, it leaves and re-enters on the same side, past both,
// choosing the side with the shorter route (and the side the previous link arrived on, to stay continuous).
function planLink(from: ThreadBox, to: ThreadBox, arrivedOn?: Side): LinkPlan {
  if (from.right < to.left) return { from, to, out: 'right', into: 'left', turn: (from.right + to.left) / 2, pastBoth: false, startDy: 0, endDy: 0 };
  if (to.right < from.left) return { from, to, out: 'left', into: 'right', turn: (from.left + to.right) / 2, pastBoth: false, startDy: 0, endDy: 0 };
  const rightTurn = Math.max(from.right, to.right) + CLEARANCE, leftTurn = Math.min(from.left, to.left) - CLEARANCE;
  const rightCost = rightTurn - from.right + (rightTurn - to.right) + (arrivedOn === 'left' ? SIDE_CONTINUITY_BONUS : 0);
  const leftCost = from.left - leftTurn + (to.left - leftTurn) + (arrivedOn === 'right' ? SIDE_CONTINUITY_BONUS : 0);
  const side: Side = rightCost <= leftCost ? 'right' : 'left';
  return { from, to, out: side, into: side, turn: side === 'right' ? rightTurn : leftTurn, pastBoth: true, startDy: 0, endDy: 0 };
}

const distanceAt = (plan: LinkPlan, box: ThreadBox, side: Side) => Math.abs(plan.turn - box[side]);

// A thread that arrives at a person on one side and leaves on the same side would run over itself along the
// short stretch next to the bar. Keep the two apart: the arriving and the leaving line sit a little above and
// below the middle of the bar's edge, and they turn at different distances, ordered so that they do not cross
// each other next to the bar. (They cross once further away when the chain doubles back; that is unavoidable.)
function separateSharedSide(plans: LinkPlan[]): void {
  for (let index = 1; index < plans.length; index++) {
    const arriving = plans[index - 1], leaving = plans[index], node = leaving.from;
    if (arriving.into !== leaving.out) continue;
    const arrivalMoves = arriving.from.y !== node.y, leavingMoves = leaving.to.y !== node.y;
    const fromAbove = arriving.from.y < node.y, toAbove = leaving.to.y < node.y;
    if (arrivalMoves && leavingMoves) {
      // From below to above they must swap, or the two would cross at the bar.
      const swap = !fromAbove && toAbove;
      arriving.endDy = swap ? SHARED_SIDE_SHIFT : -SHARED_SIDE_SHIFT;
      leaving.startDy = -arriving.endDy;
      // Both going up: the arriving line turns nearer. Both going down: the leaving one does.
      const [nearer, farther] = fromAbove && toAbove ? [arriving, leaving] : !fromAbove && !toAbove ? [leaving, arriving] : [null, null];
      if (nearer && farther?.pastBoth) {
        const outward = farther === arriving ? arriving.into : leaving.out;
        const needed = distanceAt(nearer, node, outward) + TURN_STEP - distanceAt(farther, node, outward);
        if (needed > 0) farther.turn += outward === 'right' ? needed : -needed;
      }
    } else if (arrivalMoves) arriving.endDy = fromAbove ? -SHARED_SIDE_SHIFT : SHARED_SIDE_SHIFT;
    else if (leavingMoves) leaving.startDy = toAbove ? -SHARED_SIDE_SHIFT : SHARED_SIDE_SHIFT;
  }
}

function linkPath({ from, to, out, into, turn, startDy, endDy }: LinkPlan): string {
  const start = { x: from[out], y: from.y + startDy }, end = { x: to[into], y: to.y + endDy };
  return roundedPath(start.y === end.y ? [start, end] : [start, { x: turn, y: start.y }, { x: turn, y: end.y }, end]);
}

export function manhattanThread(boxes: readonly ThreadBox[]): string[] {
  const plans: LinkPlan[] = [];
  for (let index = 1; index < boxes.length; index++) plans.push(planLink(boxes[index - 1], boxes[index], plans[index - 2]?.into));
  separateSharedSide(plans);
  return plans.map(linkPath);
}

// A person's bar as a box: the padding the row adds around it, the centre of the bar below the row top.
export function timelineThreadBox({ figure, level }: { figure: HistoricalFigure; level: number }, startYear: number): ThreadBox {
  const left = (figure.birthYear - startYear) * BASE_PIXELS_PER_YEAR + BAR_INSET;
  return { left, right: left + Math.max((figure.deathYear - figure.birthYear) * BASE_PIXELS_PER_YEAR, 10), y: level * ROW_HEIGHT + 60 + BAR_CENTER };
}

export const timelineThread = (chain: ReadonlyArray<{ figure: HistoricalFigure; level: number }>, startYear: number): string[] =>
  manhattanThread(chain.map(item => timelineThreadBox(item, startYear)));

// `cards` are the chain's cards in order, `board` every card of the board (the chain's included): the thread never
// crosses a card of the chain, and prefers not to cross the others.
export function galleryThread(cards: ReadonlyArray<{ x: number; y: number }>, board: ReadonlyArray<{ x: number; y: number }> = cards): string[] {
  if (cards.length < 2) return [];
  const rect = ({ x, y }: { x: number; y: number }): RouterRect => ({ x, y, width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT });
  const inChain = new Set<{ x: number; y: number }>(cards);
  const routes = routeThread(cards.map(rect), board.filter(card => !inChain.has(card)).map(rect), { x: GALLERY_COLUMN_GAP / 2, y: GALLERY_TIER_GAP / 2 });
  if (routes) return routes.map(points => roundedPath(points));
  return manhattanThread(cards.map(({ x, y }) => ({ left: x, right: x + GALLERY_CARD_WIDTH, y: y + GALLERY_CARD_HEIGHT / 2 })));
}
