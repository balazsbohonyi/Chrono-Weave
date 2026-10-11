# Meanwhile: explore parallel histories

Compare two canvases on a shared time axis. A Renaissance Italy canvas and a Ming China canvas become two views of the same passing years: moving the year cursor or zooming either view updates both. Users can compare people, events, and circumstances without implying that contemporaries knew or influenced one another.

Status: Proposed. Build the saved-canvas comparison first; companion generation is a later phase.

## Behavior

- **Entry.** A "Meanwhile…" button in `ControlPanel`, available when the current canvas has entries and no other mode, modal, or AI action is active. Open a picker listing saved canvases with their original prompt, subject years, and figure/event counts. Selecting a partner previews it without activating or reordering history.
- **Eligible partners.** Exclude the current canvas. Require a positive-duration overlap between the canvases' requested/inferred subject ranges, not merely their visual padding or full figure lifespans. Explain why non-overlapping entries cannot be selected. If no eligible partner exists, show "Weave another canvas covering these years to compare it here" and an action that closes comparison and opens the regular launcher.
- **Layout.** A full-screen comparison workspace with two vertically stacked timeline panes, one shared year ruler, and compact subject headers. Each header shows its prompt, subject range, and category controls. Desktop and mobile both use stacked panes so the year axis remains aligned; each pane scrolls vertically on its own. The ordinary sidebar is hidden inside this workspace.
- **Gallery canvases.** Render a temporary timeline view for comparison even if a source canvas uses gallery. Preserve its saved layout choice, placements, filters, cameras, search, and sidebar state. Closing comparison returns to the original view.
- **Shared time.** Start fitted to the intersection of the two subject ranges. Horizontal pan, zoom, pinch, and reset update one shared time window. Bound navigation to that intersection. Lifespans remain their full historical spans but are clipped by the viewport; clipping does not change stored dates.
- **Year cursor.** Pointer movement shows a shared hover line; activation selects a year across both panes. A keyboard-operable year control provides the same selection. Highlight people alive and events underway in that year, with separate counts per pane. Lifespan overlap means "alive", not proof of active work or prominence in that year. Use the existing BCE/CE conventions and do not offer year zero as a historical selection.
- **Filtering and search.** Start with each canvas's saved category filters and allow temporary independent changes. Search is qualified by pane and preserves the shared zoom; revealing a result may pan the shared window only when it lies in the comparison interval. A selected year with no visible entries shows an explicit empty state rather than implying the region had no history.
- **Pin and compare.** Each figure/event offers "Pin for comparison" and "Read biography/details". Pin at most one entry from each pane. Show a compact comparison panel with names, dates, occupations/types, and existing descriptions immediately; a separate "Compare these two" button requests an AI explanation. People and events may both be pinned. No discovery, mapping, or timeline mutation occurs inside the workspace.
- **Suggested questions.** Offer fixed question chips such as "What differed about their circumstances?" and "How did their contributions differ?" once two entries are pinned. A custom question is optional later. Suggestions do not make AI calls until selected.
- **Historical distinction.** Comparison cards are labelled "Comparison", never "Verified connection". Temporal overlap and similarities do not establish contact or influence. A model-generated comparison cannot populate relationship caches or establish a new relationship; existing assessed connections remain available in the normal mapping UI.
- **Dismissal.** Escape or the close button exits, aborts pending work, and restores focus to the entry control. Nested biography dialogs close back to comparison first. The underlying canvas remains unchanged throughout the session. Use `useModalFocus` and the current modal styling and theme tokens.

## Data and rendering

Define `CanvasFigureRef = { canvasId: string; figureId: string }`. Use it for pins, search results, annotations, and AI references. Figure IDs alone are insufficient: two canvases may contain the same IDs with different descriptions or assessments.

`ComparisonSession` holds detached snapshots of the current canvas and its selected partner, the overlap range, `centerYear`, `yearsPerPixel`, selected year, per-pane vertical offsets and filters, and optional pins. It is transient React state. Partner reads do not call `activateCanvas`, install its `CanvasCache` as the active cache, or persist comparison navigation to either snapshot.

Extract a pure `comparisonViewport.ts` helper for converting years to screen coordinates and back, fitting and constraining the shared interval, and cursor-anchored zoom. Synchronize semantic time, not raw camera translation: ordinary canvases can have different year origins and pane widths. Keep Y translation independent. Convert the shared window into each pane's transform and avoid two-way camera callbacks that feed one another indefinitely.

Adapt `TimelineCanvas` through an explicit comparison rendering mode or a focused `ComparisonTimelinePane`. Reuse the existing timeline layout and gesture helpers; do not duplicate the placement algorithm or pass comparison cameras into ordinary history persistence callbacks. The existing `initialCamera` prop alone does not provide a controlled shared viewport, so this needs a deliberate renderer contract change. No animated-camera or playback dependency is required.

Biography requests use the pane's captured cache and full figure identity. Completed partner biography results may update that partner's still-existing history entry through a targeted immutable cache update, without activating it or changing creation order. A result cannot create or resurrect an evicted entry. Closing or switching aborts work and rejects late writes.

## AI task

`fetchCanvasComparison(input, signal)` → `CanvasComparison`.

Input includes both canvas IDs and topic contexts, the shared range and optional selected year, two pinned entries with qualified references, their existing descriptions, and the selected question. Supply only these entries and, if needed, up to 6 relevant visible context entries per pane; do not send every history snapshot or cached biography.

Output:
- `title` (up to 10 words), `summary` (2–3 sentences), and 2–4 sections (roughly 200–350 words total).
- Each section has `title`, `content`, and optional qualified `figureRefs` from the supplied catalog.
- A short `limitations` field records important differences in dates, evidence, or the comparison's premise when applicable.

Prompt guidance: use `HISTORIAN_SYSTEM_PROMPT`, `READER_STYLE`, and shared year rules; compare concrete circumstances and contributions, not generic praise. Do not invent contact, quotations, sources, or precise activity dates. Distinguish similarity from causation; comparing two event records does not establish equivalence. Current AI descriptions are context, not independently verified sources, and the reader sees an "AI comparison" label.

Validate required prose, length bounds, and references against the qualified input catalog; drop unknown references. Reject empty or structurally unusable responses through `generateValidatedJson` with one correction attempt. Implement one `IAIService` method in all three providers, with a `comparison` JSON task and matching Gemini schema. No AI request is necessary to open, synchronize, filter, select a year, or pin entries.

## Persistence and lifecycle

- Cache generated comparisons in the primary canvas's `CanvasCache` under `chrono_compare_<version>_<inputFingerprint>`. Add `chrono_compare_` to `isCanvasCacheKey` in `canvasHistory.ts`.
- The fingerprint includes both canvas IDs, supplied catalog identities and descriptions, topic contexts, selected range/year, question, pinned pair, and narrative version. Partner edits therefore cannot reuse an explanation generated from older input. Swapping panes may use a separate key in v1.
- Store text and qualified references only, with a bounded number of recent results (for example 10 per primary canvas). Do not copy the partner snapshot into every cache entry. Validate cached references before display. Do not persist an open comparison session.
- Opening the launcher or restoring history closes comparison and aborts requests. During comparison, history markers behind the workspace are inactive. Settings and other exploration/playback modes cannot run over it.
- Cached comparisons can be read without an AI connection. An uncached comparison failure leaves the two panes and pins usable, with an inline error and Retry.

## Companion generation: later phase

Add "Meanwhile, elsewhere…" to the picker. The user selects a region/culture or theme, reviews the existing comparison years, and explicitly weaves a companion. Generation uses the existing preflight, topic/category checks, generation, and verification machinery, with a new orchestration path that commits the result to history rather than activating it.

The comparison range is a fixed generation constraint, not merely a prompt suggestion: reject preflight bounds outside it instead of silently broadening. Apply the normal history limit and expose any resulting eviction according to existing policy. A failed or cancelled companion build preserves the active canvas, partner, and durable history. Only a successful saved result becomes the new partner. Do not add an eighth launcher card or change normal launcher behavior as part of v1.

## Implementation

1. Qualified-reference/session types and pure overlap/year-window helpers in `src/utils/comparisonViewport.ts`, using `canvasHistoryDetails` for subject bounds.
2. Controlled comparison viewport contract in `TimelineCanvas`/`CanvasProps`, reusing `timelineLayout`, `canvasWheel`, and `canvasCamera` helpers while isolating saved-camera callbacks.
3. `ComparisonCanvasPicker.tsx`, `ComparisonWorkspace.tsx`, and `ComparisonPanel.tsx`; two pane instances with independent vertical scroll, filters, and accessible selection controls.
4. `src/hooks/useCanvasComparison.ts`: captured snapshots, pins, shared viewport, biography routing, cancellation, and cache ownership. App wiring and modal/mode exclusion.
5. Comparison prompt/parser, `JsonTask: 'comparison'`, three provider implementations, updated `IAIService` test doubles, and bounded cache support.
6. Update the application README when implemented. Companion generation is a separate follow-up after the saved-canvas version works.

## Acceptance checks

- Two eligible saved canvases align the same year at the same X position through pan, cursor zoom, reset, resize, and unequal pane widths. Vertical scrolling one pane does not scroll the other.
- Different original year origins and gallery layouts do not break alignment. Non-overlapping subject ranges are rejected even if padding overlaps. BCE/CE labels and selected years follow the app's convention.
- Comparing, reading details, and closing preserve each canvas's layout, cameras, figures, clusters, filters, sidebar state, and history order; only completed, correctly scoped cache entries may change.
- Identical figure IDs in separate canvases remain distinguishable. Pins, biography caches, and AI references cannot cross panes accidentally.
- No AI comparison creates an assessed relationship. Empty filters or years produce honest empty states; alive-in-year highlights do not claim active-in-year evidence.
- Cached replay, provider failure, retry, close during a request, and canvas switching cannot cause stale UI or writes to the wrong snapshot. Fingerprint changes invalidate prior input.
- Verify keyboard controls, focus restoration, mobile stacked panes, light/dark themes, and reduced-motion behavior manually. Cover viewport math, history preservation, scoped refs, parser/cache validation, and cancellation with focused tests; run `bun test`, `npm run typecheck`, and `npm run build` during implementation.

## Scope and effort

M–L for saved-canvas comparison; companion generation adds a separate L-sized orchestration step. Initial scope excludes world maps, playback, more than two panes, cross-canvas discovery, exporting comparisons, and share links. These can follow once simultaneous exploration is useful and readable.
