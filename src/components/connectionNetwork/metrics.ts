// Sizes shared by the layout (collision radius) and the drawing.
export const nodeRadius = (endpoint: boolean, narrow: boolean) => endpoint ? (narrow ? 26 : 32) : (narrow ? 18 : 22);
export const labelLimit = (narrow: boolean) => narrow ? 14 : 18;
export const NARROW_QUERY = '(max-width: 760px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
