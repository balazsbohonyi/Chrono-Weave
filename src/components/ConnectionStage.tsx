import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { HistoricalFigure } from '../types';
import type { ContactAssessment } from '../services/connectionGraph';
import type { ConnectionLinkResult } from '../services/connectionPath';
import { degreeLabel } from '../services/connectionFlow';
import { isRevealedAt, useConnectionReveal, type ConnectionFocusRequest, type ConnectionReveal } from '../hooks/useConnectionReveal';
import { useFigurePortraits } from '../hooks/useFigurePortraits';
import { easeInOut, prefersReducedMotion, zoomCameraAt, type CanvasCamera } from '../utils/canvasCamera';
import { createWheelClassifier } from '../utils/wheelGesture';
import { stripMarkdown } from '../utils/plainText';
import { bestStageColumns, layoutStage, pointAtProgress } from '../utils/connectionStageLayout';
import FigureCard from './FigureCard';
import ConnectionThread from './ConnectionThread';
import NetworkPortrait from './connectionNetwork/NetworkPortrait';
import ExplorationIcon from './connectionNetwork/ExplorationIcon';
import Tooltip from './Tooltip';
import { SixDegreesInfoButton } from './SixDegreesInfo';
import '../styles/connectionStage.css';

interface Props {
  connection: ConnectionReveal;
  chain: HistoricalFigure[];
  links: ConnectionLinkResult[];
  currentIndex: number | null;
  focus: ConnectionFocusRequest | null;
  // The space the stage must leave free beside it: the sidebar. It has the whole height otherwise (the canvas header steps away while it is shown).
  inset: { right: number };
  // False while a dialog is open on top, so that its Escape is its own.
  canExit: boolean;
  // Stepped aside (choosing someone on the canvas): kept as it is, but not shown and not reacting.
  hidden: boolean;
  onStep: (index: number | null) => void;
  onEnd: () => void;
  onExit: () => void;
  // Plays the connection again from the start.
  onReplay: () => void;
  onExplain: (from: HistoricalFigure, to: HistoricalFigure, contact?: ContactAssessment) => void;
  onInspect: (figure: HistoricalFigure) => void;
  // Opens the explanation of Six Degrees of Separation.
  onOpenInfo?: () => void;
  // Opens the graph (the exploration) this connection came from. Absent: no button (the connection is not saved yet).
  onOpenExploration?: () => void;
}

// The space the title takes at the top, and a little breathing room below the cards.
const HEADER_HEIGHT = 76, BOTTOM_MARGIN = 28;
const MIN_SCALE = 0.1, MAX_SCALE = 3, DRAG_SLOP = 4;
// How far the camera creeps in while it rests on a card, and how far behind the tip the comet's tail reaches (in links).
const DWELL_ZOOM = 1.045;
const TAIL = [0.035, 0.07, 0.11, 0.16, 0.22];

// The connection as a short film on a stage of its own: only the chain's people, on a snaking path. The camera follows
// the tip of the thread from person to person, each card lands as the thread reaches it, and its evidence appears beside
// the link. At the end the camera pulls back and a light runs along the whole thread once. The canvas stays behind,
// blurred. It is not a dialog: the sidebar next to it (the evidence, the Why buttons) keeps working.
const ConnectionStage: React.FC<Props> = ({ connection, chain, links, currentIndex, focus, inset, canExit, hidden, onStep, onEnd, onExit, onReplay, onExplain, onInspect, onOpenInfo, onOpenExploration }) => {
  const root = useRef<HTMLElement>(null);
  const gradient = `stage-tip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // How many people stand in a row is chosen once, from the stage's shape when it opens, so cards never move mid-reveal.
  const [columns, setColumns] = useState<number | null>(null);
  const layout = useMemo(() => layoutStage(chain.length, columns ?? undefined), [chain.length, columns]);
  const indexOf = useMemo(() => new Map(chain.map((person, index) => [person.id, index])), [chain]);
  const portraits = useFigurePortraits(chain);
  // The captions show only the first lines of the evidence, so Markdown in it would just be stray symbols there.
  const plainEvidence = useMemo(() => links.map(entry => stripMarkdown(entry.evidence)), [links]);
  const reduced = useState(() => prefersReducedMotion())[0];
  const [camera, setCameraState] = useState<CanvasCamera>({ x: 0, y: 0, scale: 1 });
  const cameraRef = useRef(camera);
  const setCamera = useCallback((next: CanvasCamera) => { cameraRef.current = next; setCameraState(next); }, []);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const classifyWheel = useMemo(() => createWheelClassifier(), []);
  // Whether the person took over (clicked, scrolled, pressed Escape, chose someone) instead of watching it play out.
  const interrupted = useRef(false);
  const suppressClick = useRef(false);
  // Whether the person has moved the camera themselves, after which it is left where they put it.
  const userMoved = useRef(false);

  useEffect(() => {
    const element = root.current; if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setViewport(previous => previous.width === box.width && previous.height === box.height ? previous : { width: box.width, height: box.height });
      if (box.width > 0) setColumns(previous => previous ?? bestStageColumns(chain.length, { width: box.width, height: Math.max(1, box.height - HEADER_HEIGHT - BOTTOM_MARGIN) }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // One card fills the stage at 100% when there is room for it, and a smaller screen gets a smaller zoom, never a larger one.
  const revealScale = Math.min(1, Math.max(0.6, (viewport.width - 64) / 380));
  const reveal = useConnectionReveal({
    connection, focus, onStep, onEnd, onExit, canExit,
    startAtFirst: true, revealScale, dwellZoom: DWELL_ZOOM,
    getBounds: id => { const card = layout.cards[indexOf.get(id) ?? -1]; return card ? { left: card.x, top: card.y, width: card.width, height: card.height } : null; },
    getCamera: () => cameraRef.current,
    setCamera: next => setCamera(next),
    getArea: () => viewport.width ? { left: 0, top: HEADER_HEIGHT, width: viewport.width, height: Math.max(1, viewport.height - HEADER_HEIGHT - BOTTOM_MARGIN) } : null,
  });
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const { progress, isRevealing } = reveal;

  // Stepping aside while it plays ends the show (there is nobody watching, and Escape then belongs to what took its place).
  useEffect(() => { if (hidden) { interrupted.current = true; revealRef.current.skip(); } }, [hidden]);

  // Escape or choosing a person (here or in the sidebar) while it plays is the person taking over.
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') interrupted.current = true; };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  useEffect(() => { if (focus) { interrupted.current = true; userMoved.current = true; } }, [focus?.requestId]);

  // Scrolling pans and pinching or a wheel zooms, as on the canvas; either takes over from a reveal that is playing.
  useEffect(() => {
    const element = root.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (revealRef.current.interrupt()) interrupted.current = true;
      userMoved.current = true;
      const intent = classifyWheel(event), box = element.getBoundingClientRect(), current = cameraRef.current;
      if (intent.kind === 'zoom') {
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * intent.factor));
        setCamera(zoomCameraAt(current, scale, { x: event.clientX - box.left, y: event.clientY - box.top }));
      } else setCamera({ ...current, x: current.x - intent.dx, y: current.y - intent.dy });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [classifyWheel, setCamera]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    suppressClick.current = false;
    if (event.button !== 0 || (event.target as Element).closest('[data-stage-control]')) return;
    // A click while it plays skips to the finished picture.
    if (revealRef.current.isRevealing) { interrupted.current = true; suppressClick.current = true; revealRef.current.skip(); return; }
    const start = { x: event.clientX, y: event.clientY, camera: cameraRef.current };
    let dragged = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - start.x, dy = next.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) <= DRAG_SLOP) return;
      if (!dragged) { dragged = true; userMoved.current = true; setDragging(true); }
      setCamera({ ...start.camera, x: start.camera.x + dx, y: start.camera.y + dy });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
      if (dragged) { suppressClick.current = true; setDragging(false); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  };

  // A stage that opens already finished, or is resized once it has, frames the whole chain (unless the person moved it).
  useEffect(() => {
    if (!connection.animate && viewport.width && !userMoved.current) revealRef.current.settle();
  }, [connection.animate, viewport.width, viewport.height]);

  // When the reveal has played out untouched, a light runs along the whole thread once.
  const [pulse, setPulse] = useState<number | null>(null);
  const wasRevealing = useRef(false);
  useEffect(() => {
    if (isRevealing) { wasRevealing.current = true; return; }
    if (!wasRevealing.current) return;
    wasRevealing.current = false;
    if (interrupted.current || reduced || !layout.links.length) return;
    const started = performance.now(), duration = Math.min(5200, 1400 + 320 * layout.links.length);
    let frame = 0;
    const step = (now: number) => {
      const done = Math.min(1, (now - started) / duration);
      if (done >= 1) { setPulse(null); return; }
      setPulse(layout.links.length * easeInOut(done));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); setPulse(null); };
  }, [isRevealing, layout.links.length, reduced]);

  const tipProgress = isRevealing ? progress : pulse;
  const tip = tipProgress === null || reduced ? null : { at: pointAtProgress(layout, tipProgress),
    tail: TAIL.map(lag => pointAtProgress(layout, Math.max(0, tipProgress - lag))) };
  const first = chain[0], last = chain[chain.length - 1];
  const finished = !isRevealing && progress >= layout.links.length;
  const scale = camera.scale;

  // Asking why from a caption while it plays takes over from the reveal, so it does not carry on behind the dialog.
  const explain = (from: HistoricalFigure, to: HistoricalFigure, contact?: ContactAssessment) => {
    interrupted.current = true; revealRef.current.skip();
    onExplain(from, to, contact);
  };

  // Like asking why, opening the explanation takes over from a reveal that is playing.
  const openInfo = () => {
    interrupted.current = true; revealRef.current.skip();
    onOpenInfo?.();
  };

  // Like asking why, opening the graph takes over from a reveal that is playing.
  const openExploration = () => {
    interrupted.current = true; revealRef.current.skip();
    onOpenExploration?.();
  };

  return <section ref={root} className={`connection-stage ${dragging ? 'is-dragging' : ''}`} data-connection-stage data-sidebar={inset.right > 0 ? 'open' : 'closed'} hidden={hidden}
    aria-label={`The connection between ${first.name} and ${last.name}`} style={{ right: inset.right }} onPointerDown={onPointerDown}>
    <div className="stage-backdrop" aria-hidden="true" style={{ backgroundPosition: `${camera.x * 0.25}px ${camera.y * 0.25}px` }} />
    <div className="stage-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${scale})` }}>
      <svg className="stage-threads" width={layout.bounds.width} height={layout.bounds.height} aria-hidden="true">
        <defs><radialGradient id={gradient}>
          <stop offset="0" stopColor="rgb(var(--color-connection))" stopOpacity="0.85" /><stop offset="0.45" stopColor="rgb(var(--color-connection))" stopOpacity="0.28" /><stop offset="1" stopColor="rgb(var(--color-connection))" stopOpacity="0" />
        </radialGradient></defs>
        <ConnectionThread segments={layout.links.map(link => link.d)} progress={progress} strokeWidth={3 / scale} extent={layout.bounds} />
        {tip && <g className="stage-tip">
          {tip.tail.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={(4.5 - index * 0.6) / scale} className="stage-tip-tail" opacity={0.7 - index * 0.13} />)}
          <circle cx={tip.at.x} cy={tip.at.y} r={30 / scale} fill={`url(#${gradient})`} />
          <circle cx={tip.at.x} cy={tip.at.y} r={5.5 / scale} className="stage-tip-core" />
        </g>}
      </svg>
      {layout.cards.map(card => {
        const person = chain[card.index], revealed = isRevealedAt(progress, card.index);
        return <FigureCard key={person.id} figure={person} imageUrl={person.imageUrl || portraits.get(person.id)} data-figure-id={person.id}
          aria-label={`Read the biography of ${person.name}`} tabIndex={revealed ? 0 : -1} aria-hidden={revealed ? undefined : true}
          className={`gallery-card stage-card ${revealed ? '' : 'is-ghost'} ${currentIndex === card.index ? 'is-current' : ''}`}
          style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
          badge={revealed ? { number: card.index + 1, scale: 1 } : undefined}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (revealed) onInspect(person); }} />;
      })}
      {layout.links.map(link => {
        const shown = progress >= link.index + 0.6, entry = links[link.index], vertical = link.vertical;
        return <div key={link.index} className={`stage-caption ${shown ? 'is-shown' : ''} ${vertical ? 'is-beside' : ''}`} aria-hidden={shown ? undefined : true}
          style={{ left: link.caption.x, top: link.caption.y, width: link.caption.width, height: link.caption.height }}>
          {entry && <>
            <p>{plainEvidence[link.index]}</p>
            <button type="button" data-stage-control className="connection-link-why" tabIndex={shown ? 0 : -1}
              aria-label={`Why were ${entry.from.name} and ${entry.to.name} connected?`} onClick={() => explain(entry.from, entry.to, entry.contact)}>Why?</button>
          </>}
        </div>;
      })}
    </div>

    <header className="stage-header" data-stage-control>
      <div className="stage-title">
        <p className="stage-kicker">Six Degrees of Separation · Connection</p>
        <div className="stage-people">
          <NetworkPortrait person={first} size={36} url={first.imageUrl || portraits.get(first.id)} /><strong>{first.name}</strong>
          <span aria-hidden="true">→</span>
          <NetworkPortrait person={last} size={36} url={last.imageUrl || portraits.get(last.id)} /><strong>{last.name}</strong>
          <span className={`stage-degrees ${finished ? 'is-final' : ''}`}>{degreeLabel(chain.length - 1)} apart</span>
          {onOpenInfo && <SixDegreesInfoButton onOpen={openInfo} plain stageControl />}
        </div>
      </div>
      <div className="stage-actions">
        {/* Bare icons, no chrome (like the icons of the sidebar's connection cards): play the connection again, and open its graph. */}
        <Tooltip text="Replay the connection" placement="bottom">
          <button type="button" className="stage-icon-button stage-replay" aria-label="Replay the connection" onClick={onReplay}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
          </button>
        </Tooltip>
        {onOpenExploration && <Tooltip text="Open exploration" placement="bottom">
          <button type="button" className="stage-icon-button stage-open-graph" aria-label="Open exploration" onClick={openExploration}><ExplorationIcon size={22} /></button>
        </Tooltip>}
        <button type="button" className="close-button" aria-label="Close the connection" onClick={onExit}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" /></svg>
        </button>
      </div>
    </header>
  </section>;
};

export default ConnectionStage;
