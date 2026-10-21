import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCamera, viewRect, rectHasSegment, rectHasPoint, rectHasRect, isFarZoom, previewTransform, type Camera, type CameraPoint, type FitOptions } from '../src/components/connectionNetwork/camera';

const size = { width: 1000, height: 600 };
const options: FitOptions = { everything: false, readableZoom: 0.8, minZoom: 0.15, maxZoom: 1.25, padding: 70, strip: 24 };
const point = (x: number, y: number, endpoint = false): CameraPoint => ({ x, y, r: 54, endpoint });
const screenX = (camera: { x: number; k: number }, worldX: number) => worldX * camera.k + camera.x;

test('a network that fits at a readable zoom is shown whole and centred', () => {
  const fit = fitCamera([point(100, 200, true), point(500, 300), point(700, 250, true)], size, options)!;
  assert.equal(fit.whole, true);
  assert.ok(fit.camera.k >= 0.8);
  const mid = screenX(fit.camera, (100 - 54 + 700 + 54) / 2);
  assert.ok(Math.abs(mid - 500) < 1);
});

test('a network wider than the screen keeps a readable zoom and sits on the middle between the two ends', () => {
  const points = [point(-2000, 300), point(900, 300, true), point(1500, 280, true), point(4200, 300)];
  const fit = fitCamera(points, size, options)!;
  assert.equal(fit.whole, false);
  assert.equal(fit.camera.k, 0.8);
  assert.ok(Math.abs(screenX(fit.camera, 1200) - 500) < 1);
  // Everything at once is still available on request.
  const all = fitCamera(points, size, { ...options, everything: true })!;
  assert.equal(all.whole, true);
  assert.ok(all.camera.k < 0.8);
  for (const p of points) assert.ok(screenX(all.camera, p.x) > 0 && screenX(all.camera, p.x) < size.width);
});

test('two ends too far apart for a readable zoom are both kept on screen', () => {
  const points = [point(0, 300, true), point(4500, 300, true), point(2200, 100)];
  const fit = fitCamera(points, size, options)!;
  assert.equal(fit.whole, false);
  assert.ok(fit.camera.k < 0.8 && fit.camera.k >= 0.15);
  for (const x of [0, 4500]) assert.ok(screenX(fit.camera, x) > 0 && screenX(fit.camera, x) < size.width, `end at ${x}`);
});

test('framing only some people (the lit chain) brings them into view wherever they are', () => {
  const chain = [point(-1800, 120), point(-1500, 260), point(-1200, 300)];
  const fit = fitCamera(chain, size, { ...options, everything: true })!;
  for (const p of chain) assert.ok(screenX(fit.camera, p.x) > 0 && screenX(fit.camera, p.x) < size.width);
});

test('nothing to frame gives no camera, and a network without ends centres on its middle', () => {
  assert.equal(fitCamera([], size, options), null);
  const fit = fitCamera([point(-3000, 300), point(3000, 300)], size, options)!;
  assert.equal(fit.camera.k, 0.8);
  assert.ok(Math.abs(screenX(fit.camera, 0) - 500) < 1);
});

const rectOf = (camera: Camera, margin = 0) => viewRect(camera, size, margin);

test('the view rectangle is the screen in world coordinates, grown by the margin', () => {
  const rect = rectOf({ x: 100, y: 50, k: 2 }, 20);
  assert.deepEqual(rect, { left: -60, top: -35, right: 460, bottom: 285 });
});

test('a line is kept when it crosses the view even with both ends outside, and dropped when it stays outside', () => {
  const rect = rectOf({ x: 0, y: 0, k: 1 });
  assert.equal(rectHasSegment(rect, { x: -500, y: 300 }, { x: 1500, y: 300 }), true);
  assert.equal(rectHasSegment(rect, { x: 500, y: 300 }, { x: 5000, y: 5000 }), true);
  assert.equal(rectHasSegment(rect, { x: -500, y: -100 }, { x: 1500, y: -100 }), false);
  assert.equal(rectHasSegment(rect, { x: -300, y: 0 }, { x: -10, y: 900 }), false);
  assert.equal(rectHasSegment(rect, { x: 1100, y: -50 }, { x: 1300, y: 700 }), false);
  // Vertical and diagonal cuts across a corner.
  assert.equal(rectHasSegment(rect, { x: 500, y: -200 }, { x: 500, y: 900 }), true);
  assert.equal(rectHasSegment(rect, { x: -100, y: 100 }, { x: 100, y: -100 }), true);
  assert.equal(rectHasSegment(rect, { x: -100, y: 0 }, { x: 0, y: -100 }), false);
  assert.equal(rectHasPoint(rect, { x: 10, y: 10 }), true);
  assert.equal(rectHasPoint(rect, { x: -1, y: 10 }), false);
});

test('far zoom switches with hysteresis', () => {
  assert.equal(isFarZoom(0.3, false), true);
  assert.equal(isFarZoom(0.45, false), false);
  assert.equal(isFarZoom(0.45, true), true);
  assert.equal(isFarZoom(0.55, true), false);
});

test('a zoom preview puts every drawn point where the new camera would draw it', () => {
  const shown = { x: 120, y: -40, k: 0.5 }, next = { x: 300, y: 80, k: 1.7 };
  const { s, x, y } = previewTransform(shown, next);
  for (const world of [{ x: 0, y: 0 }, { x: 250, y: -90 }, { x: -1200, y: 640 }]) {
    const before = { x: world.x * shown.k + shown.x, y: world.y * shown.k + shown.y };
    assert.ok(Math.abs(s * before.x + x - (world.x * next.k + next.x)) < 1e-9);
    assert.ok(Math.abs(s * before.y + y - (world.y * next.k + next.y)) < 1e-9);
  }
  assert.deepEqual(previewTransform(shown, shown), { s: 1, x: 0, y: 0 });
});

test('a rectangle is inside another only when it does not reach past any side', () => {
  const outer = { left: 0, top: 0, right: 100, bottom: 80 };
  assert.equal(rectHasRect(outer, { left: 10, top: 10, right: 90, bottom: 70 }), true);
  assert.equal(rectHasRect(outer, outer), true);
  assert.equal(rectHasRect(outer, { left: -1, top: 10, right: 90, bottom: 70 }), false);
  assert.equal(rectHasRect(outer, { left: 10, top: 10, right: 90, bottom: 81 }), false);
});
