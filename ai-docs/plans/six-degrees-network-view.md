# Six Degrees network view redesign

Status: implemented (2026-10-13). Deviation from the module table: the physics engine is a plain class in `src/services/connectionNetworkLayout.ts` (so it can be tested without React) and `useNetworkSimulation` only drives it from `requestAnimationFrame`; the success-hold timing is `src/services/connectionSuccessHold.ts`. Bundle delta from `d3-force`: about +42 kB raw / +15.5 kB gzip.
Date: 2026-10-13.
Scope: replace the contact-exploration graph in `ConnectionExplorer.tsx`. The search engine, persistence, lifecycle, settlement, Connection tab and canvas reveal are unchanged.

## Problem

The explorer draws every candidate in the session — proposed, checking, accepted, unresolved and blocked — on a fixed five-column lattice (`networkPosition`) ordered by insertion. Position carries no meaning, nearly every edge crosses the whole canvas, every edge carries a status label, and selection shows the browser focus rectangle around the edge group. After a few segments (about 55 people and well over 100 edges in a ten-minute Newton → Shakespeare exploration) the graph is unreadable, and most of what is drawn can never form a chain.

## Decisions settled with the user

| # | Area | Decision |
| --- | --- | --- |
| 1 | Default content | Accepted (AI-supported) contacts only. Unverified statuses are opt-in. |
| 2 | Layout model | Time-anchored force layout by default; a toggle releases it into a free force-directed layout. |
| 3 | Simulation | `d3-force` as a physics helper only. React renders the SVG. No full graph library. |
| 4 | Nodes | Circular clipped Wikipedia portraits: endpoints 64px, people 44px. Initials-on-category-colour fallback. Names always visible, truncated (~18 chars). |
| 5 | Dragging | Free mode: pin where dropped. Time mode: keep the dropped Y, X springs back to the person's year. A and B drag vertically only. |
| 6 | Selection | No edge labels. Selected edge/node in a dedicated blue; everything except the selection and its neighbours dims. |
| 7 | Live progress | Side tint (reached from A vs from B) plus a closest-approach gap marker. |
| 8 | Success | ~1.5s chain highlight in the graph, then auto-close into the existing canvas reveal. Settlement still happens immediately. |
| 9 | Unverified | Legend chips act as per-status filters, and selecting a person reveals that person's unverified contacts. |
| 10 | Time visibility | Light year axis with gridlines and A/B lifespan bands in time mode. No per-node lifespan whiskers or selection lifespan bars. |
| 11 | Inspection | Rich person/edge/summary panel as specified below. No Wikipedia link. |
| 12 | Narrow screens | Full-body graph, bottom-sheet inspection, smaller portraits, touch gestures, filters behind one button. Time mode stays default. |
| 13 | Large graphs | Above ~30 visible people, fold dead-end leaves into "+n" badges. |

## Visible graph

### Default content

- Visible by default: endpoints A and B, every person in the session with at least one **accepted** contact, and accepted edges between visible people.
- Hidden by default: proposed, checking, unresolved and blocked candidates and people known only through them.
- The legend doubles as the filter: chips `AI-supported` (always on, not toggleable), `Unresolved`, `Proposed / checking`, `Blocked`. Each chip shows its line style and a count. Turning a chip on shows those edges and their people across the whole graph.
- **Contextual reveal:** selecting a person also shows that person's unverified contacts (dashed edges to faded initials nodes), whatever the chips say. They disappear when the selection changes unless their status chip is on.
- The readable list follows the same filters. It is grouped as Endpoints, AI-supported people, and Contacts by status.
- "Checking" pairs are not drawn as nodes in the default view. Activity is signalled on existing nodes (see Live behaviour).

### Sides and closest approach

- Each visible person gets a side from `acceptedDistances` from each endpoint: **A side** (reached from A), **B side** (reached from B), or **unattached** (accepted contacts reachable from neither endpoint, e.g. learned through shared knowledge or cross-frontier pairs). A person reachable from both sides only exists once a chain exists.
- Side is shown as a thin outer ring: teal for A side, violet for B side, neutral for unattached. These hues must not collide with the amber connection colour or the blue selection colour, and must pass contrast in both themes. Side and distance are also in the accessible name ("reached from Isaac Newton, 2 links").
- **Closest approach:** among (A-side person, B-side person) pairs, the one with the smallest lifespan gap (overlap counts as 0; ties broken by fewer total links, then name). It is drawn as a faint dotted marker that is not an edge and not clickable as a contact. Its tooltip reads, e.g., "Closest approach: Robert Hooke ↔ Ben Jonson · 7 years apart". It is also shown in the summary panel. Hidden once a chain exists. Deterministic, with no AI call.

### Large graphs

- When more than ~30 people are visible (constant `NETWORK_FOLD_THRESHOLD`, tunable), fold **dead-end leaves**: non-endpoint people with exactly one visible accepted contact who are not part of the closest-approach pair, the selection, or a pinned node.
- A folded group appears as a small "+n" badge on the neighbour. Activating the badge expands that neighbour's leaves until the selection moves elsewhere or the user collapses it again.
- The readable list always contains everyone, folded or not.

## Layout

### Engine

- Add `d3-force` (and `@types/d3-force`) as the only new dependency. It computes positions; React owns the DOM. This supersedes the refactor plan's "SVG without a graph dependency" default with a recorded decision: d3-force is a physics module, not the general-purpose graph framework that plan excluded.
- Render in real screen pixels: drop the fixed `viewBox="0 0 1100 720"` with `preserveAspectRatio="none"` and the mobile font-size compensation. The pan/zoom camera remains a transform on the content group.
- Positions live in refs. Ticks render through `requestAnimationFrame`, so React does not re-render the whole explorer per tick. Layout state is per open overlay and is never persisted in checkpoints.

### Time mode (default)

- X scale: years from `min(A.birth, B.birth) − padding` to `max(A.death, B.death) + padding`, extended if any visible person falls outside. A person's target X is their lifespan midpoint.
- Forces: a strong `forceX` toward the year (soft, so collision can wobble contemporaries apart slightly), a weak `forceY` toward the centre, `forceCollide` sized to the portrait radius plus label room, and `forceLink` for accepted edges with a Y-dominant effect.
- A and B: X fixed at their years. Y free within the vertical drag rule below.
- Axis: faint vertical gridlines with labels along the bottom, with the step adapting to zoom (century → half-century → decade). Shaded vertical bands mark A's and B's lifespans.
- When the endpoints' lifespans overlap, time mode still starts by default. The user switches to free mode through the toggle.

### Free mode

- `forceManyBody` repulsion, `forceLink`, `forceCollide` and a weak centring force. A is pinned towards the left edge and B towards the right, at the same vertical centre.
- Axis and lifespan bands are hidden.

### Mode toggle

- A segmented control in the graph toolbar: `Timeline | Free`. The choice lasts while the overlay is open for that session.
- Switching animates nodes to their new targets. With reduced motion, positions jump after a short synchronous settle.

### Dragging and pins

- Dragging reheats the simulation so neighbours follow.
- **Free mode:** release pins the node at its drop point (`fx`/`fy`), with a small pin marker. Double-click or the inspection panel's "Unpin" releases it.
- **Time mode:** release keeps the dropped Y (pins `fy`), and X eases back to the year.
- **A and B:** vertical drag only in both modes.
- Pins reset when the overlay is reopened.

## Nodes and edges

### Nodes

- Clipped circular portrait: 64px for endpoints (amber ring and A/B badge), 44px for other people. On narrow screens: 52px and 36px.
- Portraits: reuse the batch Wikipedia `pageimages` lookup in `wikiService.ts`, exposing a name-based batch helper, keyed by shared person ID. Fetch only for people visible as accepted, in batches as they appear, only while the overlay is open. Makes no AI calls.
- Fallback when there is no image, the lookup fails, or the person is unverified: initials on a disc tinted with the category colour (`CATEGORY_COLORS`). Unverified people never get portraits, because a name collision could show the wrong face, and they use a dashed ring.
- Name label always visible below the circle, truncated at ~18 characters (~14 on narrow screens), with a canvas-coloured halo for legibility. The full name is in the accessible name and tooltip.
- Activity: a person currently being expanded, or with pairs under assessment, gets a subtle pulsing ring. With reduced motion, a static marker.

### Edges

- No edge text labels.
- Accepted: solid amber line, `--color-connection`.
- When shown through chips or the contextual reveal: unresolved, proposed/checking and blocked are distinguished by dash pattern and colour, matching the legend chips. Colour is never the only signal.
- An invisible ~18px hit stroke stays for easy pointer selection.

### Selection and focus

- Suppress the default focus outline on graph elements (it caused the bounding rectangle) and draw state on the shapes instead.
- New theme token `--color-selection` (≈ `#2563eb` light, `#60a5fa` dark) in `src/styles/tokens.css`, alongside the side-tint tokens.
- **Selected edge:** blue, 4px, with a soft blue halo. Its two people get blue rings.
- **Selected person:** blue ring. Incident visible edges turn blue.
- **Keyboard focus:** the same blue, but dashed, so focus and selection differ without relying on colour alone.
- **Focus + context:** everything except the selection, its endpoints/neighbours and their connecting edges dims to ~25% opacity.
- Clicking empty canvas clears the selection. Esc clears the selection first, and a second Esc closes the overlay as before.
- Selection is preserved across new batches.

## Live behaviour

- New accepted people enter beside the contact that introduced them (at their year in time mode), fade and scale in, and gently reheat the simulation at low alpha so existing nodes nudge rather than jump. With reduced motion: no animation, short synchronous settle.
- Camera: auto-fit as the graph grows until the first user pan, zoom or drag. After that, never refit automatically. A "Fit" button and a "New contacts outside view" chip handle off-screen arrivals.
- The status bar (phase, elapsed time, "no background search") is unchanged. Still no request counts or completion percentages.

## Success hand-off

- On an accepted route, settlement (weave, save, guards) runs immediately, exactly as now. Only the overlay's close is delayed.
- The winning chain's nodes and edges light up in amber and everything else dims. A banner reads "Connected · n degrees". The chain may include people not yet visible (e.g. folded leaves), which are unfolded for the highlight.
- After ~1.5s (`NETWORK_SUCCESS_HOLD_MS`) the overlay closes automatically and the existing canvas reveal plays. Click or Esc skips straight to the reveal. Reduced motion: static highlight for ~1s.
- Lifecycle guards still apply. If the canvas changes during the hold, the hold is abandoned and the existing settlement rules decide what happens.

## Inspection panel

**Person selected**

- Large portrait (or fallback), name, lifespan, occupation. Unverified people are labelled tentative, with no biography details presented as fact.
- Side and distance: "Endpoint A", "Reached from Isaac Newton · 2 links", or "Not yet attached to either endpoint".
- Accepted contacts: rows with small portrait, name, interaction type, and a one-line evidence excerpt. Activating a row selects that edge and pans to it if it is off-screen.
- Collapsed "Unverified around this person (n)": proposed/unresolved/blocked attempts with claim, uncertainty or blocked reason.
- "Unpin" when pinned.

**Edge selected**

- Both portraits and names side by side.
- Status, interaction type, episode, and year when known.
- Full evidence, or for unverified edges: claim / uncertainty / blocked reason.
- Provenance in small print (provider / model / date), as now.

**Nothing selected**

- Summary: counts of AI-supported people and contacts, plus the closest approach.
- Grouped readable list (follows the filters).
- Existing error and "saving across reloads is unavailable" messages are retained.

No Wikipedia or other external links. Inspection never triggers AI work.

## Narrow screens (≤ 760px)

- The graph takes the full body. Inspection becomes a bottom sheet (~45% height) that opens on selection, and dismissing it clears the selection.
- Portraits 36px / 52px, names truncated at ~14 characters.
- Touch: one-finger drag on empty space pans, pinch zooms, drag on a node follows the drag rules, tap selects.
- Legend chips collapse behind a single "Filters" button. The mode toggle stays visible.
- Time mode remains the default.

## Accessibility

- Nodes and edges stay keyboard-focusable with accessible names including status, side and distance. Enter/Space selects.
- Arrow keys move between a selected person's neighbours (nice-to-have; the readable list remains the guaranteed keyboard path).
- Modal focus trap and restore keep using `useModalFocus`.
- Reduced motion: no fades, pulses or animated transitions. Layout settles synchronously.
- Status, side and selection never rely on colour alone (dash patterns, ring styles, text in names/legend).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/services/connectionNetworkView.ts` (new) | Pure view model: visible people/edges from session + filters + selection + expanded folds; sides and distances; closest approach; leaf folding; contextual unverified reveal; success-chain highlight set. No React or d3. |
| `src/hooks/useNetworkSimulation.ts` (new) | d3-force wrapper: time/free forces, year scale, pins and drag rules, reheat on new nodes, rAF rendering, reduced-motion synchronous settle. |
| `src/hooks/useNetworkPortraits.ts` (new) | Batch portrait lookup for visible accepted people with an in-memory cache; quiet fallback. |
| `src/services/wikiService.ts` | Expose the existing batch `pageimages` lookup by name for reuse. Existing `fetchBatchFigureDetails` behaviour is unchanged. |
| `src/components/ConnectionExplorer.tsx` | Shell: header, status, footer controls, success hold; composes the parts below. |
| `src/components/connectionNetwork/` (new) | `NetworkGraph` (SVG, camera, axis, nodes, edges), `NetworkInspector` (panel/bottom sheet), `NetworkLegend` (filter chips / Filters button). |
| `src/styles/connectionExplorer.css` / `tokens.css` | Scoped styles; new `--color-selection` and side-tint tokens for both themes. |
| `src/hooks/useConnection.ts` | Only change: keep the overlay open for the success hold after settlement, then close. |

Remove `networkPosition` and the lattice. No changes to `connectionPath.ts`, `connectionGraph.ts` semantics, `connectionKnowledge.ts`, `connectionFlow.ts` settlement, `ConnectionPanel.tsx`, the reveal, or any AI prompts.

## Verification

### Automated (bun test)

- View model: accepted-only default; chip filters; contextual reveal appears and clears; sides/distances; unattached people; closest approach (overlap = 0, tie-breaking, hidden once connected); fold threshold and exemptions (endpoints, closest pair, selection, pins); expanded folds; success chain unfolds hidden members.
- Simulation (seeded, fixed tick count): time-mode X stays near year targets; endpoints fixed in X; vertical-only endpoint drag; time-mode drop keeps Y and returns X; free-mode pins; mode switch retargets.
- Portraits: only accepted people requested; unverified never requested; failures fall back.
- Success hold: overlay closes after the hold; skip closes immediately; settlement is not delayed; canvas change during the hold abandons it.
- Existing Six Degrees, lifecycle and settlement tests keep passing. Update or remove the tests that depended on `networkPosition`.
- `npm run typecheck` and `npm run build` pass. Check the bundle-size delta from `d3-force`.

### Browser (T3 preview)

- Paused large exploration (Newton → Shakespeare style): readable default view, chips, contextual reveal, folding, closest approach.
- Live search: arrivals, pulse, no refit after user pan, selection preserved.
- Time/free toggle, drag/pin rules, endpoint vertical drag.
- Edge selection is blue with no bounding rectangle; dimming; Esc ordering.
- Success hold → canvas reveal in timeline and gallery layouts; skip.
- Light/dark themes, reduced motion, keyboard, narrow viewport bottom sheet and touch.
- Portrait fallback with the network blocked.

## Glass overlay revision (2026-10-13)

The explorer stopped being a centred dialog and became a full-screen glass overlay in the style of the relationship overlay (`surface` at 60%, `blur(24px)`, the round `.close-button relationship-close`, z-index 180 so it still covers the app chrome). Header, graph, inspector and footer float on it as translucent panels. The root keeps the `connection-explorer` class, so the scoped rules and `useConnection`'s invoker check still apply; `button.close-button` is re-asserted inside that scope because the scoped base button style would otherwise restyle it.

| Area | Decision |
| --- | --- |
| Header | Kicker, then the two endpoints as portrait + name + lifespan/occupation with A/B badges (side-a / side-b colours), phase text on the left and the clock on the right. The dialog is named by `aria-label`. |
| Clock | Large bold `m:ss` with an "explored" caption. While the search runs a soft amber glow ripples out from its centre every 1.7s (a `::before` that animates only transform and opacity, so it is smooth and the digits are never rescaled; off under reduced motion). It is `role="timer"` and outside the polite live region so it is not announced every second. |
| Year spacing | `NetworkLayout.pixelsPerYear` is a world scale of its own (2.2 reference widths over the span, clamped to 2-14 px/year), no longer the measured width. Resizing never re-spaces people. Free mode is unchanged. |
| Camera | The fit is the pure `connectionNetwork/camera.ts`. Auto-follow keeps at least `READABLE_ZOOM` (0.8; 0.6 narrow) and centres between the two endpoints when the network is wider than the screen, so a big exploration is panned rather than shrunk; if the two ends alone would not fit side by side at that zoom (a span of millennia) it zooms out just enough to show both. "Fit network" fits everything and keeps following that way. While the success chain is lit the camera frames the chain (even after the user panned), because the overlay closes a moment later. The "New contacts outside view" chip also shows while following at a readable zoom. Fit and visibility margins leave room for the year strips. |
| Pan / zoom | `src/utils/wheelGesture.ts` is the main canvas's wheel classifier (40px impulse threshold, 300ms sticky trackpad mode, Ctrl/Cmd pinch at 0.01, wheel at 0.001, fine deltas pan). `TimelineCanvas` and `NetworkGraph` both use it. `GalleryCanvas` keeps its own variant (Shift pans there). Ctrl/Cmd wheel anywhere on the overlay is `preventDefault`-ed so a pinch never zooms the page; ordinary wheel scrolling of the inspector is untouched. |
| Dimming | Out-of-focus nodes and edges drop to 13% opacity and turn grey. Edges and discs are recoloured in CSS; only the portrait `<image>` takes `filter: grayscale(1)` (cheap with a crowd). Only opacity transitions. |
| View controls | The Timeline/Free toggle, zoom in/out and fit are icon buttons in the main canvas's own bottom-left toolbar container (`canvas-view-toolbar` / `canvas-floating-button`, positioned inside the graph), with tooltips. The layout toggle works like the canvas layout switcher: its icon and tooltip show the layout you would switch to. The legend chips sit beside it in the same bottom row, over the graph and above the year strip; on narrow screens "Filters" opens its popover upwards. The gesture hint moved to the footer. |
| Year strips | HTML strips at the top and bottom of the drawing (24px, `--color-timeline-axis` at 75% with blur, bold labels and tick marks), like the main canvas axis. Timeline mode only, `pointer-events: none`. Gridlines stay in the SVG. |
| Inspector | Two glass panels' worth of lists: Endpoints with portraits pinned above `People` / `Contacts` tabs (same pill style as the main sidebar), each with a search (accent-insensitive, every word must match). Only the list under the search scrolls, and the lists hide their scrollbars like the main sidebar (`no-scrollbar`). A selected person's or contact's header (portrait, name, side, "AI-supported contacts (n)") is fixed; only the rows below it scroll. Unverified people and the unresolved / proposed / blocked contacts are collapsed groups at the bottom of their tab and still follow the legend filters. With a selection, the detail replaces the lists (they stay mounted, so tab, search and scroll survive) and a "Back to list" button returns. The People badge counts the endpoints too, matching the summary. The search text lives in the shell: Esc clears a search before it closes the overlay (lit chain, then selection, then search, then close). |
| Lists are complete | `view.list.contacts.accepted` now includes contacts of people folded behind a "+n" badge, and `portraitSubjects` covers everyone in the lists (AI-supported people only), not just the drawn nodes. |

Verified in the browser with a synthetic 178-person session: dark/light themes, narrow viewport (sheet is closed until asked for), selection fade, wheel / trackpad / pinch handling, tabs and search. Frame rate while dragging a dimmed crowd was not measured; check it on a real large exploration.

## Out of scope

- Changes to search, assessment, discovery limits, persistence or lifecycle beyond the success hold.
- Manual search steering, graph editing, or persisting layout/pins.
- Using this graph for saved successful paths in the Connection tab.
- Semantic-zoom label hiding (possible follow-up if folding proves insufficient).
- External reference links.
