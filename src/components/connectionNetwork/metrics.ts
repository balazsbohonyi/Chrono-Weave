// Sizes shared by the layout (collision radius) and the drawing.
export const nodeRadius = (endpoint: boolean, narrow: boolean) => endpoint ? (narrow ? 26 : 32) : (narrow ? 18 : 22);
// How far the "+n" badge of a folded person (28 by 18, centred 0.8 radii down and to the right of the disc) reaches beyond the disc.
export const foldBadgeReach = (radius: number) => Math.ceil(Math.hypot(radius * 0.8 + 14, radius * 0.8 + 9) - radius);
export const labelLimit = (narrow: boolean) => narrow ? 14 : 18;
// The full-screen explorer's floating panel: its width and the gap around it. The strip it covers at the right edge of the graph is
// `FLOATING_PANEL_INSET`; connectionExplorer.css (`.is-floating`, `--panel-inset`) carries the same numbers.
export const FLOATING_PANEL_WIDTH = 380;
export const FLOATING_PANEL_MARGIN = 14;
export const FLOATING_PANEL_INSET = FLOATING_PANEL_WIDTH + FLOATING_PANEL_MARGIN * 2;
export const NARROW_QUERY = '(max-width: 760px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
