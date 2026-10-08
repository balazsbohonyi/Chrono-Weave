export type Point = { x: number; y: number };
export type CanvasCamera = Point & { scale: number };

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
