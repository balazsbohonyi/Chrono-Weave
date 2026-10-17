import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCamera, type CameraPoint, type FitOptions } from '../src/components/connectionNetwork/camera';

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
