// Switches for the explorer graph's performance measures, so each can be turned off to measure or to rule it out (see `ai-docs/guides/six-degrees-internals.md`).
// Culling: people and lines outside the view are kept out of the page (`display: none`) and not painted.
export const GRAPH_PERF_CULLING = true;
// Level of detail: zoomed far out in a big network, people lose their names and pulses (the endpoints, the selected person and the lit chain keep theirs).
export const GRAPH_PERF_LEVEL_OF_DETAIL = true;
// With level of detail on, also hide the portraits (and initials) of people zoomed far out. Off: portraits stay, which is the most expensive thing to draw.
export const GRAPH_PERF_HIDE_PORTRAITS = false;
// Zoom preview: a pinch, wheel or two-finger zoom scales the whole drawing with a CSS transform (no layout, no render per event) and the
// camera is committed in steps, since changing the scale of the SVG content lays out every person and line again.
export const GRAPH_PERF_ZOOM_PREVIEW = true;
