import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWheelClassifier, type WheelLike } from '../src/utils/wheelGesture';

const wheel = (patch: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...patch });
const clock = () => { let time = 1000; return { now: () => time, advance: (ms: number) => { time += ms; } }; };

test('a physical wheel notch zooms with ordinary sensitivity', () => {
  const classify = createWheelClassifier(clock().now);
  const intent = classify(wheel({ deltaY: 91 }));
  assert.equal(intent.kind, 'zoom');
  assert.ok(intent.kind === 'zoom' && Math.abs(intent.factor - (1 - 0.091)) < 1e-9);
});

test('fine vertical trackpad deltas pan instead of zooming', () => {
  const classify = createWheelClassifier(clock().now);
  assert.deepEqual(classify(wheel({ deltaX: 2, deltaY: 3 })), { kind: 'pan', dx: 2, dy: 3 });
  assert.deepEqual(classify(wheel({ deltaY: 1.5 })), { kind: 'pan', dx: 0, dy: 1.5 });
});

test('a trackpad pinch (Ctrl/Cmd + fine wheel) zooms ten times faster than a wheel', () => {
  const classify = createWheelClassifier(clock().now);
  const pinch = classify(wheel({ ctrlKey: true, deltaY: -4 }));
  assert.ok(pinch.kind === 'zoom' && Math.abs(pinch.factor - 1.04) < 1e-9);
  const heldWheel = classify(wheel({ ctrlKey: true, deltaY: -100 }));
  assert.ok(heldWheel.kind === 'zoom' && Math.abs(heldWheel.factor - 1.1) < 1e-9);
});

test('line-mode wheels and the Shift key zoom', () => {
  const classify = createWheelClassifier(clock().now);
  assert.equal(classify(wheel({ deltaMode: 1, deltaY: 3 })).kind, 'zoom');
  assert.equal(classify(wheel({ shiftKey: true, deltaY: 2 })).kind, 'zoom');
});

test('a gesture that started on the trackpad keeps panning when a delta grows large, until it goes quiet', () => {
  const time = clock(), classify = createWheelClassifier(time.now);
  assert.equal(classify(wheel({ deltaY: 5 })).kind, 'pan');
  time.advance(100);
  assert.equal(classify(wheel({ deltaY: 120 })).kind, 'pan');
  time.advance(301);
  assert.equal(classify(wheel({ deltaY: 120 })).kind, 'zoom');
});
