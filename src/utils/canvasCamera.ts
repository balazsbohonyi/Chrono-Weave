export type Point = { x: number; y: number };
export type CanvasCamera = Point & { scale: number };
export type CameraBounds = { left: number; top: number; width: number; height: number };

export const MIN_CAMERA_SCALE = 0.1;
export const MAX_CAMERA_SCALE = 5;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function unionBounds(boxes: readonly CameraBounds[]): CameraBounds | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top));
  const right = Math.max(...boxes.map(box => box.left + box.width)), bottom = Math.max(...boxes.map(box => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

// The camera that shows `bounds` (world units) centred in `area` (screen pixels), shrunk to fit
// but never beyond the scale limits. Pass equal limits for a fixed zoom on a single figure.
export function fitCameraToBounds(bounds: CameraBounds, area: CameraBounds,
  { padding = 0, minScale = MIN_CAMERA_SCALE, maxScale = MAX_CAMERA_SCALE }: { padding?: number; minScale?: number; maxScale?: number } = {}): CanvasCamera {
  const fit = Math.min(
    bounds.width > 0 ? Math.max(1, area.width - padding * 2) / bounds.width : Infinity,
    bounds.height > 0 ? Math.max(1, area.height - padding * 2) / bounds.height : Infinity);
  const scale = clamp(Number.isFinite(fit) ? fit : maxScale, Math.min(minScale, maxScale), maxScale);
  return { scale,
    x: area.left + area.width / 2 - (bounds.left + bounds.width / 2) * scale,
    y: area.top + area.height / 2 - (bounds.top + bounds.height / 2) * scale };
}

// Reaching the destination for a camera move: fixed duration, ease-in-out.
export const easeInOut = (progress: number) => {
  const t = clamp(progress, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

// CSS-style cubic-bezier(x1, y1, x2, y2) as an easing function of time progress.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const axis = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  const slope = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t * t;
  return progress => {
    const x = clamp(progress, 0, 1);
    if (x === 0 || x === 1) return x;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const error = axis(x1, x2, t) - x, d = slope(x1, x2, t);
      if (Math.abs(error) < 1e-6) return axis(y1, y2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    // Newton went astray on a very flat part of the curve: bisect, which cannot fail.
    let low = 0, high = 1;
    t = x;
    for (let i = 0; i < 32; i++) {
      const value = axis(x1, x2, t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) low = t; else high = t;
      t = (low + high) / 2;
    }
    return axis(y1, y2, t);
  };
}
// Leaves gently and slows for a long time before the end, so the camera visibly eases up as it reaches a card.
export const easeArrival = cubicBezier(0.4, 0, 0.1, 1);
// A slow drift that starts at once and settles gently, for a camera that creeps in while it rests on something.
export const easeDrift = cubicBezier(0.1, 0.5, 0.3, 1);

// A point of the flight. `pivot` is the screen point whose world position travels in a straight line
// (normally the centre of the usable viewport); its coordinates also say how large the viewport is.
// Long flights zoom out part-way, so the traveller sees the distance instead of a blur.
export function cameraAt(from: CanvasCamera, to: CanvasCamera, progress: number, pivot?: Point, ease: (progress: number) => number = easeInOut): CanvasCamera {
  const t = clamp(progress, 0, 1);
  if (t >= 1) return to;
  if (t <= 0) return from;
  const u = ease(t);
  const anchor = pivot ?? { x: 0, y: 0 };
  const worldAt = (camera: CanvasCamera) => ({ x: (anchor.x - camera.x) / camera.scale, y: (anchor.y - camera.y) / camera.scale });
  const start = worldAt(from), end = worldAt(to);
  const logFrom = Math.log(from.scale), logTo = Math.log(to.scale);
  let logScale = logFrom + (logTo - logFrom) * u;
  if (pivot && pivot.x > 0 && pivot.y > 0) {
    // The scale at which both ends of the journey fit in view; dip towards it in the middle.
    const needed = Math.min(pivot.x * 2 * 0.8 / Math.max(1, Math.abs(end.x - start.x)), pivot.y * 2 * 0.8 / Math.max(1, Math.abs(end.y - start.y)));
    const dipTo = Math.log(clamp(needed, MIN_CAMERA_SCALE, MAX_CAMERA_SCALE));
    const lowest = Math.min(logFrom, logTo);
    if (dipTo < lowest) logScale -= (lowest - dipTo) * 4 * u * (1 - u);
  }
  const scale = Math.exp(logScale);
  const centre = { x: start.x + (end.x - start.x) * u, y: start.y + (end.y - start.y) * u };
  return { scale, x: anchor.x - centre.x * scale, y: anchor.y - centre.y * scale };
}

export interface FrameScheduler {
  now: () => number;
  // Calls back on the next frame and returns a function that cancels the request.
  request: (callback: () => void) => () => void;
}

export const browserScheduler: FrameScheduler = {
  now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
  request: callback => {
    if (typeof requestAnimationFrame === 'function') {
      const handle = requestAnimationFrame(() => callback());
      return () => cancelAnimationFrame(handle);
    }
    const handle = setTimeout(callback, 16);
    return () => clearTimeout(handle);
  },
};

export const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface FlightOptions {
  pivot?: Point;
  // How the flight's progress maps to distance travelled; defaults to a symmetric ease-in-out.
  easing?: (progress: number) => number;
  reducedMotion?: boolean;
  scheduler?: FrameScheduler;
}

// Animates the camera and says how it ended. Aborting the signal (the user panned or zoomed, or the
// mode closed) stops the flight where it is. Reduced motion, or no time at all, jumps to the end.
export function flyCamera(from: CanvasCamera, to: CanvasCamera, durationMs: number, onFrame: (camera: CanvasCamera) => void,
  signal?: AbortSignal, { pivot, easing, reducedMotion = prefersReducedMotion(), scheduler = browserScheduler }: FlightOptions = {}): Promise<'finished' | 'cancelled'> {
  if (signal?.aborted) return Promise.resolve('cancelled');
  if (reducedMotion || !(durationMs > 0)) {
    onFrame(to);
    return Promise.resolve('finished');
  }
  return new Promise(resolve => {
    const started = scheduler.now();
    let cancelFrame = () => {};
    const finish = (outcome: 'finished' | 'cancelled') => {
      signal?.removeEventListener('abort', cancel);
      resolve(outcome);
    };
    function cancel() { cancelFrame(); finish('cancelled'); }
    const step = () => {
      const progress = (scheduler.now() - started) / durationMs;
      if (progress >= 1) {
        onFrame(to);
        finish('finished');
        return;
      }
      onFrame(cameraAt(from, to, progress, pivot, easing));
      cancelFrame = scheduler.request(step);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    cancelFrame = scheduler.request(step);
  });
}

export function centerCameraOnBounds(bounds: { left: number; top: number; width: number; height: number }, center: Point): CanvasCamera {
  return { scale: 1, x: center.x - bounds.left - bounds.width / 2,
    y: center.y - bounds.top - bounds.height / 2 };
}

export function zoomCameraAt(camera: CanvasCamera, requestedScale: number, anchor: Point): CanvasCamera {
  const clamped = Math.max(0.1, Math.min(5, requestedScale));
  const scale = Math.abs(clamped - 1) < 1e-10 ? 1 : clamped;
  if (!Number.isFinite(scale) || scale === camera.scale) return camera;
  const ratio = scale / camera.scale;
  return { scale, x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio };
}

export function pinchCamera(camera: CanvasCamera, before: readonly [Point, Point], after: readonly [Point, Point]): CanvasCamera {
  const center = (points: readonly [Point, Point]) => ({ x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2 });
  const previousCenter = center(before), nextCenter = center(after);
  const previousDistance = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
  const nextDistance = Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y);
  const zoomed = zoomCameraAt(camera, camera.scale * (previousDistance > 0 ? nextDistance / previousDistance : 1), previousCenter);
  return { ...zoomed, x: zoomed.x + nextCenter.x - previousCenter.x,
    y: zoomed.y + nextCenter.y - previousCenter.y };
}
