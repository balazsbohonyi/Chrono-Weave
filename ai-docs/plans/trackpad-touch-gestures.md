# Trackpad & Touch Gesture Support for TimelineCanvas

**Status:** Implemented
**Date:** 2026-02-27
**File Modified:** `src/components/TimelineCanvas.tsx`

## Problem

The TimelineCanvas only supported mouse wheel zoom and single-pointer drag for panning. Trackpad users (two-finger scroll) got zoom instead of the expected pan behavior. No pinch-to-zoom support existed for touchscreens.

## Solution Summary

Added proper gesture differentiation so that:

- Two-finger trackpad scrolling **pans** the canvas
- SHIFT + two-finger vertical scroll **zooms**
- Trackpad pinch (ctrl+wheel) **zooms** (prevents browser zoom)
- Mouse wheel continues to **zoom** (unchanged)
- Touchscreen pinch-to-zoom works via multi-pointer tracking
- Touchscreen pinch-to-single-finger transitions smoothly to pan

## Implementation Details

### 1. Gesture Tracking Refs

Added after existing drag refs (~line 377):

- `activePointersRef` — `Map<number, { clientX, clientY }>` for multi-touch tracking
- `lastPinchDistanceRef` — stores distance between two fingers for pinch ratio
- `isTrackpadModeRef` + `trackpadModeTimerRef` — delta-magnitude heuristic to detect trackpad vs mouse wheel

All refs (not state) because they're read/written synchronously in event handlers and never drive rendering.

### 2. Native Non-Passive Wheel Listener

Replaced React `onWheel` with a `useEffect` that registers a native wheel handler with `{ passive: false }`. This is required because React's `onWheel` is passive in Chrome and `e.preventDefault()` is ignored (needed to block browser zoom on pinch).

**Trackpad vs Mouse Wheel Detection:**

Mouse wheels produce `deltaY` in exact multiples of 100 (Windows Chrome) or 120 (macOS). Trackpads produce variable values (3, 7, 13, 27...) that almost never land on these multiples. This check works on the very first event — no warm-up period needed.

Once trackpad is detected, `isTrackpadModeRef` stays true for 300ms to cover the entire gesture (so even if a trackpad event coincidentally produces a multiple of 100 mid-gesture, it still pans).

**Detection logic (priority order):**

| Condition | Interpretation | Action |
|-----------|---------------|--------|
| `e.ctrlKey` or `e.metaKey` | Trackpad pinch gesture | **Zoom** + `preventDefault` |
| `e.shiftKey` | Explicit shift+scroll | **Zoom** |
| `e.deltaMode !== 0` | Line/page mode = physical mouse wheel (Firefox) | **Zoom** |
| `deltaY` is multiple of 100 or 120 | Mouse wheel step | **Zoom** |
| `deltaY` is any other value, or `deltaX` present | Trackpad | **Pan** |
| Already in trackpad mode (within 300ms) | Trackpad gesture continuation | **Pan** |

Zoom uses cursor-centered formula (same math as before). Pan uses `-deltaX` and `-deltaY` as translate offsets, with both axes free to move simultaneously (no directional locking). Pinch gesture uses higher `scaleSensitivity` (0.01 vs 0.001) since `ctrlKey` wheel events report smaller deltas.

### 3. Multi-Pointer Tracking in `handlePointerDown`

- Always stores pointer in `activePointersRef` and calls `setPointerCapture`
- 1 pointer: starts drag (existing behavior)
- 2 pointers: cancels drag, computes initial pinch distance

### 4. Pinch-to-Zoom in `handlePointerMove`

- Updates stored pointer position in the map
- 2 pointers active: computes distance ratio vs `lastPinchDistanceRef`, applies scale change centered on finger midpoint
- ≤1 pointer + dragging: existing single-pointer pan (unchanged)
- Hover year computation only runs with ≤1 pointer (pinch shouldn't trigger hover)

### 5. Graceful Multi-Pointer Cleanup in `handlePointerUp`

- Removes pointer from `activePointersRef`
- 2→1 pointer transition: resets pinch distance, resumes single-pointer drag from remaining pointer position
- 0 pointers: existing click detection logic (unchanged)

### 6. `handlePointerCancel` Handler

Cleans up pointer state when OS interrupts gestures (incoming call, system gesture). Removes pointer from map, resets pinch distance.

### 7. JSX Changes

- Removed `onWheel={handleWheel}` (native listener replaces it)
- Added `onPointerCancel={handlePointerCancel}`
- `touch-none` CSS class was already present

## Verification Checklist

- [x] Mouse wheel: zooms in/out centered on cursor (unchanged)
- [x] Trackpad two-finger scroll: pans in scroll direction
- [x] Trackpad SHIFT + two-finger vertical: zooms
- [x] Trackpad pinch gesture: zooms centered (browser reports as ctrl+wheel)
- [x] Touchscreen single-finger drag: pans
- [x] Touchscreen two-finger pinch: zooms centered on midpoint
- [x] Touchscreen pinch release to one finger: transitions smoothly to pan
- [x] Click/tap on figures: still works (click vs drag threshold preserved)
- [x] Browser zoom: prevented only on the canvas element
- [x] TypeScript compiles clean
- [x] Production build succeeds
