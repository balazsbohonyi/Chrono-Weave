import { useCallback, useEffect, useRef, useState } from 'react';
import { CONNECTION_REVEAL_MAX_MS } from '../constants';
import {
  fitCameraToBounds, flyCamera, prefersReducedMotion, unionBounds, type CameraBounds, type CanvasCamera,
} from '../utils/canvasCamera';

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
  // Leaves the connection (Escape once the reveal is over). Only while `canExit`, so dialogs and picking keep their own Escape.
  onExit?: () => void;
  canExit?: boolean;
}

const INTRO_MS = 600, HOLD_MS = 250, APPROACH_MS = 600, SETTLE_MS = 800, FOCUS_MS = 700;
const MIN_LINK_MS = 250, MAX_LINK_MS = 1400;

// Time for each link of the thread: what is left of the whole reveal's budget once the fixed phases
// (frame the chain, approach the first person, settle) are paid for, shared between the links.
export const revealLinkMs = (links: number) =>
  Math.min(MAX_LINK_MS, Math.max(MIN_LINK_MS, (CONNECTION_REVEAL_MAX_MS - INTRO_MS - HOLD_MS - APPROACH_MS - SETTLE_MS) / Math.max(1, links)));
// The whole reveal, from the first frame to the last.
export const revealTotalMs = (links: number) => INTRO_MS + HOLD_MS + APPROACH_MS + links * revealLinkMs(links) + SETTLE_MS;

// People fade in as the thread reaches them: the first at once, each next one just before its link ends.
const FADE_LEAD = 0.3;
export const isRevealedAt = (progress: number, index: number) => index <= 0 || progress >= index - FADE_LEAD;

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
  const pivot = () => {
    const area = latest.current.getArea();
    return area ? { x: area.left + area.width / 2, y: area.top + area.height / 2 } : undefined;
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
      const overview = overviewCamera();
      if (!overview || !links) { finish(); return; }
      if (prefersReducedMotion()) { apply(overview); finish(); return; }

      const fly = (to: CanvasCamera, ms: number) => flyCamera(startCamera(), to, ms, apply, signal, { pivot: pivot() });
      const linkMs = revealLinkMs(links);
      const ids = latest.current.connection!.nodeIds;

      if (await fly(overview, INTRO_MS) === 'cancelled' || await wait(HOLD_MS, signal) === 'cancelled') return;
      step(0);
      const first = personCamera(ids[0]);
      if (first && await fly(first, APPROACH_MS) === 'cancelled') return;
      for (let index = 0; index < links; index++) {
        const target = personCamera(ids[index + 1]) ?? startCamera();
        const started = performance.now();
        let shown = index;
        const outcome = await flyCamera(startCamera(), target, linkMs, camera => {
          apply(camera);
          const elapsed = Math.min(1, (performance.now() - started) / linkMs);
          setProgress(index + elapsed);
          const nearest = elapsed < 0.5 ? index : index + 1;
          if (nearest !== shown) { shown = nearest; step(nearest); }
        }, signal, { pivot: pivot() });
        if (outcome === 'cancelled') return;
        setProgress(index + 1);
        step(index + 1);
      }
      const last = overviewCamera();
      if (last && await fly(last, SETTLE_MS) === 'cancelled') return;
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
