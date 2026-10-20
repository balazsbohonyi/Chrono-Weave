// Portraits come from Wikimedia as thumbnails up to 400px wide but are shown in boxes of 32-112px. A crowd of oversized pictures
// overflows the browser's decoded-image cache, so every repaint decodes and scales them all again (that is what made big timelines
// and the Six Degrees graph slow). This picks the smallest Wikimedia thumbnail that still covers the box on this screen.

// Wikimedia's standard thumbnail widths: other widths may be rendered slowly or refused.
const STANDARD_WIDTHS = [60, 120, 250, 330, 500, 960];
const devicePixels = () => (typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);

// The thumbnail width wanted for a box `cssPixels` wide, shown at `zoom` on a screen of `pixelRatio`.
export function portraitWidth(cssPixels: number, zoom = 1, pixelRatio = devicePixels()) {
  const needed = cssPixels * zoom * pixelRatio;
  return STANDARD_WIDTHS.find(width => width >= needed) ?? STANDARD_WIDTHS[STANDARD_WIDTHS.length - 1];
}

// The same picture at the wanted width. Only Wikimedia thumbnails are resized (`…/thumb/…/400px-Name.jpg` and
// `Special:FilePath/…?width=400`), and only made smaller: a thumbnail is never asked for wider than the one stored, which Wikimedia
// could not provide when the original is smaller. Anything else (an original file, another host) comes back unchanged.
export function sizedPortrait<T extends string | null | undefined>(url: T, cssPixels: number, zoom = 1, pixelRatio = devicePixels()): T | string {
  if (!url) return url;
  const width = portraitWidth(cssPixels, zoom, pixelRatio);
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (!/(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/.test(parsed.hostname)) return url;
  if (parsed.pathname.includes('/Special:FilePath/')) {
    const stored = Number(parsed.searchParams.get('width'));
    if (!(stored > width)) return url;
    parsed.searchParams.set('width', String(width));
    return parsed.toString();
  }
  const match = parsed.pathname.match(/^(.*\/thumb\/.*\/)(\d+)px-([^/]+)$/);
  if (!match || !(Number(match[2]) > width)) return url;
  parsed.pathname = `${match[1]}${width}px-${match[3]}`;
  return parsed.toString();
}
