# Real full screen for the Six Degrees graph

## Context

Maximizing the explorer graph today only hides the inspector grid column. Three things still hold the space the graph could use: the overlay's `22px 28px` padding, the `max-width: 1720px` rule on its children (wasted side space on big monitors), and the header and footer. A click while maximized also shows nothing readable, because the inspector is `display: none`.

Goal: when maximized, the graph fills the whole viewport. The header and footer collapse into one floating compact bar (frosty glass, like the bottom-left view controls), and the inspector becomes a floating panel on the right. UI only: no service, prompt or request changes, so `tests/connectionRequestTrace.golden.json` and the other guardrails are untouched. Narrow screens (<=760px) never maximize and stay as they are.

## Decisions (settled with the user)

| Area | Decision |
| --- | --- |
| Meaning of "full screen" | Fill the viewport with CSS. Not the browser Fullscreen API (browsers swallow Esc there, which breaks the Esc ladder). |
| Esc in full screen | 1st Esc hides the floating panel (one press, no back-steps), 2nd restores (un-maximizes), 3rd closes. The panel's own Back button still steps back. |
| Hiding the panel | Keeps the selection (highlight and dimming stay). Clicking empty graph space clears the selection and also closes the panel. |
| Panel opening | Any selection opens it. A bar icon toggles it in list mode (People/Contacts tabs and search). A small × in its header hides it. Maximizing with a selection starts it open. Selecting while hidden reopens it. |
| Bar placement | Top centre, just under the year strip (top: 34px). |
| Search-in-progress cue | Shrunk existing sweeping magnifier + pulsing timer. Stop states go still. Hovering the clock area shows the phase text as a tooltip. No progress text is displayed. |
| Reveal | Bar shows the degrees pill + Reveal icon in both `found` and `solved`. The centred cards (Connected/Reveal, Search paused/Continue, Search interrupted) stay, moved below the bar. |
| Bar extras | Restore and Close icons at the tail (Close replaces both the top-right X and "Back to canvas"). Red warning icon only when `session.saveIssue` is set. No kicker, no "?" info icon. |
| Hover text | Portrait tooltip is `<name> · <years> · <occupation> — N people closer to …`. The footer keeps its current text. |
| Panel geometry | 380px, docked right, ~14px margins, full height under the year strip. While open the legend row shifts left of it. The camera does not move on open. |
| Persistence | The existing remembered `maximized` choice (`readNetworkViewPrefs`) is unchanged, so the explorer can reopen straight into full screen. |

## Design

**Root class.** `.connection-explorer` gets `is-fullscreen` when the effective `maximized` is true (not `maximizedChoice`). The class must be absent otherwise, so the first existing test's `class="connection-explorer"` still matches. Scoped rules in `src/styles/connectionExplorer.css`:
- padding 0, gap 0, children `max-width: none; margin: 0`
- network section: no border, radius or shadow
- header, footer and the fixed `.relationship-close` X are not rendered at all (no duplicate clock timers or live regions)
- the bare `net-maximize` icon is not rendered (Restore lives in the bar)
- `.net-success-wrap`, `.net-resume-wrap` and `.net-alert-wrap` move from `top: 76px` to about `100px`

**Compact bar** (new, rendered by `ConnectionExplorer` inside `.connection-explorer-network`, **before** the graph in the DOM). It is not rendered by `NetworkGraph`, so it exists while `view` is null (a persisted full screen can reopen before the first session) and the user always has a way out. DOM order matters: every person and line in the SVG is a `tabIndex=0` stop, so a bar placed after the graph would take hundreds of Tabs to reach, and `useModalFocus`'s initial focus (first control, with the header and close X gone) would land on an SVG node. It is absolutely positioned, so nothing moves visually; this matches today's order, where the header precedes the graph.
- Glass: `class="canvas-view-toolbar ce-bar"` reuses the glass from `globals.css`. `.canvas-view-toolbar.ce-bar { position: absolute; top: 34px; left: 50%; transform: translateX(-50%); bottom: auto; z-index: 4; max-width: calc(100% - 28px) }`. Do not nest it in another `backdrop-filter` element.
- With the panel open (`has-panel`), the bar is centred in the uncovered area instead: `left: calc((100% - var(--panel-inset)) / 2)` and `max-width: calc(100% - var(--panel-inset) - 28px)`. At 1366px and below the bar (about 550-600px with all items) would otherwise run under the 380px panel. The `top: 100px` cards (`.net-success-wrap`, `.net-resume-wrap`, `.net-alert-wrap`) get the same centring in the uncovered area.
- Buttons: the existing `ToolButton` (move it out of `NetworkGraph.tsx` into `connectionNetwork/ToolButton.tsx`, add an optional accent tone).
- Order: `[save warning?] [A portrait+count] [B portrait+count] │ [degrees pill?] [clock] [phase actions] │ [panel] [restore] [close]`.
- Hidden `<span class="sr-only" role="status" aria-live="polite">` carries the phase text, so the header's live region is not lost.

| Phase (`barPhase`) | Derived from | Counts | Degrees | Clock | Actions |
| --- | --- | --- | --- | --- | --- |
| opening | no session | none | none | magnifier + clock | none |
| searching | `busy` | yes | none | running | Stop (square) |
| paused | session, not busy, not found/solved | yes | none | still | Continue or Resume (accent; label by `stable`), Start a new search (refresh) |
| found | `success` | yes | pill | still | Reveal (eye, accent) |
| solved | `solved` | yes | pill | still | Reveal |

Order of derivation: `!session` → opening, `solved` → solved, `success` → found, `busy` → searching, else paused.

**Floating panel.** `NetworkInspector` gets `floating` and `onHide` props. When floating, its `hidden` follows `open` (so it stays mounted and tab, search and scroll survive), it adds `is-floating`, and its header shows the × (`onHide` only hides, never clears the selection). CSS: `position: absolute; top: 34px; right: 14px; bottom: 14px; width: 380px; z-index: 6`, blur glass (about 72% surface), replacing the old `.is-maximized > .connection-explorer-inspection { display: none }` rule. `.connection-explorer-body.has-panel .net-overlay-row { right: calc(380px + 28px) }` shifts the legend. Share the 380 and margin numbers through a constant in `connectionNetwork/metrics.ts` (CSS carries a matching comment).

**State in `ConnectionExplorer`.** New `panelOpen`:
- Graph `select(next)` sets it to `!!(next.person || next.edge)`.
- `selectFromPanel` sets it true.
- The bar icon toggles it, the × and Esc set it false.
- On becoming maximized it takes `hasSelection`.
- The `resetKey` effect clears it.
- After hiding, if focus was inside the panel, focus goes to the dialog. After Restore, focus goes to the graph's maximize button.

**Esc ladder.** The inline `escape.current` becomes a pure `escapeStep()` (new `connectionNetwork/escapeLadder.ts`):
- maximized: `panelOpen` → hide-panel, else restore. The selection-back, sheet and query steps are skipped, since none of them is visible there, so no press looks dead.
- not maximized: unchanged (back → dismiss sheet → clear query → close).
- `useModalFocus` and the layout menu's own Esc listener are untouched.

**Camera and the covered strip.** `NetworkGraph` gets an `inset` number prop (px covered on the right, 0 when the panel is closed). Using an `insetRef` like `sizeRef`, `visibleOnScreen`, `centerOn` and `fitCamera` use `width - inset`, so a person picked from the lists is panned into the uncovered area. Opening the panel does not refit; the follow framing picks the new inset up on its next frame. `inset` is a primitive, so the memoized graph does not re-render for no reason. The panel never resizes the SVG, so there is no relayout.

**Shared pieces (extractions, behaviour unchanged).**
- `ExplorerClock` → `connectionNetwork/ExplorerClock.tsx` with a `compact` variant. It keeps its reserved magnifier slot so the bar never jiggles; CSS shrinks the glass to about 22px and the digits to about 20px, hides the caption, and keeps the transform/opacity-only animations.
- `sideCount()` → `connectionNetwork/SideCount.tsx`. The footer's markup stays byte-identical (the test asserts it); the bar passes the identity prefix as the tooltip lead.
- `statusText(...)` is shared by the header and the bar's tooltip and live region.

## Files

Modify:
- `src/components/ConnectionExplorer.tsx`: root class, conditional header/footer/close, `panelOpen`, Esc via `escapeStep`, bar, extractions
- `src/components/connectionNetwork/NetworkGraph.tsx`: import `ToolButton`, `inset`, no maximize icon while maximized
- `src/components/connectionNetwork/NetworkInspector.tsx`: `floating`, `onHide`, ×
- `src/components/connectionNetwork/metrics.ts`: panel width and margin constants
- `src/styles/connectionExplorer.css`: `is-fullscreen` rules, `.ce-bar`, `.is-compact` clock, floating panel, banner offsets
- `tests/connectionExplorer.test.tsx`
- `ai-docs/guides/six-degrees-internals.md` (per AGENTS.md, same change)
- `ai-docs/plans/six-degrees/six-degrees-network-view.md` (a one-line note on the old maximize paragraph)

Create:
- `connectionNetwork/ToolButton.tsx`, `ExplorerClock.tsx`, `SideCount.tsx`, `CompactBar.tsx`, `escapeLadder.ts`, `compactBar.ts` (`barPhase`, `statusText`)
- `tests/connectionEscapeLadder.test.ts`

## Steps (test first where it is pure)

1. Extract `ToolButton`, `ExplorerClock`, `SideCount`, `statusText` with no behaviour change. `bun test` stays green.
2. Add `escapeStep` and `barPhase` with unit tests (every Esc-ladder state, every phase).
3. Full-screen shell: root class, header/footer/close/maximize icon removed, CSS. Rewrite the test at `tests/connectionExplorer.test.tsx:214-222`, which pins the old `.is-maximized` CSS by regex, to the new rules. Maximized markup is rendered by stubbing `localStorage` with `{"maximized":true}`, as the existing solved test does.
4. `CompactBar` plus its CSS. SSR tests per phase: opening, searching (Stop, `ce-working is-working`), paused (Continue/Resume, Start new), found and solved (degrees pill, Reveal), save-warning only with `saveIssue`, tooltip prefix, no header/footer/`relationship-close`.
5. Floating panel: `NetworkInspector` props, `panelOpen` state, Esc wiring, `inset`, the legend shift.
6. Docs. Then `bun test`, `npm run typecheck`, `npm run build`.

## Verification

- Automated: `bun test` (about a minute), `npm run typecheck`, `npm run build`. The golden request trace must be unchanged.
- Manual, `npm run dev` (port 3000), Chrome:
  - **Solved:** Open a Recent connection card (no AI needed). Maximize. The graph touches all four viewport edges at 1366×768, 1920×1080 and 2560×1440 (no gutters, year strips edge-to-edge). The bar shows the two portraits with counts, the degrees pill, the still timer and Reveal. Hovering a portrait shows name · years · occupation + the count sentence.
  - **Searching:** A short run (a narrow range such as 1400-1500) shows the magnifier sweep and the timer pulse, with Stop. Stopping gives Continue + Start a new search. The `found` card plus the bar's Reveal both play the connection.
  - **Esc ladder:** Click a person and the panel opens. Esc hides it and the selection stays highlighted. Esc restores. Esc steps back or clears. Esc closes. Also: the × works, the panel icon opens the lists and search, clicking empty graph space closes the panel, and maximizing with a selection starts the panel open.
  - **Covered strip:** Pick a person from the lists who is behind the panel's strip. It pans into the uncovered area. The legend shifts left while the panel is open.
  - **Laptop width:** At 1280×800 with the panel open, the bar and the centred cards sit in the uncovered area and overlap nothing.
  - **Keyboard:** Initial focus lands on a bar control. Tab reaches the bar's buttons before the graph's people, and the trap stays inside the dialog.
  - **Other:** The bar fits at about 800px wide. Below 760px maximize stays unavailable. Light and dark themes. `prefers-reduced-motion` (animations off, digits still tick).

## Open items for the implementer

- Known consequence of "the camera does not move when the panel opens": clicking a person in the right-hand strip opens a panel that covers them. Not changed silently. A small follow-up would pan only when a graph click lands in the covered strip; decide at implementation or leave it.
- Final icon shapes (stop, play, refresh, eye, list) follow the existing 24px stroke style of `ToolButton`.
- Pixel offsets (34px bar top, about 100px banner top) are starting values to adjust against the live bar height.
- On approval, copy this plan to `ai-docs/plans/six-degrees/real-fullscreen-graph.md`, following the repo convention for plans.
