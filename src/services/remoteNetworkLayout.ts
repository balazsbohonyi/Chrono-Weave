import {
  clampDragPoint, NetworkLayout, pixelsPerYearFor, timeX, yearDomainFor,
  type CategoryGuide, type ColumnGuide, type CorridorGuide, type FreeZone, type LayoutInput, type LayoutLinkInput, type LayoutMode, type OrbitRing,
} from './connectionNetworkLayout';

// What the explorer needs of a layout. `NetworkLayout` itself is one (the fallback, and what the tests drive), and so is
// `RemoteNetworkLayout`, which keeps the physics in a worker so a big network never blocks clicks, scrolling or the drawing.
export interface NetworkLayoutHandle {
  readonly nodes: ReadonlyMap<string, Pick<LayoutInput, 'id' | 'year' | 'endpoint' | 'radius'>>;
  readonly pinned: ReadonlySet<string>;
  readonly rings: OrbitRing[];
  readonly columns: ColumnGuide[];
  readonly categories: CategoryGuide[];
  readonly corridor: CorridorGuide | null;
  readonly yearDomain: [number, number];
  readonly pixelsPerYear: number;
  readonly active: boolean;
  xOf(year: number): number;
  position(id: string): { x: number; y: number } | undefined;
  subscribe(listener: () => void): () => void;
  setBounds(start: number, end: number): void;
  setSize(width: number, height: number): void;
  setMode(mode: LayoutMode): void;
  setGraph(inputs: LayoutInput[], links: LayoutLinkInput[]): void;
  // Advances the animation one frame; false once it is at rest.
  step(): boolean;
  settle(maxTicks?: number): unknown;
  refresh(): void;
  stop(): void;
  dragStart(id: string): void;
  dragTo(id: string, x: number, y: number): void;
  dragEnd(id: string): void;
  unpin(id: string): void;
  unpinAll(): void;
}

export type LayoutCommand =
  | { type: 'bounds'; start: number; end: number }
  | { type: 'size'; width: number; height: number }
  | { type: 'mode'; mode: LayoutMode }
  | { type: 'graph'; inputs: LayoutInput[]; links: LayoutLinkInput[] }
  | { type: 'tick'; seq: number }
  | { type: 'settle'; seq: number; max?: number }
  | { type: 'dragStart'; id: string }
  | { type: 'dragTo'; id: string; x: number; y: number }
  | { type: 'dragEnd'; id: string }
  | { type: 'unpin'; id: string }
  | { type: 'unpinAll' };

// One frame of positions from the worker. `ids` (the order of `positions`, two numbers per person, NaN when not placed) comes
// whenever the people changed since the last frame; guides and pins only when they changed, so they keep their identity here.
export interface LayoutFrame {
  seq: number; active: boolean; positions: Float64Array; zones: FreeZone[];
  ids?: string[]; pinned?: string[];
  guides?: { rings: OrbitRing[]; columns: ColumnGuide[]; categories: CategoryGuide[]; corridor: CorridorGuide | null };
}

const ARRANGED: ReadonlySet<LayoutMode> = new Set(['cluster', 'columns', 'category', 'corridor']);
type Meta = Pick<LayoutInput, 'id' | 'year' | 'endpoint' | 'radius'> & { clearance: number };

// Mirrors a NetworkLayout that runs in a worker. Everything the drawing reads synchronously is kept here: the people (from the
// inputs), the time axis (computed the same way the worker does), the pins (updated at once, then confirmed by the worker), and the
// latest frame of positions. A person the worker has not placed yet has no position, and the drawing leaves them out until it has.
// Only one frame is asked for at a time, so a long seating of a big round of people never piles up requests.
export class RemoteNetworkLayout implements NetworkLayoutHandle {
  readonly nodes = new Map<string, Meta>();
  pinned = new Set<string>();
  rings: OrbitRing[] = [];
  columns: ColumnGuide[] = [];
  categories: CategoryGuide[] = [];
  corridor: CorridorGuide | null = null;
  yearDomain: [number, number] = [1500, 1600];
  pixelsPerYear = pixelsPerYearFor(this.yearDomain);
  private bounds: [number, number] = [1500, 1600];
  private mode: LayoutMode = 'time';
  private worker: Worker | null = null;
  private listeners = new Set<() => void>();
  private index = new Map<string, number>();
  private positions = new Float64Array(0);
  private zones: FreeZone[] = [];
  private seq = 0;
  private waiting = false;
  // Whether the worker may still be moving people: true after any change until a frame asked for after it says it is at rest.
  private moving = false;
  private changeSeq = 0;
  private size: { width: number; height: number } | null = null;
  // The person being dragged is drawn at the pointer (clamped as the worker will clamp it), not a frame behind it; after the drop
  // that holds until a frame asked for after it arrives.
  private held: { id: string; x: number; y: number; until: number } | null = null;

  constructor(private readonly spawn: () => Worker) {}

  get active() { return this.moving || this.held !== null; }
  xOf(year: number) { return timeX(year, this.yearDomain); }

  position(id: string) {
    if (this.held?.id === id) return { x: this.held.x, y: this.held.y };
    const at = this.index.get(id); if (at === undefined) return undefined;
    const x = this.positions[2 * at], y = this.positions[2 * at + 1];
    return Number.isNaN(x) || Number.isNaN(y) ? undefined : { x, y };
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }

  private post(command: LayoutCommand) {
    if (!this.worker) {
      this.worker = this.spawn();
      this.worker.onmessage = (event: MessageEvent<LayoutFrame>) => this.receive(event.data);
      // A fresh worker knows nothing yet: give it what this mirror holds (the graph follows with the next setGraph).
      this.worker.postMessage({ type: 'bounds', start: this.bounds[0], end: this.bounds[1] } satisfies LayoutCommand);
      this.worker.postMessage({ type: 'mode', mode: this.mode } satisfies LayoutCommand);
      if (this.size) this.worker.postMessage({ type: 'size', ...this.size } satisfies LayoutCommand);
    }
    this.worker.postMessage(command);
  }
  private change(command: LayoutCommand) { this.moving = true; this.changeSeq = this.seq + 1; this.post(command); }

  private receive(frame: LayoutFrame) {
    if (frame.ids) this.index = new Map(frame.ids.map((id, at) => [id, at]));
    this.positions = frame.positions;
    this.zones = frame.zones;
    if (frame.pinned) this.pinned = new Set(frame.pinned);
    if (frame.guides) Object.assign(this, frame.guides);
    if (frame.seq === this.seq) { this.waiting = false; if (frame.seq >= this.changeSeq) this.moving = frame.active; }
    if (this.held && this.held.until >= 0 && frame.seq > this.held.until) this.held = null;
    this.emit();
  }

  setBounds(start: number, end: number) {
    this.bounds = [Math.min(start, end), Math.max(start, end)];
    this.updateDomain();
    this.change({ type: 'bounds', start, end });
  }
  setSize(width: number, height: number) {
    if (!(width > 0) || !(height > 0) || (this.size?.width === width && this.size.height === height)) return;
    this.size = { width, height };
    this.change({ type: 'size', width, height });
  }
  setMode(mode: LayoutMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    // Entering an arranged layout lets go of every pin (as the worker's layout does).
    if (ARRANGED.has(mode)) this.pinned = new Set();
    this.change({ type: 'mode', mode });
  }
  setGraph(inputs: LayoutInput[], links: LayoutLinkInput[]) {
    this.nodes.clear();
    for (const input of inputs) this.nodes.set(input.id, { id: input.id, year: input.year, endpoint: input.endpoint, radius: input.radius, clearance: input.clearance ?? 0 });
    for (const id of [...this.pinned]) if (!this.nodes.has(id)) this.pinned.delete(id);
    this.updateDomain();
    this.change({ type: 'graph', inputs, links });
  }
  private updateDomain() {
    this.yearDomain = yearDomainFor(this.bounds, [...this.nodes.values()].map(node => node.year));
    this.pixelsPerYear = pixelsPerYearFor(this.yearDomain);
  }

  step() {
    if (this.waiting) return true;
    if (!this.moving) return false;
    this.waiting = true;
    this.post({ type: 'tick', seq: ++this.seq });
    return true;
  }
  settle(max?: number) { this.waiting = true; this.post({ type: 'settle', seq: ++this.seq, max }); }
  refresh() { this.emit(); }
  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.waiting = false; this.moving = false;
  }

  dragStart(id: string) {
    const at = this.position(id); if (!at) return;
    this.held = { id, ...at, until: -1 };
    this.change({ type: 'dragStart', id });
  }
  dragTo(id: string, x: number, y: number) {
    const node = this.nodes.get(id); if (!node || this.held?.id !== id) return;
    const other = node.endpoint === null ? undefined : [...this.nodes.values()].find(candidate => candidate.endpoint !== null && candidate.id !== id);
    const otherAt = other && this.position(other.id);
    const arranged = ARRANGED.has(this.mode), time = this.mode === 'time';
    const held = clampDragPoint(node, x, y, {
      arranged, time, zones: arranged ? [] : this.zones, homeX: this.xOf(node.year),
      other: other && otherAt ? { ...otherAt, radius: other.radius } : null,
    });
    // On the time line an endpoint keeps its place on the axis.
    this.held = { id, x: node.endpoint !== null && time ? this.xOf(node.year) : held.x, y: held.y, until: -1 };
    this.change({ type: 'dragTo', id, x, y });
    this.emit();
  }
  dragEnd(id: string) {
    if (!this.nodes.has(id)) return;
    this.pinned = new Set(this.pinned).add(id);
    this.change({ type: 'dragEnd', id });
    if (this.held?.id === id) this.held.until = this.seq;
  }
  unpin(id: string) {
    if (!this.pinned.has(id)) return;
    this.pinned = new Set(this.pinned); this.pinned.delete(id);
    this.change({ type: 'unpin', id });
  }
  unpinAll() {
    if (!this.pinned.size) return;
    this.pinned = new Set();
    this.change({ type: 'unpinAll' });
  }
}

// A worker when the platform has them (the browser), otherwise the layout in this thread (server rendering, tests).
export function createNetworkLayout(): NetworkLayoutHandle {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return new NetworkLayout();
  return new RemoteNetworkLayout(() => new Worker(new URL('../workers/networkLayout.worker.ts', import.meta.url), { type: 'module' }));
}
