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
const DEFAULT_SIZE = { width: 900, height: 600 };
const ALPHA_MIN = 0.02;

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

  xOf(year: number) {
    const [from, to] = this.domain, span = Math.max(1, to - from), usable = Math.max(1, this.width - MARGIN * 2);
    return MARGIN + (year - from) / span * usable;
  }
  get pixelsPerYear() { return Math.max(1, this.width - MARGIN * 2) / Math.max(1, this.domain[1] - this.domain[0]); }

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
    for (const input of inputs) {
      const existing = this.nodes.get(input.id);
      if (existing) { existing.year = input.year; existing.radius = input.radius; existing.endpoint = input.endpoint; continue; }
      this.nodes.set(input.id, { id: input.id, year: input.year, endpoint: input.endpoint, radius: input.radius });
      added = true;
    }
    this.updateDomain();
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
    if (added) this.reheat(0.35);
    this.emit();
  }

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
