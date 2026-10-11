import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraAt, centerCameraOnBounds, easeInOut, fitCameraToBounds, flyCamera, pinchCamera, unionBounds, zoomCameraAt, type CanvasCamera, type Point } from '../src/utils/canvasCamera';

const worldPoint = (camera: CanvasCamera, screen: Point) => ({ x: (screen.x - camera.x) / camera.scale,
  y: (screen.y - camera.y) / camera.scale });
const close = (actual: Point, expected: Point) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8);
};

test('zooming in and out preserves the world point under the cursor', () => {
  const camera = { x: -500, y: 80, scale: 1.5 }, anchor = { x: 700, y: 350 };
  for (const scale of [0.3, 1, 2, 4]) {
    const zoomed = zoomCameraAt(camera, scale, anchor);
    assert.equal(zoomed.scale, scale);
    close(worldPoint(zoomed, anchor), worldPoint(camera, anchor));
  }
  assert.deepEqual(camera, { x: -500, y: 80, scale: 1.5 });
});

test('zoom limits keep the cursor anchor stable and stop drift at the limits', () => {
  const camera = { x: 100, y: -200, scale: 1 }, anchor = { x: 400, y: 300 };
  for (const [requested, expected] of [[0, 0.1], [Infinity, 5]] as const) {
    const zoomed = zoomCameraAt(camera, requested, anchor);
    assert.equal(zoomed.scale, expected);
    close(worldPoint(zoomed, anchor), worldPoint(camera, anchor));
    assert.equal(zoomCameraAt(zoomed, requested, anchor), zoomed);
  }
  assert.equal(zoomCameraAt(camera, NaN, anchor), camera);
});

test('reset returns to 100% and centers the full layout, including translated and oversized bounds', () => {
  const center = { x: 420, y: 490 };
  for (const bounds of [
    { left: 0, top: 0, width: 320, height: 116 },
    { left: -500, top: 120, width: 1800, height: 1200 },
    { left: 6000, top: -700, width: 800, height: 350 },
  ]) {
    const reset = centerCameraOnBounds(bounds, center);
    assert.equal(reset.scale, 1);
    close(worldPoint(reset, center), { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    assert.deepEqual(centerCameraOnBounds(bounds, center), reset);
  }
});

test('a moving pinch both zooms and pans with the world point following its centroid', () => {
  const camera = { x: -300, y: 90, scale: 0.8 };
  const before: [Point, Point] = [{ x: 100, y: 200 }, { x: 300, y: 200 }];
  const after: [Point, Point] = [{ x: 80, y: 240 }, { x: 480, y: 240 }];
  const next = pinchCamera(camera, before, after);
  assert.equal(next.scale, 1.6);
  close(worldPoint(next, { x: 280, y: 240 }), worldPoint(camera, { x: 200, y: 200 }));
  assert.deepEqual(before, [{ x: 100, y: 200 }, { x: 300, y: 200 }]);
});

test('two-finger panning at a fixed distance preserves scale, including coincident starting fingers', () => {
  const camera = { x: 40, y: 50, scale: 2 };
  const next = pinchCamera(camera, [{ x: 10, y: 20 }, { x: 30, y: 20 }], [{ x: 50, y: 80 }, { x: 70, y: 80 }]);
  assert.deepEqual(next, { x: 80, y: 110, scale: 2 });
  const coincident = pinchCamera(camera, [{ x: 10, y: 20 }, { x: 10, y: 20 }], [{ x: 30, y: 40 }, { x: 50, y: 60 }]);
  assert.deepEqual(coincident, { x: 70, y: 80, scale: 2 });
});

const frames = () => {
  // A manual clock and frame queue: each tick advances time, then runs the pending frame callback.
  let time = 0;
  let pending: (() => void) | null = null;
  let requested = 0;
  return {
    scheduler: { now: () => time, request: (callback: () => void) => { requested++; pending = callback; return () => { if (pending === callback) pending = null; }; } },
    tick: (ms: number) => { time += ms; const callback = pending; pending = null; callback?.(); },
    get isWaiting() { return pending !== null; },
    get requested() { return requested; },
  };
};

test('easing starts and ends at rest, is symmetric, and never leaves 0..1', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.25) < 0.25 && easeInOut(0.75) > 0.75);
  assert.ok(Math.abs(easeInOut(0.3) + easeInOut(0.7) - 1) < 1e-12);
  assert.equal(easeInOut(-4), 0);
  assert.equal(easeInOut(9), 1);
  let previous = 0;
  for (let step = 1; step <= 100; step++) { const value = easeInOut(step / 100); assert.ok(value >= previous); previous = value; }
});

test('a flight begins and ends exactly on the requested cameras', () => {
  const from = { x: -200, y: 40, scale: 1 }, to = { x: -9000, y: 300, scale: 1.2 }, pivot = { x: 600, y: 400 };
  assert.deepEqual(cameraAt(from, to, 0, pivot), from);
  assert.deepEqual(cameraAt(from, to, 1, pivot), to);
  assert.deepEqual(cameraAt(from, to, 5, pivot), to);
  assert.deepEqual(cameraAt(from, from, 0.5, pivot), from);
});

test('the world point under the pivot travels in a straight line, even while the zoom changes', () => {
  const from = { x: 100, y: 50, scale: 1 }, to = { x: -3000, y: -700, scale: 0.6 }, pivot = { x: 500, y: 300 };
  const centre = (camera: CanvasCamera) => worldPoint(camera, pivot);
  const start = centre(from), end = centre(to);
  for (const progress of [0.2, 0.5, 0.8]) {
    const u = easeInOut(progress);
    close(centre(cameraAt(from, to, progress, pivot)), { x: start.x + (end.x - start.x) * u, y: start.y + (end.y - start.y) * u });
  }
});

test('a long flight zooms out part-way and back in, while a short one only pans', () => {
  const pivot = { x: 600, y: 400 };
  const far = cameraAt({ x: 0, y: 0, scale: 1 }, { x: -20000, y: 0, scale: 1 }, 0.5, pivot);
  assert.ok(far.scale < 0.5, `expected a pronounced zoom-out, got ${far.scale}`);
  assert.ok(far.scale >= 0.1);
  const near = cameraAt({ x: 0, y: 0, scale: 1 }, { x: -200, y: 0, scale: 1 }, 0.5, pivot);
  assert.equal(near.scale, 1);
  // Without a pivot there is no viewport to measure against, so the zoom simply interpolates.
  assert.equal(cameraAt({ x: 0, y: 0, scale: 1 }, { x: -20000, y: 0, scale: 1 }, 0.5).scale, 1);
});

test('flying delivers eased frames and finishes exactly on the destination', async () => {
  const clock = frames();
  const seen: CanvasCamera[] = [];
  const from = { x: 0, y: 0, scale: 1 }, to = { x: -400, y: 200, scale: 1 };
  const flight = flyCamera(from, to, 1000, camera => seen.push(camera), undefined, { reducedMotion: false, scheduler: clock.scheduler, pivot: { x: 600, y: 400 } });
  for (let step = 0; step < 4; step++) clock.tick(250);
  assert.equal(await flight, 'finished');
  assert.deepEqual(seen.at(-1), to);
  assert.equal(seen.length, 4);
  const xs = seen.map(camera => camera.x);
  assert.ok(xs.every((x, index) => index === 0 || x <= xs[index - 1]));
  // Ease-in-out: the quarter-time frame has travelled less than a quarter of the way.
  assert.ok(Math.abs(seen[0].x) < 100);
  assert.equal(clock.isWaiting, false);
});

test('aborting stops the flight where it is, cancels the pending frame, and reports it', async () => {
  const clock = frames();
  const controller = new AbortController();
  const seen: CanvasCamera[] = [];
  const flight = flyCamera({ x: 0, y: 0, scale: 1 }, { x: -400, y: 0, scale: 1 }, 1000, camera => seen.push(camera), controller.signal,
    { reducedMotion: false, scheduler: clock.scheduler });
  clock.tick(300);
  controller.abort();
  assert.equal(await flight, 'cancelled');
  assert.equal(clock.isWaiting, false);
  const count = seen.length;
  clock.tick(900);
  assert.equal(seen.length, count);
  // A signal that is already aborted never starts.
  assert.equal(await flyCamera({ x: 0, y: 0, scale: 1 }, { x: 1, y: 1, scale: 1 }, 1000, () => assert.fail('no frame'), controller.signal,
    { reducedMotion: false, scheduler: clock.scheduler }), 'cancelled');
});

test('reduced motion and zero duration jump straight to the destination without scheduling frames', async () => {
  const to = { x: -400, y: 200, scale: 1.2 };
  for (const options of [{ reducedMotion: true, duration: 1000 }, { reducedMotion: false, duration: 0 }]) {
    const clock = frames();
    const seen: CanvasCamera[] = [];
    assert.equal(await flyCamera({ x: 0, y: 0, scale: 1 }, to, options.duration, camera => seen.push(camera), undefined,
      { reducedMotion: options.reducedMotion, scheduler: clock.scheduler }), 'finished');
    assert.deepEqual(seen, [to]);
    assert.equal(clock.requested, 0);
  }
});

test('fitting centres the bounds in the usable area and shrinks to fit within the scale limits', () => {
  const area = { left: 0, top: 100, width: 800, height: 500 };
  const fixed = fitCameraToBounds({ left: 1000, top: 200, width: 320, height: 116 }, area, { minScale: 1.2, maxScale: 1.2 });
  assert.equal(fixed.scale, 1.2);
  close({ x: fixed.x + (1000 + 160) * fixed.scale, y: fixed.y + (200 + 58) * fixed.scale }, { x: 400, y: 350 });
  const wide = fitCameraToBounds({ left: 0, top: 0, width: 4000, height: 100 }, area, { padding: 50, maxScale: 1.2 });
  assert.equal(wide.scale, 0.175);
  const tiny = fitCameraToBounds({ left: 0, top: 0, width: 10, height: 10 }, area, { maxScale: 1.2 });
  assert.equal(tiny.scale, 1.2);
  const huge = fitCameraToBounds({ left: 0, top: 0, width: 400000, height: 100 }, area);
  assert.equal(huge.scale, 0.1);
  assert.equal(fitCameraToBounds({ left: 5, top: 5, width: 0, height: 0 }, area, { maxScale: 2 }).scale, 2);
});

test('bounds of several boxes are their union', () => {
  assert.equal(unionBounds([]), null);
  assert.deepEqual(unionBounds([{ left: 10, top: 20, width: 30, height: 40 }, { left: -5, top: 60, width: 10, height: 100 }]),
    { left: -5, top: 20, width: 45, height: 140 });
});
