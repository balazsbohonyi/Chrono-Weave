import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import type { Side } from './connectionNetworkView';

// d3-force as a physics helper only: it computes positions, React owns the DOM. Everything here is
// plain TypeScript so the layout can be driven and checked tick by tick without a browser.

// 'cluster' is a free layout (no time axis) that gathers everybody on rings around the endpoint they are closest to; 'columns' lines
// them up in columns by the number of links from the nearest endpoint (A on the left counted from the left, B on the right from the right);
// 'category' sets everybody in a labelled pod per category between the two endpoints; 'corridor' puts the chain (or the best known
// way between the two ends) on the centre line and fans everybody else out above and below the person on it they are closest to.
export type LayoutMode = 'time' | 'free' | 'cluster' | 'columns' | 'category' | 'corridor';
// `side`, `distance` and `parent` come from the view model (accepted links from the nearest endpoint), `category` is the person's field
// and `spine` their place along the corridor (null when they are not on it); only the arranged layouts read them.
// `clearance` is how far beyond its disc a person's drawing reaches (the "+n" badge of a folded person), so the free zone around an
// endpoint keeps that out as well.
export interface LayoutInput {
  id: string; year: number; endpoint: 0 | 1 | null; radius: number; clearance?: number;
  side?: Side; distance?: number | null; parent?: string | null; category?: string; spine?: number | null;
}
export interface LayoutLinkInput { a: string; b: string }
export interface LayoutNode extends SimulationNodeDatum {
  id: string; year: number; endpoint: 0 | 1 | null; radius: number; clearance: number; side: Side; distance: number | null; parent: string | null;
  category: string; spine: number | null;
}
// The round space kept free around an endpoint on the time line and in the free layout.
export interface FreeZone { id: string; x: number; y: number; radius: number }
type Link = SimulationLinkDatum<LayoutNode>;
interface Point { x: number; y: number }

const MARGIN = 90;
const LABEL_ROOM = 28;
// The time axis has a spacing of its own instead of being squeezed into whatever width the drawing has:
// a short span gets this much room per year, a long span gets less (down to a floor), and the camera
// pans and zooms over the result. The years are spread twice as far apart as they first were (4.4 reference widths), so a person is
// placed by their year across a wider band and the picture grows more horizontal than tall; the axis labels keep the same years
// (`TICK_MIN_SPACING` doubled with it), so their distance doubles too.
const TIME_REFERENCE_WIDTH = 1000;
const TIME_SPREAD = 4.4;
const MIN_PIXELS_PER_YEAR = 4;
const MAX_PIXELS_PER_YEAR = 28;
export const TICK_MIN_SPACING = 140;
// Contacts on the time line pull toward each other; with the years spread twice as far apart the old pull (0.08) would drag people about twice as far off their year, so it is lowered to keep them where they were.
const TIME_LINK_STRENGTH = 0.03;
const DEFAULT_SIZE = { width: 900, height: 600 };
const ALPHA_MIN = 0.02;
// This many people arriving at once (or the very first people) are seated before they are drawn instead of animating.
const SEAT_THRESHOLD = 6;
const SEAT_MAX_TICKS = 400;
// Cluster layout: each endpoint keeps its people on rings (one per link of distance) over this much of the circle,
// facing away from the other endpoint so the space between the two stays free for people attached to neither.
const ORBIT_ARC = Math.PI * 1.5;
const ORBIT_MIN_SEPARATION = 480;
const ORBIT_GAP = 120;
const ORBIT_PULL = 0.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Columns layout: people at the same number of links from an endpoint share a group of lanes. A lane is at least as wide as a name
// (a name is wider than the slot), a lane holds this many rows before the group widens by another lane, and groups are set a little
// apart so the distances read as separate columns. The first lane clears the widest name pill under the endpoint.
const COLUMN_MIN_PITCH = 124;
const COLUMN_MAX_ROWS = 12;
const COLUMN_GROUP_GAP = 40;
const COLUMN_MIN_SEPARATION = 640;
const COLUMN_GAP = 120;
const ENDPOINT_LABEL_HALF = 118;
// Category layout: a pod holds one category's people in a grid of slots under a title; the pods partition one block that
// is wider than tall, with the endpoints standing outside it, one on each side.
const POD_PADDING = 26;
const POD_HEADER = 50;
const POD_GAP = 44;
const POD_BLOCK_ASPECT = 1.7;
const POD_MIN_SEPARATION = 480;
const POD_SIDE_GAP = ENDPOINT_LABEL_HALF + 70;
// Corridor layout: the people on the centre line are at least this far apart, and the people around each of them hang in lanes
// (like a column's) above and below, a slot of height per link.
const CORRIDOR_MIN_PITCH = 170;
const CORRIDOR_RIB_GAP = 36;
const CORRIDOR_MIN_LENGTH = 560;
// The anchor of offsets that are measured from the fixed middle of the layout (it follows nobody).
const CENTER = '@center';
// Free zone: nobody but the endpoint stands within this many endpoint radii of an endpoint's middle (and nobody's whole drawing
// reaches into it), so the two endpoints are easy to find in a crowd. When the endpoints are so close that the two zones would
// overlap, both shrink equally, down to a floor.
const ZONE_FACTOR = 3;
const ZONE_MIN_SCALE = 0.5;

// Pushes a person whose disc (plus `reach`) enters `zone` out to its rim: straight away from the endpoint, or (`vertical`, the time
// line, where the place along the axis is a year) straight up or down to the rim. Null when the person is already clear.
// `bias` (1 or -1) picks the side when the person is exactly on the endpoint's middle line.
export function pushOutOfZone(point: Point, zone: Pick<FreeZone, 'x' | 'y' | 'radius'>, reach: number, vertical: boolean, bias = 1): Point | null {
  const min = zone.radius + reach, dx = point.x - zone.x, dy = point.y - zone.y, distance = Math.hypot(dx, dy);
  if (distance >= min) return null;
  if (vertical) return { x: point.x, y: zone.y + (dy === 0 ? bias : Math.sign(dy)) * Math.sqrt(min * min - dx * dx) };
  if (distance === 0) return { x: zone.x + bias * min, y: zone.y };
  return { x: zone.x + dx / distance * min, y: zone.y + dy / distance * min };
}
const tieBreak = (id: string) => { let hash = 0; for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0; return hash % 2 === 0 ? 1 : -1; };

// The time axis as pure functions of the endpoints' years and everybody's years, so a copy of the layout running elsewhere (a
// worker) and the drawing agree on it without asking each other.
export function yearDomainFor(bounds: readonly [number, number], years: Iterable<number>): [number, number] {
  let [from, to] = bounds;
  const pad = Math.max(8, (to - from) * 0.06);
  from -= pad; to += pad;
  for (const year of years) { from = Math.min(from, year - pad / 2); to = Math.max(to, year + pad / 2); }
  return [Math.floor(from), Math.ceil(to)];
}
export function pixelsPerYearFor(domain: readonly [number, number]) {
  const span = Math.max(1, domain[1] - domain[0]);
  return Math.min(MAX_PIXELS_PER_YEAR, Math.max(MIN_PIXELS_PER_YEAR, TIME_REFERENCE_WIDTH * TIME_SPREAD / span));
}
export const timeX = (year: number, domain: readonly [number, number]) => MARGIN + (year - domain[0]) * pixelsPerYearFor(domain);

// Where a dragged person may go: not into a free zone (so they stop at the rim), and an endpoint not so near the other that the zones
// would meet at their smallest. `homeX` is where an endpoint stands on the time line; `other` is the other endpoint, when placed.
export function clampDragPoint(node: Pick<LayoutNode, 'id' | 'endpoint' | 'radius' | 'clearance'>, x: number, y: number,
  context: { arranged: boolean; time: boolean; zones: readonly FreeZone[]; homeX: number; other: { x: number; y: number; radius: number } | null }): Point {
  if (context.arranged) return { x, y };
  if (node.endpoint === null) {
    let at = { x, y };
    for (const zone of context.zones) at = pushOutOfZone(at, zone, node.radius + node.clearance, false, tieBreak(node.id)) ?? at;
    return at;
  }
  const other = context.other; if (!other) return { x, y };
  const apart = ZONE_MIN_SCALE * ZONE_FACTOR * (node.radius + other.radius);
  return pushOutOfZone({ x: context.time ? context.homeX : x, y }, { x: other.x, y: other.y, radius: apart }, 0, context.time, tieBreak(node.id)) ?? { x, y };
}

// A small seeded generator so a given graph always settles the same way (also what the tests rely on).
export function seededRandom(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

export interface OrbitRing { anchor: string; side: 'a' | 'b'; hops: number; radius: number }
// What the cluster and columns layouts have in common: where the endpoints rest, and where everybody else is drawn toward.
interface Arrangement {
  // Where each endpoint sits by default.
  home: Map<string, Point>;
  // Everyone else, relative to the endpoint (or the person) they belong to; a null anchor is the middle between the two endpoints and
  // CENTER the layout's own fixed middle. `along` puts the base a fraction of the way from the first endpoint to the second instead.
  offsets: Map<string, { anchor: string | null; dx: number; dy: number; along?: number }>;
}
export interface OrbitPlan extends Arrangement { rings: OrbitRing[] }
// One group of lanes in the columns layout: the people at `hops` links from the endpoint `anchor`. `dx` is the group's middle and
// `half` its half-width, `top` and `bottom` the extent of the band, all relative to the endpoint (so dragging it carries the band).
export interface ColumnGuide { anchor: string; side: 'a' | 'b'; hops: number; dx: number; half: number; top: number; bottom: number }
export interface ColumnPlan extends Arrangement { columns: ColumnGuide[] }
// One pod of the category layout, in the layout's own (fixed) coordinates.
export interface CategoryGuide { category: string; count: number; x: number; y: number; width: number; height: number }
export interface CategoryPlan extends Arrangement { categories: CategoryGuide[] }
// The centre line of the corridor layout: it runs between these two endpoints.
export interface CorridorGuide { from: string; to: string }
export interface CorridorPlan extends Arrangement { corridor: CorridorGuide | null }
type OrbitPerson = Pick<LayoutNode, 'id' | 'year' | 'endpoint' | 'radius' | 'side' | 'distance' | 'parent'> & Partial<Pick<LayoutNode, 'category' | 'spine'>>;
const sameRings = (a: OrbitRing[], b: OrbitRing[]) => a.length === b.length
  && a.every((ring, index) => ring.anchor === b[index].anchor && ring.hops === b[index].hops && Math.abs(ring.radius - b[index].radius) < 0.5);
const sameColumns = (a: ColumnGuide[], b: ColumnGuide[]) => a.length === b.length
  && a.every((guide, index) => guide.anchor === b[index].anchor && guide.hops === b[index].hops
    && [guide.dx - b[index].dx, guide.half - b[index].half, guide.top - b[index].top, guide.bottom - b[index].bottom].every(difference => Math.abs(difference) < 0.5));
const sameCategories = (a: CategoryGuide[], b: CategoryGuide[]) => a.length === b.length
  && a.every((guide, index) => guide.category === b[index].category && guide.count === b[index].count
    && [guide.x - b[index].x, guide.y - b[index].y, guide.width - b[index].width, guide.height - b[index].height].every(difference => Math.abs(difference) < 0.5));

// Where everybody goes when grouped around the endpoints. People at 1 link from an endpoint share its first ring, at 2 links
// the second, and so on; a ring is as wide as its people need, and they are ordered by the angle of whoever introduced them
// (then by year) so a family of contacts stays together and lines rarely cross. People who are on no ring but are linked to
// somebody who is (unverified contacts of a selected person, or the ones a legend chip reveals) stay beside that person; only the
// rest gather between the two clusters, so selecting someone never moves the endpoints. Pure: the layout turns it into forces.
export function planOrbit(people: OrbitPerson[], center: Point, neighbours: ReadonlyMap<string, readonly string[]> = new Map()): OrbitPlan {
  const hubs = [0, 1].map(index => people.find(person => person.endpoint === index));
  const offsets: OrbitPlan['offsets'] = new Map(), rings: OrbitRing[] = [], reach = [0, 0], outermost = [0, 0];
  const hubIndex = new Map<string, number>();
  hubs.forEach((hub, index) => { if (hub) hubIndex.set(hub.id, index); });
  const facingOf = (index: number) => index === 0 ? Math.PI : 0;
  // Only the people on the rings set how far apart the endpoints are; unverified ones beside them come and go with the selection.
  const place = (index: number, person: OrbitPerson, anchor: string, dx: number, dy: number, spacing = true) => {
    offsets.set(person.id, { anchor, dx, dy });
    if (spacing) reach[index] = Math.max(reach[index], dx * (index === 0 ? 1 : -1) + person.radius + LABEL_ROOM);
  };
  hubs.forEach((hub, index) => {
    if (!hub) return;
    const side = index === 0 ? 'a' : 'b', facing = facingOf(index);
    reach[index] = hub.radius + LABEL_ROOM;
    const byHops = new Map<number, OrbitPerson[]>();
    for (const person of people) {
      if (person.endpoint !== null || person.side !== side || person.distance === null || person.distance < 1) continue;
      byHops.set(person.distance, [...(byHops.get(person.distance) ?? []), person]);
    }
    const angles = new Map<string, number>();
    let radius = 0;
    for (const hops of [...byHops.keys()].sort((x, y) => x - y)) {
      const ring = byHops.get(hops)!;
      ring.sort((x, y) => (angles.get(x.parent ?? '') ?? 0) - (angles.get(y.parent ?? '') ?? 0) || x.year - y.year || x.id.localeCompare(y.id));
      const widest = Math.max(...ring.map(person => person.radius)), slot = 2 * (widest + LABEL_ROOM);
      radius = Math.max(radius === 0 ? hub.radius + widest + 2 * LABEL_ROOM + 14 : radius + slot, ring.length * slot / ORBIT_ARC);
      ring.forEach((person, position) => {
        const angle = facing - ORBIT_ARC / 2 + (position + 0.5) * ORBIT_ARC / ring.length;
        angles.set(person.id, angle);
        place(index, person, hub.id, radius * Math.cos(angle), radius * Math.sin(angle));
      });
      rings.push({ anchor: hub.id, side, hops, radius });
    }
    outermost[index] = radius;
  });
  // Unverified people beside whoever they are linked to: a fan one slot beyond that person (rows of it when there are many); the
  // ones linked to an endpoint itself get one more ring around it. A person linked to somebody just placed follows in a later round.
  const byYear = (x: OrbitPerson, y: OrbitPerson) => x.year - y.year || x.id.localeCompare(y.id);
  const reachOf = (id: string) => { const at = offsets.get(id); return at ? Math.hypot(at.dx, at.dy) : 0; };
  let pending = people.filter(person => person.endpoint === null && !offsets.has(person.id)).sort(byYear);
  for (let round = 0; pending.length && round < 8; round++) {
    const groups = new Map<string, OrbitPerson[]>(), rest: OrbitPerson[] = [];
    for (const person of pending) {
      const hosts = (neighbours.get(person.id) ?? []).filter(id => hubIndex.has(id) || offsets.get(id)?.anchor).sort((x, y) => reachOf(x) - reachOf(y) || x.localeCompare(y));
      if (hosts.length) groups.set(hosts[0], [...(groups.get(hosts[0]) ?? []), person]); else rest.push(person);
    }
    if (!groups.size) break;
    for (const [hostId, group] of groups) {
      const slot = 2 * (Math.max(...group.map(person => person.radius)) + LABEL_ROOM), hubAt = hubIndex.get(hostId);
      if (hubAt !== undefined) {
        const hub = hubs[hubAt]!, facing = facingOf(hubAt);
        const radius = Math.max(outermost[hubAt] === 0 ? hub.radius + slot / 2 + LABEL_ROOM + 14 : outermost[hubAt] + slot, group.length * slot / ORBIT_ARC);
        outermost[hubAt] = radius;
        group.forEach((person, position) => {
          const angle = facing - ORBIT_ARC / 2 + (position + 0.5) * ORBIT_ARC / group.length;
          place(hubAt, person, hub.id, radius * Math.cos(angle), radius * Math.sin(angle), false);
        });
        continue;
      }
      const host = offsets.get(hostId)!, index = hubIndex.get(host.anchor!)!;
      const hostRadius = Math.hypot(host.dx, host.dy), heading = Math.atan2(host.dy, host.dx);
      const perRow = Math.max(1, Math.floor(Math.PI / 2 * (hostRadius + slot) / slot));
      for (let row = 0, start = 0; start < group.length; row++, start += perRow) {
        const items = group.slice(start, start + perRow), radius = hostRadius + slot * (row + 1);
        items.forEach((person, position) => {
          const angle = heading + (position - (items.length - 1) / 2) * slot / radius;
          place(index, person, host.anchor!, radius * Math.cos(angle), radius * Math.sin(angle), false);
        });
      }
    }
    pending = rest;
  }
  // Only people with no link to anybody on a ring gather in the free space between the two clusters.
  const loose = pending;
  const slot = loose.length ? 2 * (Math.max(...loose.map(person => person.radius)) + LABEL_ROOM) : 0;
  let looseReach = 0;
  const spiral = loose.map((person, index) => {
    const distance = slot * 0.8 * Math.sqrt(index);
    looseReach = Math.max(looseReach, distance + slot / 2);
    return { person, dx: distance * Math.cos(index * GOLDEN_ANGLE), dy: distance * Math.sin(index * GOLDEN_ANGLE) };
  });
  const separation = Math.max(ORBIT_MIN_SEPARATION, reach[0] + reach[1] + 2 * looseReach + ORBIT_GAP), shift = (reach[0] - reach[1]) / 2;
  for (const { person, dx, dy } of spiral) offsets.set(person.id, { anchor: null, dx: dx + shift, dy });
  const home = new Map<string, Point>();
  if (hubs[0]) home.set(hubs[0].id, { x: center.x - separation / 2, y: center.y });
  if (hubs[1]) home.set(hubs[1].id, { x: center.x + separation / 2, y: center.y });
  return { home, offsets, rings };
}

// Seats one group of people (the same number of links from the same endpoint) in lanes of rows. They are taken in the order of the
// height they want (their parent's), then by year, and row r holds the people r*lanes ... r*lanes+lanes-1, so the order reads top to
// bottom. A group of more than COLUMN_MAX_ROWS people widens into lanes instead of growing taller. Rows are a slot apart at least and
// each as close to its wanted height as that allows (pool-adjacent-violators over the rows), so children stand beside their parent.
function seatGroup(group: Array<{ id: string; want: number; year: number }>, slot: number) {
  const ordered = [...group].sort((x, y) => x.want - y.want || x.year - y.year || x.id.localeCompare(y.id));
  const lanes = Math.max(1, Math.ceil(ordered.length / COLUMN_MAX_ROWS)), rowCount = Math.ceil(ordered.length / lanes);
  // Rows stay a slot apart exactly when each row's wanted height less (row x slot) does not decrease; a decrease pools the rows.
  const blocks: Array<{ sum: number; weight: number; rows: number }> = [];
  for (let row = 0; row < rowCount; row++) {
    const people = ordered.slice(row * lanes, (row + 1) * lanes);
    let block = { sum: people.reduce((total, person) => total + person.want - row * slot, 0), weight: people.length, rows: 1 };
    while (blocks.length && blocks[blocks.length - 1].sum / blocks[blocks.length - 1].weight > block.sum / block.weight) {
      const last = blocks.pop()!;
      block = { sum: last.sum + block.sum, weight: last.weight + block.weight, rows: last.rows + block.rows };
    }
    blocks.push(block);
  }
  const seats = new Map<string, { lane: number; dy: number }>();
  let row = 0;
  for (const block of blocks) for (let step = 0; step < block.rows; step++, row++) {
    const dy = block.sum / block.weight + row * slot;
    ordered.slice(row * lanes, (row + 1) * lanes).forEach((person, lane) => seats.set(person.id, { lane, dy }));
  }
  return { lanes, seats };
}

// Where everybody goes when lined up in columns: endpoint A on the left with the people one link from it in the first column to
// its right, two links in the next, and so on; endpoint B mirrored on the right. A person is on the side of the endpoint they are
// closest to, so "which contact is nearer to which endpoint" reads left to right. Inside a column people are ordered by where
// their parent stands in the previous column (then by year) so lines rarely cross. Unverified people (a selected person's
// contextual contacts, or the ones a legend chip reveals) never move anybody: they stand in lanes behind the endpoint of the side
// they are linked into, at the height of the person they link to, where nothing else is. Only people linked to nobody gather in
// the middle. Pure: the layout turns it into forces.
export function planColumns(people: OrbitPerson[], center: Point, neighbours: ReadonlyMap<string, readonly string[]> = new Map()): ColumnPlan {
  const hubs = [0, 1].map(index => people.find(person => person.endpoint === index));
  const offsets: ColumnPlan['offsets'] = new Map(), reach = [0, 0], nextColumn = [0, 0], nextBehind = [0, 0];
  const guides: Array<Omit<ColumnGuide, 'top' | 'bottom'>> = [], heights: number[] = [];
  const hubIndex = new Map<string, number>(), rows = new Map<string, number>();
  hubs.forEach((hub, index) => { if (hub) { hubIndex.set(hub.id, index); rows.set(hub.id, 0); } });
  const sign = (index: number) => index === 0 ? 1 : -1;
  const widest = (group: OrbitPerson[]) => Math.max(...group.map(person => person.radius));
  // The first lane clears the name under the endpoint.
  const firstLane = (group: OrbitPerson[]) => ENDPOINT_LABEL_HALF + widest(group) + LABEL_ROOM;
  // Seats `group` in lanes `from` away from the endpoint: toward the middle, or behind the endpoint when not `verified`.
  const lay = (index: number, hub: OrbitPerson, group: OrbitPerson[], from: number, want: (person: OrbitPerson) => number, verified: boolean) => {
    const slot = 2 * (widest(group) + LABEL_ROOM), pitch = Math.max(slot, COLUMN_MIN_PITCH);
    const { lanes, seats } = seatGroup(group.map(person => ({ id: person.id, want: want(person), year: person.year })), slot);
    for (const person of group) {
      const { lane, dy } = seats.get(person.id)!, along = from + lane * pitch;
      offsets.set(person.id, { anchor: hub.id, dx: (verified ? 1 : -1) * sign(index) * along, dy });
      rows.set(person.id, dy);
      if (verified) { reach[index] = Math.max(reach[index], along + person.radius + LABEL_ROOM); heights.push(dy); }
    }
    return { lanes, pitch };
  };
  hubs.forEach((hub, index) => {
    if (!hub) return;
    const side = index === 0 ? 'a' : 'b';
    reach[index] = hub.radius + LABEL_ROOM;
    const byHops = new Map<number, OrbitPerson[]>();
    for (const person of people) {
      if (person.endpoint !== null || person.side !== side || person.distance === null || person.distance < 1) continue;
      byHops.set(person.distance, [...(byHops.get(person.distance) ?? []), person]);
    }
    for (const hops of [...byHops.keys()].sort((x, y) => x - y)) {
      const group = byHops.get(hops)!, from = nextColumn[index] || firstLane(group);
      const { lanes, pitch } = lay(index, hub, group, from, person => rows.get(person.parent ?? '') ?? 0, true);
      guides.push({ anchor: hub.id, side, hops, dx: sign(index) * (from + (lanes - 1) * pitch / 2), half: lanes * pitch / 2 });
      nextColumn[index] = from + lanes * pitch + COLUMN_GROUP_GAP;
    }
  });
  // Unverified people go behind the endpoint of whoever they are linked to (the nearest of them to an endpoint, when several), at
  // that person's height. Behind an endpoint is free space, so neither the columns nor the middle are touched; the price is a longer
  // line to the person they belong to. A person linked to somebody just placed follows in a later round.
  const byYear = (x: OrbitPerson, y: OrbitPerson) => x.year - y.year || x.id.localeCompare(y.id);
  const reachOf = (id: string) => { const at = offsets.get(id); return at ? Math.abs(at.dx) : 0; };
  const hostOf = new Map<string, string>();
  let pending = people.filter(person => person.endpoint === null && !offsets.has(person.id)).sort(byYear);
  for (let round = 0; pending.length && round < 8; round++) {
    const groups = new Map<number, OrbitPerson[]>(), rest: OrbitPerson[] = [];
    for (const person of pending) {
      const hosts = (neighbours.get(person.id) ?? []).filter(id => hubIndex.has(id) || offsets.get(id)?.anchor).sort((x, y) => reachOf(x) - reachOf(y) || x.localeCompare(y));
      if (!hosts.length) { rest.push(person); continue; }
      const index = hubIndex.get(hosts[0]) ?? hubIndex.get(offsets.get(hosts[0])!.anchor!)!;
      hostOf.set(person.id, hosts[0]);
      groups.set(index, [...(groups.get(index) ?? []), person]);
    }
    if (!groups.size) break;
    for (const [index, members] of groups) {
      const from = nextBehind[index] || firstLane(members);
      const { lanes, pitch } = lay(index, hubs[index]!, members, from, person => rows.get(hostOf.get(person.id)!) ?? 0, false);
      nextBehind[index] = from + lanes * pitch;
    }
    pending = rest;
  }
  // Only people with no link to anybody on a column gather in the free space between the two sides.
  const slot = pending.length ? 2 * (widest(pending) + LABEL_ROOM) : 0, pitch = Math.max(slot, COLUMN_MIN_PITCH);
  const middle = seatGroup(pending.map(person => ({ id: person.id, want: 0, year: person.year })), slot);
  const looseReach = pending.length ? middle.lanes * pitch / 2 : 0, shift = (reach[0] - reach[1]) / 2;
  for (const person of pending) {
    const { lane, dy } = middle.seats.get(person.id)!;
    offsets.set(person.id, { anchor: null, dx: (lane - (middle.lanes - 1) / 2) * pitch + shift, dy });
  }
  const separation = Math.max(COLUMN_MIN_SEPARATION, reach[0] + reach[1] + 2 * looseReach + COLUMN_GAP);
  const home = new Map<string, Point>();
  if (hubs[0]) home.set(hubs[0].id, { x: center.x - separation / 2, y: center.y });
  if (hubs[1]) home.set(hubs[1].id, { x: center.x + separation / 2, y: center.y });
  // Every band spans the same height: the tallest column and a half slot beyond it.
  const room = Math.max(0, ...people.filter(person => person.endpoint === null).map(person => person.radius)) + LABEL_ROOM;
  const top = (heights.length ? Math.min(...heights) : 0) - room, bottom = (heights.length ? Math.max(...heights) : 0) + room;
  return { home, offsets, columns: guides.map(guide => ({ ...guide, top, bottom })) };
}

// Where everybody goes when grouped by category: one big rectangle, wider than tall, is partitioned between the categories, the pods
// filling it edge to edge with no hanging corners, each pod a grid of slots in year order under a title. The partition is the one that
// takes the least room (see `partitionPods`). The rectangle is centred on `center`; endpoint A stands left of it and B right of it. The
// endpoints belong to no pod: they stay the landmarks the pods hang between. Pure: the layout turns it into forces.
const POD_MAX_STRETCH = 1.5;
const POD_TITLE_WIDTH = 230;
const POD_SHAPES_KEPT = 12;

// A pod's title ("Leaders & Baddies · 30") sits on a dot, inset from the pod's left edge. The layout runs in a worker with no fonts to
// measure with, so the width of the text is estimated per character (a little over what the heavy title font needs) here, for the layout
// that gives each pod at least the width its title needs and for the drawing that shrinks a title that would not fit the pod.
const TITLE_INSET = 18;
const TITLE_DOT_EM = 0.95;
const TITLE_CHAR_EM = 0.62;
// The largest title size the drawing ever uses (it keeps the title about 15px on screen, so zooming out grows it in the layout's units up to
// this). Every pod is made wide enough for its title at that size, so a title never has to shrink to fit; the drawing still caps its size by
// the pod's width (`podTitleSize`) as the safety net for the estimate.
export const POD_TITLE_MAX_SIZE = 34;
// 'LEADERS & BADDIES' -> 'Leaders & Baddies'
export const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
export const podTitle = (category: string, count: number) => `${titleCase(category)} · ${count}`;
// The width of a pod's title row (dot, text and the inset on both sides) at this font size.
export const podTitleWidth = (title: string, size: number) => 2 * TITLE_INSET + size * (TITLE_DOT_EM + title.length * TITLE_CHAR_EM);
// The largest font size at which the title still fits inside a pod of this width.
export const podTitleSize = (title: string, width: number) => (width - 2 * TITLE_INSET) / (TITLE_DOT_EM + title.length * TITLE_CHAR_EM);

// How `count` people sit in a pod of this size: a grid whose rows and columns follow the pod's proportions, spread (up to a limit)
// over the room there is and centred in it. Null when a slot per person does not fit.
function podGrid(count: number, width: number, height: number, slot: number) {
  const inner = width - 2 * POD_PADDING, room = height - POD_HEADER - POD_PADDING;
  const maxColumns = Math.floor(inner / slot), maxRows = Math.floor(room / slot);
  if (maxColumns < 1 || maxRows < 1 || Math.ceil(count / maxColumns) > maxRows) return null;
  const rows = Math.min(maxRows, Math.max(Math.ceil(count / maxColumns), Math.ceil(Math.sqrt(count * room / inner)))), columns = Math.ceil(count / rows);
  const pitchX = Math.min(slot * POD_MAX_STRETCH, inner / columns), pitchY = Math.min(slot * POD_MAX_STRETCH, room / rows);
  return { columns, pitchX, pitchY, left: POD_PADDING + (inner - columns * pitchX) / 2, top: POD_HEADER + (room - rows * pitchY) / 2 };
}

// A size a block of pods can have (gaps included), and how it is made of two smaller blocks: side by side, or one above the other.
interface Box { x: number; y: number; width: number; height: number }
interface PodShape { width: number; height: number; cut?: { vertical: boolean; first: PodShape; second: PodShape } }
// Keeps the shapes no other shape beats (no wider and no taller), thinned to a handful: the sizes worth choosing from.
function bestShapes(shapes: PodShape[]): PodShape[] {
  const sorted = [...shapes].sort((x, y) => x.width - y.width || x.height - y.height), kept: PodShape[] = [];
  for (const shape of sorted) if (!kept.length || shape.height < kept[kept.length - 1].height - 1e-9) kept.push(shape);
  if (kept.length <= POD_SHAPES_KEPT) return kept;
  return Array.from({ length: POD_SHAPES_KEPT }, (_, index) => kept[Math.round(index * (kept.length - 1) / (POD_SHAPES_KEPT - 1))]);
}

// A slicing floorplan: the pods (given as people counts, the biggest first) are split into two runs of neighbours, each run is laid out the same way,
// and the two blocks go side by side or one above the other, the shorter (or narrower) one stretched to the other's size so the whole is
// a rectangle. Every run of pods keeps the list of the sizes worth having (a pod can be one column tall and narrow, or many wide and
// short); the best whole is the one that takes the least room near the wanted proportions. Returns the pods' places in the block.
// `minWidths` is the least width each pod may have (its title has to fit; the default is `POD_TITLE_WIDTH` for every pod), so a pod with a long
// title is never narrower than that however few columns its people need, and the partition shapes itself around it.
export function partitionPods(counts: readonly number[], slot: number, minWidths: readonly number[] = []): { width: number; height: number; places: Box[] } {
  const total = counts.length;
  if (!total) return { width: 0, height: 0, places: [] };
  const alone = (count: number, minWidth: number) => bestShapes(Array.from({ length: count }, (_, index) => index + 1).map(columns => ({
    width: Math.max(minWidth, columns * slot + 2 * POD_PADDING) + POD_GAP, height: Math.ceil(count / columns) * slot + POD_HEADER + POD_PADDING + POD_GAP,
  })));
  // Only runs of neighbours in the biggest-first order are grouped (from pod `from` up to, not including, `to`), which keeps the search
  // small enough to run whenever the network changes while still finding good partitions.
  const groups = new Map<number, PodShape[]>(), key = (from: number, to: number) => from * (total + 1) + to;
  for (let length = 1; length <= total; length++) for (let from = 0; from + length <= total; from++) {
    const to = from + length;
    if (length === 1) { groups.set(key(from, to), alone(counts[from], Math.max(POD_TITLE_WIDTH, minWidths[from] ?? 0))); continue; }
    const made: PodShape[] = [];
    for (let middle = from + 1; middle < to; middle++) for (const first of groups.get(key(from, middle))!) for (const second of groups.get(key(middle, to))!) {
      made.push({ width: first.width + second.width, height: Math.max(first.height, second.height), cut: { vertical: false, first, second } });
      made.push({ width: Math.max(first.width, second.width), height: first.height + second.height, cut: { vertical: true, first, second } });
    }
    groups.set(key(from, to), bestShapes(made));
  }
  const cost = (shape: PodShape) => shape.width * shape.height * Math.exp(Math.abs(Math.log(shape.width / shape.height / POD_BLOCK_ASPECT)));
  const whole = groups.get(key(0, total))!.reduce((best, shape) => cost(shape) < cost(best) ? shape : best);
  // Hand the block out: every part is as big as the block it is cut from along the cut, so the parts fill it exactly.
  const podOf = new Map<PodShape, number>();
  for (let index = 0; index < total; index++) for (const shape of groups.get(key(index, index + 1))!) podOf.set(shape, index);
  const places: Box[] = [];
  const hand = (shape: PodShape, box: Box) => {
    if (!shape.cut) { places[podOf.get(shape)!] = box; return; }
    // A part may be handed more room than it asked for (it was stretched to its neighbour): the extra is shared by both halves of its cut.
    const { first, second, vertical } = shape.cut;
    if (vertical) {
      const firstHeight = box.height * first.height / (first.height + second.height);
      hand(first, { x: box.x, y: box.y, width: box.width, height: firstHeight });
      hand(second, { x: box.x, y: box.y + firstHeight, width: box.width, height: box.height - firstHeight });
    } else {
      const firstWidth = box.width * first.width / (first.width + second.width);
      hand(first, { x: box.x, y: box.y, width: firstWidth, height: box.height });
      hand(second, { x: box.x + firstWidth, y: box.y, width: box.width - firstWidth, height: box.height });
    }
  };
  hand(whole, { x: 0, y: 0, width: whole.width, height: whole.height });
  return { width: whole.width, height: whole.height, places };
}

export function planCategories(people: OrbitPerson[], center: Point): CategoryPlan {
  const hubs = [0, 1].map(index => people.find(person => person.endpoint === index));
  const members = people.filter(person => person.endpoint === null);
  const slot = members.length ? 2 * (Math.max(...members.map(person => person.radius)) + LABEL_ROOM) : 0;
  const byCategory = new Map<string, OrbitPerson[]>();
  for (const person of members) byCategory.set(person.category || 'OTHER', [...(byCategory.get(person.category || 'OTHER') ?? []), person]);
  const pods = [...byCategory].map(([category, list]) => {
    list.sort((x, y) => x.year - y.year || x.id.localeCompare(y.id));
    return { category, list };
  }).sort((x, y) => y.list.length - x.list.length || x.category.localeCompare(y.category));
  const block = partitionPods(pods.map(pod => pod.list.length), slot, pods.map(pod => podTitleWidth(podTitle(pod.category, pod.list.length), POD_TITLE_MAX_SIZE)));
  const originX = center.x - block.width / 2, originY = center.y - block.height / 2;
  const offsets: CategoryPlan['offsets'] = new Map(), categories: CategoryGuide[] = [];
  pods.forEach((pod, index) => {
    // A pod is the share of the block it was given, held apart from the next by a gap all round.
    const place = block.places[index], x = originX + place.x + POD_GAP / 2, y = originY + place.y + POD_GAP / 2, width = place.width - POD_GAP, height = place.height - POD_GAP;
    categories.push({ category: pod.category, count: pod.list.length, x, y, width, height });
    const grid = podGrid(pod.list.length, width, height, slot) ?? { columns: Math.max(1, Math.floor(width / slot)), pitchX: slot, pitchY: slot, left: POD_PADDING, top: POD_HEADER };
    pod.list.forEach((person, position) => offsets.set(person.id, {
      anchor: CENTER,
      dx: x + grid.left + (position % grid.columns + 0.5) * grid.pitchX - center.x,
      dy: y + grid.top + (Math.floor(position / grid.columns) + 0.5) * grid.pitchY - center.y,
    }));
  });
  const separation = Math.max(POD_MIN_SEPARATION, block.width + 2 * POD_SIDE_GAP);
  const home = new Map<string, Point>();
  if (hubs[0]) home.set(hubs[0].id, { x: center.x - separation / 2, y: center.y });
  if (hubs[1]) home.set(hubs[1].id, { x: center.x + separation / 2, y: center.y });
  return { home, offsets, categories };
}

// Where everybody goes in the corridor: the people of the spine (the lit chain, or the best known way from each endpoint to the
// closest approach between the two sides) stand on the centre line from A to B, and everybody else belongs to the spine person they
// are fewest links from (the earlier one on a tie). Those hang above and below that person, a slot of height per link, in lanes like a
// column's: the first link's people alternate above and below, deeper ones stay on their parent's side, and each row is ordered by
// where its parents stand. The centre line is as long as the ribs need. People linked to nobody on the line wait in rows underneath.
// Pure: the layout turns it into forces.
export function planCorridor(people: OrbitPerson[], center: Point, neighbours: ReadonlyMap<string, readonly string[]> = new Map()): CorridorPlan {
  const hubs = [0, 1].map(index => people.find(person => person.endpoint === index));
  const byId = new Map(people.map(person => [person.id, person]));
  let spine = people.filter(person => person.spine !== null && person.spine !== undefined).sort((x, y) => x.spine! - y.spine! || x.id.localeCompare(y.id));
  // Whatever was asked for, the line runs from endpoint A to endpoint B.
  if (hubs[0] && spine[0] !== hubs[0]) spine = [hubs[0], ...spine.filter(person => person !== hubs[0])];
  if (hubs[1] && spine.at(-1) !== hubs[1]) spine = [...spine.filter(person => person !== hubs[1]), hubs[1]];
  const onSpine = new Set(spine.map(person => person.id));
  // Everybody else belongs to the nearest spine person, the earlier one when two are equally near.
  const owner = new Map<string, { spine: string; parent: string; depth: number }>();
  const queue = spine.map(person => ({ id: person.id, spine: person.id, depth: 0 }));
  for (let i = 0; i < queue.length; i++) {
    const { id, spine: from, depth } = queue[i];
    for (const next of neighbours.get(id) ?? []) {
      if (onSpine.has(next) || owner.has(next) || !byId.has(next)) continue;
      owner.set(next, { spine: from, parent: id, depth: depth + 1 });
      queue.push({ id: next, spine: from, depth: depth + 1 });
    }
  }
  // A slot fits the widest of the people who hang from the line (the endpoints, with their bigger discs, are on it).
  const hanging = people.filter(person => person.endpoint === null);
  const slot = people.length ? 2 * (Math.max(...(hanging.length ? hanging : people).map(person => person.radius)) + LABEL_ROOM) : 0, pitch = Math.max(slot, COLUMN_MIN_PITCH);
  const byYear = (x: OrbitPerson, y: OrbitPerson) => x.year - y.year || x.id.localeCompare(y.id);
  const children = new Map<string, OrbitPerson[]>();
  for (const [id, { parent }] of owner) children.set(parent, [...(children.get(parent) ?? []), byId.get(id)!]);
  // Per spine person: where each of their people hangs (lane and level, above or below), and how wide the rib has to be.
  const seats = new Map<string, { sign: number; depth: number; dx: number }>(), half = new Map<string, number>();
  let lowest = 0;
  for (const head of spine) {
    const sign = new Map<string, number>(), rib = people.filter(person => owner.get(person.id)?.spine === head.id);
    [...(children.get(head.id) ?? [])].sort(byYear).forEach((person, index) => sign.set(person.id, index % 2 === 0 ? -1 : 1));
    for (const person of [...rib].sort((x, y) => owner.get(x.id)!.depth - owner.get(y.id)!.depth)) if (!sign.has(person.id)) sign.set(person.id, sign.get(owner.get(person.id)!.parent) ?? -1);
    const rows = new Map<string, OrbitPerson[]>();
    for (const person of rib) { const key = `${sign.get(person.id)}|${owner.get(person.id)!.depth}`; rows.set(key, [...(rows.get(key) ?? []), person]); }
    let ribHalf = pitch / 2;
    // A row is ordered by where its parents stand (nearest rows first), then by year.
    for (const key of [...rows.keys()].sort((x, y) => Number(x.split('|')[1]) - Number(y.split('|')[1]))) {
      const row = rows.get(key)!;
      row.sort((x, y) => (seats.get(owner.get(x.id)!.parent)?.dx ?? 0) - (seats.get(owner.get(y.id)!.parent)?.dx ?? 0) || byYear(x, y));
      row.forEach((person, index) => seats.set(person.id, { sign: sign.get(person.id)!, depth: owner.get(person.id)!.depth, dx: (index - (row.length - 1) / 2) * pitch }));
      ribHalf = Math.max(ribHalf, row.length * pitch / 2);
      if (sign.get(row[0].id)! > 0) lowest = Math.max(lowest, owner.get(row[0].id)!.depth);
    }
    half.set(head.id, ribHalf);
  }
  // Spine people stand far enough apart for their ribs, and the line is long enough to read as a corridor.
  const places: number[] = [0];
  spine.slice(1).forEach((person, index) => places.push(places[index] + Math.max(CORRIDOR_MIN_PITCH, half.get(spine[index].id)! + half.get(person.id)! + CORRIDOR_RIB_GAP)));
  const natural = places[places.length - 1] ?? 0, length = Math.max(CORRIDOR_MIN_LENGTH, natural);
  const offsets: CorridorPlan['offsets'] = new Map();
  spine.forEach((person, index) => {
    if (index > 0 && index < spine.length - 1) offsets.set(person.id, { anchor: null, dx: 0, dy: 0, along: places[index] / natural });
  });
  for (const head of spine) for (const person of people) {
    const seat = seats.get(person.id);
    if (seat && owner.get(person.id)?.spine === head.id) offsets.set(person.id, { anchor: head.id, dx: seat.dx, dy: seat.sign * seat.depth * slot });
  }
  // People linked to nobody on the line: rows beneath the lowest rib, as wide as the line.
  const strays = people.filter(person => person.endpoint === null && !onSpine.has(person.id) && !owner.has(person.id)).sort(byYear);
  const perRow = Math.max(1, Math.floor(length / pitch));
  strays.forEach((person, index) => {
    const inRow = Math.min(perRow, strays.length - Math.floor(index / perRow) * perRow);
    offsets.set(person.id, { anchor: CENTER, dx: ((index % perRow) - (inRow - 1) / 2) * pitch, dy: (lowest + 2 + Math.floor(index / perRow)) * slot });
  });
  const home = new Map<string, Point>();
  if (hubs[0]) home.set(hubs[0].id, { x: center.x - length / 2, y: center.y });
  if (hubs[1]) home.set(hubs[1].id, { x: center.x + length / 2, y: center.y });
  return { home, offsets, corridor: hubs[0] && hubs[1] ? { from: hubs[0].id, to: hubs[1].id } : null };
}

const NO_RINGS: OrbitRing[] = [];
const NO_COLUMNS: ColumnGuide[] = [];
const NO_CATEGORIES: CategoryGuide[] = [];

export class NetworkLayout {
  readonly nodes = new Map<string, LayoutNode>();
  readonly pinned = new Set<string>();
  mode: LayoutMode = 'time';
  width = DEFAULT_SIZE.width;
  height = DEFAULT_SIZE.height;
  private bounds: [number, number] = [1500, 1600];
  private domain: [number, number] = [1500, 1600];
  private links: Link[] = [];
  private simulation: Simulation<LayoutNode, Link>;
  private listeners = new Set<() => void>();
  private random: () => number;
  private dragging: string | null = null;
  // The arranged layouts steer everybody by a plan (see `replan`); the other layouts have none.
  private plan: (Arrangement & Partial<Pick<OrbitPlan, 'rings'> & Pick<ColumnPlan, 'columns'> & Pick<CategoryPlan, 'categories'> & Pick<CorridorPlan, 'corridor'>>) | null = null;
  private neighbours = new Map<string, string[]>();
  // The middle of an arranged layout is fixed when it starts, so adding people or resizing never shifts the whole picture.
  private planCenter: Point | null = null;

  constructor(random: () => number = seededRandom()) {
    this.random = random;
    this.simulation = forceSimulation<LayoutNode, Link>([]).randomSource(random).alphaMin(ALPHA_MIN).stop();
    this.configureForces();
  }

  // Years the endpoints live through. The domain widens from here to fit everybody else.
  setBounds(start: number, end: number) { this.bounds = [Math.min(start, end), Math.max(start, end)]; this.updateDomain(); }
  get yearDomain(): [number, number] { return this.domain; }
  get alpha() { return this.simulation.alpha(); }
  get active() { return this.dragging !== null || this.simulation.alpha() > ALPHA_MIN; }
  // The guide rings of the cluster layout; empty in the other layouts. The same array until the plan changes.
  get rings(): OrbitRing[] { return this.plan?.rings ?? NO_RINGS; }
  // The column bands of the columns layout; empty in the other layouts. The same array until the plan changes.
  get columns(): ColumnGuide[] { return this.plan?.columns ?? NO_COLUMNS; }
  // The pods of the category layout (in the layout's own coordinates); empty in the other layouts. The same array until the plan changes.
  get categories(): CategoryGuide[] { return this.plan?.categories ?? NO_CATEGORIES; }
  // The centre line of the corridor layout, between its two endpoints; null in the other layouts. The same object until the plan changes.
  get corridor(): CorridorGuide | null { return this.plan?.corridor ?? null; }
  // Whether people are steered to places of a plan (every layout but the time line and the free one) rather than by the time axis or by repulsion.
  private get arranged() { return this.mode !== 'time' && this.mode !== 'free'; }
  position(id: string) { const node = this.nodes.get(id); return node && node.x !== undefined && node.y !== undefined ? { x: node.x, y: node.y } : undefined; }

  // Independent of the measured size, so resizing or opening the panel never re-spaces the people.
  get pixelsPerYear() { return pixelsPerYearFor(this.domain); }
  xOf(year: number) { return timeX(year, this.domain); }

  setSize(width: number, height: number) {
    if (!(width > 0) || !(height > 0) || (width === this.width && height === this.height)) return;
    this.width = width; this.height = height;
    this.configureForces(); this.applyEndpoints(); this.reheat(0.3); this.emit();
  }

  setMode(mode: LayoutMode) {
    if (mode === this.mode) return;
    const wasTime = this.mode === 'time';
    this.mode = mode;
    // A drop in the free layouts pins both axes; in time mode only the height survives the switch.
    for (const id of [...this.pinned]) {
      const node = this.nodes.get(id); if (!node || node.endpoint !== null) continue;
      if (mode === 'time') node.fx = null;
    }
    // Grouping is an arrangement of its own: pins made in another layout would hold people (or an endpoint) out of their places.
    if (this.arranged) this.releasePins();
    this.planCenter = null;
    this.replan();
    // A pinned endpoint keeps its dropped height, but its place along the axis belongs to the layout it is entering.
    if (wasTime || mode === 'time') for (const node of this.nodes.values()) if (node.endpoint !== null && this.pinned.has(node.id)) node.fx = this.home(node).x;
    this.configureForces(); this.applyEndpoints(); this.reheat(0.8); this.emit();
  }

  // Replaces the graph, keeping positions of nodes that stay. New nodes enter beside the contact that
  // introduced them (at their own year in time mode) and the simulation is nudged, not restarted.
  setGraph(inputs: LayoutInput[], links: LayoutLinkInput[]) {
    const ids = new Set(inputs.map(input => input.id));
    let removed = false;
    for (const id of [...this.nodes.keys()]) if (!ids.has(id)) { this.nodes.delete(id); this.pinned.delete(id); removed = true; }
    const neighbours = new Map<string, string[]>();
    for (const { a, b } of links) {
      neighbours.set(a, [...(neighbours.get(a) ?? []), b]); neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
    }
    let added = false, regrouped = false;
    const fresh = new Set<string>();
    const firstPeople = ![...this.nodes.values()].some(node => node.x !== undefined);
    for (const input of inputs) {
      const existing = this.nodes.get(input.id);
      const side = input.side ?? 'none', distance = input.distance ?? null, parent = input.parent ?? null, category = input.category ?? '', spine = input.spine ?? null;
      const clearance = input.clearance ?? 0;
      if (existing) {
        regrouped ||= existing.side !== side || existing.distance !== distance || existing.parent !== parent || existing.category !== category || existing.spine !== spine
          || existing.radius !== input.radius;
        Object.assign(existing, { year: input.year, radius: input.radius, clearance, endpoint: input.endpoint, side, distance, parent, category, spine });
        continue;
      }
      this.nodes.set(input.id, { id: input.id, year: input.year, endpoint: input.endpoint, radius: input.radius, clearance, side, distance, parent, category, spine });
      fresh.add(input.id);
      added = true;
    }
    this.updateDomain();
    this.neighbours = neighbours;
    this.replan();
    // A crowd arriving at once (a saved exploration opening, or a big round of contacts) is laid out spread over the
    // whole area rather than beside one another, so the collision force has little to push apart.
    const crowd = fresh.size >= SEAT_THRESHOLD;
    if (crowd) this.scatter(inputs.filter(input => fresh.has(input.id)).map(input => this.nodes.get(input.id)!));
    for (const input of inputs) {
      const node = this.nodes.get(input.id)!;
      if (node.x !== undefined) continue;
      const anchor = (neighbours.get(input.id) ?? []).map(id => this.nodes.get(id)).find(other => other && other.x !== undefined);
      const jitter = () => (this.random() - 0.5) * 60;
      const cx = anchor?.x ?? this.width / 2, cy = anchor?.y ?? this.height / 2;
      node.x = this.mode === 'time' ? this.xOf(node.year) + jitter() * 0.2 : cx + jitter();
      node.y = cy + jitter() + (anchor ? 30 : 0);
    }
    this.links = links.filter(link => this.nodes.has(link.a) && this.nodes.has(link.b)).map(link => ({ source: link.a, target: link.b }));
    this.simulation.nodes([...this.nodes.values()]);
    this.configureForces();
    this.applyEndpoints();
    this.keepClear();
    if (crowd || (firstPeople && added)) this.seat(fresh);
    // People leaving re-plan an arranged layout as much as people arriving do (a legend chip switched off leaves the pods, rings or
    // columns that remain partitioned anew), so everybody who stays is pushed toward the new places, not left at rest on the old ones.
    else if (added || ((regrouped || removed) && this.arranged)) this.reheat(this.arranged ? 0.55 : 0.35);
    this.emit();
  }

  // Redraws the screen at the layout's current positions (the layout is at rest, so nothing else would).
  refresh() { this.emit(); }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  step(): boolean {
    if (this.dragging === null && this.simulation.alpha() <= ALPHA_MIN) return false;
    this.tick();
    this.emit();
    return true;
  }

  // One step of the simulation, then everybody is put back out of the endpoints' free zones.
  private tick() { this.simulation.tick(); this.keepClear(); }

  // Runs to rest in one go. Used for reduced motion and by the tests.
  settle(maxTicks = 400) {
    let ticks = 0;
    while (ticks < maxTicks && this.simulation.alpha() > ALPHA_MIN) { this.tick(); ticks++; }
    this.emit();
    return ticks;
  }

  reheat(alpha = 0.3) { this.simulation.alpha(Math.max(this.simulation.alpha(), alpha)); }

  dragStart(id: string) {
    const node = this.nodes.get(id); if (!node) return;
    this.dragging = id;
    node.fx = this.movesAlongX(node) ? node.x : this.home(node).x;
    node.fy = node.y;
    this.simulation.alphaTarget(0.25);
    this.reheat(0.25);
  }
  // Only on the time line do the two endpoints slide just vertically (their place on the axis is theirs); in the free layouts they go anywhere.
  dragTo(id: string, x: number, y: number) {
    const node = this.nodes.get(id); if (!node || this.dragging !== id) return;
    const held = this.clampDrag(node, x, y);
    node.fx = this.movesAlongX(node) ? held.x : this.home(node).x;
    node.fy = held.y;
  }
  dragEnd(id: string) {
    const node = this.nodes.get(id); if (this.dragging === id) this.dragging = null;
    this.simulation.alphaTarget(0);
    if (!node) return;
    this.pinned.add(id);
    // In time mode the dropped height stays and the year pulls the node back across.
    if (this.mode === 'time' && node.endpoint === null) node.fx = null;
    this.reheat(0.2);
  }
  unpin(id: string) {
    const node = this.nodes.get(id); if (!node) return;
    this.pinned.delete(id);
    node.fy = null;
    if (node.endpoint === null) node.fx = null;
    this.applyEndpoints();
    this.reheat(0.3);
  }
  // Releases every pinned person at once; the endpoints go back to where their layout puts them.
  unpinAll() {
    if (!this.pinned.size) return;
    this.releasePins();
    this.applyEndpoints();
    this.reheat(0.5);
  }
  private releasePins() {
    for (const id of this.pinned) {
      const node = this.nodes.get(id); if (!node) continue;
      node.fy = null;
      if (node.endpoint === null) node.fx = null;
    }
    this.pinned.clear();
  }

  stop() { this.simulation.stop(); }

  private emit() { for (const listener of this.listeners) listener(); }

  // Spreads people that have no place yet: in time mode at their year, in rows above and below the middle, taken in
  // year order so neighbours in time land in different rows; in free mode along a spiral around the middle; in the
  // cluster and columns layouts straight on their places.
  private scatter(people: LayoutNode[]) {
    const ordered = [...people].filter(node => node.endpoint === null).sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
    const cx = this.width / 2, cy = this.height / 2;
    // The two endpoints sit on the middle line, at their year (or on their side in the free layouts).
    for (const node of people) if (node.endpoint !== null) { const at = this.home(node); node.x = at.x; node.y = at.y ?? cy; }
    if (!ordered.length) return;
    if (this.arranged) {
      // People who hang from somebody (the corridor's ribs) need that person placed first; the line's own people go before them.
      const stands = (node: LayoutNode) => this.plan?.offsets.get(node.id)?.along !== undefined ? 0 : 1;
      ordered.sort((a, b) => stands(a) - stands(b));
      for (const node of ordered) {
        const at = this.planTarget(node) ?? { x: cx, y: cy };
        node.x = at.x + (this.random() - 0.5) * 6; node.y = at.y + (this.random() - 0.5) * 6;
      }
      return;
    }
    if (this.mode === 'time') {
      const rowHeight = 2 * (Math.max(...ordered.map(node => node.radius)) + LABEL_ROOM) * 0.8;
      const rows = Math.max(1, Math.floor((this.height - 2 * LABEL_ROOM) / rowHeight));
      ordered.forEach((node, index) => {
        // Rows alternate around the middle: 0, +1, -1, +2, -2, ...
        const slot = index % rows, offset = slot === 0 ? 0 : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2);
        node.x = this.xOf(node.year) + (this.random() - 0.5) * 6;
        node.y = cy + offset * rowHeight + (this.random() - 0.5) * 6;
      });
      return;
    }
    const golden = Math.PI * (3 - Math.sqrt(5));
    ordered.forEach((node, index) => {
      const distance = 46 * Math.sqrt(index + 1);
      node.x = cx + distance * Math.cos(index * golden);
      node.y = cy + distance * Math.sin(index * golden);
    });
  }

  // Lets new people find their places before anything is drawn. The people already there stay put meanwhile
  // (or stay where a drag pinned them), and are only given a small nudge afterwards to make room.
  private seat(fresh: ReadonlySet<string>) {
    const held: Array<[LayoutNode, number | null | undefined, number | null | undefined]> = [];
    for (const node of this.nodes.values()) {
      if (fresh.has(node.id)) continue;
      held.push([node, node.fx, node.fy]);
      node.fx = node.fx ?? node.x; node.fy = node.fy ?? node.y;
    }
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.6));
    this.settle(SEAT_MAX_TICKS);
    for (const [node, fx, fy] of held) { node.fx = fx; node.fy = fy; node.vx = 0; node.vy = 0; }
    // Groups can shift a lot when somebody arrives, so the arranged layouts give them a real push toward their new places.
    if (held.length) this.reheat(this.arranged ? 0.6 : 0.1);
  }

  // The space kept free around each endpoint on the time line and in the free layout (none in the arranged layouts, which have
  // slots of their own). It is `ZONE_FACTOR` endpoint radii wide, and both zones shrink together, to a floor, when the endpoints
  // are too close for the two to stand apart.
  get freeZones(): FreeZone[] {
    if (this.arranged) return [];
    const ends = [...this.nodes.values()].filter(node => node.endpoint !== null && (node.fx ?? node.x) !== undefined && (node.fy ?? node.y) !== undefined)
      .sort((a, b) => a.endpoint! - b.endpoint!);
    const zones = ends.map(node => ({ id: node.id, x: (node.fx ?? node.x)!, y: (node.fy ?? node.y)!, radius: ZONE_FACTOR * node.radius }));
    if (zones.length === 2) {
      const scale = Math.min(1, Math.max(ZONE_MIN_SCALE, Math.hypot(zones[0].x - zones[1].x, zones[0].y - zones[1].y) / (zones[0].radius + zones[1].radius)));
      for (const zone of zones) zone.radius *= scale;
    }
    return zones;
  }

  // Puts everybody (the held people too) back outside the free zones: straight up or down on the time line, where the place along the
  // axis is a year, and straight away from the endpoint in the free layout. The person being dragged follows the pointer to the rim instead.
  private keepClear() {
    const zones = this.freeZones; if (!zones.length) return;
    const vertical = this.mode === 'time';
    for (const node of this.nodes.values()) {
      if (node.endpoint !== null || this.dragging === node.id) continue;
      let x = node.fx ?? node.x, y = node.fy ?? node.y; if (x === undefined || y === undefined) continue;
      let moved = false;
      // Leaving one zone could, in a tight spot, enter the other, so go round twice.
      for (let pass = 0; pass < 2; pass++) {
        let settled = true;
        for (const zone of zones) {
          const out = pushOutOfZone({ x, y }, zone, node.radius + node.clearance, vertical, tieBreak(node.id));
          if (out) { x = out.x; y = out.y; moved = true; settled = false; }
        }
        if (settled) break;
      }
      if (!moved) continue;
      if (node.fx != null) node.fx = x;
      if (node.fy != null) node.fy = y;
      node.x = x; node.y = y; node.vx = 0; node.vy = 0;
    }
  }

  private clampDrag(node: LayoutNode, x: number, y: number): Point {
    const other = node.endpoint === null ? undefined : [...this.nodes.values()].find(candidate => candidate.endpoint !== null && candidate.id !== node.id);
    const ox = other && (other.fx ?? other.x), oy = other && (other.fy ?? other.y);
    return clampDragPoint(node, x, y, {
      arranged: this.arranged, time: this.mode === 'time', zones: this.arranged ? [] : this.freeZones, homeX: this.home(node).x,
      other: other && ox !== undefined && oy !== undefined ? { x: ox, y: oy, radius: other.radius } : null,
    });
  }

  // Whether dragging may change a node's place along the axis: always, except for the endpoints on the time line.
  private movesAlongX(node: LayoutNode) { return node.endpoint === null || this.mode !== 'time'; }

  // Where an endpoint rests when nobody holds it: at its year on the time line (height free), on its side of the
  // drawing in free mode, and at the middle of its cluster (or the head of its columns) in the arranged layouts.
  private home(node: LayoutNode): { x: number; y: number | null } {
    if (this.mode === 'time') return { x: this.xOf(node.year), y: null };
    const planned = this.arranged ? this.plan?.home.get(node.id) : undefined;
    return planned ?? { x: node.endpoint === 0 ? MARGIN : this.width - MARGIN, y: this.height / 2 };
  }

  private applyEndpoints() {
    for (const node of this.nodes.values()) {
      if (node.endpoint === null) continue;
      const pinned = this.pinned.has(node.id);
      // Outside the time line a pinned endpoint stays exactly where it was dropped.
      if (pinned && this.mode !== 'time') continue;
      const at = this.home(node);
      node.fx = at.x;
      if (!pinned) node.fy = at.y;
    }
  }

  // The plan of the cluster or columns layout, from the people as they are now; nothing in the other layouts. Guides keep the
  // same array while they are unchanged, so the drawing is told about them only when they move.
  private replan() {
    if (!this.arranged) { this.plan = null; return; }
    this.planCenter ??= { x: this.width / 2, y: this.height / 2 };
    const people = [...this.nodes.values()], previous = this.plan;
    if (this.mode === 'cluster') {
      const next = planOrbit(people, this.planCenter, this.neighbours);
      if (previous?.rings && sameRings(previous.rings, next.rings)) next.rings = previous.rings;
      this.plan = next;
    } else if (this.mode === 'columns') {
      const next = planColumns(people, this.planCenter, this.neighbours);
      if (previous?.columns && sameColumns(previous.columns, next.columns)) next.columns = previous.columns;
      this.plan = next;
    } else if (this.mode === 'category') {
      const next = planCategories(people, this.planCenter);
      if (previous?.categories && sameCategories(previous.categories, next.categories)) next.categories = previous.categories;
      this.plan = next;
    } else {
      const next = planCorridor(people, this.planCenter, this.neighbours);
      if (previous?.corridor && next.corridor && previous.corridor.from === next.corridor.from && previous.corridor.to === next.corridor.to) next.corridor = previous.corridor;
      this.plan = next;
    }
  }

  // Where a person is drawn toward in an arranged layout: their place around (or beside) the endpoint's *current* position,
  // so dragging an endpoint carries its people along. Endpoints have no target; they are held by `home`.
  private planTarget(node: LayoutNode): Point | undefined {
    const offset = this.plan?.offsets.get(node.id); if (!offset) return undefined;
    const held = (id: string | null | undefined) => {
      const hub = id ? this.nodes.get(id) : undefined, x = hub?.fx ?? hub?.x, y = hub?.fy ?? hub?.y;
      return x === undefined || y === undefined ? undefined : { x, y };
    };
    const ends = [...(this.plan?.home.keys() ?? [])].map(held);
    let base: Point | undefined;
    if (offset.along !== undefined) {
      // A fraction of the way from the first endpoint to the second, wherever they are now.
      const [first, second] = ends;
      base = first && second ? { x: first.x + (second.x - first.x) * offset.along, y: first.y + (second.y - first.y) * offset.along } : first ?? second;
    } else if (offset.anchor === CENTER) base = this.planCenter ?? undefined;
    else if (offset.anchor) base = held(offset.anchor);
    else {
      const present = ends.filter((at): at is Point => !!at);
      base = present.length ? { x: present.reduce((sum, at) => sum + at.x, 0) / present.length, y: present.reduce((sum, at) => sum + at.y, 0) / present.length } : this.planCenter ?? undefined;
    }
    return base && { x: base.x + offset.dx, y: base.y + offset.dy };
  }

  // d3's forceX/forceY read their targets once, so this is a force of our own that asks again every tick.
  private planForce = (alpha: number) => {
    for (const node of this.nodes.values()) {
      if (node.x === undefined || node.y === undefined || (node.fx != null && node.fy != null)) continue;
      const target = this.planTarget(node); if (!target) continue;
      node.vx = (node.vx ?? 0) + (target.x - node.x) * ORBIT_PULL * alpha;
      node.vy = (node.vy ?? 0) + (target.y - node.y) * ORBIT_PULL * alpha;
    }
  };

  private updateDomain() { this.domain = yearDomainFor(this.bounds, [...this.nodes.values()].map(node => node.year)); }

  private configureForces() {
    const time = this.mode === 'time', arranged = this.arranged;
    const cx = this.width / 2, cy = this.height / 2;
    const sim = this.simulation;
    // The arranged layouts are steered by their plan alone: no pull to the middle, no repulsion, only a faint tie along contacts. The
    // category layout has not even that: its pods are containers, and a tie to contacts in other pods pulled people at a pod's edge out of it.
    sim.force('x', arranged ? null : forceX<LayoutNode>(node => time ? this.xOf(node.year) : cx).strength(time ? 0.45 : 0.02));
    sim.force('y', arranged ? null : forceY<LayoutNode>(cy).strength(time ? 0.04 : 0.05));
    sim.force('plan', arranged ? this.planForce : null);
    sim.force('collide', forceCollide<LayoutNode>(node => node.radius + LABEL_ROOM).strength(0.9));
    sim.force('charge', time || arranged ? null : forceManyBody<LayoutNode>().strength(-320).distanceMax(500));
    sim.force('link', this.mode === 'category' ? null : forceLink<LayoutNode, Link>(this.links).id(node => node.id).distance(time ? 70 : 120).strength(time ? TIME_LINK_STRENGTH : arranged ? 0.005 : 0.5));
    sim.velocityDecay(0.45);
  }
}

// Gridline years for the time axis: the finest step that keeps labels about 70px apart.
const AXIS_STEPS = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000];
export function axisTicks(from: number, to: number, pixelsPerYear: number, minSpacing = 70): number[] {
  const step = AXIS_STEPS.find(candidate => candidate * pixelsPerYear >= minSpacing) ?? AXIS_STEPS[AXIS_STEPS.length - 1];
  const ticks: number[] = [];
  for (let year = Math.ceil(from / step) * step; year <= to; year += step) ticks.push(year);
  return ticks;
}
