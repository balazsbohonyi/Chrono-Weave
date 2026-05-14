# Canvas Pan & Zoom: Complete Implementation Guide

**Purpose:** Enable an AI coding agent to implement production-quality pan, zoom, trackpad, and touch-pinch interactions on any web canvas element. This guide is self-contained — no reference to any other codebase is needed.

**What you get after following this guide:**
- Mouse wheel zooms, centered on the cursor
- Trackpad two-finger scroll pans the canvas
- Trackpad pinch (`Ctrl+wheel`) zooms
- `Shift + scroll` always zooms regardless of input device
- Touch single-finger drag pans
- Touch two-finger pinch zooms, centered on finger midpoint
- Smooth pinch → drag transition when one finger lifts
- Click vs drag discrimination (5 px threshold)
- Browser pinch-zoom prevented on the canvas element only

**Prerequisites:** A `<div>` container element with a scrollable/zoomable content child. TypeScript is used throughout; the plain-JS notes in Section 14 explain how to adapt each piece.

---

## Supported Interactions Reference

All gestures and shortcuts implemented by this guide:

| Input | Modifier | Action | Notes |
|-------|----------|--------|-------|
| Mouse wheel scroll | — | Zoom in/out centered on cursor | Discrete feel; `deltaY` in multiples of 100 (Windows) or 120 (macOS) |
| Mouse wheel scroll | Shift | Zoom in/out centered on cursor | Shift forces zoom mode explicitly |
| Mouse wheel scroll | Ctrl / Cmd | Zoom in/out centered on cursor | Treated identically to trackpad pinch |
| Trackpad two-finger scroll | — | Pan (both axes freely) | No axis lock; X and Y move simultaneously |
| Trackpad two-finger scroll | Shift | Zoom in/out centered on cursor | Shift overrides trackpad pan detection → zoom |
| Trackpad two-finger scroll | Ctrl / Cmd | Zoom in/out centered on cursor | Browser reports trackpad pinch as Ctrl+wheel |
| Trackpad pinch gesture | — | Zoom in/out centered on cursor | Same event as Ctrl+wheel; uses higher sensitivity (0.01 vs 0.001) |
| Left-click drag | — | Pan | Single pointer drag; pointer captured on element |
| Touch single-finger drag | — | Pan | Same code path as mouse drag |
| Touch two-finger pinch | — | Zoom centered on finger midpoint | Uses pointer distance ratio each frame |
| Touch pinch → lift one finger | — | Seamless transition to single-finger pan | Remaining finger becomes the new drag origin |

**Not implemented by this guide:** Space-key pan, middle-click pan, dedicated pan tool, right-click pan, zoom-to-fit shortcut.

---

## Architecture Overview

The implementation uses a three-layer model:

```
┌────────────────────────────────────────────────┐
│  ViewState  { scale, translateX, translateY }  │  ← What to render (React state)
├────────────────────────────────────────────────┤
│  Event Handlers  (wheel, pointer*)             │  ← What happened (pure functions)
├────────────────────────────────────────────────┤
│  CSS Transform  translate + scale              │  ← How to render (DOM style)
└────────────────────────────────────────────────┘
```

**Why `scale + translateX + translateY` is the minimal representation:**
All zoom and pan state can be described by a 2D affine transform. Three numbers are sufficient: one scalar for zoom, two for offset. Everything else (content size, focal point, coordinate conversion) is derived from these three at render time.

**State vs Refs decision rule:**

| Data | Use | Reason |
|------|-----|--------|
| `scale`, `translateX`, `translateY` | `useState` | Changes must trigger re-render |
| `isDragging` | `useState` | Changes cursor class (re-render needed) |
| `lastMousePos` | `useState` | Used in render to compute pan delta |
| `activePointersRef` | `useRef` | Updated on every `pointermove` — too frequent for state |
| `lastPinchDistanceRef` | `useRef` | Working memory; only used to compute next state |
| `isTrackpadModeRef` | `useRef` | Read synchronously inside event handler |
| `trackpadModeTimerRef` | `useRef` | Timer handle; never rendered |
| `dragStartPos` | `useRef` | Only read in `pointerup` for click detection |

---

## Section 2 — Coordinate System & Transform Math

### World Space vs Screen/Viewport Space

**World space** is the coordinate system of your content. It has a fixed size regardless of zoom. For example, in a timeline, a year 1500 always maps to the same world X position.

**Screen space** is what the user sees. It changes when the user pans or zooms.

### The Transform Formulas

```typescript
// World → Screen
const screenX = worldX * scale + translateX;
const screenY = worldY * scale + translateY;

// Screen → World
const worldX = (screenX - translateX) / scale;
const worldY = (screenY - translateY) / scale;
```

These two formulas are used everywhere: hit testing, hover detection, zoom focal point math.

### Why `transformOrigin: 'top left'` Is Required

CSS `transform: scale(S)` by default scales around the element's center. By setting `transformOrigin: 'top left'`, scaling is anchored at the top-left corner of the content, which makes the math above exact. If you use any other `transformOrigin`, the formulas break.

**Always set `transformOrigin: 'top left'` on the content wrapper. Never change this.**

### The Cursor-Centered Zoom Formula

When the user zooms, the world point under the cursor should stay under the cursor. This requires adjusting `translateX`/`translateY` as scale changes.

**Derivation:**
```
Before zoom: worldFocalX = (focalX - prevTranslateX) / prevScale
After zoom:  worldFocalX = (focalX - newTranslateX)  / newScale

Setting equal (focal point doesn't move in world space):
  (focalX - prevTranslateX) / prevScale = (focalX - newTranslateX) / newScale

Solving for newTranslateX:
  newTranslateX = focalX - (focalX - prevTranslateX) * (newScale / prevScale)
```

**In code:**
```typescript
const scaleRatio = newScale / prevScale;
const newTranslateX = focalX - (focalX - prevTranslateX) * scaleRatio;
const newTranslateY = focalY - (focalY - prevTranslateY) * scaleRatio;
```

Where `focalX` and `focalY` are **viewport-relative** coordinates (cursor position or finger midpoint relative to the container's top-left corner).

---

## Step 1 — ViewState and Refs Setup

### TypeScript Types

```typescript
interface ViewState {
  scale: number;
  translateX: number;
  translateY: number;
}
```

### Constants (tune these per app — see Section 12)

```typescript
const MIN_SCALE = 0.1;         // 10% zoom minimum
const MAX_SCALE = 5;           // 500% zoom maximum
const WHEEL_SENSITIVITY = 0.001;   // zoom speed for mouse wheel / shift+trackpad
const PINCH_SENSITIVITY = 0.01;    // zoom speed for ctrl+wheel (trackpad pinch)
const TRACKPAD_STICKY_MS = 300;    // ms to stay in trackpad mode after last trackpad event
const CLICK_THRESHOLD_PX = 5;     // pointer movement < this = click, not drag
const PAN_CLAMP_BUFFER = 0.8;     // fraction of viewport width as overscroll buffer
```

### React: State and Refs

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';

// ── Render-driving state ──────────────────────────────────────────────────────
const [viewState, setViewState] = useState<ViewState>({
  scale: 1,
  translateX: 0,
  translateY: 0,
});
const [isDragging, setIsDragging] = useState(false);
const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

// ── Working-memory refs (never drive renders) ─────────────────────────────────
const containerRef = useRef<HTMLDivElement>(null);

// Multi-touch tracking: pointerId → last known position
const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
// Distance between two fingers at the start of a pinch frame
const lastPinchDistanceRef = useRef<number | null>(null);
// Whether recent wheel events look like a trackpad
const isTrackpadModeRef = useRef(false);
const trackpadModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// Pointer position at pointerdown, for click-vs-drag detection
const dragStartPos = useRef({ x: 0, y: 0 });
```

### Vanilla JS Equivalent

```javascript
// All "state" and "refs" are plain variables on a controller object
const panZoom = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
  activePointers: new Map(),         // pointerId → {clientX, clientY}
  lastPinchDistance: null,           // number | null
  isTrackpadMode: false,
  trackpadModeTimer: null,           // timeout id
  dragStartX: 0,
  dragStartY: 0,
};

// Whenever scale/translateX/translateY change, call this to update the DOM:
function applyTransform() {
  contentEl.style.transform =
    `translate(${panZoom.translateX}px, ${panZoom.translateY}px) scale(${panZoom.scale})`;
}
```

---

## Step 2 — Register the Native Wheel Listener

### Why Not React's `onWheel`?

React 17+ registers synthetic `onWheel` handlers as passive by default (a browser performance optimization). Passive listeners **cannot call `e.preventDefault()`**, which is required to block browser pinch-zoom when the user Ctrl+scrolls. Use a native `addEventListener` with `{ passive: false }` instead.

### React: useEffect Registration

```typescript
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  el.addEventListener('wheel', handleWheel, { passive: false });
  return () => {
    el.removeEventListener('wheel', handleWheel);
    if (trackpadModeTimerRef.current) clearTimeout(trackpadModeTimerRef.current);
  };
  // handleWheel must be stable (useCallback with correct deps) or re-register on change
}, [handleWheel]);
```

> **Important:** `handleWheel` must be wrapped in `useCallback` with its dependencies, or the `useEffect` cleanup will detach the old listener but the new one won't be re-added. Alternatively, put all the logic inline inside the `useEffect`.

### Vanilla JS

```javascript
document.addEventListener('DOMContentLoaded', () => {
  containerEl.addEventListener('wheel', handleWheel, { passive: false });
});
```

---

## Step 3 — Trackpad vs Mouse Wheel Detection

### The Heuristic

Physical mouse wheels produce `deltaY` in exact multiples of **100** (Windows/Chrome) or **120** (macOS). Trackpads produce smooth, variable values like `3`, `7`, `13`, `27` — values that almost never land on those multiples.

Additional signals:
- `deltaX !== 0` → only trackpads produce horizontal scroll from natural scrolling
- `e.deltaMode !== 0` → Firefox uses line/page mode for physical wheels; trackpads always use pixel mode (0)
- `e.ctrlKey || e.metaKey` → browser reports trackpad pinch gesture as `ctrlKey + wheel`

### Priority Decision Table

Evaluated top-to-bottom; first match wins:

| # | Condition | Interpretation | Action |
|---|-----------|---------------|--------|
| 1 | `e.ctrlKey \|\| e.metaKey` | Trackpad pinch | **Zoom** + `preventDefault` |
| 2 | `e.shiftKey` | User forced zoom | **Zoom** |
| 3 | `e.deltaMode !== 0` | Firefox physical wheel | **Zoom** |
| 4 | `Math.abs(e.deltaY) % 100 === 0 \|\| Math.abs(e.deltaY) % 120 === 0` (and `deltaY !== 0`) | Mouse wheel click | **Zoom** |
| 5 | `Math.abs(e.deltaX) > 0` or `deltaY` not a multiple | Trackpad | **Pan** |
| 6 | `isTrackpadModeRef.current === true` (within 300ms) | Gesture continuation | **Pan** |

### The Sticky-Mode Timer

Once trackpad mode is detected, hold it for 300ms. This prevents a single gesture from flip-flopping between pan and zoom if a mid-gesture event coincidentally produces a multiple-of-100 delta.

```typescript
function markTrackpadMode() {
  isTrackpadModeRef.current = true;
  if (trackpadModeTimerRef.current) clearTimeout(trackpadModeTimerRef.current);
  trackpadModeTimerRef.current = setTimeout(() => {
    isTrackpadModeRef.current = false;
  }, TRACKPAD_STICKY_MS);
}

function detectTrackpad(e: WheelEvent): boolean {
  const absY = Math.abs(e.deltaY);
  const isMouseStep =
    e.deltaY !== 0 &&
    Number.isInteger(e.deltaY) &&
    (absY % 100 === 0 || absY % 120 === 0);
  const hasDeltaX = Math.abs(e.deltaX) > 0;

  if (hasDeltaX || (e.deltaY !== 0 && !isMouseStep)) {
    markTrackpadMode();
    return true;
  }
  return isTrackpadModeRef.current;
}
```

---

## Step 4 — Full Wheel Event Handler

```typescript
const handleWheel = useCallback((e: WheelEvent) => {
  e.preventDefault(); // always prevent — we handle all zoom/pan ourselves

  const rect = containerRef.current!.getBoundingClientRect();
  // Focal point = cursor position relative to container top-left
  const focalX = e.clientX - rect.left;
  const focalY = e.clientY - rect.top;

  const isCtrl  = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;
  const isLineOrPageMode = e.deltaMode !== 0;
  const looksLikeTrackpad = detectTrackpad(e);

  const shouldZoom = isCtrl || isShift || isLineOrPageMode || !looksLikeTrackpad;

  setViewState(prev => {
    if (shouldZoom) {
      // ── Zoom branch ───────────────────────────────────────────────────────
      // Ctrl (trackpad pinch) reports smaller deltas → use coarser sensitivity
      const sensitivity = isCtrl ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
      let newScale = prev.scale * (1 - e.deltaY * sensitivity);
      newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
      const scaleRatio = newScale / prev.scale;
      return {
        scale: newScale,
        translateX: focalX - (focalX - prev.translateX) * scaleRatio,
        translateY: focalY - (focalY - prev.translateY) * scaleRatio,
      };
    } else {
      // ── Pan branch ────────────────────────────────────────────────────────
      let nextX = prev.translateX - e.deltaX;
      let nextY = prev.translateY - e.deltaY;

      // Optional: clamp horizontal pan so content stays reachable
      // Remove this block if you want unconstrained panning
      const contentWidth = /* your content world width in px */ 5000;
      const viewportWidth = rect.width;
      const totalWidth = contentWidth * prev.scale;
      const buffer = viewportWidth * PAN_CLAMP_BUFFER;
      nextX = Math.min(buffer, Math.max(viewportWidth - totalWidth - buffer, nextX));

      return { ...prev, translateX: nextX, translateY: nextY };
    }
  });
}, [/* add any closure vars like contentWidth if needed */]);
```

> **Note on `contentWidth`:** Replace the placeholder `5000` with the actual pixel width of your content in world space. This is used only for horizontal pan clamping; remove the clamp block entirely if you want unbounded panning.

---

## Step 5 — handlePointerDown

```typescript
const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  // Track all pointers by ID (supports multi-touch)
  activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
  // Capture pointer so we receive events even if cursor leaves the element
  containerRef.current?.setPointerCapture(e.pointerId);

  if (activePointersRef.current.size === 2) {
    // ── Two fingers: start pinch ──────────────────────────────────────────
    setIsDragging(false); // cancel any in-progress drag
    const pts = [...activePointersRef.current.values()];
    lastPinchDistanceRef.current = Math.hypot(
      pts[1].clientX - pts[0].clientX,
      pts[1].clientY - pts[0].clientY,
    );
    return;
  }

  // ── One finger / mouse button: start drag ────────────────────────────────
  if (e.button === 0 || e.button === 1) { // left or middle button
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    setLastMousePos({ x: e.clientX, y: e.clientY });
  }
}, []);
```

---

## Step 6 — handlePointerMove

```typescript
const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  // Keep the pointer map current
  if (activePointersRef.current.has(e.pointerId)) {
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
  }

  if (activePointersRef.current.size === 2 && lastPinchDistanceRef.current !== null) {
    // ── Two-finger pinch zoom ─────────────────────────────────────────────
    const pts = [...activePointersRef.current.values()];
    const newDist = Math.hypot(
      pts[1].clientX - pts[0].clientX,
      pts[1].clientY - pts[0].clientY,
    );
    const ratio = newDist / lastPinchDistanceRef.current;
    lastPinchDistanceRef.current = newDist;

    const rect = containerRef.current!.getBoundingClientRect();
    // Focal point = midpoint between the two fingers, relative to container
    const focalX = (pts[0].clientX + pts[1].clientX) / 2 - rect.left;
    const focalY = (pts[0].clientY + pts[1].clientY) / 2 - rect.top;

    setViewState(prev => {
      let newScale = prev.scale * ratio;
      newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
      const scaleRatio = newScale / prev.scale;
      return {
        scale: newScale,
        translateX: focalX - (focalX - prev.translateX) * scaleRatio,
        translateY: focalY - (focalY - prev.translateY) * scaleRatio,
      };
    });
    return;
  }

  if (isDragging) {
    // ── Single-pointer drag pan ───────────────────────────────────────────
    const dx = e.clientX - lastMousePos.x;
    const dy = e.clientY - lastMousePos.y;

    setViewState(prev => {
      let nextX = prev.translateX + dx;

      // Optional horizontal clamp — remove if unbounded panning is desired
      const contentWidth = /* your content world width in px */ 5000;
      const rect = containerRef.current!.getBoundingClientRect();
      const viewportWidth = rect.width;
      const totalWidth = contentWidth * prev.scale;
      const buffer = viewportWidth * PAN_CLAMP_BUFFER;
      nextX = Math.min(buffer, Math.max(viewportWidth - totalWidth - buffer, nextX));

      return { ...prev, translateX: nextX, translateY: prev.translateY + dy };
    });
    setLastMousePos({ x: e.clientX, y: e.clientY });
  }
}, [isDragging, lastMousePos]);
```

---

## Step 7 — handlePointerUp

```typescript
const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  const wasPinching = activePointersRef.current.size === 2;
  activePointersRef.current.delete(e.pointerId);

  if (wasPinching && activePointersRef.current.size === 1) {
    // ── Pinch → drag transition ───────────────────────────────────────────
    // One finger lifted; continue with remaining finger as a drag
    lastPinchDistanceRef.current = null;
    const remaining = [...activePointersRef.current.values()][0];
    setLastMousePos({ x: remaining.clientX, y: remaining.clientY });
    setIsDragging(true);
    return;
  }

  setIsDragging(false);
  lastPinchDistanceRef.current = null;

  // ── Click detection ───────────────────────────────────────────────────────
  const dist = Math.hypot(
    e.clientX - dragStartPos.current.x,
    e.clientY - dragStartPos.current.y,
  );
  if (dist < CLICK_THRESHOLD_PX && e.button === 0) {
    // Treat as a click — add your click-handling logic here
    // Example: hit-test against rendered objects using world coordinates
    const rect = containerRef.current!.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - viewState.translateX) / viewState.scale;
    const worldY = (e.clientY - rect.top  - viewState.translateY) / viewState.scale;
    // onCanvasClick(worldX, worldY);   ← call your handler here
    console.log('canvas click at world', worldX, worldY);
  }
}, [viewState]);
```

---

## Step 8 — handlePointerCancel

Called by the OS when a gesture is interrupted (incoming call, system gesture, pointer capture lost).

```typescript
const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  activePointersRef.current.delete(e.pointerId);
  lastPinchDistanceRef.current = null;
  if (activePointersRef.current.size === 0) {
    setIsDragging(false);
  }
}, []);
```

---

## Step 9 — Apply the CSS Transform

### Container Element

```tsx
<div
  ref={containerRef}
  style={{
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    userSelect: 'none',
    touchAction: 'none',        // disables browser default touch pan/zoom
    cursor: isDragging ? 'grabbing' : 'default',
  }}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onPointerCancel={handlePointerCancel}
>
  {/* Content wrapper — this is what gets transformed */}
  <div
    style={{
      transform: `translate(${viewState.translateX}px, ${viewState.translateY}px) scale(${viewState.scale})`,
      transformOrigin: 'top left',  // CRITICAL — do not change
      width: contentWidth,
      height: contentHeight,
    }}
  >
    {/* Your content here */}
  </div>
</div>
```

> **Tailwind equivalent classes for the container:**
> `relative w-full h-full overflow-hidden select-none touch-none`

### Important Notes
- `touch-action: none` disables browser pan/zoom for touch — required so pointer events fire correctly on touch devices
- `user-select: none` prevents text selection during drag
- The `transform` and `transformOrigin` go on the **content wrapper**, not the container
- `transformOrigin: 'top left'` is non-negotiable — the coordinate math assumes this

---

## Section 12 — What to Adapt for Your App

Every value in this table is app-specific. The formulas and event-handling structure are universal.

| Parameter | This Guide's Default | When to Change |
|-----------|---------------------|----------------|
| `MIN_SCALE` | `0.1` | Lower if your content needs extreme zoom-out |
| `MAX_SCALE` | `5` | Higher if you need more zoom-in detail |
| `WHEEL_SENSITIVITY` | `0.001` | Increase for faster scroll zoom, decrease for finer control |
| `PINCH_SENSITIVITY` | `0.01` | Keep ~10× `WHEEL_SENSITIVITY`; trackpad pinch reports smaller deltas |
| `TRACKPAD_STICKY_MS` | `300` | Rarely needs changing |
| `CLICK_THRESHOLD_PX` | `5` | Increase to `10–15` for touch-first apps where fingers drift more |
| `PAN_CLAMP_BUFFER` | `0.8` (80% viewport) | Set to `0` for strict bounds; remove the clamp entirely for unbounded |
| Initial `scale` | `1` | Set to show the right initial zoom level for your content |
| Initial `translateX/Y` | `0` | Adjust to center content or show a specific area on load |
| `transformOrigin` | `'top left'` | **Never change** |
| Forward/inverse formulas | `x * scale + tx` | **Never change** |
| `contentWidth` in clamp | app-specific | The pixel width of your world-space content |

### Coordinate Domain Mapping

The world-space coordinates (`worldX`, `worldY`) are generic pixel positions. Map them to your app's domain after the transform math:

```typescript
// Example: timeline where worldX 0..50000 maps to years 0..5000
const year = (worldX / PIXELS_PER_YEAR) + START_YEAR;

// Example: map where worldX 0..8000 maps to longitude -180..180
const longitude = (worldX / MAP_WIDTH) * 360 - 180;

// Example: graph where worldX is directly the data coordinate (no mapping needed)
const dataX = worldX;
```

Strip the domain mapping from the boilerplate entirely and add your own after the coordinate transform.

### Axis Clamping

The guide includes horizontal (`X`) clamping to prevent the content from scrolling off-screen. Vertical clamping follows the same pattern:

```typescript
const buffer = viewportHeight * PAN_CLAMP_BUFFER;
const maxTranslateY = buffer;
const minTranslateY = viewportHeight - (contentHeight * scale) - buffer;
nextY = Math.min(maxTranslateY, Math.max(minTranslateY, nextY));
```

---

## Section 13 — Complete Minimal React Example

A self-contained ~150-line component you can drop into any React + TypeScript project. Replace the `<YourContent />` placeholder with your real content.

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';

// ── Constants — tune these for your app ────────────────────────────────────────
const MIN_SCALE           = 0.1;
const MAX_SCALE           = 5;
const WHEEL_SENSITIVITY   = 0.001;
const PINCH_SENSITIVITY   = 0.01;
const TRACKPAD_STICKY_MS  = 300;
const CLICK_THRESHOLD_PX  = 5;
const PAN_CLAMP_BUFFER    = 0.8;
const CONTENT_WIDTH       = 3000;  // world-space pixel width of your content
const CONTENT_HEIGHT      = 2000;  // world-space pixel height of your content

interface ViewState { scale: number; translateX: number; translateY: number; }

export function PanZoomCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  const [viewState, setViewState] = useState<ViewState>({ scale: 1, translateX: 0, translateY: 0 });
  const [isDragging, setIsDragging]   = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  const activePointersRef     = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const lastPinchDistanceRef  = useRef<number | null>(null);
  const isTrackpadModeRef     = useRef(false);
  const trackpadModeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPos          = useRef({ x: 0, y: 0 });
  // Keep a stable ref to viewState for use inside pointerup callback
  const viewStateRef = useRef(viewState);
  useEffect(() => { viewStateRef.current = viewState; }, [viewState]);

  // ── Trackpad detection ──────────────────────────────────────────────────────
  const detectTrackpad = useCallback((e: WheelEvent): boolean => {
    const absY = Math.abs(e.deltaY);
    const isMouseStep = e.deltaY !== 0 && Number.isInteger(e.deltaY) &&
      (absY % 100 === 0 || absY % 120 === 0);
    const hasDeltaX = Math.abs(e.deltaX) > 0;

    if (hasDeltaX || (e.deltaY !== 0 && !isMouseStep)) {
      isTrackpadModeRef.current = true;
      if (trackpadModeTimerRef.current) clearTimeout(trackpadModeTimerRef.current);
      trackpadModeTimerRef.current = setTimeout(() => {
        isTrackpadModeRef.current = false;
      }, TRACKPAD_STICKY_MS);
      return true;
    }
    return isTrackpadModeRef.current;
  }, []);

  // ── Wheel handler (registered as non-passive native listener) ───────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const focalX = e.clientX - rect.left;
    const focalY = e.clientY - rect.top;
    const isCtrl = e.ctrlKey || e.metaKey;
    const shouldZoom = isCtrl || e.shiftKey || e.deltaMode !== 0 || !detectTrackpad(e);

    setViewState(prev => {
      if (shouldZoom) {
        const sensitivity = isCtrl ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
        let newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * (1 - e.deltaY * sensitivity)));
        const r = newScale / prev.scale;
        return {
          scale: newScale,
          translateX: focalX - (focalX - prev.translateX) * r,
          translateY: focalY - (focalY - prev.translateY) * r,
        };
      }
      let nextX = prev.translateX - e.deltaX;
      const buffer = rect.width * PAN_CLAMP_BUFFER;
      nextX = Math.min(buffer, Math.max(rect.width - CONTENT_WIDTH * prev.scale - buffer, nextX));
      return { ...prev, translateX: nextX, translateY: prev.translateY - e.deltaY };
    });
  }, [detectTrackpad]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (trackpadModeTimerRef.current) clearTimeout(trackpadModeTimerRef.current);
    };
  }, [handleWheel]);

  // ── Pointer handlers ────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    containerRef.current?.setPointerCapture(e.pointerId);

    if (activePointersRef.current.size === 2) {
      setIsDragging(false);
      const pts = [...activePointersRef.current.values()];
      lastPinchDistanceRef.current = Math.hypot(
        pts[1].clientX - pts[0].clientX,
        pts[1].clientY - pts[0].clientY,
      );
      return;
    }
    if (e.button === 0 || e.button === 1) {
      setIsDragging(true);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    }

    if (activePointersRef.current.size === 2 && lastPinchDistanceRef.current !== null) {
      const pts = [...activePointersRef.current.values()];
      const newDist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
      const ratio = newDist / lastPinchDistanceRef.current;
      lastPinchDistanceRef.current = newDist;
      const rect = containerRef.current!.getBoundingClientRect();
      const focalX = (pts[0].clientX + pts[1].clientX) / 2 - rect.left;
      const focalY = (pts[0].clientY + pts[1].clientY) / 2 - rect.top;
      setViewState(prev => {
        let newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * ratio));
        const r = newScale / prev.scale;
        return {
          scale: newScale,
          translateX: focalX - (focalX - prev.translateX) * r,
          translateY: focalY - (focalY - prev.translateY) * r,
        };
      });
      return;
    }

    if (isDragging) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      setViewState(prev => {
        let nextX = prev.translateX + dx;
        const rect = containerRef.current!.getBoundingClientRect();
        const buffer = rect.width * PAN_CLAMP_BUFFER;
        nextX = Math.min(buffer, Math.max(rect.width - CONTENT_WIDTH * prev.scale - buffer, nextX));
        return { ...prev, translateX: nextX, translateY: prev.translateY + dy };
      });
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  }, [isDragging, lastMousePos]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wasPinching = activePointersRef.current.size === 2;
    activePointersRef.current.delete(e.pointerId);

    if (wasPinching && activePointersRef.current.size === 1) {
      lastPinchDistanceRef.current = null;
      const remaining = [...activePointersRef.current.values()][0];
      setLastMousePos({ x: remaining.clientX, y: remaining.clientY });
      setIsDragging(true);
      return;
    }
    setIsDragging(false);
    lastPinchDistanceRef.current = null;

    const dist = Math.hypot(e.clientX - dragStartPos.current.x, e.clientY - dragStartPos.current.y);
    if (dist < CLICK_THRESHOLD_PX && e.button === 0) {
      const rect = containerRef.current!.getBoundingClientRect();
      const vs = viewStateRef.current;
      const worldX = (e.clientX - rect.left - vs.translateX) / vs.scale;
      const worldY = (e.clientY - rect.top  - vs.translateY) / vs.scale;
      console.log('canvas click at world coords', worldX, worldY);
      // ← Replace with your click handler
    }
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    lastPinchDistanceRef.current = null;
    if (activePointersRef.current.size === 0) setIsDragging(false);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Content wrapper */}
      <div
        style={{
          transform: `translate(${viewState.translateX}px, ${viewState.translateY}px) scale(${viewState.scale})`,
          transformOrigin: 'top left',
          width: CONTENT_WIDTH,
          height: CONTENT_HEIGHT,
          position: 'absolute',
        }}
      >
        {/* Replace with your actual content */}
        <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #e8f4f8, #d4edda)' }}>
          <p style={{ padding: 40, fontSize: 24 }}>Your content here — pan and zoom me</p>
        </div>
      </div>
    </div>
  );
}
```

---

## Section 14 — Plain JS / Non-React Wiring Notes

The logic is identical in vanilla JS; only the wiring differs.

### State → Variables + DOM Updates

```javascript
// Instead of useState:
let scale = 1, translateX = 0, translateY = 0;
let isDragging = false;
let lastMouseX = 0, lastMouseY = 0;

// Instead of setViewState(prev => {...}):
function applyTransform() {
  contentEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}
// Call applyTransform() at the end of every event handler that changes scale/translate.

// Instead of setIsDragging(true):
isDragging = true;
containerEl.style.cursor = 'grabbing';
```

### Refs → Plain Variables

```javascript
const activePointers    = new Map();   // was activePointersRef.current
let lastPinchDistance   = null;        // was lastPinchDistanceRef.current
let isTrackpadMode      = false;       // was isTrackpadModeRef.current
let trackpadModeTimer   = null;        // was trackpadModeTimerRef.current
let dragStartX          = 0;           // was dragStartPos.current.x
let dragStartY          = 0;           // was dragStartPos.current.y
```

### useEffect → Init Function

```javascript
function initPanZoom(containerEl, contentEl) {
  containerEl.addEventListener('wheel', handleWheel, { passive: false });
  containerEl.addEventListener('pointerdown',   handlePointerDown);
  containerEl.addEventListener('pointermove',   handlePointerMove);
  containerEl.addEventListener('pointerup',     handlePointerUp);
  containerEl.addEventListener('pointercancel', handlePointerCancel);

  // Cleanup (call this when unmounting / destroying):
  return function destroy() {
    containerEl.removeEventListener('wheel', handleWheel);
    containerEl.removeEventListener('pointerdown',   handlePointerDown);
    containerEl.removeEventListener('pointermove',   handlePointerMove);
    containerEl.removeEventListener('pointerup',     handlePointerUp);
    containerEl.removeEventListener('pointercancel', handlePointerCancel);
    if (trackpadModeTimer) clearTimeout(trackpadModeTimer);
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const destroy = initPanZoom(
    document.getElementById('container'),
    document.getElementById('content'),
  );
  // Call destroy() when done
});
```

### CSS (vanilla)

```css
#container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  touch-action: none;
  cursor: default;
}

#content {
  position: absolute;
  transform-origin: top left; /* CRITICAL */
  /* width/height set to your content size */
}
```

---

## Quick Reference: Gesture State Machine

```
IDLE
 ├── pointerdown (1 pointer)    → DRAGGING
 │    ├── pointermove           → pan content
 │    ├── pointerdown (2nd)     → PINCHING  (cancel drag)
 │    └── pointerup (dist < 5px) → CLICK → IDLE
 │         pointerup (dist ≥ 5px) → IDLE
 │
 ├── pointerdown (2 pointers)   → PINCHING
 │    ├── pointermove           → zoom at midpoint
 │    ├── pointerup (1 remains) → DRAGGING  (smooth transition)
 │    └── pointerup (all up)    → IDLE
 │
 ├── wheel (ctrl / shift / mouse wheel) → ZOOMING  (state update, back to IDLE)
 └── wheel (trackpad, no modifier)      → PANNING  (state update, back to IDLE)

All zoom operations:
  - Clamp scale to [MIN_SCALE, MAX_SCALE]
  - Preserve focal point using: newT = focal - (focal - prevT) * (newScale / prevScale)

Panning:
  - X-axis: optionally clamped to keep content reachable
  - Y-axis: unclamped by default (add clamp if needed)
```
