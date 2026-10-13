// Routes the thread of a connection through a board of cards, one polyline per link.
//
// Each link is drawn as one of a few canonical orthogonal shapes between a side of one card and a side of the
// next: a straight line, an L (two legs), or a Z / U (three legs, the middle one in a gutter between cards).
// The shapes are listed for every pair of sides, the ones that run through another card of the chain are dropped,
// and one shape per link is then chosen for the whole chain at once:
//
//  - Shorter is better, and every bend costs a lot, so a single clean L beats a staircase.
//  - A thread prefers to leave a card sideways, run horizontally to the middle of the next card and then turn
//    up or down into it. Climbing first and then running into the side costs a little extra, so it happens when
//    something is in the way, or when it keeps the thread curling one way.
//  - A thread keeps curling the same way. Turning clockwise and then anticlockwise (an S) costs more than two
//    turns the same way (a bowl or a C). The turn the thread makes passing through a card counts too.
//  - A card is never left through the side the thread arrived by: that would double back along itself.
//
// Cards that are not part of the chain are ghosted while a connection is shown: crossing one costs next to
// nothing and only breaks ties. Finally, a stretch that would lie exactly on a thread laid earlier (and so hide
// it) is moved aside into a parallel lane a few pixels away.
//
// On a crowded board no canonical shape may be free (the way out can be a staircase through staggered rows). For
// such a link, and only then, a small search over the gutters between the chain's cards finds a route.

export interface RouterRect { x: number; y: number; width: number; height: number }
export interface RouterPoint { x: number; y: number }
export interface Gutter { x: number; y: number }

// Headings, and the sides of a card a thread leaves through (the side's outward direction): east/right,
// south/bottom, west/left, north/top.
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

// Costs, in pixels of route.
const BEND_COST = 250;
// A thread that turns one way and then the other (an S).
const REVERSAL_COST = 200;
// Climbing (or dropping) first and then running into the side, instead of the other way round.
const VERTICAL_FIRST_COST = 80;
// Leaving a card by the side the thread arrived by, which doubles it back on itself. A last resort.
const DOUBLING_BACK_COST = 2000;
// Per ghosted card a route crosses: a tie-break towards the clear gutters.
const GHOST_COST = 3;
// A leg shorter than this is not a leg.
const MIN_LEG = 10;
// How far chain cards are kept clear of, and the lanes a thread is moved into to avoid another.
const WALL_MARGIN = 6;
const LANE_STEP = 10;
const LANES = [1, -1, 2, -2, 3, -3, 4, -4];

const EPSILON = 0.01;
const same = (a: number, b: number) => Math.abs(a - b) < 0.5;

interface Segment { from: RouterPoint; to: RouterPoint }
interface Route {
  points: RouterPoint[];
  out: number; into: number;
  // Turn after turn along the route: +1 clockwise, -1 anticlockwise (screen directions).
  turns: number[];
  cost: number;
  walls: number;
}

const heading = (from: RouterPoint, to: RouterPoint) => Math.abs(to.x - from.x) > Math.abs(to.y - from.y) ? (to.x > from.x ? 0 : 2) : (to.y > from.y ? 1 : 3);
// +1 clockwise, -1 anticlockwise, 0 straight on, 2 a U-turn.
const turn = (from: number, to: number) => { const d = (to - from + 4) % 4; return d === 0 ? 0 : d === 1 ? 1 : d === 3 ? -1 : 2; };

const segmentsOf = (points: RouterPoint[]): Segment[] => points.slice(1).map((to, index) => ({ from: points[index], to }));
const lengthOf = (points: RouterPoint[]) => segmentsOf(points).reduce((sum, { from, to }) => sum + Math.abs(to.x - from.x) + Math.abs(to.y - from.y), 0);

// Whether an axis-aligned segment goes through the inside of a card (grown by `margin`).
function crosses({ from, to }: Segment, rect: RouterRect, margin: number): boolean {
  const left = Math.min(from.x, to.x), right = Math.max(from.x, to.x), top = Math.min(from.y, to.y), bottom = Math.max(from.y, to.y);
  return right > rect.x - margin + EPSILON && left < rect.x + rect.width + margin - EPSILON
    && bottom > rect.y - margin + EPSILON && top < rect.y + rect.height + margin - EPSILON;
}

// Where a thread touches a card: the middle of a side.
function port(rect: RouterRect, side: number): RouterPoint {
  const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return side === 0 ? { x: rect.x + rect.width, y: middle.y } : side === 2 ? { x: rect.x, y: middle.y }
    : side === 1 ? { x: middle.x, y: rect.y + rect.height } : { x: middle.x, y: rect.y };
}

// The gutter lines of the board: the empty channels beside every card, where a middle leg can run clear.
function gutterLines(rects: RouterRect[], gutter: Gutter) {
  const xs = new Set<number>(), ys = new Set<number>();
  for (const rect of rects) {
    xs.add(rect.x - gutter.x); xs.add(rect.x + rect.width + gutter.x);
    ys.add(rect.y - gutter.y); ys.add(rect.y + rect.height + gutter.y);
  }
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}
type Lines = ReturnType<typeof gutterLines>;

// A few of the lines strictly between `low` and `high`: the nearest to each end, and the middle one.
function between(lines: number[], low: number, high: number): number[] {
  const inside = lines.filter(line => line > low + MIN_LEG && line < high - MIN_LEG);
  if (!inside.length) return [];
  const middle = inside.reduce((best, line) => Math.abs(line - (low + high) / 2) < Math.abs(best - (low + high) / 2) ? line : best);
  return [...new Set([inside[0], inside[inside.length - 1], middle])];
}

// Every canonical shape from side `leaving` of `from` to side `entering` of `to`, as lists of points.
function shapes(from: RouterRect, to: RouterRect, leaving: number, entering: number, lines: Lines, gutter: Gutter): RouterPoint[][] {
  const p = port(from, leaving), q = port(to, entering), arriving = (entering + 2) % 4;
  const horizontal = leaving % 2 === 0;
  const ahead = (value: number, origin: number, dir: number) => (value - origin) * (horizontal ? DX[dir] : DY[dir]) > MIN_LEG;
  const result: RouterPoint[][] = [];

  if (entering % 2 !== leaving % 2) {
    // An L: out along the side's direction to the line of the other port, then into the other card.
    const corner = horizontal ? { x: q.x, y: p.y } : { x: p.x, y: q.y };
    const outward = horizontal ? (corner.x - p.x) * DX[leaving] > MIN_LEG : (corner.y - p.y) * DY[leaving] > MIN_LEG;
    const inward = horizontal ? (q.y - corner.y) * DY[arriving] > MIN_LEG : (q.x - corner.x) * DX[arriving] > MIN_LEG;
    if (outward && inward) result.push([p, corner, q]);
  } else if (arriving === leaving) {
    // Opposite sides facing each other: straight if lined up, otherwise a Z through a gutter between them.
    if (!ahead(horizontal ? q.x : q.y, horizontal ? p.x : p.y, leaving)) return result;
    if (horizontal ? same(p.y, q.y) : same(p.x, q.x)) result.push([p, q]);
    else if (horizontal) for (const x of between(lines.xs, Math.min(p.x, q.x), Math.max(p.x, q.x))) result.push([p, { x, y: p.y }, { x, y: q.y }, q]);
    else for (const y of between(lines.ys, Math.min(p.y, q.y), Math.max(p.y, q.y))) result.push([p, { x: p.x, y }, { x: q.x, y }, q]);
  } else if (entering === leaving) {
    // The same side of both cards: a U round the outside of the pair, in the nearest gutter beyond both.
    const sign = horizontal ? DX[leaving] : DY[leaving];
    const beyond = Math.max(...[p, q].map(point => (horizontal ? point.x : point.y) * sign)) + (horizontal ? gutter.x : gutter.y);
    const clear = (horizontal ? lines.xs : lines.ys).map(line => line * sign).filter(line => line >= beyond - EPSILON).sort((a, b) => a - b)[0] ?? beyond;
    const line = clear * sign;
    result.push(horizontal ? [p, { x: line, y: p.y }, { x: line, y: q.y }, q] : [p, { x: p.x, y: line }, { x: q.x, y: line }, q]);
  }
  return result;
}

const describe = (points: RouterPoint[]): Pick<Route, 'out' | 'into' | 'turns'> => {
  const headings = segmentsOf(points).map(({ from, to }) => heading(from, to));
  return { out: headings[0], into: headings[headings.length - 1], turns: headings.slice(1).map((h, index) => turn(headings[index], h)).filter(t => t !== 0) };
};

// A binary heap of [cost, state] pairs, for the rescue search.
class Heap {
  private costs: number[] = []; private states: number[] = [];
  get size() { return this.costs.length; }
  push(cost: number, state: number) {
    let index = this.costs.length;
    this.costs.push(cost); this.states.push(state);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.costs[parent] <= cost) break;
      this.costs[index] = this.costs[parent]; this.states[index] = this.states[parent]; index = parent;
    }
    this.costs[index] = cost; this.states[index] = state;
  }
  pop(): [number, number] {
    const topCost = this.costs[0], topState = this.states[0];
    const cost = this.costs.pop()!, state = this.states.pop()!;
    if (this.costs.length) {
      let index = 0;
      for (;;) {
        let child = 2 * index + 1;
        if (child >= this.costs.length) break;
        if (child + 1 < this.costs.length && this.costs[child + 1] < this.costs[child]) child++;
        if (this.costs[child] >= cost) break;
        this.costs[index] = this.costs[child]; this.states[index] = this.states[child]; index = child;
      }
      this.costs[index] = cost; this.states[index] = state;
    }
    return [topCost, topState];
  }
}

// The way out when no canonical shape is clear: the cheapest orthogonal route through the gutters beside the
// chain's cards, for each side the thread could leave by (shortest, with bends counted as in the shapes).
function rescue(from: RouterRect, to: RouterRect, walls: RouterRect[], gutter: Gutter): Route[] {
  const cards = [from, to, ...walls];
  const lines = gutterLines(cards, gutter);
  const xs = [...new Set([...lines.xs, from.x + from.width / 2, to.x + to.width / 2])].sort((a, b) => a - b);
  const ys = [...new Set([...lines.ys, from.y + from.height / 2, to.y + to.height / 2])].sort((a, b) => a - b);
  const column = new Map(xs.map((value, index) => [value, index])), row = new Map(ys.map((value, index) => [value, index]));
  const ny = ys.length;
  const at = (node: number): RouterPoint => ({ x: xs[Math.floor(node / ny)], y: ys[node % ny] });
  const nodeOf = (point: RouterPoint) => (column.get(point.x) ?? -1) * ny + (row.get(point.y) ?? -1);
  const stub = (rect: RouterRect, side: number) => { const at = port(rect, side); return { x: at.x + DX[side] * gutter.x, y: at.y + DY[side] * gutter.y }; };
  const clear = new Map<string, boolean>();
  const free = (a: RouterPoint, b: RouterPoint) => {
    const key = `${a.x},${a.y},${b.x},${b.y}`;
    if (!clear.has(key)) clear.set(key, !cards.some(card => crosses({ from: a, to: b }, card, card === from || card === to ? 0 : WALL_MARGIN)));
    return clear.get(key)!;
  };
  const routes: Route[] = [];
  for (let leaving = 0; leaving < 4; leaving++) {
    const start = nodeOf(stub(from, leaving)) * 4 + leaving;
    // Arriving at the stub of any side of the other card, the last turn into the card is paid for like any bend.
    const goals = new Map([0, 1, 2, 3].map(side => [nodeOf(stub(to, side)), side]));
    const dist = new Map<number, number>([[start, 0]]), previous = new Map<number, number>();
    const heap = new Heap();
    heap.push(0, start);
    let best = Infinity, reached = -1, entering = -1;
    while (heap.size) {
      const [cost, state] = heap.pop();
      if (cost >= best) break;
      if (cost > (dist.get(state) ?? Infinity)) continue;
      const dir = state & 3, node = state >> 2, here = at(node), ix = Math.floor(node / ny), iy = node % ny;
      const side = goals.get(node);
      if (side !== undefined) {
        const total = cost + (dir === (side + 2) % 4 ? 0 : BEND_COST);
        if (total < best) { best = total; reached = state; entering = side; }
      }
      for (let next = 0; next < 4; next++) {
        if (next === (dir + 2) % 4) continue;
        const jx = ix + DX[next], jy = iy + DY[next];
        if (jx < 0 || jx >= xs.length || jy < 0 || jy >= ny) continue;
        const there = { x: xs[jx], y: ys[jy] };
        if (!free(here, there)) continue;
        const total = cost + Math.abs(there.x - here.x) + Math.abs(there.y - here.y) + (next === dir ? 0 : BEND_COST);
        const target = (jx * ny + jy) * 4 + next;
        if (total < (dist.get(target) ?? Infinity)) { dist.set(target, total); previous.set(target, state); heap.push(total, target); }
      }
    }
    if (reached < 0) continue;
    const nodes: RouterPoint[] = [];
    for (let state: number | undefined = reached; state !== undefined; state = previous.get(state)) nodes.unshift(at(state >> 2));
    const points = [port(from, leaving), ...nodes, port(to, entering)]
      .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y)
      .filter((point, index, all) => index === 0 || index === all.length - 1 || !((all[index - 1].x === point.x && point.x === all[index + 1].x) || (all[index - 1].y === point.y && point.y === all[index + 1].y)));
    routes.push({ points, ...describe(points), walls: 0, cost: lengthOf(points) + BEND_COST * (points.length - 2) });
  }
  return routes;
}

// All the routes worth considering between two cards, each with what it costs on its own.
function routesBetween(from: RouterRect, to: RouterRect, walls: RouterRect[], ghosts: RouterRect[], lines: Lines, gutter: Gutter): Route[] {
  const found: Route[] = [];
  for (let leaving = 0; leaving < 4; leaving++) for (let entering = 0; entering < 4; entering++) {
    for (const points of shapes(from, to, leaving, entering, lines, gutter)) {
      const parts = segmentsOf(points);
      const blocked = parts.filter(part => walls.some(wall => crosses(part, wall, WALL_MARGIN)) || crosses(part, from, 0) || crosses(part, to, 0)).length;
      const ghostsCrossed = ghosts.filter(ghost => parts.some(part => crosses(part, ghost, 0))).length;
      const shape = describe(points);
      const verticalFirst = shape.turns.length === 1 && shape.out % 2 === 1;
      found.push({ points, ...shape, walls: blocked,
        cost: lengthOf(points) + BEND_COST * (points.length - 2) + (verticalFirst ? VERTICAL_FIRST_COST : 0) + GHOST_COST * ghostsCrossed });
    }
  }
  // Routes that keep clear of the chain's cards win outright; if no shape does, search for one (and if even that
  // finds nothing, the least bad shape).
  const fewest = Math.min(...found.map(route => route.walls));
  if (fewest > 0) { const rescued = rescue(from, to, walls, gutter); if (rescued.length) return rescued; }
  return found.filter(route => route.walls === fewest);
}

// Picks one route per link so the whole chain costs least: the routes' own costs, plus the S-turns the thread makes
// across them and through the cards between them, plus doubling back at a card.
function choose(options: Route[][]): Route[] {
  // State after each link: how the thread arrives at the card (heading) and which way it last turned.
  interface State { cost: number; route: Route; previous: State | null; heading: number; lastTurn: number }
  let states: State[] = [];
  options.forEach((routes, link) => {
    const next = new Map<string, State>();
    const sources: Array<State | null> = link === 0 ? [null] : states;
    for (const source of sources) for (const route of routes) {
      let cost = (source?.cost ?? 0) + route.cost, last = source?.lastTurn ?? 0;
      const turns = [...(source ? [turn(source.heading, route.out)] : []), ...route.turns];
      for (const t of turns) {
        if (t === 2) { cost += DOUBLING_BACK_COST; continue; }
        if (t === 0) continue;
        if (last !== 0 && t !== last) cost += REVERSAL_COST;
        last = t;
      }
      const key = `${route.into}|${last}`;
      const known = next.get(key);
      if (!known || cost < known.cost) next.set(key, { cost, route, previous: source, heading: route.into, lastTurn: last });
    }
    states = [...next.values()];
  });
  const chosen: Route[] = [];
  let state: State | null = states.reduce((best, candidate) => candidate.cost < best.cost ? candidate : best);
  for (; state; state = state.previous) chosen.unshift(state.route);
  return chosen;
}

// How much of two segments lies on top of each other (on the same line, covering the same stretch).
function overlap(a: Segment, b: Segment): number {
  const aHorizontal = same(a.from.y, a.to.y), bHorizontal = same(b.from.y, b.to.y);
  if (aHorizontal !== bHorizontal) return 0;
  if (aHorizontal ? !same(a.from.y, b.from.y) : !same(a.from.x, b.from.x)) return 0;
  const [a1, a2] = (aHorizontal ? [a.from.x, a.to.x] : [a.from.y, a.to.y]).sort((x, y) => x - y);
  const [b1, b2] = (aHorizontal ? [b.from.x, b.to.x] : [b.from.y, b.to.y]).sort((x, y) => x - y);
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}
const overlapCount = (points: RouterPoint[], others: Segment[]) =>
  segmentsOf(points).reduce((sum, part) => sum + others.filter(other => overlap(part, other) > 1).length, 0);

// Moves one leg of a route sideways, taking the points at both its ends with it (the legs next to it just get
// longer or shorter). The first and last legs slide along the side of the card they start or end on.
function shift(points: RouterPoint[], leg: number, by: number): RouterPoint[] {
  const horizontal = same(points[leg].y, points[leg + 1].y);
  return points.map((point, index) => index === leg || index === leg + 1 ? (horizontal ? { x: point.x, y: point.y + by } : { x: point.x + by, y: point.y }) : point);
}

// A route that lies on top of an earlier one is moved over by a lane, if that frees it without running into a card.
function separate(route: Route, earlier: Segment[], walls: RouterRect[], ends: RouterRect[]): RouterPoint[] {
  let points = route.points;
  for (let leg = 0; leg < points.length - 1; leg++) {
    if (!earlier.some(other => overlap({ from: points[leg], to: points[leg + 1] }, other) > 1)) continue;
    const before = overlapCount(points, earlier);
    for (const lane of LANES) {
      const moved = shift(points, leg, lane * LANE_STEP), parts = segmentsOf(moved);
      if (walls.some(wall => parts.some(part => crosses(part, wall, WALL_MARGIN))) || ends.some(card => parts.some(part => crosses(part, card, 0)))) continue;
      if (overlapCount(moved, earlier) < before) { points = moved; break; }
    }
  }
  return points;
}

// One polyline per link of the chain. `others` are the other cards of the board (ghosted while the thread is shown).
export function routeThread(chain: RouterRect[], others: RouterRect[], gutter: Gutter): RouterPoint[][] | null {
  if (chain.length < 2) return [];
  const lines = gutterLines([...chain, ...others], gutter);
  const options = chain.slice(1).map((to, index) => {
    const from = chain[index];
    return routesBetween(from, to, chain.filter(card => card !== from && card !== to), others, lines, gutter);
  });
  if (options.some(routes => !routes.length)) return null;
  const placed: Segment[] = [];
  return choose(options).map((route, index) => {
    const points = separate(route, placed, chain.filter(card => card !== chain[index] && card !== chain[index + 1]), [chain[index], chain[index + 1]]);
    placed.push(...segmentsOf(points));
    return points;
  });
}
