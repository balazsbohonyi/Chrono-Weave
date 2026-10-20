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
