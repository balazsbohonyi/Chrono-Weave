// Switches for the explorer graph's performance measures, so each can be turned off to measure or to rule it out (see `ai-docs/guides/six-degrees-internals.md`).
// Each can also be overridden without a rebuild, to compare on another screen: `localStorage.setItem('chrono_perf_<name>', 'false' | 'true')` (name: culling, level_of_detail,
// hide_portraits, zoom_preview), then reload; `removeItem` returns to the default. Read once, when the module loads.
const flag = (name: string, fallback: boolean) => {
  try {
    const stored = localStorage.getItem(`chrono_perf_${name}`);
    return stored === 'true' ? true : stored === 'false' ? false : fallback;
  } catch { return fallback; }
};
// Culling: people and lines outside the view are kept out of the page (`display: none`) and not painted.
export const GRAPH_PERF_CULLING = flag('culling', true);
// Level of detail: zoomed far out in a big network, people lose their names, pulses and "+n" fold badges (the endpoints, the selected person and the lit chain keep theirs).
export const GRAPH_PERF_LEVEL_OF_DETAIL = flag('level_of_detail', true);
// With level of detail on, also hide the portraits (and initials) of people zoomed far out. Off: portraits stay, which is the most expensive thing to draw (on a 4K screen hiding them was the biggest single gain).
export const GRAPH_PERF_HIDE_PORTRAITS = flag('hide_portraits', true);
// Zoom preview (off by default: on a 4K screen it made a zoom start late and flicker at its end, and zooming redrawn directly was smoother): a pinch, wheel or two-finger zoom scales the whole drawing with a CSS transform (no layout, no render per event) and the
// camera is committed in steps, since changing the scale of the SVG content lays out every person and line again.
export const GRAPH_PERF_ZOOM_PREVIEW = flag('zoom_preview', false);
