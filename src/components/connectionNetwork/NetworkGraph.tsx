import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CATEGORY_BAR_TEXT_COLORS, CATEGORY_COLORS } from '../../constants';
import { axisTicks, type LayoutMode, type NetworkLayout } from '../../services/connectionNetworkLayout';
import {
  closestApproachLabel, describeSide, initials, STATUS_LABELS, truncateName, type NetworkNode, type NetworkSelection, type NetworkView,
} from '../../services/connectionNetworkView';
import { formatYear } from '../../utils/formatters';
import { createWheelClassifier } from '../../utils/wheelGesture';
import Tooltip from '../Tooltip';
import { fitCamera as fitPoints, type Camera, type CameraPoint } from './camera';
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
  reveal: RevealRequest | null;
  onPinsChange: () => void;
  onToggleFold: (hostId: string) => void;
  legend: React.ReactNode;
}

const sideClass = (node: NetworkNode) => node.endpoint !== null ? 'is-endpoint' : `is-side-${node.side}`;
// Keeps receiving a drag that leaves the element; a pointer that is already gone is not an error.
const capture = (element: Element, pointerId: number) => { try { element.setPointerCapture(pointerId); } catch { /* released */ } };
const activate = (action: () => void) => (event: React.KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); }
};

// The drawing: an SVG whose structure React renders and whose positions the layout paints directly,
// so the simulation never re-renders the explorer. The camera is a transform over screen-sized content.
const NetworkGraph: React.FC<Props> = ({
  view, endpointNames, nameOf, layout, kick, mode, onModeChange, size, onSize, selection, onSelect, portraits, narrow, reducedMotion,
  success, reveal, onPinsChange, onToggleFold, legend,
}) => {
  const uid = useId().replace(/:/g, '');
  const svg = useRef<SVGSVGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, { from: string; to: string; el: SVGGElement }>());
  const gapEl = useRef<SVGGElement | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const userMoved = useRef(false);
  // Following the graph normally keeps a readable zoom; "Fit network" asks for everything at once.
  const followAll = useRef(false);
  // False while the camera follows at a readable zoom and part of the network is out of view.
  const followsWhole = useRef(true);
  // While the winning chain is lit, the camera frames it, whatever else is on screen.
  const litChain = useRef<ReadonlySet<string> | null>(null);
  const classifyWheel = useRef(createWheelClassifier()).current;
  const [outside, setOutside] = useState(false);
  const [failed, setFailed] = useState(() => new Set<string>());
  const [domain, setDomain] = useState(layout.yearDomain);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const known = useRef(new Set<string>());

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
    if (!only) followsWhole.current = result?.whole ?? true;
    return result?.camera ?? null;
  }, [layout]);

  const fit = useCallback(() => {
    userMoved.current = false; followAll.current = true; setOutside(false);
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
  useEffect(() => layout.subscribe(() => {
    paint();
    const current = layout.yearDomain;
    setDomain(previous => previous[0] === current[0] && previous[1] === current[1] ? previous : current);
    if (!userMoved.current && (ticks.current++ % 3 === 0 || !layout.active)) { const next = fitCamera(followAll.current, litChain.current ?? undefined); if (next) apply(next); }
  }), [layout, paint, fitCamera, apply]);
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

  // New people outside the view after the user has panned or zoomed: say so instead of moving the camera.
  const idsKey = view.nodes.map(node => node.id).join('|');
  useEffect(() => {
    const fresh = view.nodes.filter(node => !known.current.has(node.id)).map(node => node.id);
    known.current = new Set(view.nodes.map(node => node.id));
    // Following the whole network, new people are always on screen; otherwise they may land out of view.
    if (!fresh.length || (!userMoved.current && followsWhole.current)) return;
    const timer = setTimeout(() => {
      if (fresh.some(id => { const at = layout.position(id); return at && !visibleOnScreen(at); })) setOutside(true);
    }, reducedMotion ? 0 : 700);
    return () => clearTimeout(timer);
  }, [idsKey]);

  // The inspector asked to look at something; pan there only when it is off-screen.
  useEffect(() => {
    if (!reveal) return;
    const ids = reveal.edge ? view.edges.filter(edge => edge.id === reveal.edge).flatMap(edge => [edge.from, edge.to]) : reveal.person ? [reveal.person] : [];
    const points = ids.flatMap(id => layout.position(id) ?? []);
    if (!points.length || points.every(visibleOnScreen)) return;
    centerOn(points.reduce((sum, p) => sum + p.x, 0) / points.length, points.reduce((sum, p) => sum + p.y, 0) / points.length);
  }, [reveal?.n]);

  // The chain lights up for a moment before the overlay closes: bring it into view even when the camera
  // sits on the middle of a wider network or the user had panned away, and keep it framed while it settles.
  const chainKey = success && view.chain ? JSON.stringify(view.chain.nodeIds) : '';
  useEffect(() => {
    if (!chainKey) { litChain.current = null; return; }
    litChain.current = new Set<string>(JSON.parse(chainKey));
    userMoved.current = false; setOutside(false);
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
  const freeLabel = mode === 'time' ? 'Switch to free layout' : 'Switch to year-based timeline';
  const closest = view.closest;
  const closestVisible = closest && layout.nodes.has(closest.a) && layout.nodes.has(closest.b) && view.nodes.some(n => n.id === closest.a) && view.nodes.some(n => n.id === closest.b);

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
        {view.edges.map(edge => {
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
        {view.nodes.map((node, index) => {
          const r = nodeRadius(node.endpoint !== null, narrow), url = node.supported && !failed.has(node.id) ? portraits.get(node.id) : undefined;
          const fold = view.folds.find(item => item.hostId === node.id);
          const selected = selection.person === node.id, onEdge = !!selection.edge && !!view.focus?.nodes.has(node.id);
          const name = node.person.name;
          const label = `${name}, ${describeSide(node, endpointNames)}${layout.pinned.has(node.id) ? ', pinned' : ''}`;
          const select = () => onSelect({ person: node.id });
          const clip = `${uid}-clip-${index}`;
          return <g key={node.id} data-net-interactive ref={el => { if (el) nodeEls.current.set(node.id, el); else nodeEls.current.delete(node.id); }}
            role="button" tabIndex={0} aria-label={label} aria-pressed={selected}
            className={`net-node ${sideClass(node)} ${node.supported ? 'is-supported' : 'is-tentative'} ${selected ? 'is-selected' : ''} ${onEdge ? 'is-edge-end' : ''} ${dimmed(node.id) ? 'is-dim' : ''} ${successChain && view.chain!.nodeIds.includes(node.id) ? 'is-chain' : ''} ${node.active ? 'is-active' : ''}`}
            onPointerDown={event => onNodeDown(event, node.id)} onPointerMove={onNodeMove} onPointerUp={event => onNodeUp(event, node.id)} onPointerCancel={event => onNodeUp(event, node.id)}
            onDoubleClick={() => { if (layout.pinned.has(node.id)) { layout.unpin(node.id); kick(); onPinsChange(); } }} onKeyDown={activate(select)}>
            <title>{`${name} (${node.person.birthYear}–${node.person.deathYear})`}</title>
            <g className="net-node-body">
              {node.active && <circle className="net-pulse" r={r + 9} />}
              <circle className="net-select-ring" r={r + 8} />
              <circle className="net-ring" r={r + 3} />
              <clipPath id={clip}><circle r={r} /></clipPath>
              <circle className="net-disc" r={r} fill={CATEGORY_COLORS[node.person.category]} />
              {url
                ? <image href={url} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" onError={() => setFailed(previous => new Set(previous).add(node.id))} />
                : <text className="net-initials" textAnchor="middle" dy="0.35em" style={{ fontSize: r * 0.8, fill: CATEGORY_BAR_TEXT_COLORS[node.person.category] }}>{initials(name)}</text>}
              {node.endpoint !== null && <g className="net-badge-ab"><circle cx={r * 0.78} cy={-r * 0.78} r={r * 0.34} /><text x={r * 0.78} y={-r * 0.78} textAnchor="middle" dy="0.35em">{node.endpoint === 0 ? 'A' : 'B'}</text></g>}
              {layout.pinned.has(node.id) && <g className="net-pin"><title>Pinned · double-click to release</title><circle cx={-r * 0.78} cy={-r * 0.78} r={6} /><path d={`M ${-r * 0.78 - 2.5} ${-r * 0.78 + 2.5} L ${-r * 0.78 + 2.5} ${-r * 0.78 - 2.5}`} /></g>}
            </g>
            <text className="net-name" textAnchor="middle" y={r + 15}>{truncateName(name, labelLimit(narrow))}</text>
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
    <div className="net-overlay-row">
      <div data-net-controls className="canvas-view-toolbar net-view-toolbar" role="toolbar" aria-label="Network view controls">
        <Tooltip text={freeLabel}><button type="button" className="canvas-floating-button" aria-label={freeLabel} onClick={event => {
          if (event.detail > 0) event.currentTarget.blur();
          onModeChange(mode === 'time' ? 'free' : 'time');
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {mode === 'free' ? <>
              <path d="M3 20h18M6 18v3M12 18v3M18 18v3" />
              <rect x="3" y="3" width="11" height="3" rx="1" fill="currentColor" stroke="none" />
              <rect x="8" y="8" width="13" height="3" rx="1" fill="currentColor" stroke="none" />
              <rect x="5" y="13" width="10" height="3" rx="1" fill="currentColor" stroke="none" />
            </> : <>
              <circle cx="6" cy="7" r="2.6" /><circle cx="18" cy="6" r="2.6" /><circle cx="12" cy="18" r="2.6" />
              <path d="M8.5 7h7M7.4 9.3l3.3 6.4M16.7 8.4l-3.4 7.2" />
            </>}
          </svg>
        </button></Tooltip>
        <span className="canvas-toolbar-divider" aria-hidden="true" />
        <Tooltip text="Zoom in"><button type="button" className="canvas-floating-button" aria-label="Zoom network in" onClick={event => { if (event.detail > 0) event.currentTarget.blur(); zoomBy(1.25); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.8v5.4M7.8 10.5h5.4" /></svg>
        </button></Tooltip>
        <Tooltip text="Zoom out"><button type="button" className="canvas-floating-button" aria-label="Zoom network out" onClick={event => { if (event.detail > 0) event.currentTarget.blur(); zoomBy(0.8); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.8 10.5h5.4" /></svg>
        </button></Tooltip>
        <Tooltip text="Fit the whole network"><button type="button" className="canvas-floating-button" aria-label="Fit network" onClick={event => { if (event.detail > 0) event.currentTarget.blur(); fit(); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>
        </button></Tooltip>
      </div>
      {legend}
    </div>
    </div>
    {outside && <button type="button" className="net-outside" onClick={fit}>New contacts outside view · Fit</button>}
    {success && <div className="net-success" role="status">Connected · {success.degrees} {success.degrees === 1 ? 'degree' : 'degrees'}<small>Opening the connection… click or press Esc to skip</small></div>}
  </div>;
};
export default NetworkGraph;
