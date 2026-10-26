import React, { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_BAR_TEXT_COLORS, CATEGORY_COLORS } from '../../constants';
import { readNetworkViewPrefs, saveNetworkViewPrefs } from '../../utils/networkViewPrefs';
import { axisTicks, podTitle, podTitleSize, POD_TITLE_MAX_SIZE, TICK_MIN_SPACING, type CategoryGuide, type ColumnGuide, type CorridorGuide, type LayoutMode, type OrbitRing } from '../../services/connectionNetworkLayout';
import type { NetworkLayoutHandle } from '../../services/remoteNetworkLayout';
import {
  closestApproachLabel, describeSide, edgeDrawOrder, initials, STATUS_LABELS, truncateName, type NetworkEdge, type NetworkFold, type NetworkNode, type NetworkSelection, type NetworkView,
} from '../../services/connectionNetworkView';
import { formatYear } from '../../utils/formatters';
import { createWheelClassifier } from '../../utils/wheelGesture';
import ToolButton from './ToolButton';
import ActivityCaption from './ActivityCaption';
import { fitCamera as fitPoints, isFarZoom, previewTransform, rectHasPoint, rectHasRect, rectHasSegment, viewRect, type Camera, type CameraPoint, type Rect } from './camera';
import { GRAPH_PERF_CULLING, GRAPH_PERF_EXTENDED_ANIMATIONS, GRAPH_PERF_HIDE_PORTRAITS, GRAPH_PERF_LEVEL_OF_DETAIL, GRAPH_PERF_ZOOM_PREVIEW } from './performance';
import LayoutMenu from './LayoutMenu';
import { layoutInfoLabel } from '../LayoutInfo';
import { labelLimit, nodeRadius } from './metrics';

interface Point { x: number; y: number }
const MIN_ZOOM = 0.15, MAX_ZOOM = 4, DRAG_SLOP = 4, FIT_PADDING = 70;
// The year strips cover this much of the top and bottom of the drawing; nothing should hide under them.
const STRIP_HEIGHT = 24;
// While following a growing network the camera stays at least this close, even when that means panning.
const READABLE_ZOOM = 0.8, READABLE_ZOOM_NARROW = 0.6;

export interface RevealRequest { n: number; person?: string; edge?: string }
interface Props {
  view: NetworkView;
  endpointNames: [string, string];
  nameOf: (id: string) => string;
  layout: NetworkLayoutHandle;
  kick: () => void;
  // The pinned people as the explorer last synced them (the layout's own set changes in place, so a memoized layer could not see it).
  pinned: ReadonlySet<string>;
  mode: LayoutMode;
  onModeChange: (mode: LayoutMode) => void;
  size: { width: number; height: number };
  onSize: (width: number, height: number) => void;
  selection: NetworkSelection;
  onSelect: (selection: NetworkSelection) => void;
  portraits: Map<string, string>;
  narrow: boolean;
  reducedMotion: boolean;
  success: { degrees: number } | null;
  // A connection that was already made, reopened to explore: nothing is framed, everyone off the chain is dimmed until something is selected, and its chain is lime, lines on or off (Reveal is in the header).
  solved?: { degrees: number } | null;
  // Whether the chain of a found or solved connection is lit (lime); off, it looks like any other AI-supported contacts.
  showChain?: boolean;
  onReveal: () => void;
  // Set when the search stopped on its own limit and can be carried on from where it is.
  resume?: { onResume: () => void; reason: 'time' | 'work' } | null;
  reveal: RevealRequest | null;
  onPinsChange: () => void;
  onToggleFold: (hostId: string) => void;
  legend: React.ReactNode;
  // Whether the graph has the whole viewport to itself, and the way to switch that on (absent when there is no side panel to hide). While it is
  // on, the explorer's compact bar has the way back, so the bare icon is not drawn.
  maximized: boolean;
  onToggleMaximize?: () => void;
  // Width in pixels of the strip at the right edge that the floating panel covers (0 when it is closed). The graph is not resized by it, but
  // what the camera frames, or pans to, stays in the part that is left.
  inset?: number;
  // Opens the explanation of the current layout (absent: no help button in the toolbar).
  onOpenLayoutInfo?: () => void;
  // Whether the search is also drawn along lines and in a caption (see `GRAPH_PERF_EXTENDED_ANIMATIONS`).
  extendedAnimations?: boolean;
  // Hears how wide the activity caption is while it is shown (0 when not), for the full-screen bar to make room for.
  onCaptionWidth?: (width: number) => void;
}

const sideClass = (node: NetworkNode) => node.endpoint !== null ? `is-endpoint is-end-${node.endpoint === 0 ? 'a' : 'b'}` : `is-side-${node.side}`;
// Endpoint names are shown whole, on a pill, so they stay readable among a crowd.
const ENDPOINT_NAME_LIMIT = 28;
const pillWidth = (text: string) => text.length * 7.6 + 20;
// Column headers are drawn at a constant size on screen, so when zoomed out they share the room of the narrowest band: all of them
// say "n links" while that fits, then just the number, then only every fifth.
const columnLabel = (guide: ColumnGuide, guides: readonly ColumnGuide[], zoom: number) => {
  const room = Math.min(...guides.map(item => item.half * 2 + 40)) * zoom;
  if (room >= 64) return `${guide.hops} ${guide.hops === 1 ? 'link' : 'links'}`;
  return room >= 18 || guide.hops % 5 === 0 ? String(guide.hops) : '';
};

// Keeps receiving a drag that leaves the element; a pointer that is already gone is not an error.
const capture = (element: Element, pointerId: number) => { try { element.setPointerCapture(pointerId); } catch { /* released */ } };
const activate = (action: () => void) => (event: React.KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); }
};

type Focus = NetworkView['focus'];
interface NodeHandlers {
  down: (event: React.PointerEvent<SVGGElement>, id: string) => void;
  move: (event: React.PointerEvent<SVGGElement>) => void;
  up: (event: React.PointerEvent<SVGGElement>, id: string) => void;
  release: (id: string) => void;
  // A picture that did not load: the person and the address that failed (a new address, e.g. after they became AI-supported, is tried again).
  failed: (id: string, url: string) => void;
}

// The lines and the people are layers of their own, memoized: moving the camera, the clock or the axis re-renders neither. Each line
// and person is a memoized item too, given only plain values, so a search update (which rebuilds the view, with new objects for
// everybody) re-renders just the people and lines whose drawing changed. Their elements carry their ids (data-edge, data-node) and
// the graph finds them after each render of a layer to paint positions on them directly.
const EdgeItem = memo(function EdgeItem({ id, from, to, status, label, flags, onSelect }: {
  id: string; from: string; to: string; status: NetworkEdge['status']; label: string; flags: string; onSelect: (selection: NetworkSelection) => void;
}) {
  const select = () => onSelect({ edge: id });
  return <g data-net-interactive data-edge={id} data-from={from} data-to={to} role="button" tabIndex={0} aria-label={label} aria-pressed={flags.includes(' is-selected')}
    className={`net-edge is-${status}${flags}`} onClick={select} onKeyDown={activate(select)}>
    <title>{label}</title>
    <path className="net-edge-halo" /><path className="net-edge-line" /><path className="net-edge-hit" />
  </g>;
});

const EdgeLayer = memo(function EdgeLayer({ edges, selection, focus, chainEdges, nameOf, onSelect }: {
  edges: NetworkEdge[]; selection: NetworkSelection; focus: Focus; chainEdges: ReadonlySet<string> | null;
  nameOf: (id: string) => string; onSelect: (selection: NetworkSelection) => void;
}) {
  return <>{edges.map(edge => {
    const flags = [edge.contextual && 'is-contextual', selection.edge === edge.id && 'is-selected',
      selection.person && (edge.from === selection.person || edge.to === selection.person) && 'is-incident',
      focus && !focus.edges.has(edge.id) && 'is-dim', chainEdges?.has(edge.id) && 'is-chain'].filter(Boolean);
    return <EdgeItem key={edge.id} id={edge.id} from={edge.from} to={edge.to} status={edge.status} onSelect={onSelect}
      label={`${nameOf(edge.from)} and ${nameOf(edge.to)}: ${STATUS_LABELS[edge.status]}`} flags={flags.map(flag => ` ${flag}`).join('')} />;
  })}</>;
});

// What the search is doing, drawn as lines of its own between two people (they are painted like any other line, from their data-from / data-to):
// a beam from each person whose contacts are sought toward the other end of the chain, or a comet between the endpoints while a seed route is asked for.
interface Beam { id: string; from: string; to: string; kind: 'a' | 'b' | 'seed' }
const BeamLayer = memo(function BeamLayer({ beams }: { beams: readonly Beam[] }) {
  return <>{beams.map(beam => <g key={beam.id} data-edge={beam.id} data-from={beam.from} data-to={beam.to} className={`net-edge net-beam is-beam-${beam.kind}`} aria-hidden="true">
    <path className="net-edge-halo" /><path className="net-edge-line" pathLength={beam.kind === 'seed' ? 100 : undefined} /><path className="net-edge-hit" />
  </g>)}</>;
});

interface NodeItemProps {
  id: string; name: string; years: string; category: NetworkNode['person']['category']; endpoint: 0 | 1 | null; label: string; className: string;
  selected: boolean; r: number; url?: string; clip: string; pinned: boolean; active: boolean; working: string; shownName: string; foldCount: number; foldExpanded: boolean;
  handlers: NodeHandlers; onSelect: (selection: NetworkSelection) => void; onToggleFold: (hostId: string) => void;
}
const NodeItem = memo(function NodeItem({ id, name, years, category, endpoint, label, className, selected, r, url, clip, pinned, active, working, shownName, foldCount, foldExpanded, handlers, onSelect, onToggleFold }: NodeItemProps) {
  const isEndpoint = endpoint !== null;
  const select = () => onSelect({ person: id });
  return <g data-net-interactive data-node={id} role="button" tabIndex={0} aria-label={label} aria-pressed={selected}
    className={className} onPointerDown={event => handlers.down(event, id)} onPointerMove={handlers.move} onPointerUp={event => handlers.up(event, id)} onPointerCancel={event => handlers.up(event, id)}
    onDoubleClick={() => handlers.release(id)} onKeyDown={activate(select)}>
    <title>{`${name} (${years})`}</title>
    <g className="net-node-body">
      {isEndpoint && <g className="net-beacon" aria-hidden="true"><circle className="net-halo" r={r + 28} /><circle className="net-halo-ring" r={r + 14} /></g>}
      {working.startsWith('asked') && <g className="net-ripple-set" aria-hidden="true"><circle className="net-ripple" r={r + 3} /><circle className="net-ripple" r={r + 3} /><circle className="net-ripple" r={r + 3} /></g>}
      {working === 'identity' && <circle className="net-scan" r={r + 8} aria-hidden="true" />}
      {active && <g className="net-pulse-set" aria-hidden="true"><circle className="net-pulse-halo" r={r + 6} /><circle className="net-pulse" r={r + 6} /><circle className="net-pulse" r={r + 6} /><circle className="net-pulse" r={r + 6} /></g>}
      <circle className="net-select-ring" r={r + 8} />
      <circle className="net-ring" r={r + 3} />
      <circle className="net-disc" r={r} fill={CATEGORY_COLORS[category]} />
      {url
        ? <image href={url} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" onError={() => handlers.failed(id, url)} />
        : <text className="net-initials" textAnchor="middle" dy="0.35em" style={{ fontSize: r * 0.8, fill: CATEGORY_BAR_TEXT_COLORS[category] }}>{initials(name)}</text>}
      {isEndpoint && <g className="net-badge-ab"><circle cx={r * 0.78} cy={-r * 0.78} r={r * 0.4} /><text x={r * 0.78} y={-r * 0.78} textAnchor="middle" dy="0.35em">{endpoint === 0 ? 'A' : 'B'}</text></g>}
      {pinned && <g className="net-pin"><title>Pinned · double-click to release</title><circle cx={-r * 0.78} cy={-r * 0.78} r={6} /><path d={`M ${-r * 0.78 - 2.5} ${-r * 0.78 + 2.5} L ${-r * 0.78 + 2.5} ${-r * 0.78 - 2.5}`} /></g>}
    </g>
    {isEndpoint && <rect className="net-pill" x={-pillWidth(shownName) / 2} y={r + 5} width={pillWidth(shownName)} height={22} rx={11} />}
    <text className="net-name" textAnchor="middle" y={isEndpoint ? r + 20.5 : r + 15}>{shownName}</text>
    {foldCount > 0 && <g data-net-interactive role="button" tabIndex={0} className="net-fold" aria-label={`${foldExpanded ? 'Hide' : 'Show'} ${foldCount} more ${foldCount === 1 ? 'contact' : 'contacts'} of ${name}`}
      transform={`translate(${r * 0.8} ${r * 0.8})`} onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onToggleFold(id); }} onKeyDown={activate(() => onToggleFold(id))}>
      <rect x={-14} y={-9} width={28} height={18} rx={9} /><text textAnchor="middle" dy="0.35em">{foldExpanded ? '−' : '+'}{foldCount}</text>
    </g>}
  </g>;
});

const NodeLayer = memo(function NodeLayer({ nodes, folds, selection, focus, chainNodes, workingEnds, narrow, portraits, failed, pinned, endpointNames, clips, handlers, onSelect, onToggleFold }: {
  nodes: NetworkNode[]; folds: NetworkFold[]; selection: NetworkSelection; focus: Focus; chainNodes: ReadonlySet<string> | null; workingEnds: string; narrow: boolean;
  portraits: Map<string, string>; failed: ReadonlyMap<string, string>; pinned: ReadonlySet<string>; endpointNames: [string, string];
  clips: { endpoint: string; person: string }; handlers: NodeHandlers; onSelect: (selection: NetworkSelection) => void; onToggleFold: (hostId: string) => void;
}) {
  const foldOf = useMemo(() => new Map(folds.map(fold => [fold.hostId, fold])), [folds]);
  return <>{nodes.map(node => {
    const isEndpoint = node.endpoint !== null, fold = foldOf.get(node.id), isPinned = pinned.has(node.id), name = node.person.name;
    const selected = selection.person === node.id, onEdge = !!selection.edge && !!focus?.nodes.has(node.id);
    const className = `net-node ${sideClass(node)} ${node.supported ? 'is-supported' : 'is-tentative'} ${selected ? 'is-selected' : ''} ${onEdge ? 'is-edge-end' : ''} ${focus && !focus.nodes.has(node.id) ? 'is-dim' : ''} ${chainNodes?.has(node.id) ? 'is-chain' : ''} ${node.active ? 'is-active' : ''} ${isEndpoint && workingEnds.includes(node.endpoint === 0 ? 'a' : 'b') ? 'is-working-end' : ''} ${node.working ? `is-${node.working.kind}${node.working.side ? `-${node.working.side}` : ''}` : ''}`;
    return <NodeItem key={node.id} id={node.id} name={name} years={`${node.person.birthYear}–${node.person.deathYear}`} category={node.person.category}
      endpoint={node.endpoint} label={`${name}, ${describeSide(node, endpointNames)}${isPinned ? ', pinned' : ''}`} className={className} selected={selected}
      r={nodeRadius(isEndpoint, narrow)} url={failed.get(node.id) !== portraits.get(node.id) ? portraits.get(node.id) : undefined} clip={isEndpoint ? clips.endpoint : clips.person}
      pinned={isPinned} active={node.active} working={node.working ? `${node.working.kind}${node.working.side ? `-${node.working.side}` : ''}` : ''} shownName={isEndpoint ? truncateName(name, ENDPOINT_NAME_LIMIT) : truncateName(name, labelLimit(narrow))}
      foldCount={fold?.ids.length ?? 0} foldExpanded={!!fold?.expanded} handlers={handlers} onSelect={onSelect} onToggleFold={onToggleFold} />;
  })}</>;
});

// Sets the ends of a straight line drawn as paths (an edge draws three: halo, line and hit area), one attribute each. Returns what
// it set, so a caller can skip lines that did not move: most frames move only part of a big network.
const setEnds = (paths: Iterable<SVGPathElement>, a: Point, b: Point, previous = '') => {
  const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  if (d !== previous) for (const path of paths) path.setAttribute('d', d);
  return d;
};
// A person (or line) the layout has not placed yet is kept out of sight until it has, rather than drawn at the origin; one outside the
// view is kept out of sight too (`display: none` takes it out of style, layout and paint, which `visibility` would not). What was set
// is remembered, so a frame does not read every element's style.
interface Drawn { el: SVGGElement; key: string; visible: boolean }
const show = (drawn: Drawn, visible: boolean) => { if (drawn.visible !== visible) { drawn.el.style.display = visible ? '' : 'none'; drawn.visible = visible; } };
// Room kept around the view, in screen pixels, for what reaches past a person's centre (name, halo) so nothing pops in at the edge.
const CULL_MARGIN = 120;
// Below this many drawn people, zooming out keeps names and portraits (see `isFarZoom`).
const LOD_MIN_PEOPLE = 60;
// How long without a pointer or wheel event before the drawing's place on the page is read again (see `local`).
const ORIGIN_KEPT_MS = 250;
// A zoom gesture is previewed with a CSS transform and committed to the drawing after this long without an event, and at least this often while it goes on.
const PREVIEW_SETTLE_MS = 120, PREVIEW_COMMIT_MAX_MS = 350;
// How much more than the view (as a share of the bigger side of the drawing) is drawn when a preview zooms out past what was drawn.
const PREVIEW_OVERSCAN = 0.5;
// The year bands and lines reach this many drawing heights (and widths, for the lines) beyond the view, so a zoom preview that shrinks the drawing finds them there.
const AXIS_PREVIEW_REACH = 3;
// From this many drawn people and lines, dimming is immediate instead of fading (see the stylesheet).
const LARGE_DRAWING = 250;
// How long a line flashes after its contact is decided (the stylesheet's `net-decided` animations last about as long).
const DECIDED_FLASH_MS = 1600;

// The drawing: an SVG whose structure React renders and whose positions the layout paints directly,
// so the simulation never re-renders the explorer. The camera is a transform over screen-sized content.
const NetworkGraph: React.FC<Props> = ({
  view, endpointNames, nameOf, layout, kick, pinned, mode, onModeChange, size, onSize, selection, onSelect, portraits, narrow, reducedMotion,
  success, solved = null, showChain = true, onReveal, resume = null, reveal, onPinsChange, onToggleFold, legend, maximized, onToggleMaximize, inset = 0, onOpenLayoutInfo, extendedAnimations = GRAPH_PERF_EXTENDED_ANIMATIONS, onCaptionWidth,
}) => {
  const uid = useId().replace(/:/g, '');
  const svg = useRef<SVGSVGElement>(null);
  // The drawn people and lines, found after their layer renders; `key` is what was last painted, so unmoved ones are skipped.
  const nodeEls = useRef(new Map<string, Drawn>());
  const edgeEls = useRef(new Map<string, Drawn & { from: string; to: string; paths: SVGPathElement[] }>());
  const gapEl = useRef<SVGGElement | null>(null);
  // The guides of the cluster (rings) and columns (bands) layouts, each moved to its endpoint's live position.
  const ringEls = useRef(new Map<string, { anchor: string; el: SVGGElement }>());
  // Connection lines can be switched off to read just the people and their names.
  const [showLines, setShowLines] = useState(() => readNetworkViewPrefs().showLines);
  useEffect(() => saveNetworkViewPrefs({ showLines }), [showLines]);
  const [rings, setRings] = useState<readonly OrbitRing[]>(() => layout.rings);
  const [columns, setColumns] = useState<readonly ColumnGuide[]>(() => layout.columns);
  // The pods of the category layout stand still; the corridor's centre line is painted between its two endpoints.
  const [categories, setCategories] = useState<readonly CategoryGuide[]>(() => layout.categories);
  const [corridor, setCorridor] = useState<CorridorGuide | null>(() => layout.corridor);
  const corridorEl = useRef<SVGGElement | null>(null);
  // The layer over the graph the layout menu is drawn in (see LayoutMenu).
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
  // `camera` is what the drawing shows; `cameraRef` is where the camera is (ahead of it while a zoom is being previewed, see `previewTo`).
  const cameraRef = useRef(camera);
  const shown = useRef(camera);
  shown.current = camera;
  const userMoved = useRef(false);
  // Following the graph normally keeps a readable zoom; "Fit network" asks for everything at once.
  const followAll = useRef(false);
  // While the winning chain is lit, the camera frames it, whatever else is on screen.
  const litChain = useRef<ReadonlySet<string> | null>(null);
  const classifyWheel = useRef(createWheelClassifier()).current;
  const [failed, setFailed] = useState(() => new Map<string, string>());
  const [domain, setDomain] = useState(layout.yearDomain);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const insetRef = useRef(inset);
  insetRef.current = inset;

  const apply = useCallback((next: Camera) => { cameraRef.current = next; setCamera(next); }, []);

  // Paints positions, and keeps people and lines outside the view out of the page: they are skipped entirely (no attribute writes) until
  // they come back, when their remembered `key` no longer matches and they are painted again.
  // `overscan` (screen pixels, on top of CULL_MARGIN) draws more than the view, for a zoom preview that is about to show more; `painted` is the
  // world rectangle that was last drawn, so a preview knows when it has outgrown it.
  const painted = useRef<Rect | null>(null);
  const paint = useCallback((overscan = 0) => {
    const { width, height } = sizeRef.current;
    const inView = GRAPH_PERF_CULLING && width > 0 && height > 0 ? viewRect(cameraRef.current, sizeRef.current, CULL_MARGIN + overscan) : null;
    painted.current = inView;
    for (const [id, drawn] of nodeEls.current) {
      const at = layout.position(id);
      show(drawn, !!at && (!inView || rectHasPoint(inView, at)));
      if (!at || !drawn.visible) continue;
      const key = `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`;
      if (key !== drawn.key) { drawn.el.setAttribute('transform', key); drawn.key = key; }
    }
    for (const drawn of edgeEls.current.values()) {
      const a = layout.position(drawn.from), b = layout.position(drawn.to);
      show(drawn, !!a && !!b && (!inView || rectHasSegment(inView, a, b)));
      if (a && b && drawn.visible) drawn.key = setEnds(drawn.paths, a, b, drawn.key);
    }
    for (const { anchor, el } of ringEls.current.values()) {
      const at = layout.position(anchor);
      if (at) el.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    }
    for (const el of [corridorEl.current, gapEl.current]) {
      if (!el) continue;
      const a = layout.position(el.dataset.a ?? ''), b = layout.position(el.dataset.b ?? '');
      el.style.visibility = a && b ? '' : 'hidden';
      if (a && b) setEnds(el.querySelectorAll('path'), a, b);
    }
  }, [layout]);

  // `only` frames just those people (the lit chain); otherwise everybody, at a readable zoom unless asked for it all.
  const fitCamera = useCallback((everything: boolean, only?: ReadonlySet<string>): Camera | null => {
    const points: CameraPoint[] = [];
    for (const [id, node] of layout.nodes) {
      const at = layout.position(id);
      if (at && (!only || only.has(id))) points.push({ ...at, r: node.radius + 22, endpoint: node.endpoint !== null });
    }
    const result = fitPoints(points, { width: Math.max(1, sizeRef.current.width - insetRef.current), height: sizeRef.current.height }, {
      everything: everything || !!only, readableZoom: narrowRef.current ? READABLE_ZOOM_NARROW : READABLE_ZOOM,
      minZoom: MIN_ZOOM, maxZoom: 1.25, padding: FIT_PADDING, strip: STRIP_HEIGHT,
    });
    return result?.camera ?? null;
  }, [layout]);

  const fit = useCallback(() => {
    userMoved.current = false; followAll.current = true;
    const next = fitCamera(true); if (next) apply(next);
  }, [fitCamera, apply]);

  const centerOn = useCallback((x: number, y: number) => {
    const { width, height } = sizeRef.current, k = cameraRef.current.k;
    userMoved.current = true;
    apply({ k, x: (width - insetRef.current) / 2 - x * k, y: height / 2 - y * k });
  }, [apply]);

  const visibleOnScreen = useCallback((at: Point) => {
    const { width, height } = sizeRef.current, { x, y, k } = cameraRef.current;
    const sx = at.x * k + x, sy = at.y * k + y;
    return sx > 20 && sx < width - insetRef.current - 20 && sy > STRIP_HEIGHT + 8 && sy < height - STRIP_HEIGHT - 8;
  }, []);

  // Positions painted by the layout, plus follow-the-graph camera until the user takes over. The camera follows every frame (the
  // people and lines are memoized layers, so a camera change re-renders only the axis and guides) and only when it actually moves.
  useEffect(() => { setRings(layout.rings); setColumns(layout.columns); setCategories(layout.categories); setCorridor(layout.corridor); return layout.subscribe(() => {
    paint();
    setRings(layout.rings);
    setColumns(layout.columns);
    setCategories(layout.categories);
    setCorridor(layout.corridor);
    const current = layout.yearDomain;
    setDomain(previous => previous[0] === current[0] && previous[1] === current[1] ? previous : current);
    if (userMoved.current) return;
    const next = fitCamera(followAll.current, litChain.current ?? undefined), was = cameraRef.current;
    if (next && (Math.abs(next.x - was.x) > 0.25 || Math.abs(next.y - was.y) > 0.25 || Math.abs(next.k - was.k) > 0.0005)) apply(next);
  }); }, [layout, paint, fitCamera, apply]);

  // Panning, zooming and resizing move what is in view without the layout moving anyone: culling follows them.
  useLayoutEffect(() => { if (GRAPH_PERF_CULLING) paint(); }, [camera, size.width, size.height, paint]);

  // Measure the available area. Layout and drawing work in real screen pixels.
  useLayoutEffect(() => {
    const element = svg.current; if (!element) return;
    const measure = () => { origin.current = null; const box = (element.parentElement ?? element).getBoundingClientRect(); if (box.width > 0 && box.height > 0) onSize(Math.round(box.width), Math.round(box.height)); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onSize]);

  // The inspector asked to look at something; pan there only when it is off-screen.
  useEffect(() => {
    if (!reveal) return;
    const ids = reveal.edge ? view.edges.filter(edge => edge.id === reveal.edge).flatMap(edge => [edge.from, edge.to]) : reveal.person ? [reveal.person] : [];
    const points = ids.flatMap(id => layout.position(id) ?? []);
    if (!points.length || points.every(visibleOnScreen)) return;
    centerOn(points.reduce((sum, p) => sum + p.x, 0) / points.length, points.reduce((sum, p) => sum + p.y, 0) / points.length);
  }, [reveal?.n]);

  // The chain lights up and stays lit until the user reveals it: bring it into view even when the camera
  // sits on the middle of a wider network or the user had panned away, and keep it framed until they take over.
  const chainKey = success && view.chain ? JSON.stringify(view.chain.nodeIds) : '';
  useEffect(() => {
    if (!chainKey) { litChain.current = null; return; }
    litChain.current = new Set<string>(JSON.parse(chainKey));
    userMoved.current = false;
    const next = fitCamera(true, litChain.current); if (next) apply(next);
    return () => { litChain.current = null; };
  }, [chainKey]);

  // Zoom gestures (wheel, pinch) move the camera without redrawing: the drawing is scaled as a picture by a CSS transform on the SVG, which costs
  // neither layout nor a render, and the camera is committed (drawn for real, with the transform cleared) once the gesture pauses and at least
  // every PREVIEW_COMMIT_MAX_MS while it goes on. Changing the scale of the content itself lays out every person and line again.
  const settle = useRef<{ timer?: number; since: number }>({ since: 0 });
  const commit = useCallback(() => { window.clearTimeout(settle.current.timer); settle.current.timer = undefined; setCamera(cameraRef.current); }, []);
  const schedule = useCallback(() => {
    const gesture = settle.current, now = performance.now();
    if (gesture.timer === undefined) gesture.since = now;
    window.clearTimeout(gesture.timer);
    if (now - gesture.since >= PREVIEW_COMMIT_MAX_MS) commit(); else gesture.timer = window.setTimeout(commit, PREVIEW_SETTLE_MS);
  }, [commit]);
  const showPreview = useCallback(() => {
    const element = svg.current; if (!element) return;
    const { s, x, y } = previewTransform(shown.current, cameraRef.current);
    element.style.transformOrigin = '0 0'; element.style.willChange = 'transform'; element.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }, []);
  const previewTo = useCallback((next: Camera) => {
    if (!GRAPH_PERF_ZOOM_PREVIEW) { apply(next); return; }
    cameraRef.current = next;
    showPreview();
    // Zooming out shows more than was drawn: whoever was culled and now falls in the view is drawn (in the drawn camera's own coordinates, which the
    // transform carries along), and the SVG lets its content show outside its own box (see the stylesheet), so the new edges are not left empty.
    if (GRAPH_PERF_CULLING && painted.current && !rectHasRect(painted.current, viewRect(cameraRef.current, sizeRef.current, 0))) paint(Math.max(sizeRef.current.width, sizeRef.current.height) * PREVIEW_OVERSCAN);
    schedule();
  }, [apply, showPreview, schedule, paint]);
  // A committed camera is drawn for real: the preview is over, unless the camera has moved on since the commit was asked for.
  useLayoutEffect(() => {
    const element = svg.current; if (!element) return;
    element.style.transform = ''; element.style.willChange = '';
    window.clearTimeout(settle.current.timer); settle.current.timer = undefined;
    if (cameraRef.current !== camera) { showPreview(); schedule(); }
  }, [camera, showPreview, schedule]);
  useEffect(() => () => window.clearTimeout(settle.current.timer), []);

  const zoomBy = useCallback((factor: number, anchor?: Point) => {
    const { width, height } = sizeRef.current, c = cameraRef.current, at = anchor ?? { x: width / 2, y: height / 2 };
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.k * factor)), ratio = k / c.k;
    userMoved.current = true;
    const next = { k, x: at.x - (at.x - c.x) * ratio, y: at.y - (at.y - c.y) * ratio };
    // A gesture has an anchor (the pointer); the buttons zoom around the middle in one step.
    if (anchor) previewTo(next); else apply(next);
  }, [apply, previewTo]);

  // Where the drawing sits on the page (read from the stage around the SVG, which a zoom preview does not transform). Reading it forces a layout whenever the page changed since the last one, and a gesture changes the
  // page every frame (the camera moves), so a pinch or a pan would lay out the whole drawing on each of its events: the reading is kept for as
  // long as events keep coming, and taken again after a pause, a resize or a scroll.
  const origin = useRef<{ left: number; top: number; at: number } | null>(null);
  useEffect(() => {
    const forget = () => { origin.current = null; };
    window.addEventListener('resize', forget); window.addEventListener('scroll', forget, true);
    return () => { window.removeEventListener('resize', forget); window.removeEventListener('scroll', forget, true); };
  }, []);
  const local = (event: { clientX: number; clientY: number }): Point => {
    const now = performance.now();
    let box = origin.current;
    if (!box || now - box.at > ORIGIN_KEPT_MS) { const rect = svg.current!.parentElement!.getBoundingClientRect(); box = { left: rect.left, top: rect.top, at: now }; origin.current = box; }
    box.at = now;
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const toWorld = (event: { clientX: number; clientY: number }): Point => {
    const at = local(event), c = cameraRef.current;
    return { x: (at.x - c.x) / c.k, y: (at.y - c.y) / c.k };
  };

  // The same gestures as the main canvas: a mouse wheel and a trackpad pinch zoom around the pointer,
  // a two-finger trackpad scroll pans.
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const intent = classifyWheel(event);
      if (intent.kind === 'zoom') { zoomBy(intent.factor, local(event)); return; }
      userMoved.current = true;
      const c = cameraRef.current;
      apply({ ...c, x: c.x - intent.dx, y: c.y - intent.dy });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoomBy, apply, classifyWheel]);

  // One finger or mouse pans the background, two fingers pinch; a tap on empty space clears the selection.
  const pointers = useRef(new Map<number, Point>());
  // `fromLine`: the gesture began on a line, which is still a click (select it) unless the pointer moves, and then it pans.
  const pan = useRef<{ camera: Camera; origin: Point; moved: boolean; fromLine?: boolean; pinch?: { distance: number } } | null>(null);
  const onBackgroundDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // People and the "+n" badges take the gesture (a person is dragged). A line takes the click only: lines cover a crowded graph, so a drag that
    // starts on one still has to pan, and the pointer is captured for it only once it has moved (a captured pointer would swallow the click).
    const target = event.target as Element, onLine = !!target.closest('[data-edge]');
    if (target.closest('[data-net-interactive]') && !onLine) return;
    pointers.current.set(event.pointerId, local(event));
    if (!onLine) capture(event.currentTarget, event.pointerId);
    const points = [...pointers.current.values()];
    pan.current = { camera: cameraRef.current, origin: points[0], moved: pan.current?.moved ?? false, fromLine: onLine && points.length === 1,
      pinch: points.length > 1 ? { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) } : undefined };
  };
  const onBackgroundMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = pan.current;
    if (!current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    const points = [...pointers.current.values()];
    if (points.length > 1 && current.pinch) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      zoomBy(distance / current.pinch.distance, { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      current.pinch.distance = distance; current.moved = true;
      return;
    }
    const at = points[0];
    if (!current.moved && Math.hypot(at.x - current.origin.x, at.y - current.origin.y) > DRAG_SLOP) {
      current.moved = true;
      if (current.fromLine) capture(event.currentTarget, event.pointerId);
    }
    if (current.moved) { userMoved.current = true; apply({ ...current.camera, x: current.camera.x + at.x - current.origin.x, y: current.camera.y + at.y - current.origin.y }); }
  };
  const onBackgroundUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const current = pan.current;
    if (!pointers.current.size) {
      if (current && !current.moved && !current.fromLine && event.type === 'pointerup') onSelect({});
      pan.current = null;
    } else if (current) {
      const [remaining] = [...pointers.current.values()];
      pan.current = { camera: cameraRef.current, origin: remaining, moved: true };
    }
  };

  // Dragging a person: neighbours follow, and the drop point is remembered by the layout.
  const drag = useRef<{ id: string; pointerId: number; origin: Point; started: boolean } | null>(null);
  const onNodeDown = (event: React.PointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    drag.current = { id, pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, started: false };
    capture(event.currentTarget, event.pointerId);
  };
  const onNodeMove = (event: React.PointerEvent<SVGGElement>) => {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    if (!current.started) {
      if (Math.hypot(event.clientX - current.origin.x, event.clientY - current.origin.y) <= DRAG_SLOP) return;
      current.started = true; layout.dragStart(current.id);
    }
    const at = toWorld(event);
    layout.dragTo(current.id, at.x, at.y);
    if (reducedMotion) layout.settle(12); else kick();
  };
  const onNodeUp = (event: React.PointerEvent<SVGGElement>, id: string) => {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.stopPropagation();
    if (current.started) { layout.dragEnd(id); if (reducedMotion) layout.settle(60); else kick(); onPinsChange(); }
    else if (event.type === 'pointerup') onSelect({ person: id });
  };
  const releasePin = (id: string) => { if (layout.pinned.has(id)) { layout.unpin(id); kick(); onPinsChange(); } };
  // The person layer is memoized, so it gets handlers that never change and always call the current ones.
  const live = useRef({ onNodeDown, onNodeMove, onNodeUp, releasePin });
  live.current = { onNodeDown, onNodeMove, onNodeUp, releasePin };
  const handlers = useMemo<NodeHandlers>(() => ({
    down: (event, id) => live.current.onNodeDown(event, id), move: event => live.current.onNodeMove(event), up: (event, id) => live.current.onNodeUp(event, id),
    release: id => live.current.releasePin(id), failed: (id, url) => setFailed(previous => previous.get(id) === url ? previous : new Map(previous).set(id, url)),
  }), []);
  const clips = useMemo(() => ({ endpoint: `${uid}-clip-end`, person: `${uid}-clip-person` }), [uid]);

  const successChain = success && view.chain;
  // The chain of a solved connection stays drawn, lime, even with the lines off (only the chain's own lines are kept then, like the lit chain of a search that just succeeded).
  const coloredChain = showChain ? successChain || (solved ? view.chain : null) : null;
  const chainNodes = useMemo(() => coloredChain ? new Set(coloredChain.nodeIds) : null, [coloredChain]);
  const chainEdges = useMemo(() => coloredChain ? new Set(coloredChain.edgeIds) : null, [coloredChain]);
  const [bandA, bandB] = [0, 1].map(index => view.nodes.find(node => node.endpoint === index)?.person);
  const sx = (year: number) => camera.x + layout.xOf(year) * camera.k;
  const allTicks = mode === 'time' ? axisTicks(domain[0], domain[1], layout.pixelsPerYear * camera.k, TICK_MIN_SPACING) : [];
  const ticksForAxis = allTicks.filter(year => sx(year) > -40 && sx(year) < size.width + 40);
  // The lines (and bands) of the time axis are part of the picture a zoom preview scales, so they are drawn well past the view.
  const axisReach = GRAPH_PERF_ZOOM_PREVIEW ? AXIS_PREVIEW_REACH : 0;
  const axisLines = axisReach ? allTicks.filter(year => sx(year) > -size.width * axisReach && sx(year) < size.width * (1 + axisReach)) : ticksForAxis;
  const closest = view.closest;
  // With the lines off, only what the user is looking at or the lit chain (of a search that just succeeded, or a solved connection) keeps its line, so selecting a contact still shows it.
  const drawnEdges = useMemo(() => {
    const chainEdge = (edge: NetworkEdge) => !!chainEdges?.has(edge.id);
    const shownEdges = showLines ? view.edges : view.edges.filter(edge => edge.id === selection.edge || chainEdge(edge));
    // The faded lines go underneath, then the rest, and a colored chain is drawn last, over the crowd: a click where lines cross lands on the
    // one on top, which is the one the reader is looking at (a selected person's lines, not the faded ones behind them).
    return edgeDrawOrder(shownEdges, view.focus, chainEdges);
  }, [view.edges, view.focus, showLines, selection.edge, chainEdges]);
  // The endpoints are drawn last, on top of everybody else, so a crowd never covers them.
  const drawnNodes = useMemo(() => [...view.nodes].sort((x, y) => Number(x.endpoint !== null) - Number(y.endpoint !== null)), [view.nodes]);
  // The lines the search itself draws: from each person whose contacts are asked about toward the far end of the chain (the beams), or between
  // the endpoints while a seed route is asked for (the comet).
  const beams = useMemo<Beam[]>(() => {
    const activity = view.activity; if (!activity || (!extendedAnimations && activity.kind !== 'seed')) return [];
    const ends = [0, 1].map(index => view.nodes.find(node => node.endpoint === index)?.id);
    if (!ends[0] || !ends[1]) return [];
    if (activity.kind === 'seed') return [{ id: 'beam:seed', from: ends[0], to: ends[1], kind: 'seed' }];
    if (activity.kind !== 'discover') return [];
    const present = new Set(view.nodes.map(node => node.id));
    return activity.people.flatMap(({ id, side }): Beam[] => {
      const goal = side === 'a' ? ends[1]! : ends[0]!;
      return side && id !== goal && present.has(id) ? [{ id: `beam:${id}`, from: id, to: goal, kind: side }] : [];
    });
  }, [view.activity, view.nodes, extendedAnimations]);
  // Which end of the chain the search is working outward from right now ('a', 'b', both, or none), for the endpoints' halos to breathe.
  const workingEnds = !extendedAnimations ? '' : view.activity?.kind === 'seed' ? 'ab' : view.activity?.kind === 'discover' ? ['a', 'b'].filter(side => view.activity!.people.some(person => person.side === side)).join('') : '';
  // A line whose contact has just been decided flashes for a moment: accepted lights up, unresolved flickers grey. The class is set on the
  // line itself and removed when the flash ends, so no render of the graph is needed for it.
  const lastStatus = useRef(new Map<string, string>());
  const flashTimers = useRef(new Set<number>());
  useEffect(() => {
    const now = new Map<string, string>(), fresh: Array<[string, string]> = [];
    for (const edge of view.edges) {
      now.set(edge.id, edge.status);
      if (lastStatus.current.get(edge.id) === 'checking' && (edge.status === 'accepted' || edge.status === 'unresolved')) fresh.push([edge.id, `just-${edge.status}`]);
    }
    lastStatus.current = now;
    if (!extendedAnimations || reducedMotion) return;
    for (const [id, flash] of fresh) {
      const el = edgeEls.current.get(id)?.el; if (!el) continue;
      el.classList.add(flash);
      const timer = window.setTimeout(() => { flashTimers.current.delete(timer); el.classList.remove(flash); }, DECIDED_FLASH_MS);
      flashTimers.current.add(timer);
    }
  }, [view.edges, reducedMotion, extendedAnimations]);
  useEffect(() => () => { for (const timer of flashTimers.current) window.clearTimeout(timer); }, []);
  const pinnedCount = pinned.size;
  const farRef = useRef(false);
  const far = GRAPH_PERF_LEVEL_OF_DETAIL && drawnNodes.length >= LOD_MIN_PEOPLE && isFarZoom(camera.k, farRef.current);
  farRef.current = far;
  const clustered = mode === 'cluster', columnar = mode === 'columns', podded = mode === 'category', corridored = mode === 'corridor';
  // Choosing an arrangement also frames the whole picture, which is about to move; the timeline and the free layout keep the camera.
  const chooseLayout = (next: LayoutMode) => { onModeChange(next); if (next !== 'time' && next !== 'free') fit(); };
  const closestVisible = showLines && closest && layout.nodes.has(closest.a) && layout.nodes.has(closest.b) && view.nodes.some(n => n.id === closest.a) && view.nodes.some(n => n.id === closest.b);

  // Finds the drawn people and lines again after their layers render, then paints them at once: a person who just appeared stands at
  // their place (or out of sight until the layout has one) before the browser shows them.
  useLayoutEffect(() => {
    const root = svg.current; if (!root) return;
    const nodes = new Map<string, Drawn>();
    for (const el of root.querySelectorAll<SVGGElement>('g[data-node]')) {
      const known = nodeEls.current.get(el.dataset.node!);
      nodes.set(el.dataset.node!, known?.el === el ? known : { el, key: '', visible: true });
    }
    const edges = new Map<string, Drawn & { from: string; to: string; paths: SVGPathElement[] }>();
    for (const el of root.querySelectorAll<SVGGElement>('g[data-edge]')) {
      const known = edgeEls.current.get(el.dataset.edge!);
      edges.set(el.dataset.edge!, known?.el === el ? known : { from: el.dataset.from!, to: el.dataset.to!, el, paths: [...el.querySelectorAll('path')], key: '', visible: true });
    }
    nodeEls.current = nodes; edgeEls.current = edges;
    paint();
  }, [drawnNodes, drawnEdges, beams, rings, columns, corridor, closestVisible, mode, paint]);

  // With a solved connection's lines on, every other line steps back (see the stylesheet) so the lime chain stands out.
  return <div className={['net-graph', success && 'is-success', extendedAnimations && 'is-extended', solved && showChain && showLines && view.chain && 'is-solved', drawnNodes.length + drawnEdges.length >= LARGE_DRAWING && 'is-large', far && 'is-far', far && GRAPH_PERF_HIDE_PORTRAITS && 'is-far-portraits'].filter(Boolean).join(' ')}>
    <div className="net-stage">
    <svg ref={svg} className="net-svg" role="group" aria-label="Live contact graph"
      onPointerDown={onBackgroundDown} onPointerMove={onBackgroundMove} onPointerUp={onBackgroundUp} onPointerCancel={onBackgroundUp}>
      {/* Portraits share two round clips (endpoints are bigger), in each person's own coordinates. */}
      <defs>
        <clipPath id={clips.endpoint}><circle r={nodeRadius(true, narrow)} /></clipPath>
        <clipPath id={clips.person}><circle r={nodeRadius(false, narrow)} /></clipPath>
      </defs>
      {mode === 'time' && <g className="net-axis" aria-hidden="true">
        {[bandA, bandB].map((person, index) => person && <rect key={index} className={index === 0 ? 'net-band-a' : 'net-band-b'}
          x={sx(person.birthYear)} width={Math.max(2, (person.deathYear - person.birthYear) * layout.pixelsPerYear * camera.k)} y={-size.height * axisReach} height={size.height * (1 + 2 * axisReach)} />)}
        {axisLines.map(year => <line key={year} x1={sx(year)} x2={sx(year)} y1={-size.height * axisReach} y2={size.height * (1 + axisReach)} />)}
      </g>}
      <g className="net-content" transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
        {clustered && <g className="net-orbits" aria-hidden="true">
          {rings.map(ring => <g key={`${ring.anchor}-${ring.hops}`} className={`net-orbit is-side-${ring.side}`}
            ref={el => { const key = `${ring.anchor}-${ring.hops}`; if (el) ringEls.current.set(key, { anchor: ring.anchor, el }); else ringEls.current.delete(key); }}>
            <circle r={ring.radius} />
            {/* The labels of the two endpoints' rings meet between them and used to print over each other: A's stand above the line through the endpoints, B's below it. */}
            <text x={(ring.side === 'a' ? 1 : -1) * (ring.radius + 6)} y={ring.side === 'a' ? -5 : 15} textAnchor={ring.side === 'a' ? 'start' : 'end'}>{ring.hops} {ring.hops === 1 ? 'link' : 'links'}</text>
          </g>)}
        </g>}
        {columnar && <g className="net-columns" aria-hidden="true">
          {columns.map(guide => {
            const key = `col-${guide.anchor}-${guide.hops}`, label = columnLabel(guide, columns, camera.k);
            return <g key={key} className={`net-column is-side-${guide.side}`} ref={el => { if (el) ringEls.current.set(key, { anchor: guide.anchor, el }); else ringEls.current.delete(key); }}>
              <rect x={guide.dx - guide.half} y={guide.top} width={guide.half * 2} height={guide.bottom - guide.top} rx={14} />
              {label && <text x={guide.dx} y={guide.top - 8 / camera.k} textAnchor="middle" style={{ fontSize: 12 / camera.k, strokeWidth: 3 / camera.k }}>{label}</text>}
            </g>;
          })}
        </g>}
        {podded && <g className="net-pods" aria-hidden="true">
          {categories.map(guide => {
            // The title keeps a readable size on screen, up to the height of the pod's header, and never wider than the pod (zoomed out
            // it would otherwise grow past the pod's edge into the next one).
            const title = podTitle(guide.category, guide.count);
            const size = Math.min(POD_TITLE_MAX_SIZE, Math.max(14, 15 / camera.k), podTitleSize(title, guide.width));
            return <g key={guide.category} className="net-pod" style={{ '--cat': (CATEGORY_COLORS as Record<string, string>)[guide.category] ?? 'rgb(var(--color-content-muted))' } as React.CSSProperties}>
              <rect x={guide.x} y={guide.y} width={guide.width} height={guide.height} rx={20} />
              <circle cx={guide.x + 18 + size * 0.32} cy={guide.y + Math.min(46, 14 + size) - size * 0.33} r={size * 0.32} />
              <text x={guide.x + 18 + size * 0.95} y={guide.y + Math.min(46, 14 + size)} style={{ fontSize: size, strokeWidth: size / 5 }}>{title}</text>
            </g>;
          })}
        </g>}
        {corridored && corridor && <g className="net-corridor" aria-hidden="true" ref={el => { corridorEl.current = el; }} data-a={corridor.from} data-b={corridor.to}><path /></g>}
        <BeamLayer beams={beams} />
        <EdgeLayer edges={drawnEdges} selection={selection} focus={view.focus} chainEdges={chainEdges} nameOf={nameOf} onSelect={onSelect} />
        {closestVisible && <g className="net-gap" ref={el => { gapEl.current = el; }} data-a={closest.a} data-b={closest.b}>
          <title>{closestApproachLabel(closest, nameOf)}</title>
          <path className="net-gap-line" /><path className="net-gap-hit" />
        </g>}
        <NodeLayer nodes={drawnNodes} folds={view.folds} selection={selection} focus={view.focus} chainNodes={chainNodes} workingEnds={workingEnds} narrow={narrow} portraits={portraits}
          failed={failed} pinned={pinned} endpointNames={endpointNames} clips={clips} handlers={handlers} onSelect={onSelect} onToggleFold={onToggleFold} />
      </g>
    </svg>
    {mode === 'time' && ['top', 'bottom'].map(edge => <div key={edge} className={`net-strip is-${edge}`} aria-hidden="true">
      {ticksForAxis.map(year => <span key={year} className="net-tick" style={{ left: sx(year) }}>{formatYear(year)}</span>)}
    </div>)}
    {onToggleMaximize && !maximized && <div className="net-maximize">
      <ToolButton tip="Maximize the graph to the whole screen" label="Maximize the graph" onClick={onToggleMaximize}>
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </ToolButton>
    </div>}
    <div className="net-overlay-row">
      <div data-net-controls className="canvas-view-toolbar net-view-toolbar" role="toolbar" aria-label="Network view controls">
        <LayoutMenu mode={mode} onSelect={chooseLayout} host={menuHost} />
        <ToolButton tip={pinnedCount ? `Unpin all ${pinnedCount} pinned ${pinnedCount === 1 ? 'person' : 'people'}` : 'Nobody is pinned'} label="Unpin all people" disabled={!pinnedCount}
          onClick={() => { layout.unpinAll(); kick(); onPinsChange(); }}>
          <path d="M12 17v5" /><path d="M15 9.3V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.9" /><path d="m2 2 20 20" />
          <path d="M9 9v1.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h11" />
        </ToolButton>
        <span className="canvas-toolbar-divider" aria-hidden="true" />
        <ToolButton tip={showLines ? 'Hide connection lines' : 'Show connection lines'} label="Hide connection lines" pressed={!showLines} onClick={() => setShowLines(on => !on)}>
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
          {!showLines && <path d="m2 2 20 20" />}
        </ToolButton>
        <ToolButton tip="Zoom in" label="Zoom network in" onClick={() => zoomBy(1.25)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.8v5.4M7.8 10.5h5.4" /></ToolButton>
        <ToolButton tip="Zoom out" label="Zoom network out" onClick={() => zoomBy(0.8)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.8 10.5h5.4" /></ToolButton>
        <ToolButton tip="Fit the whole network" label="Fit network" onClick={fit}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="9" y="9" width="6" height="6" rx="1" /></ToolButton>
        {onOpenLayoutInfo && <ToolButton tip={layoutInfoLabel(mode)} label={layoutInfoLabel(mode)} haspopup onClick={onOpenLayoutInfo}>
          <path d="M9.2 9.2a2.9 2.9 0 1 1 4.1 2.6c-.9.5-1.3 1.1-1.3 2" /><path d="M12 18.5h.01" />
        </ToolButton>}
      </div>
      {legend}
    </div>
    <div className="net-menu-host" ref={setMenuHost} />
    </div>
    {!success && !resume && <ActivityCaption activity={view.activity} nameOf={nameOf} belowStrip={mode === 'time'} onWidth={onCaptionWidth} />}
    {success && <div className="net-success-wrap">
      <button type="button" className="net-reveal" onClick={onReveal} autoFocus>Reveal</button>
    </div>}
    {resume && !success && <div className="net-resume-wrap">
      <div className="net-resume" role="status">Search paused<small>{resume.reason === 'time'
        ? 'The time limit for this round was reached. The network so far is kept: carry on to explore further from here.'
        : 'This round reached its work limit. The network so far is kept: carry on to explore further from here.'}</small></div>
      <button type="button" className="net-continue" onClick={resume.onResume}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>Continue searching
      </button>
    </div>}
  </div>;
};
export default memo(NetworkGraph);
