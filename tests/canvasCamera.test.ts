import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centerCameraOnBounds, pinchCamera, zoomCameraAt, type CanvasCamera, type Point } from '../src/utils/canvasCamera';

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
