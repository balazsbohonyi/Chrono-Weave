// The camera is a transform over screen-sized content: screen = world * k + (x, y).
export interface Camera { x: number; y: number; k: number }
export interface CameraPoint { x: number; y: number; r: number; endpoint?: boolean }
export interface FitOptions {
  // Fit every point, however small that makes the people. Otherwise the zoom keeps at least `readableZoom`.
  everything: boolean;
  readableZoom: number;
  minZoom: number;
  maxZoom: number;
  // Room kept free at the sides, and at the top and bottom (the year strips).
  padding: number;
  strip: number;
}
// `whole` is true when the camera shows the entire network.
export interface Fit { camera: Camera; whole: boolean }

// Where to put the camera so the points are in view. Following a growing network keeps people readable
// and pans to the middle of the time line between the two ends instead of shrinking everything; when
// the two ends alone would not fit side by side at that zoom, it zooms out just enough to show both.
export function fitCamera(points: CameraPoint[], size: { width: number; height: number }, options: FitOptions): Fit | null {
  if (!points.length) return null;
  const { width, height } = size, { everything, readableZoom, minZoom, maxZoom, padding, strip } = options;
  const left = Math.min(...points.map(p => p.x - p.r)), right = Math.max(...points.map(p => p.x + p.r));
  const top = Math.min(...points.map(p => p.y - p.r)), bottom = Math.max(...points.map(p => p.y + p.r));
  const bw = Math.max(1, right - left), bh = Math.max(1, bottom - top);
  const room = Math.max(1, height - strip * 2 - padding);
  const fits = Math.min(maxZoom, (width - padding) / bw, room / bh);
  if (everything || fits >= readableZoom) {
    const k = Math.max(minZoom, fits);
    return { camera: { k, x: width / 2 - (left + right) / 2 * k, y: height / 2 - (top + bottom) / 2 * k }, whole: true };
  }
  const ends = points.filter(p => p.endpoint);
  if (!ends.length) return { camera: { k: readableZoom, x: width / 2 - (left + right) / 2 * readableZoom, y: height / 2 - (top + bottom) / 2 * readableZoom }, whole: false };
  const endLeft = Math.min(...ends.map(p => p.x - p.r)), endRight = Math.max(...ends.map(p => p.x + p.r));
  const k = Math.max(minZoom, Math.min(readableZoom, (width - padding) / Math.max(1, endRight - endLeft)));
  return { camera: { k, x: width / 2 - (endLeft + endRight) / 2 * k, y: height / 2 - (top + bottom) / 2 * k }, whole: false };
}

export interface Rect { left: number; top: number; right: number; bottom: number }

// The part of the world the camera shows, grown by `margin` screen pixels on every side (the room names, halos and a line's thickness need).
export function viewRect(camera: Camera, size: { width: number; height: number }, margin: number): Rect {
  const { x, y, k } = camera, m = margin / k;
  return { left: -x / k - m, top: -y / k - m, right: (size.width - x) / k + m, bottom: (size.height - y) / k + m };
}

export const rectHasRect = (outer: Rect, inner: Rect) => inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;

export const rectHasPoint = (rect: Rect, p: { x: number; y: number }) => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;

// Whether a straight line touches the rectangle (Liang–Barsky). A line with both ends outside still shows when it crosses the view.
export function rectHasSegment(rect: Rect, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - rect.left) && clip(dx, rect.right - a.x) && clip(-dy, a.y - rect.top) && clip(dy, rect.bottom - a.y);
}

// Level of detail: zoomed far out, people shrink to plain discs (no names, portraits or pulses; endpoints and whoever is selected keep theirs).
// The two thresholds differ so a zoom hovering at the edge does not flip back and forth.
export const FAR_ZOOM_IN = 0.5, FAR_ZOOM_OUT = 0.4;
export const isFarZoom = (k: number, wasFar: boolean) => k < FAR_ZOOM_OUT || (wasFar && k < FAR_ZOOM_IN);

// The CSS transform (`translate(x, y) scale(s)`, origin at the corner) that makes what is drawn for the camera `shown` look as if it were drawn
// for `next`: screen = s * (screen position under `shown`) + (x, y).
export function previewTransform(shown: Camera, next: Camera): { s: number; x: number; y: number } {
  const s = next.k / shown.k;
  return { s, x: next.x - s * shown.x, y: next.y - s * shown.y };
}
