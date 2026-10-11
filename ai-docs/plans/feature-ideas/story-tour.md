# Guided Story Tour

Turn the current canvas into a short narrated documentary. The AI writes a tour of 6–10 stops through the canvas's own figures and events. The camera flies to each stop, highlights its figures, draws the relevant connection, and shows a caption card. The user can play, pause, step, or leave at any time.

## Behavior

- **Entry.** A "Tell me the story" button in the control panel, next to the history controls, plus a "Tour from here" action in the figure action bar (`ActionBar`) that starts a tour centred on that figure. Disabled for empty or busy canvases and for canvases with fewer than 4 entries.
- **Generation.** One AI request using a catalog of the current canvas (see the grounding rule in the README). A progress overlay ("Writing your tour…") can be cancelled. Failure shows the usual error toast and leaves the canvas untouched.
- **Tour shape.**
  - `title` (≤ 8 words) and `intro` (1–2 sentences).
  - 6–10 `stops`, each with `figureIds` (1–3 canvas IDs), an optional `linkPair` (two of those IDs whose connection to draw), `year`, `heading` (≤ 6 words), and `narration` (60–110 words, `READER_STYLE`).
  - `outro` (1–2 sentences) with a "keep exploring" suggestion naming one canvas figure.
  - Stops progress broadly forward in time, but a stop may look back.
- **Playback.**
  - The camera flies to the bounds of the stop's figures using the shared animated camera, padded so the caption card does not cover them.
  - Stop figures get the existing highlight treatment and everything else dims (reuse `highlightedFigureIds`).
  - If `linkPair` is present and has a cached positive assessment, draw a connector between the two bars. A link without one is drawn dashed, labelled "suggested connection" and is never shown as verified.
  - The caption card sits bottom-left over the canvas. Its heading and narration support Markdown (`MarkdownContent`). A "Read more" link opens the existing biography or relationship dialog and pauses the tour.
  - Auto-advance uses reading time (about 230 wpm, minimum 6 s). The shared `PlaybackBar` provides play/pause, step, a progress bar with stop ticks, and close.
  - Optional **voice narration** uses the browser's `speechSynthesis` behind a speaker toggle. It is off by default, and stops advance when the utterance ends.
- **Ending.** Show the outro card with **Replay**, **Explore {figure}** (closes the tour and opens that figure's actions), and **Close**. Closing restores the pre-tour camera, highlights, and selection.
- **Persistence.** Tours are cached per canvas (`chrono_tour_<canvasId>[_<figureId>]`) and saved with canvas history. A cached tour replays instantly; a "New tour" action regenerates it. The cache is invalidated if any stop references a removed figure.

## AI task

`fetchCanvasTour(figures, context, focusFigureId?, signal)` → `CanvasTour`.

Prompt guidance:
- Tell a coherent story with a through-line (a rivalry, an idea passing between generations, an empire's rise and fall), not a list.
- Use only catalog IDs. Prefer stops where the people genuinely interacted, and cover both people and events when both exist.
- Narration states only facts supported by the figures' known history. Mark uncertainty plainly, and include no invented dialogue (shared rules).
- With `focusFigureId`, the tour begins or ends with that figure and most stops relate to it.

Validation: drop unknown IDs and drop stops left with no figures. Require at least 4 valid stops. Clamp word counts by trimming at a sentence boundary. If `linkPair` is not a subset of `figureIds`, drop it.

## Implementation

1. Shared animated camera and `PlaybackBar` (README foundations 1–2), if Time-Lapse has not built them already.
2. Types (`CanvasTour`, `TourStop`), prompt, parser, `JsonTask: 'tour'`, and three provider implementations.
3. `src/hooks/useStoryTour.ts`: generate/cache/load, step state, timers, abort, and speech.
4. `TourCaptionCard.tsx` and connector drawing (reuse the relationship-line drawing in `TimelineCanvas`; the gallery draws a simple straight connector).
5. App wiring and mutual exclusion; add `chrono_tour_` to `isCanvasCacheKey`.
6. Tests: parser (unknown IDs, too few stops, bad linkPair), cache invalidation, auto-advance timing, and abort on canvas switch.

## Open questions

- Is voice narration in scope for v1?
- Should tours be shareable? That would need an export format, which is out of scope here.
