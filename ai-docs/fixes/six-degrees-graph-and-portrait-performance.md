# Six Degrees graph and portrait performance

Date: 2026-10-16 · Branch: `feat/six-degrees-refactor`

## Problem

With hundreds of people in the Six Degrees explorer (worst on the Timeline and Free layouts):

- clicking buttons and controls was laggy;
- nodes moved jerkily when new people arrived or had to make room;
- portraits made everything noticeably slower than nodes drawn with initials.

## How it was measured

No real large session can be produced offline, so measurements used a throwaway harness (deleted afterwards) that mounts
`ConnectionExplorer` with a synthetic, seeded session of 500 or 1000 people (with folding, about 240 or 490 are drawn).

- **Build:** production build of the harness (`vite build`, then `vite preview`). The dev server is not representative: React's
  development build spent about 137 ms in `jsxDEV` alone in a single render.
- **Browser:** headless Chrome, driven by `agent-browser`. It rasterizes on the CPU, so absolute frame times are worse than on a
  desktop GPU, but the comparisons hold.
- **Metrics:** main-thread long tasks (`PerformanceObserver('longtask')`), `requestAnimationFrame` frame times, and Chrome traces
  summed per thread (`agent-browser profiler`).
- **Baseline:** the same harness built from `HEAD` (commit `502d2b4`) in a temporary git worktree.
- **Scenarios:**
  - a round of 60 people arriving;
  - selecting people;
  - a simulated live search: statuses flipping every 400 ms, 30 people arriving every 3.2 s, one click per second;
  - pan and zoom with the layout at rest.
- **Portraits:** the harness mocked the Wikipedia API with generated, distinct JPEG portraits at a chosen width.

## Findings

1. **Seating new people blocked the main thread.** When 6 or more people arrive, `NetworkLayout.setGraph` seats them by running up
   to 400 d3-force ticks synchronously. In a bun benchmark this took 100–700 ms at 500 people and up to about 2 s at 1000 (Free
   layout). This freeze, followed by the jump, was most of the "jaggy" motion. Steady ticks cost 1.5–10 ms each.
2. **Selecting someone started an opacity transition on every node and line.** SVG opacity is not composited, so every frame of
   the 0.2 s fade repainted the whole drawing. Disabling the transition removed all long tasks on selection. Background blur
   (`backdrop-filter`) turned out to be minor.
3. **Too much React work.**
   - Every follow-camera update (every third tick) re-rendered all people and lines.
   - The explorer clock re-rendered the whole explorer every second.
   - During a search, each session update re-rendered every person and line.
   - `nameOf` scanned the people list for every line, which is O(lines × people) per render.
4. **Too many DOM writes per frame.**
   - Each line was three `<line>` elements with four coordinates each, found again with `querySelectorAll` on every frame.
   - Every person had their own `<clipPath>`.
5. **Oversized portraits.**
   - Wikipedia sends 400 px thumbnails for discs and boxes of 32–112 px.
   - Hundreds of 400×500 decoded pictures (about 800 KB each) overflow Chrome's decoded-image cache, so every repaint decodes and
     scales them all again, on the raster threads.
   - The round clip path itself costs nothing measurable.
6. **The view model was not the problem.** `buildNetworkView` takes 1–4 ms even at 1000 people.

## Changes

### Layout physics off the main thread

- `src/workers/networkLayout.worker.ts` runs the unchanged `NetworkLayout`. `src/services/networkLayoutHost.ts` implements the
  command and frame protocol, so it can be tested without a worker.
- `src/services/remoteNetworkLayout.ts` (`RemoteNetworkLayout`, behind the `NetworkLayoutHandle` interface) mirrors on the main
  thread what the drawing reads synchronously:
  - the people, from the inputs;
  - the time axis, using pure helpers shared with the worker (`yearDomainFor`, `pixelsPerYearFor`, `timeX`);
  - pins, updated optimistically and confirmed by the worker;
  - the latest frame of positions;
  - the dragged person, drawn at the pointer and clamped locally with the shared `clampDragPoint`.
- Only one frame request is in flight at a time, so a long seating never queues messages.
- A sequence number keeps the animation running when a change was made after the frame being answered was requested.
- People without a position yet stay hidden instead of flashing at the origin.
- `createNetworkLayout()` falls back to an in-thread `NetworkLayout` where there is no `Worker` (tests, server rendering).

### Rendering (`NetworkGraph.tsx`, `ConnectionExplorer.tsx`)

- People and lines are memoized layers, and each person and line is a memoized item with plain props. Camera, clock and axis
  changes do not re-render them, and a search update re-renders only the items whose drawing changed.
- Elements are found once per layer render (`data-node`, `data-edge`). Paint skips anything that did not move, and visibility is
  tracked in memory instead of being read from the style.
- Each line part is a `<path>` with a single `d` attribute: three writes per edge instead of twelve.
- Portraits share two clip paths (endpoint and person radius) instead of one per person.
- From 250 drawn people and lines (`is-large`), dimming switches immediately; smaller networks keep the fade.
- The follow-camera updates every frame and only when it actually moves. With memoized layers this is cheap; a measured
  comparison with every third frame showed no cost.
- The clock is its own component (`ExplorerClock`). Names are looked up through a memoized map, and the graph is `React.memo` with
  stable props.

### Portraits

- Six Degrees contact portraits are fetched at 120 px (`fetchWikipediaImagesByName` → `pithumbsize: 120`, and the Wikidata
  fallback uses `?width=120`). Canvas figure details still fetch 400 px.
- `src/utils/portraitSize.ts` `sizedPortrait(url, boxCssPixels, zoom)` rewrites a stored Wikimedia thumbnail URL to the smallest
  standard width (60/120/250/330/500/960) covering box × zoom × `devicePixelRatio`.
  - It never asks for a width above the stored one.
  - Anything that is not a Wikimedia thumbnail is left unchanged.
  - Because it works at display time, saved timelines benefit too.
- Applied to:
  - gallery cards (64 px × canvas zoom);
  - relationship mapper and Expand overlay cards (64 px);
  - sidebar cards (80 px);
  - relationship dialog cards (96 px);
  - the biography header (112 px);
  - all `NetworkPortrait`s.

## Results

All figures come from a production build in headless Chrome. "Long tasks" means main-thread tasks over 50 ms.

### A round of 60 people arriving (1000 people)

| | Before (layout on the main thread) | After (worker) |
|---|---|---|
| Worst main-thread task | 130–146 ms | 52–55 ms |

The 100 ms – 2 s seating freeze is gone. The remaining ~50 ms is React rendering the new people once.

### Selecting people (1000 people)

| | Before | After |
|---|---|---|
| Long tasks per selection | 4–5 (50–100 ms each) | 0 |

### Live search with a click every second (8 clicks, 9.5 s window)

| | n=500 before | n=500 after | n=1000 before | n=1000 after |
|---|---|---|---|---|
| Total long-task time | 822 ms | 156 ms | 5240 ms | 4133 ms |
| Worst task | 174 ms | 53 ms | 352 ms | 117 ms |
| Click to next frame (median) | ~85 ms | ~70 ms | ~190 ms | ~125 ms |

At about 500 drawn people, what remains is the browser's own work for a large animated SVG: per frame, about 12 ms of style
recalculation, about 20 ms of paint, and layerization.

### Portraits: with and without images (live search, 1000 people, before the thumbnail change)

| | No images | 400 px portraits |
|---|---|---|
| Frame rate | 29–32 fps | 22–24 fps |
| Long-task time (9 s) | 0.6–0.7 s | 1.0–1.6 s |

At 500 people: 47 fps without images vs 36 fps with them. These runs vary by about ±0.5 s of long-task time, so the traced
comparison below is the reliable one.

### Portraits: rendering work while panning and zooming (1000 people, 4.5 s trace, all threads)

| Portrait width | Image decoding | Raster |
|---|---|---|
| None | 0 s | 1.0 s |
| 400 px (before) | 3.2 s | 4.8 s |
| 400 px, round clip removed | 3.3 s | 4.8 s |
| **120 px (after)** | **0.43 s** | **2.0 s** |
| 64 px | 0.16 s | 1.5 s |

120 px thumbnails cut image decoding by about 7× and raster time by more than half. The clip path made no difference. In real use,
the smaller thumbnails noticeably sped up the explorer and the canvas.

## Trade-offs

- **Portrait sharpness.** Contact portraits (120 px) look soft when the explorer graph is zoomed in past about 2×. Gallery cards
  pick a larger thumbnail as you zoom, up to the stored 400 px.
- **No dimming fade on large networks.** Above 250 drawn people and lines, dimming is immediate.
- **The drag offset is unchanged.** A dropped person settles where the in-thread layout put them before; this was verified with the
  same drag in both modes.

## Tests

- `tests/remoteNetworkLayout.test.ts` covers the worker protocol over a fake worker:
  - positions identical to the in-thread layout;
  - unplaced people hidden;
  - a change racing an in-flight frame (the test fails without the sequence guard);
  - optimistic pins;
  - drag clamping at the free-zone rim;
  - guide identity in the arranged layouts;
  - worker restart.
- `tests/wikiThumbnails.test.ts` checks that contact portraits ask for 120 px, including through the Wikidata fallback.
- `tests/portraitSize.test.ts` covers width selection and URL rewriting, and confirms nothing is upscaled or touched outside Wikimedia.

## Possible next steps

- **Initials when zoomed out.** Show initials instead of portraits when the explorer is zoomed out below about 0.4×.
- **Canvas rendering.** Draw the explorer graph on a `<canvas>` (possibly an `OffscreenCanvas` in the worker). This is the next big
  step for networks of 500+ drawn people, at the cost of re-implementing hit testing and keyboard accessibility.

## Follow-up: culling, level of detail and zoom preview (2026-10-22)

Switches: `GRAPH_PERF_CULLING`, `GRAPH_PERF_LEVEL_OF_DETAIL`, `GRAPH_PERF_HIDE_PORTRAITS`, `GRAPH_PERF_ZOOM_PREVIEW` in
`src/components/connectionNetwork/performance.ts`; behavior in `ai-docs/guides/six-degrees-internals.md` ("Explorer graph").

Measured on a production build of a throwaway harness (synthetic 1000-person session, about 915 drawn, headless Chrome, 240 scripted
frames per scenario, two runs; HEAD built from a stash as the baseline). CPU is summed over all browser processes, so it includes raster.

| Scenario | HEAD | Culling + level of detail | All measures |
|---|---|---|---|
| Fit-all pan, mean frame | 61 ms | 25 ms | 22 ms |
| Fit-all pan, CPU | 40.6 s | 12.3 s | 11.2 s |
| Zoom 1.0 pan, CPU | 13.8 s | 7.5 s | 7.4 s |
| Zoom in/out cycle, layout | 1546 ms | 1146 ms | 96 ms |
| Zoom in/out cycle, CPU | 7.8 s | 4.9 s | 4.5 s |

Findings:

- Changing the scale of the SVG content makes Blink lay out every person and line again ("SVG changed" on each); a translate-only pan costs
  about a tenth. Hiding edges, nodes or the axis alone barely moved that cost, so the lever is not changing the scale per event.
- `local()` read `getBoundingClientRect()` on every wheel and pointer event, forcing a layout after each React commit; the reading is now kept
  while events keep coming.
- A zoom preview (CSS `scale()` on the `<svg>`, committed on a pause and at least every 350 ms) removes the layout cost, but needs: `overflow:
  visible` on the SVG, culling against the logical camera with overscan while previewing, and a time axis drawn well past the view, or zooming
  out shows empty space around what was drawn.
- Always profile with every switch in its intended state: a preview-only build left in the working tree once hid most of the gain.

