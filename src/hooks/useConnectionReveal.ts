import { useCallback, useEffect, useRef, useState } from 'react';
import {
  easeArrival, easeDrift, fitCameraToBounds, flyCamera, prefersReducedMotion, unionBounds, type CameraBounds, type CanvasCamera,
} from '../utils/canvasCamera';
import { planReveal, REVEAL_APPROACH_MS, REVEAL_HOLD_MS, REVEAL_INTRO_MS, REVEAL_OPENING_HOLD_MS, REVEAL_SETTLE_MS } from '../utils/revealTiming';

// What a canvas is asked to show: the chain's people in order, and a token that restarts the reveal.
export interface ConnectionReveal {
  nodeIds: string[];
  playId: number;
  // False once the reveal has played, so a canvas that mounts later shows the finished thread.
  animate: boolean;
}

export interface ConnectionFocusRequest {
  requestId: number;
  figureId: string;
}

interface Options {
  connection: ConnectionReveal | null | undefined;
  focus: ConnectionFocusRequest | null | undefined;
  // World-space boxes come from the layout that is current when the camera moves.
  getBounds: (figureId: string) => CameraBounds | null;
  getCamera: () => CanvasCamera;
  setCamera: (camera: CanvasCamera) => void;
  // The part of the screen not covered by the header or the sidebar.
  getArea: () => CameraBounds | null;
  onStep?: (index: number | null) => void;
  // The reveal finished, was skipped, or was interrupted.
  onEnd?: () => void;
  // The canvas appeared together with this reveal (a faded-in gallery): open on the first person, already at
  // the reveal's zoom, instead of flying in from wherever the camera happens to be. Only the first play counts.
  startAtFirst?: boolean;
  // A fixed zoom for the card-to-card flights (1 is 100%); without it the zoom fits each person to the screen.
  revealScale?: number;
  // While the camera rests on a person it creeps in by this factor (1.05 is five percent) instead of standing still.
  dwellZoom?: number;
  // Leaves the connection (Escape once the reveal is over). Only while `canExit`, so dialogs and picking keep their own Escape.
  onExit?: () => void;
  canExit?: boolean;
}

const FOCUS_MS = 700;
// The part of a link's flight at which the sidebar's current person becomes the one being flown to.
const HANDOVER = 0.75;

// People fade in as the thread reaches them: the first at once, each next one just before its link ends.
const FADE_LEAD = 0.3;
export const isRevealedAt = (progress: number, index: number) => index <= 0 || progress >= index - FADE_LEAD;

// Resolves once `ready` is true, polling about every frame; false if the signal aborts or it takes too long.
async function until(ready: () => boolean, signal: AbortSignal, limitMs = 1500): Promise<boolean> {
  for (let waited = 0; waited <= limitMs && !signal.aborted; waited += 16) {
    if (ready()) return true;
    await new Promise<void>(resolve => setTimeout(resolve, 16));
  }
  return !signal.aborted && ready();
}

function wait(ms: number, signal: AbortSignal): Promise<'finished' | 'cancelled'> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve('cancelled');
    const done = () => { clearTimeout(timer); resolve('cancelled'); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve('finished'); }, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

// Drives the camera and the thread for one canvas: frame the whole chain, fly node to node while each
// segment of the thread draws, then settle on the whole chain. Both layouts share it; they only
// supply how to measure a person, where the usable screen is, and how to move their own camera.
export function useConnectionReveal(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [progress, setProgress] = useState(() =>
    options.connection && !options.connection.animate ? Math.max(0, options.connection.nodeIds.length - 1) : 0);
  const [isRevealing, setIsRevealing] = useState(false);
  const revealFlight = useRef<AbortController | null>(null);
  const focusFlight = useRef<AbortController | null>(null);
  const revealing = useRef(false);
  const current = useRef<CanvasCamera | null>(null);

  const apply = useCallback((camera: CanvasCamera) => {
    current.current = camera;
    latest.current.setCamera(camera);
  }, []);
  const startCamera = () => current.current ?? latest.current.getCamera();

  const overviewCamera = useCallback((): CanvasCamera | null => {
    const { connection, getBounds, getArea } = latest.current;
    const union = unionBounds((connection?.nodeIds ?? []).flatMap(id => getBounds(id) ?? []));
    const area = getArea();
    return union && area ? fitCameraToBounds(union, area, { padding: 96, maxScale: 1.2 }) : null;
  }, []);
  const personCamera = useCallback((figureId: string): CanvasCamera | null => {
    const bounds = latest.current.getBounds(figureId), area = latest.current.getArea();
    return bounds && area ? fitCameraToBounds(bounds, area, { padding: 120, minScale: 0.5, maxScale: 1.2 }) : null;
  }, []);
  // Where the camera rests on a person during the reveal: centred, at the fixed zoom when there is one.
  const revealCamera = useCallback((figureId: string): CanvasCamera | null => {
    const scale = latest.current.revealScale;
    const bounds = latest.current.getBounds(figureId), area = latest.current.getArea();
    return scale && bounds && area ? fitCameraToBounds(bounds, area, { minScale: scale, maxScale: scale }) : personCamera(figureId);
  }, [personCamera]);
  const firstPlay = useRef(true);
  const pivot = () => {
    const area = latest.current.getArea();
    return area ? { x: area.left + area.width / 2, y: area.top + area.height / 2 } : undefined;
  };
  // On-screen distance between consecutive people at the zoom the camera settles on them: longer hops get longer flights.
  const hopDistances = (ids: string[]) => {
    const spots = ids.map(id => {
      const bounds = latest.current.getBounds(id), camera = revealCamera(id);
      return bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, scale: camera?.scale ?? 1 } : null;
    });
    return spots.slice(1).map((spot, index) => {
      const from = spots[index];
      return from && spot ? Math.hypot(spot.x - from.x, spot.y - from.y) * (from.scale + spot.scale) / 2 : 0;
    });
  };
  const linkCount = () => Math.max(0, (latest.current.connection?.nodeIds.length ?? 0) - 1);

  const finish = useCallback(() => {
    revealing.current = false;
    setIsRevealing(false);
    setProgress(linkCount());
    latest.current.onStep?.(null);
    latest.current.onEnd?.();
  }, []);

  // A person took over the camera (pan, zoom, wheel) or asked to skip: stop moving it and show the finished thread.
  // Returns whether a reveal was still running.
  const interrupt = useCallback((): boolean => {
    focusFlight.current?.abort();
    const wasRevealing = revealing.current;
    if (wasRevealing) {
      revealFlight.current?.abort();
      finish();
    }
    return wasRevealing;
  }, [finish]);

  // Frames the whole chain again, for a click that skipped the reveal.
  const settle = useCallback(() => {
    const overview = overviewCamera();
    if (overview) apply(overview);
  }, [overviewCamera, apply]);

  const skip = useCallback(() => {
    if (interrupt()) settle();
  }, [interrupt, settle]);

  const playId = options.connection?.playId ?? null;
  useEffect(() => {
    focusFlight.current?.abort();
    revealFlight.current?.abort();
    current.current = null;
    if (playId === null) {
      revealing.current = false;
      setIsRevealing(false);
      setProgress(0);
      return;
    }
    const controller = new AbortController();
    revealFlight.current = controller;
    const { signal } = controller;
    const links = linkCount();
    if (!latest.current.connection!.animate) {
      revealing.current = false;
      setIsRevealing(false);
      setProgress(links);
      return;
    }
    const step = (index: number | null) => { if (!signal.aborted) latest.current.onStep?.(index); };

    const run = async () => {
      revealing.current = true;
      setIsRevealing(true);
      setProgress(0);
      // A canvas that has only just mounted is measured a moment later.
      if (!await until(() => !!latest.current.getArea(), signal)) { if (!signal.aborted) finish(); return; }
      const overview = overviewCamera();
      if (!overview || !links) { finish(); return; }
      if (prefersReducedMotion()) { apply(overview); finish(); return; }

      const fly = (to: CanvasCamera, ms: number) => flyCamera(startCamera(), to, ms, apply, signal, { pivot: pivot() });
      const ids = latest.current.connection!.nodeIds;
      const plan = planReveal(hopDistances(ids));

      const atFirst = !!latest.current.startAtFirst && firstPlay.current;
      firstPlay.current = false;
      const first = revealCamera(ids[0]);
      if (atFirst && first) {
        // The canvas is fading in: it opens on the first person at the reveal's zoom, no flight needed.
        apply(first);
        step(0);
      } else {
        if (await fly(overview, REVEAL_INTRO_MS) === 'cancelled' || await wait(REVEAL_HOLD_MS, signal) === 'cancelled') return;
        step(0);
        if (first && await fly(first, REVEAL_APPROACH_MS) === 'cancelled') return;
      }
      // Resting on a person: still, or a slow creep towards them, and the next flight starts from wherever that ended.
      const rest = (ms: number) => {
        const zoom = latest.current.dwellZoom, from = startCamera(), at = pivot();
        if (!zoom || zoom === 1 || !at) return wait(ms, signal);
        const to = { scale: from.scale * zoom, x: at.x - (at.x - from.x) * zoom, y: at.y - (at.y - from.y) * zoom };
        return flyCamera(from, to, ms, apply, signal, { pivot: at, easing: easeDrift });
      };
      // A reveal that opens on the first person lingers on them, so they are in focus before the thread sets off.
      if (await rest(plan.dwellMs[0] + (atFirst && first ? REVEAL_OPENING_HOLD_MS : 0)) === 'cancelled') return;
      for (let index = 0; index < links; index++) {
        const target = revealCamera(ids[index + 1]) ?? startCamera();
        const travelMs = plan.travelMs[index];
        const started = performance.now();
        let shown = index;
        // The thread is drawn by the same easing as the camera, so its tip stays where the camera is looking
        // and both slow down together as they reach the person.
        const outcome = await flyCamera(startCamera(), target, travelMs, camera => {
          apply(camera);
          const travelled = easeArrival(Math.min(1, (performance.now() - started) / travelMs));
          setProgress(index + travelled);
          const nearest = travelled < HANDOVER ? index : index + 1;
          if (nearest !== shown) { shown = nearest; step(nearest); }
        }, signal, { pivot: pivot(), easing: easeArrival });
        if (outcome === 'cancelled') return;
        setProgress(index + 1);
        step(index + 1);
        // Stay on the person for a moment: this is when the evidence for the link can be read.
        if (await rest(plan.dwellMs[index + 1]) === 'cancelled') return;
      }
      const last = overviewCamera();
      if (last && await fly(last, REVEAL_SETTLE_MS) === 'cancelled') return;
      if (!signal.aborted) finish();
    };
    void run();
    return () => controller.abort();
  }, [playId]);

  // A click on a card in the chain list flies to that person without replaying the reveal.
  // A request that was already there when this canvas mounted (after a layout switch) is not new.
  const focusId = options.focus?.requestId ?? null;
  const handledFocus = useRef(focusId);
  useEffect(() => {
    const request = latest.current.focus;
    if (focusId === null || !request || focusId === handledFocus.current) return;
    handledFocus.current = focusId;
    if (revealing.current) {
      revealFlight.current?.abort();
      finish();
    }
    focusFlight.current?.abort();
    current.current = null;
    const target = personCamera(request.figureId);
    const index = latest.current.connection?.nodeIds.indexOf(request.figureId) ?? -1;
    if (!target) return;
    const controller = new AbortController();
    focusFlight.current = controller;
    latest.current.onStep?.(index >= 0 ? index : null);
    void flyCamera(startCamera(), target, FOCUS_MS, apply, controller.signal, { pivot: pivot() });
    return () => controller.abort();
  }, [focusId]);

  useEffect(() => {
    if (!isRevealing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isRevealing, skip]);

  // After the reveal, Escape leaves the connection. The first Escape of a reveal only skips it
  // (that handler prevents the default), so it never leaves in the same press.
  const canExit = !!options.connection && !!options.onExit && !isRevealing && options.canExit !== false;
  useEffect(() => {
    if (!canExit) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      latest.current.onExit?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canExit]);

  useEffect(() => () => {
    revealFlight.current?.abort();
    focusFlight.current?.abort();
  }, []);

  return { progress, isRevealing, interrupt, settle, skip };
}
