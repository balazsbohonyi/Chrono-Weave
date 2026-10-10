# Time-Lapse playback

Play the canvas through time. A year cursor sweeps from the canvas's start to its end. Bars light up as people are born or events begin and fade when they end, and the sidebar lists who is alive in the current year. The sweep shows who lived at the same time, which the static canvas only implies.

## Behavior

- **Entry.** A ▶ "Play through time" button beside the zoom-reset control (`CanvasZoomReset`). Disabled while the canvas is empty or busy.
- **Range.** It plays the historical subject (`weaveContext.inferredStartYear`–`inferredEndYear`) when available, or otherwise `config.start`–`config.end`. It does not play the padding.
- **Cursor.** Reuse the existing selected-year line (`selectedYear`), driven by `requestAnimationFrame`. Speed presets: 5, 10, 25, and 50 years/second (default chosen so a full canvas plays in about 30–45 s). The scrubber in the playback bar seeks.
- **Bar states** (timeline and gallery):
  - *future*: dimmed to about 25% opacity;
  - *alive / ongoing*: full colour; a brief glow pulse when the cursor crosses the birth/start year;
  - *past*: about 50% opacity, desaturated.
  Category filters still apply. Use a CSS class per state rather than inline style churn, and recompute states only when the integer year changes.
- **Sidebar.** Shows the existing year view (figures alive in the selected year) and updates as the year changes. Throttle to integer-year changes.
- **Age labels (optional).** While playing, show each alive person's age next to their name at low zoom cost ("Leonardo, 51").
- **Follow camera.** Off by default. When on, the camera pans horizontally to keep the cursor at about 40% of the viewport width, using the shared animated camera. Manual pan disables follow until it is toggled again.
- **Event flashes.** When an event starts, show a small floating chip near the top of the canvas ("1517 · Protestant Reformation begins") for about 2 s. Queue chips and show at most 3 at once.
- **Ticker (optional, AI).** Off by default; a toggle in the playback bar. See below.
- **Ending.** At the end, pause on the last year and offer "Replay". Closing restores the previous `selectedYear` and camera.
- **Interactions.** Clicking a bar pauses and opens its actions as usual. Starting relationship mapping, discovery, a tour, the launcher, or a history switch stops playback.
- **Reduced motion.** Step a decade at a time without glows or camera motion.

## AI ticker (phase 2)

A one-line caption per notable year that combines the canvas's people and events: "1503 — Leonardo begins the Mona Lisa; Michelangelo, 28, is carving David."

- New method `fetchTimeLapseTicker(figures, start, end, context, signal)` returns `[{ year, text, figureIds[] }]`, about 1 entry per 10–20 years and at most 40 entries. Each entry must reference at least one canvas figure ID that is alive or ongoing in that year (validated locally; invalid entries are dropped).
- Fetched once when the ticker is first enabled. It is cached per canvas under `chrono_timelapse_<hash of figure IDs>` and invalidated when figures change (for example after a discovery).
- Playback never waits for the ticker; captions appear once loaded.

## Implementation

1. `src/hooks/useTimeLapse.ts`: state (`isPlaying`, `year`, `speed`, `follow`), the rAF loop, seek, step, stop, and the abort controller for the ticker.
2. Shared `PlaybackBar` (see README) wired to the hook.
3. `TimelineCanvas` / `GalleryCanvas`: accept `timeLapseYear?: number | null` and derive the bar state class from it. Add CSS for the three states and the pulse to `globals.css` with light and dark tokens.
4. App: while playing, drive `selectedYear` from the hook and suppress saving the view snapshot every frame (save the original year and restore it on close).
5. Event chips component and an optional ticker caption line.
6. Tests: range selection, state classification at boundaries (birth year inclusive, death year inclusive), speed math, and ticker validation.

## Open questions

- Should the follow camera default to on for long canvases (> 500 years)?
- Should age labels ship in v1?
