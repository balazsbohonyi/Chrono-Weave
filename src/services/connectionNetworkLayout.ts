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
export interface LayoutInput {
  id: string; year: number; endpoint: 0 | 1 | null; radius: number;
  side?: Side; distance?: number | null; parent?: string | null; category?: string; spine?: number | null;
}
export interface LayoutLinkInput { a: string; b: string }
export interface LayoutNode extends SimulationNodeDatum {
  id: string; year: number; endpoint: 0 | 1 | null; radius: number; side: Side; distance: number | null; parent: string | null;
  category: string; spine: number | null;
}
type Link = SimulationLinkDatum<LayoutNode>;
interface Point { x: number; y: number }

const MARGIN = 90;
const LABEL_ROOM = 28;
// The time axis has a spacing of its own instead of being squeezed into whatever width the drawing has:
// a short span gets this much room per year, a long span gets less (down to a floor), and the camera
// pans and zooms over the result. 2.2 reference widths is roughly 2.4 times the old fit-to-width spacing.
const TIME_REFERENCE_WIDTH = 1000;
const TIME_SPREAD = 2.2;
const MIN_PIXELS_PER_YEAR = 2;
const MAX_PIXELS_PER_YEAR = 14;
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
// Category layout: a pod holds one category's people in a grid of slots under a title; the pods are packed in rows into a block that
// is wider than tall, with the endpoints standing outside it, one on each side.
const POD_PADDING = 26;
const POD_HEADER = 50;
const POD_GAP = 44;
const POD_ASPECT = 1.5;
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

// Where everybody goes when grouped by category: one pod per category (the biggest first), each a grid of slots in year order under a
// title, the pods packed in rows into a block wider than tall and centred on `center`; endpoint A stands left of the block and B right
// of it. The endpoints belong to no pod: they stay the landmarks the pods hang between. Pure: the layout turns it into forces.
export function planCategories(people: OrbitPerson[], center: Point): CategoryPlan {
  const hubs = [0, 1].map(index => people.find(person => person.endpoint === index));
  const members = people.filter(person => person.endpoint === null);
  const slot = members.length ? 2 * (Math.max(...members.map(person => person.radius)) + LABEL_ROOM) : 0;
  const byCategory = new Map<string, OrbitPerson[]>();
  for (const person of members) byCategory.set(person.category || 'OTHER', [...(byCategory.get(person.category || 'OTHER') ?? []), person]);
  const pods = [...byCategory].map(([category, list]) => {
    list.sort((x, y) => x.year - y.year || x.id.localeCompare(y.id));
    const columns = Math.max(1, Math.round(Math.sqrt(list.length * POD_ASPECT))), rows = Math.ceil(list.length / columns);
    return { category, list, columns, width: columns * slot + 2 * POD_PADDING, height: rows * slot + POD_HEADER + POD_PADDING, x: 0, y: 0 };
  }).sort((x, y) => y.list.length - x.list.length || x.category.localeCompare(y.category));
  // Shelf packing: fill a row up to a width, then start the next. Every width that adds one more pod to a row is tried, and the one
  // whose block comes closest to the wanted proportions wins.
  const shelves = (limit: number) => {
    const packed: Array<typeof pods> = [];
    let used = 0;
    for (const pod of pods) {
      if (!packed.length || (used > 0 && used + pod.width > limit)) { packed.push([]); used = 0; }
      packed[packed.length - 1].push(pod); used += pod.width + POD_GAP;
    }
    const rowWidths = packed.map(row => row.reduce((sum, pod) => sum + pod.width, 0) + (row.length - 1) * POD_GAP);
    const height = packed.reduce((sum, row) => sum + Math.max(...row.map(pod => pod.height)) + POD_GAP, -POD_GAP);
    return { rows: packed, widths: rowWidths, fit: Math.abs(Math.log(Math.max(1, ...rowWidths) / Math.max(1, height) / POD_BLOCK_ASPECT)) };
  };
  let best = shelves(0);
  for (let count = 1, limit = 0; pods.length && count <= pods.length; count++) {
    limit = pods.slice(0, count).reduce((sum, pod) => sum + pod.width + POD_GAP, 0);
    const candidate = shelves(limit);
    if (candidate.fit < best.fit - 1e-9) best = candidate;
  }
  const { rows, widths } = best;
  const blockW = Math.max(0, ...widths);
  let top = 0;
  rows.forEach((row, index) => {
    let left = (blockW - widths[index]) / 2;
    for (const pod of row) { pod.x = left; pod.y = top; left += pod.width + POD_GAP; }
    top += Math.max(...row.map(pod => pod.height)) + POD_GAP;
  });
  const blockH = Math.max(0, top - POD_GAP), originX = center.x - blockW / 2, originY = center.y - blockH / 2;
  const offsets: CategoryPlan['offsets'] = new Map(), categories: CategoryGuide[] = [];
  for (const pod of pods) {
    categories.push({ category: pod.category, count: pod.list.length, x: originX + pod.x, y: originY + pod.y, width: pod.width, height: pod.height });
    pod.list.forEach((person, index) => offsets.set(person.id, {
      anchor: CENTER,
      dx: originX + pod.x + POD_PADDING + (index % pod.columns) * slot + slot / 2 - center.x,
      dy: originY + pod.y + POD_HEADER + Math.floor(index / pod.columns) * slot + slot / 2 - center.y,
    }));
  }
  const separation = Math.max(POD_MIN_SEPARATION, blockW + 2 * POD_SIDE_GAP);
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
  get pixelsPerYear() {
    const span = Math.max(1, this.domain[1] - this.domain[0]);
    return Math.min(MAX_PIXELS_PER_YEAR, Math.max(MIN_PIXELS_PER_YEAR, TIME_REFERENCE_WIDTH * TIME_SPREAD / span));
  }
  xOf(year: number) { return MARGIN + (year - this.domain[0]) * this.pixelsPerYear; }

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
    for (const id of [...this.nodes.keys()]) if (!ids.has(id)) { this.nodes.delete(id); this.pinned.delete(id); }
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
      if (existing) {
        regrouped ||= existing.side !== side || existing.distance !== distance || existing.parent !== parent || existing.category !== category || existing.spine !== spine;
        Object.assign(existing, { year: input.year, radius: input.radius, endpoint: input.endpoint, side, distance, parent, category, spine });
        continue;
      }
      this.nodes.set(input.id, { id: input.id, year: input.year, endpoint: input.endpoint, radius: input.radius, side, distance, parent, category, spine });
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
    if (crowd || (firstPeople && added)) this.seat(fresh);
    else if (added || (regrouped && this.arranged)) this.reheat(this.arranged ? 0.55 : 0.35);
    this.emit();
  }

  // Redraws the screen at the layout's current positions (the layout is at rest, so nothing else would).
  refresh() { this.emit(); }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  step(): boolean {
    if (this.dragging === null && this.simulation.alpha() <= ALPHA_MIN) return false;
    this.simulation.tick();
    this.emit();
    return true;
  }

  // Runs to rest in one go. Used for reduced motion and by the tests.
  settle(maxTicks = 400) {
    let ticks = 0;
    while (ticks < maxTicks && this.simulation.alpha() > ALPHA_MIN) { this.simulation.tick(); ticks++; }
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
    node.fx = this.movesAlongX(node) ? x : this.home(node).x;
    node.fy = y;
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

  private updateDomain() {
    let [from, to] = this.bounds;
    const pad = Math.max(8, (to - from) * 0.06);
    from -= pad; to += pad;
    for (const node of this.nodes.values()) { from = Math.min(from, node.year - pad / 2); to = Math.max(to, node.year + pad / 2); }
    this.domain = [Math.floor(from), Math.ceil(to)];
  }

  private configureForces() {
    const time = this.mode === 'time', arranged = this.arranged;
    const cx = this.width / 2, cy = this.height / 2;
    const sim = this.simulation;
    // The cluster and columns layouts are steered by their plan alone: no pull to the middle, no repulsion, only a faint tie along contacts.
    sim.force('x', arranged ? null : forceX<LayoutNode>(node => time ? this.xOf(node.year) : cx).strength(time ? 0.45 : 0.02));
    sim.force('y', arranged ? null : forceY<LayoutNode>(cy).strength(time ? 0.04 : 0.05));
    sim.force('plan', arranged ? this.planForce : null);
    sim.force('collide', forceCollide<LayoutNode>(node => node.radius + LABEL_ROOM).strength(0.9));
    sim.force('charge', time || arranged ? null : forceManyBody<LayoutNode>().strength(-320).distanceMax(500));
    sim.force('link', forceLink<LayoutNode, Link>(this.links).id(node => node.id).distance(time ? 70 : 120).strength(time ? 0.08 : arranged ? 0.005 : 0.5));
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
