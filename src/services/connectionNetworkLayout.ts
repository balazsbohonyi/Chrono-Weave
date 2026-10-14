import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';

// d3-force as a physics helper only: it computes positions, React owns the DOM. Everything here is
// plain TypeScript so the layout can be driven and checked tick by tick without a browser.

export type LayoutMode = 'time' | 'free';
export interface LayoutInput { id: string; year: number; endpoint: 0 | 1 | null; radius: number }
export interface LayoutLinkInput { a: string; b: string }
export interface LayoutNode extends SimulationNodeDatum { id: string; year: number; endpoint: 0 | 1 | null; radius: number }
type Link = SimulationLinkDatum<LayoutNode>;

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

// A small seeded generator so a given graph always settles the same way (also what the tests rely on).
export function seededRandom(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

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
    this.mode = mode;
    // A drop in free mode pins both axes; in time mode only the height survives the switch.
    for (const id of this.pinned) { const node = this.nodes.get(id); if (node && node.endpoint === null) node.fx = null; }
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
    let added = false;
    const fresh = new Set<string>();
    const firstPeople = ![...this.nodes.values()].some(node => node.x !== undefined);
    for (const input of inputs) {
      const existing = this.nodes.get(input.id);
      if (existing) { existing.year = input.year; existing.radius = input.radius; existing.endpoint = input.endpoint; continue; }
      this.nodes.set(input.id, { id: input.id, year: input.year, endpoint: input.endpoint, radius: input.radius });
      fresh.add(input.id);
      added = true;
    }
    this.updateDomain();
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
    else if (added) this.reheat(0.35);
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
    node.fx = node.endpoint === null ? node.x : this.fixedX(node);
    node.fy = node.y;
    this.simulation.alphaTarget(0.25);
    this.reheat(0.25);
  }
  // The two endpoints only slide vertically; their place on the time line is theirs.
  dragTo(id: string, x: number, y: number) {
    const node = this.nodes.get(id); if (!node || this.dragging !== id) return;
    node.fx = node.endpoint === null ? x : this.fixedX(node);
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

  stop() { this.simulation.stop(); }

  private emit() { for (const listener of this.listeners) listener(); }

  // Spreads people that have no place yet: in time mode at their year, in rows above and below the middle, taken in
  // year order so neighbours in time land in different rows; in free mode along a spiral around the middle.
  private scatter(people: LayoutNode[]) {
    const ordered = [...people].filter(node => node.endpoint === null).sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
    const cx = this.width / 2, cy = this.height / 2;
    // The two endpoints sit on the middle line, at their year (or on their side in free mode).
    for (const node of people) if (node.endpoint !== null) { node.x = this.fixedX(node); node.y = cy; }
    if (!ordered.length) return;
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
    if (held.length) this.reheat(0.1);
  }

  private fixedX(node: LayoutNode) {
    if (this.mode === 'time') return this.xOf(node.year);
    return node.endpoint === 0 ? MARGIN : this.width - MARGIN;
  }

  private applyEndpoints() {
    for (const node of this.nodes.values()) {
      if (node.endpoint === null) continue;
      node.fx = this.fixedX(node);
      if (!this.pinned.has(node.id)) node.fy = this.mode === 'free' ? this.height / 2 : null;
    }
  }

  private updateDomain() {
    let [from, to] = this.bounds;
    const pad = Math.max(8, (to - from) * 0.06);
    from -= pad; to += pad;
    for (const node of this.nodes.values()) { from = Math.min(from, node.year - pad / 2); to = Math.max(to, node.year + pad / 2); }
    this.domain = [Math.floor(from), Math.ceil(to)];
  }

  private configureForces() {
    const time = this.mode === 'time';
    const cx = this.width / 2, cy = this.height / 2;
    const sim = this.simulation;
    sim.force('x', forceX<LayoutNode>(node => time ? this.xOf(node.year) : cx).strength(time ? 0.45 : 0.02));
    sim.force('y', forceY<LayoutNode>(cy).strength(time ? 0.04 : 0.05));
    sim.force('collide', forceCollide<LayoutNode>(node => node.radius + LABEL_ROOM).strength(0.9));
    sim.force('charge', time ? null : forceManyBody<LayoutNode>().strength(-320).distanceMax(500));
    sim.force('link', forceLink<LayoutNode, Link>(this.links).id(node => node.id).distance(time ? 70 : 120).strength(time ? 0.08 : 0.5));
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
