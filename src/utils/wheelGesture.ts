// Wheel events do not say which device produced them. Large vertical-only pixel impulses are treated
// as mouse-wheel notches; finer or horizontal events mean a trackpad and stay in trackpad mode for the
// rest of the gesture, so acceleration cannot flip a two-finger pan into a zoom half way through.
// The target mouse reports about 90.91px per notch and the Precision Touchpad 0.91-3.64px.
export const MOUSE_WHEEL_IMPULSE_THRESHOLD_PX = 40;
export const TRACKPAD_STICKY_MS = 300;
const WHEEL_ZOOM_SENSITIVITY = 0.001;
const PINCH_ZOOM_SENSITIVITY = 0.01;

export interface WheelLike {
  deltaX: number; deltaY: number; deltaMode: number;
  ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
}
// A zoom is a scale factor to multiply the camera with; a pan is how far the content should move.
export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

const DOM_DELTA_PIXEL = 0;

// One classifier per canvas: it remembers whether the current gesture came from a trackpad.
export function createWheelClassifier(now: () => number = Date.now) {
  let trackpadUntil = 0;
  return function classifyWheel(event: WheelLike): WheelIntent {
    const modified = event.ctrlKey || event.metaKey; // ctrlKey is also how a trackpad pinch arrives
    const lineOrPage = event.deltaMode !== DOM_DELTA_PIXEL;
    const hasDeltaX = Math.abs(event.deltaX) > 0;
    const impulse = lineOrPage || (!hasDeltaX && Math.abs(event.deltaY) >= MOUSE_WHEEL_IMPULSE_THRESHOLD_PX);
    const trackpadSignature = event.deltaMode === DOM_DELTA_PIXEL && (hasDeltaX || (event.deltaY !== 0 && !impulse));
    if (trackpadSignature) trackpadUntil = now() + TRACKPAD_STICKY_MS;
    const looksLikeTrackpad = trackpadSignature || now() < trackpadUntil;

    if (modified || event.shiftKey || lineOrPage || !looksLikeTrackpad) {
      // Fine Ctrl/Cmd input is a trackpad pinch; a physical wheel keeps ordinary sensitivity even with Ctrl held.
      const sensitivity = modified && !impulse ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
      return { kind: 'zoom', factor: 1 - event.deltaY * sensitivity };
    }
    return { kind: 'pan', dx: event.deltaX, dy: event.deltaY };
  };
}
