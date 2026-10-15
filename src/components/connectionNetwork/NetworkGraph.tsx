import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CATEGORY_BAR_TEXT_COLORS, CATEGORY_COLORS } from '../../constants';
import { readNetworkViewPrefs, saveNetworkViewPrefs } from '../../utils/networkViewPrefs';
import { axisTicks, type CategoryGuide, type ColumnGuide, type CorridorGuide, type LayoutMode, type NetworkLayout, type OrbitRing } from '../../services/connectionNetworkLayout';
import {
  closestApproachLabel, describeSide, initials, STATUS_LABELS, truncateName, type NetworkNode, type NetworkSelection, type NetworkView,
} from '../../services/connectionNetworkView';
import { formatYear } from '../../utils/formatters';
import { createWheelClassifier } from '../../utils/wheelGesture';
import Tooltip from '../Tooltip';
import { fitCamera as fitPoints, type Camera, type CameraPoint } from './camera';
import LayoutMenu from './LayoutMenu';
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
  layout: NetworkLayout;
  kick: () => void;
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
  onReveal: () => void;
  // Set when the search stopped on its own limit and can be carried on from where it is.
  resume?: { onResume: () => void; reason: 'time' | 'work' } | null;
  reveal: RevealRequest | null;
  onPinsChange: () => void;
  onToggleFold: (hostId: string) => void;
  legend: React.ReactNode;
  // Whether the graph has the whole body to itself, and the way to toggle that (absent when there is no side panel to hide).
  maximized: boolean;
  onToggleMaximize?: () => void;
}

const sideClass = (node: NetworkNode) => node.endpoint !== null ? `is-endpoint is-end-${node.endpoint === 0 ? 'a' : 'b'}` : `is-side-${node.side}`;
// Endpoint names are shown whole, on a pill, so they stay readable among a crowd.
const ENDPOINT_NAME_LIMIT = 28;
const pillWidth = (text: string) => text.length * 7.6 + 20;
// 'LEADERS & BADDIES' -> 'Leaders & Baddies'
const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
// Column headers are drawn at a constant size on screen, so when zoomed out they share the room of the narrowest band: all of them
// say "n links" while that fits, then just the number, then only every fifth.
const columnLabel = (guide: ColumnGuide, guides: readonly ColumnGuide[], zoom: number) => {
  const room = Math.min(...guides.map(item => item.half * 2 + 40)) * zoom;
  if (room >= 64) return `${guide.hops} ${guide.hops === 1 ? 'link' : 'links'}`;
  return room >= 18 || guide.hops % 5 === 0 ? String(guide.hops) : '';
};

// One icon button of the view controls. A state is shown with `pressed`, an action with just its label.
const ToolButton: React.FC<{ tip: string; label?: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }> = ({ tip, label, pressed, disabled, onClick, children }) =>
  <Tooltip text={tip}><button type="button" className="canvas-floating-button" aria-label={label ?? tip} aria-pressed={pressed} disabled={disabled}
    onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onClick(); }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  </button></Tooltip>;
// Keeps receiving a drag that leaves the element; a pointer that is already gone is not an error.
const capture = (element: Element, pointerId: number) => { try { element.setPointerCapture(pointerId); } catch { /* released */ } };
const activate = (action: () => void) => (event: React.KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); }
};

// The drawing: an SVG whose structure React renders and whose positions the layout paints directly,
// so the simulation never re-renders the explorer. The camera is a transform over screen-sized content.
const NetworkGraph: React.FC<Props> = ({
  view, endpointNames, nameOf, layout, kick, mode, onModeChange, size, onSize, selection, onSelect, portraits, narrow, reducedMotion,
  success, onReveal, resume = null, reveal, onPinsChange, onToggleFold, legend, maximized, onToggleMaximize,
}) => {
  const uid = useId().replace(/:/g, '');
  const svg = useRef<SVGSVGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, { from: string; to: string; el: SVGGElement }>());
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
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const userMoved = useRef(false);
  // Following the graph normally keeps a readable zoom; "Fit network" asks for everything at once.
  const followAll = useRef(false);
  // While the winning chain is lit, the camera frames it, whatever else is on screen.
  const litChain = useRef<ReadonlySet<string> | null>(null);
  const classifyWheel = useRef(createWheelClassifier()).current;
  const [failed, setFailed] = useState(() => new Set<string>());
  const [domain, setDomain] = useState(layout.yearDomain);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  const apply = useCallback((next: Camera) => { cameraRef.current = next; setCamera(next); }, []);

  const paint = useCallback(() => {
    for (const [id, el] of nodeEls.current) {
      const at = layout.position(id);
      if (at) el.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    }
    for (const { from, to, el } of edgeEls.current.values()) {
      const a = layout.position(from), b = layout.position(to);
      if (!a || !b) continue;
      for (const line of el.querySelectorAll('line')) {
        line.setAttribute('x1', a.x.toFixed(1)); line.setAttribute('y1', a.y.toFixed(1));
        line.setAttribute('x2', b.x.toFixed(1)); line.setAttribute('y2', b.y.toFixed(1));
      }
    }
    for (const { anchor, el } of ringEls.current.values()) {
      const at = layout.position(anchor);
      if (at) el.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    }
    const band = corridorEl.current;
    if (band) {
      const a = layout.position(band.dataset.a ?? ''), b = layout.position(band.dataset.b ?? '');
      if (a && b) for (const line of band.querySelectorAll('line')) {
        line.setAttribute('x1', a.x.toFixed(1)); line.setAttribute('y1', a.y.toFixed(1));
        line.setAttribute('x2', b.x.toFixed(1)); line.setAttribute('y2', b.y.toFixed(1));
      }
    }
    const closest = gapEl.current;
    if (closest) {
      const a = layout.position(closest.dataset.a ?? ''), b = layout.position(closest.dataset.b ?? '');
      if (a && b) for (const line of closest.querySelectorAll('line')) {
        line.setAttribute('x1', a.x.toFixed(1)); line.setAttribute('y1', a.y.toFixed(1));
        line.setAttribute('x2', b.x.toFixed(1)); line.setAttribute('y2', b.y.toFixed(1));
      }
    }
  }, [layout]);

  // `only` frames just those people (the lit chain); otherwise everybody, at a readable zoom unless asked for it all.
  const fitCamera = useCallback((everything: boolean, only?: ReadonlySet<string>): Camera | null => {
    const points: CameraPoint[] = [];
    for (const [id, node] of layout.nodes) {
      const at = layout.position(id);
      if (at && (!only || only.has(id))) points.push({ ...at, r: node.radius + 22, endpoint: node.endpoint !== null });
    }
    const result = fitPoints(points, sizeRef.current, {
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
    apply({ k, x: width / 2 - x * k, y: height / 2 - y * k });
  }, [apply]);

  const visibleOnScreen = useCallback((at: Point) => {
    const { width, height } = sizeRef.current, { x, y, k } = cameraRef.current;
    const sx = at.x * k + x, sy = at.y * k + y;
    return sx > 20 && sx < width - 20 && sy > STRIP_HEIGHT + 8 && sy < height - STRIP_HEIGHT - 8;
  }, []);

  // Positions painted by the layout, plus follow-the-graph camera until the user takes over.
  const ticks = useRef(0);
  useEffect(() => { setRings(layout.rings); setColumns(layout.columns); setCategories(layout.categories); setCorridor(layout.corridor); return layout.subscribe(() => {
    paint();
    setRings(layout.rings);
    setColumns(layout.columns);
    setCategories(layout.categories);
    setCorridor(layout.corridor);
    const current = layout.yearDomain;
    setDomain(previous => previous[0] === current[0] && previous[1] === current[1] ? previous : current);
    if (!userMoved.current && (ticks.current++ % 3 === 0 || !layout.active)) { const next = fitCamera(followAll.current, litChain.current ?? undefined); if (next) apply(next); }
  }); }, [layout, paint, fitCamera, apply]);
  useLayoutEffect(() => { paint(); });

  // Measure the available area. Layout and drawing work in real screen pixels.
  useLayoutEffect(() => {
    const element = svg.current; if (!element) return;
    const measure = () => { const box = element.getBoundingClientRect(); if (box.width > 0 && box.height > 0) onSize(Math.round(box.width), Math.round(box.height)); };
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

  const zoomBy = useCallback((factor: number, anchor?: Point) => {
    const { width, height } = sizeRef.current, c = cameraRef.current, at = anchor ?? { x: width / 2, y: height / 2 };
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.k * factor)), ratio = k / c.k;
    userMoved.current = true;
    apply({ k, x: at.x - (at.x - c.x) * ratio, y: at.y - (at.y - c.y) * ratio });
  }, [apply]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const box = svg.current!.getBoundingClientRect();
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
  const pan = useRef<{ camera: Camera; origin: Point; moved: boolean; pinch?: { distance: number } } | null>(null);
  const onBackgroundDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-net-interactive]')) return;
    pointers.current.set(event.pointerId, local(event));
    capture(event.currentTarget, event.pointerId);
    const points = [...pointers.current.values()];
    pan.current = { camera: cameraRef.current, origin: points[0], moved: pan.current?.moved ?? false,
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
    if (Math.hypot(at.x - current.origin.x, at.y - current.origin.y) > DRAG_SLOP) current.moved = true;
    if (current.moved) { userMoved.current = true; apply({ ...current.camera, x: current.camera.x + at.x - current.origin.x, y: current.camera.y + at.y - current.origin.y }); }
  };
  const onBackgroundUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const current = pan.current;
    if (!pointers.current.size) {
      if (current && !current.moved && event.type === 'pointerup') onSelect({});
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

  const successChain = success && view.chain;
  const dimmed = (nodeId?: string, edgeKey?: string) => !!view.focus && (nodeId ? !view.focus.nodes.has(nodeId) : !view.focus.edges.has(edgeKey!));
  const [bandA, bandB] = [0, 1].map(index => view.nodes.find(node => node.endpoint === index)?.person);
  const sx = (year: number) => camera.x + layout.xOf(year) * camera.k;
  const ticksForAxis = mode === 'time'
    ? axisTicks(domain[0], domain[1], layout.pixelsPerYear * camera.k).filter(year => sx(year) > -40 && sx(year) < size.width + 40) : [];
  const closest = view.closest;
  // With the lines off, only what the user is looking at or the lit chain keeps its line, so selecting a contact still shows it.
  const drawnEdges = showLines ? view.edges : view.edges.filter(edge => edge.id === selection.edge || (successChain && view.chain!.edgeIds.includes(edge.id)));
  // The endpoints are drawn last, on top of everybody else, so a crowd never covers them.
  const drawnNodes = [...view.nodes].sort((x, y) => Number(x.endpoint !== null) - Number(y.endpoint !== null));
  const pinnedCount = layout.pinned.size;
  const clustered = mode === 'cluster', columnar = mode === 'columns', podded = mode === 'category', corridored = mode === 'corridor';
  // Choosing an arrangement also frames the whole picture, which is about to move; the timeline and the free layout keep the camera.
  const chooseLayout = (next: LayoutMode) => { onModeChange(next); if (next !== 'time' && next !== 'free') fit(); };
  const closestVisible = showLines && closest && layout.nodes.has(closest.a) && layout.nodes.has(closest.b) && view.nodes.some(n => n.id === closest.a) && view.nodes.some(n => n.id === closest.b);

  return <div className={`net-graph ${success ? 'is-success' : ''}`}>
    <div className="net-stage">
    <svg ref={svg} className="net-svg" role="group" aria-label="Live contact graph"
      onPointerDown={onBackgroundDown} onPointerMove={onBackgroundMove} onPointerUp={onBackgroundUp} onPointerCancel={onBackgroundUp}>
      {mode === 'time' && <g className="net-axis" aria-hidden="true">
        {[bandA, bandB].map((person, index) => person && <rect key={index} className={index === 0 ? 'net-band-a' : 'net-band-b'}
          x={sx(person.birthYear)} width={Math.max(2, (person.deathYear - person.birthYear) * layout.pixelsPerYear * camera.k)} y={0} height={size.height} />)}
        {ticksForAxis.map(year => <line key={year} x1={sx(year)} x2={sx(year)} y1={0} y2={size.height} />)}
      </g>}
      <g className="net-content" transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
        {clustered && <g className="net-orbits" aria-hidden="true">
          {rings.map(ring => <g key={`${ring.anchor}-${ring.hops}`} className={`net-orbit is-side-${ring.side}`}
            ref={el => { const key = `${ring.anchor}-${ring.hops}`; if (el) ringEls.current.set(key, { anchor: ring.anchor, el }); else ringEls.current.delete(key); }}>
            <circle r={ring.radius} />
            <text x={(ring.side === 'a' ? 1 : -1) * (ring.radius + 6)} y={-5} textAnchor={ring.side === 'a' ? 'start' : 'end'}>{ring.hops} {ring.hops === 1 ? 'link' : 'links'}</text>
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
            // The title keeps a readable size on screen, up to the height of the pod's header.
            const size = Math.min(34, Math.max(14, 15 / camera.k));
            return <g key={guide.category} className="net-pod" style={{ '--cat': (CATEGORY_COLORS as Record<string, string>)[guide.category] ?? 'rgb(var(--color-content-muted))' } as React.CSSProperties}>
              <rect x={guide.x} y={guide.y} width={guide.width} height={guide.height} rx={20} />
              <circle cx={guide.x + 18 + size * 0.32} cy={guide.y + Math.min(46, 14 + size) - size * 0.33} r={size * 0.32} />
              <text x={guide.x + 18 + size * 0.95} y={guide.y + Math.min(46, 14 + size)} style={{ fontSize: size, strokeWidth: size / 5 }}>{titleCase(guide.category)} · {guide.count}</text>
            </g>;
          })}
        </g>}
        {corridored && corridor && <g className="net-corridor" aria-hidden="true" ref={el => { corridorEl.current = el; }} data-a={corridor.from} data-b={corridor.to}><line /></g>}
        {drawnEdges.map(edge => {
          const label = `${nameOf(edge.from)} and ${nameOf(edge.to)}: ${STATUS_LABELS[edge.status]}`;
          const select = () => onSelect({ edge: edge.id });
          return <g key={edge.id} data-net-interactive ref={el => { if (el) edgeEls.current.set(edge.id, { from: edge.from, to: edge.to, el }); else edgeEls.current.delete(edge.id); }}
            role="button" tabIndex={0} aria-label={label} aria-pressed={selection.edge === edge.id}
            className={`net-edge is-${edge.status} ${edge.contextual ? 'is-contextual' : ''} ${selection.edge === edge.id ? 'is-selected' : ''} ${selection.person && (edge.from === selection.person || edge.to === selection.person) ? 'is-incident' : ''} ${dimmed(undefined, edge.id) ? 'is-dim' : ''} ${successChain && view.chain!.edgeIds.includes(edge.id) ? 'is-chain' : ''}`}
            onClick={select} onKeyDown={activate(select)}>
            <title>{label}</title>
            <line className="net-edge-halo" /><line className="net-edge-line" /><line className="net-edge-hit" />
          </g>;
        })}
        {closestVisible && <g className="net-gap" ref={el => { gapEl.current = el; }} data-a={closest.a} data-b={closest.b}>
          <title>{closestApproachLabel(closest, nameOf)}</title>
          <line className="net-gap-line" /><line className="net-gap-hit" />
        </g>}
        {drawnNodes.map((node, index) => {
          const isEndpoint = node.endpoint !== null;
          const r = nodeRadius(isEndpoint, narrow), url = node.supported && !failed.has(node.id) ? portraits.get(node.id) : undefined;
          const fold = view.folds.find(item => item.hostId === node.id);
          const selected = selection.person === node.id, onEdge = !!selection.edge && !!view.focus?.nodes.has(node.id);
          const name = node.person.name;
          const label = `${name}, ${describeSide(node, endpointNames)}${layout.pinned.has(node.id) ? ', pinned' : ''}`;
          const select = () => onSelect({ person: node.id });
          const clip = `${uid}-clip-${index}`;
          const shownName = isEndpoint ? truncateName(name, ENDPOINT_NAME_LIMIT) : truncateName(name, labelLimit(narrow));
          return <g key={node.id} data-net-interactive ref={el => { if (el) nodeEls.current.set(node.id, el); else nodeEls.current.delete(node.id); }}
            role="button" tabIndex={0} aria-label={label} aria-pressed={selected}
            className={`net-node ${sideClass(node)} ${node.supported ? 'is-supported' : 'is-tentative'} ${selected ? 'is-selected' : ''} ${onEdge ? 'is-edge-end' : ''} ${dimmed(node.id) ? 'is-dim' : ''} ${successChain && view.chain!.nodeIds.includes(node.id) ? 'is-chain' : ''} ${node.active ? 'is-active' : ''}`}
            onPointerDown={event => onNodeDown(event, node.id)} onPointerMove={onNodeMove} onPointerUp={event => onNodeUp(event, node.id)} onPointerCancel={event => onNodeUp(event, node.id)}
            onDoubleClick={() => { if (layout.pinned.has(node.id)) { layout.unpin(node.id); kick(); onPinsChange(); } }} onKeyDown={activate(select)}>
            <title>{`${name} (${node.person.birthYear}–${node.person.deathYear})`}</title>
            <g className="net-node-body">
              {isEndpoint && <g className="net-beacon" aria-hidden="true"><circle className="net-halo" r={r + 28} /><circle className="net-halo-ring" r={r + 14} /></g>}
              {node.active && <circle className="net-pulse" r={r + 9} />}
              <circle className="net-select-ring" r={r + 8} />
              <circle className="net-ring" r={r + 3} />
              <clipPath id={clip}><circle r={r} /></clipPath>
              <circle className="net-disc" r={r} fill={CATEGORY_COLORS[node.person.category]} />
              {url
                ? <image href={url} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" onError={() => setFailed(previous => new Set(previous).add(node.id))} />
                : <text className="net-initials" textAnchor="middle" dy="0.35em" style={{ fontSize: r * 0.8, fill: CATEGORY_BAR_TEXT_COLORS[node.person.category] }}>{initials(name)}</text>}
              {node.endpoint !== null && <g className="net-badge-ab"><circle cx={r * 0.78} cy={-r * 0.78} r={r * 0.4} /><text x={r * 0.78} y={-r * 0.78} textAnchor="middle" dy="0.35em">{node.endpoint === 0 ? 'A' : 'B'}</text></g>}
              {layout.pinned.has(node.id) && <g className="net-pin"><title>Pinned · double-click to release</title><circle cx={-r * 0.78} cy={-r * 0.78} r={6} /><path d={`M ${-r * 0.78 - 2.5} ${-r * 0.78 + 2.5} L ${-r * 0.78 + 2.5} ${-r * 0.78 - 2.5}`} /></g>}
            </g>
            {isEndpoint && <rect className="net-pill" x={-pillWidth(shownName) / 2} y={r + 5} width={pillWidth(shownName)} height={22} rx={11} />}
            <text className="net-name" textAnchor="middle" y={isEndpoint ? r + 20.5 : r + 15}>{shownName}</text>
            {fold && <g data-net-interactive role="button" tabIndex={0} className="net-fold" aria-label={fold.expanded ? `Hide ${fold.ids.length} more ${fold.ids.length === 1 ? 'contact' : 'contacts'} of ${name}` : `Show ${fold.ids.length} more ${fold.ids.length === 1 ? 'contact' : 'contacts'} of ${name}`}
              transform={`translate(${r * 0.8} ${r * 0.8})`} onPointerDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); onToggleFold(node.id); }} onKeyDown={activate(() => onToggleFold(node.id))}>
              <rect x={-14} y={-9} width={28} height={18} rx={9} /><text textAnchor="middle" dy="0.35em">{fold.expanded ? '−' : '+'}{fold.ids.length}</text>
            </g>}
          </g>;
        })}
      </g>
    </svg>
    {mode === 'time' && ['top', 'bottom'].map(edge => <div key={edge} className={`net-strip is-${edge}`} aria-hidden="true">
      {ticksForAxis.map(year => <span key={year} className="net-tick" style={{ left: sx(year) }}>{formatYear(year)}</span>)}
    </div>)}
    {onToggleMaximize && <div className="net-maximize">
      <ToolButton tip={maximized ? 'Show the side panel again' : 'Maximize the graph (hides the side panel)'} label={maximized ? 'Restore the side panel' : 'Maximize the graph'} onClick={onToggleMaximize}>
        {maximized ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
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
          <circle cx="5.5" cy="12" r="2.6" /><circle cx="18.5" cy="12" r="2.6" /><path d="M8.1 12h7.8" />
          {!showLines && <path d="M4 20 20 4" />}
        </ToolButton>
        <ToolButton tip="Zoom in" label="Zoom network in" onClick={() => zoomBy(1.25)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.8v5.4M7.8 10.5h5.4" /></ToolButton>
        <ToolButton tip="Zoom out" label="Zoom network out" onClick={() => zoomBy(0.8)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.8 10.5h5.4" /></ToolButton>
        <ToolButton tip="Fit the whole network" label="Fit network" onClick={fit}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="9" y="9" width="6" height="6" rx="1" /></ToolButton>
      </div>
      {legend}
    </div>
    <div className="net-menu-host" ref={setMenuHost} />
    </div>
    {success && <div className="net-success-wrap">
      <div className="net-success" role="status">Connected · {success.degrees} {success.degrees === 1 ? 'degree' : 'degrees'}<small>Look the chain over, then press Reveal to play it</small></div>
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
export default NetworkGraph;
