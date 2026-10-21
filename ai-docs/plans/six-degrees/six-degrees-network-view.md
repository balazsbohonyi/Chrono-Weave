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
- Camera: auto-fit as the graph grows until the first user pan, zoom or drag. After that, never refit automatically. The toolbar's Fit button brings everyone back into view (there is no "New contacts outside view" chip).
- A crowd (6 or more people at once, or the very first people of an exploration) is seated before it is drawn: scattered over the area (rows at their year in time mode, a spiral in free mode), then settled off-screen with everyone already there held in place, so nothing jumps on screen. The layout waits for the drawing's real size (`ready`) so it is not placed for a guess and shuffled later.
- The status bar (phase, elapsed time, "no background search") is unchanged. Still no request counts or completion percentages.

## Success hand-off

- On an accepted route, settlement (weave, save, guards) runs immediately, exactly as now. Only the overlay's close and the reveal are deferred.
- The winning chain's nodes and edges light up in amber and everything else dims. A banner reads "Connected · n degrees", with an amber **Reveal** button under it. The chain may include people not yet visible (e.g. folded leaves), which are unfolded for the highlight.
- The overlay stays as it is, with no timer, and the graph stays explorable (pan, zoom, select) until the user presses **Reveal**; only then does the overlay close and the existing canvas reveal play. Clicking the graph does not reveal. Closing the overlay (✕, Back to canvas, Esc with nothing selected) leaves without playing the animation: the connection is already saved and stays in the Connection tab to replay.
- Lifecycle guards still apply. If the canvas changes while the chain is lit, the hand-off is abandoned and the existing settlement rules decide what happens.

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
| `src/hooks/useConnection.ts` | Only change: keep the overlay open after settlement until the user presses Reveal (`revealConnection`), then close and play. |

Remove `networkPosition` and the lattice. No changes to `connectionPath.ts`, `connectionGraph.ts` semantics, `connectionKnowledge.ts`, `connectionFlow.ts` settlement, `ConnectionPanel.tsx`, the reveal, or any AI prompts.

## Verification

### Automated (bun test)

- View model: accepted-only default; chip filters; contextual reveal appears and clears; sides/distances; unattached people; closest approach (overlap = 0, tie-breaking, hidden once connected); fold threshold and exemptions (endpoints, closest pair, selection, pins); expanded folds; success chain unfolds hidden members.
- Simulation (seeded, fixed tick count): time-mode X stays near year targets; endpoints fixed in X; vertical-only endpoint drag (time mode; free and cluster modes drag endpoints anywhere, see the 2026-10-15 revision); time-mode drop keeps Y and returns X; free-mode pins; mode switch retargets.
- Portraits: only accepted people requested; unverified never requested; failures fall back.
- Success hold: nothing happens on its own; Reveal hands over once; leaving without revealing abandons it; settlement is not delayed; canvas change while the chain is lit abandons it. The explorer shows the Reveal button only for a lit chain.
- Existing Six Degrees, lifecycle and settlement tests keep passing. Update or remove the tests that depended on `networkPosition`.
- `npm run typecheck` and `npm run build` pass. Check the bundle-size delta from `d3-force`.

### Browser (T3 preview)

- Paused large exploration (Newton → Shakespeare style): readable default view, chips, contextual reveal, folding, closest approach.
- Live search: arrivals, pulse, no refit after user pan, selection preserved.
- Time/free toggle, drag/pin rules, endpoint vertical drag on the time line.
- Edge selection is blue with no bounding rectangle; dimming; Esc ordering.
- Success hold → press Reveal → canvas reveal in timeline and gallery layouts; leaving without Reveal.
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
| Inspector | Two glass panels' worth of lists: Endpoints with portraits pinned above `People` / `Contacts` tabs (same pill style as the main sidebar), each with a search (accent-insensitive, every word must match). Only the list under the search scrolls, and the lists hide their scrollbars like the main sidebar (`no-scrollbar`). A selected person's or contact's header (portrait, name, side, "AI-supported contacts (n)") is fixed; only the rows below it scroll. Unverified people and the unresolved / proposed / blocked contacts are collapsed groups at the bottom of their tab and still follow the legend filters. With a selection, the detail replaces the lists (they stay mounted, so tab, search and scroll survive) and a "Back to list" button returns. The People badge counts the endpoints too, matching the summary. The search text lives in the shell: Esc clears a search before it closes the overlay (lit chain, then selection, then search, then a maximized graph, then close). |
| Lists are complete | `view.list.contacts.accepted` now includes contacts of people folded behind a "+n" badge, and `portraitSubjects` covers everyone in the lists (AI-supported people only), not just the drawn nodes. |

Verified in the browser with a synthetic 178-person session: dark/light themes, narrow viewport (sheet is closed until asked for), selection fade, wheel / trackpad / pinch handling, tabs and search. Frame rate while dragging a dimmed crowd was not measured; check it on a real large exploration.

## View controls revision (2026-10-15)

Seven buttons now live in the bottom-left toolbar: layout (time/free), group around endpoints, unpin all | hide lines, zoom in, zoom out, fit. The buttons share one `ToolButton`; a state is shown with `aria-pressed` and a fixed label, an action by its label alone.

| Area | Decision |
| --- | --- |
| Endpoint drag | Only on the time line do the endpoints slide just vertically (their year is their place). In free and cluster layouts they go anywhere and are pinned where dropped. `applyEndpoints` (run by `setGraph`, `setSize`, `setMode`, `unpin`) leaves a pinned endpoint alone outside time mode, so new people or a resize never snap it back. Entering or leaving the time line gives a pinned endpoint the new layout's place along the axis but keeps its dropped height. |
| Unpin all | `NetworkLayout.unpinAll()` releases every pin once (endpoints go home) and reheats once; the explorer syncs `pinned` afterwards. Disabled when nothing is pinned. Pinned people are exempt from folding, so releasing them can fold leaves into "+n" on crowded graphs. |
| Hide lines | Local state in `NetworkGraph`. The edges are not rendered at all (also cheaper to paint), nor the closest-approach line; the selected contact and the lit success chain keep theirs, so choosing a contact in the inspector or the Reveal hold still shows something. |
| Endpoint prominence | `view.nodes` starts with the endpoints, so they were painted under everybody; they are now drawn last. Beyond size: a static halo and a second ring in their side's colour (A teal, B violet, as in the header badges and the time bands), rings that keep their thickness when zoomed out (`vector-effect: non-scaling-stroke`), the whole name (28 characters) on a pill, a larger A/B badge, and a dim of .45 instead of .13 so they stay landmarks while someone is selected. Not a pulse: `.net-pulse` already means "being assessed". |
| Group around endpoints | Third `LayoutMode`, `'cluster'`: a free layout (no time axis) where each endpoint's people sit on rings by number of accepted links (`NetworkNode.distance`, along the BFS `parent`), over 270° facing away from the other endpoint; people linked to nobody on a ring gather in the space between. Unverified people (a selected person's contextual contacts, or the ones a legend chip reveals) are not strays: each stays beside the person it is linked to, in a fan one slot beyond, or on one more ring around the endpoint when it is linked to the endpoint itself; they do not count toward the endpoints' separation, so selecting someone or toggling a chip never moves the clusters. `planOrbit` is pure: a ring is as wide as its people need (slot = 2 × (radius + label room)), people are ordered by their parent's angle then year, and the endpoints are placed from the ring sizes, not the screen. A custom per-tick force (`orbitForce`; d3's `forceX/forceY` read their targets once) pulls everyone to their ring around the endpoint's current position, so dragging an endpoint carries its people; no charge, a faint link force. Guide rings with "n links" labels are drawn at the endpoints' live positions. A mode, not a one-shot: arrivals during a live search land on their rings and a person who gets closer to an endpoint moves in. Entering it releases all pins (grouping is an arrangement of its own); `LayoutInput` gained `side`, `distance`, `parent` (also in the simulation signature). |

Verified in the browser with a synthetic 213-person exploration: free endpoint drag and pin, unpin all, cluster layout (light, dark, 375px wide), hide lines. Two limits seen: with 100+ people the fit zoom makes names unreadable (the halo keeps the endpoints findable); the preview pane throttles `requestAnimationFrame`, so animations were finished with `layout.settle()`.

Ideas not built (candidates for a follow-up): time mode with side swimlanes (A above the middle, B below); community clusters; off-screen endpoint pointers. (Grouping by category and the corridor were built later the same day, below.)

## Columns layout (2026-10-15)

Fourth `LayoutMode`, `'columns'`: two-sided layered columns, so "which contact is closer to which endpoint" reads as a left-to-right gradient. Endpoint A rests on the far left and B on the far right, level with each other; a person on A's side stands in the group of lanes for their number of accepted links (`NetworkNode.distance`, 1 link = first group right of A), a person on B's side in the mirrored group counted from the right; people linked to nobody gather in a middle band between the two sides. It shares the cluster layout's machinery: `LayoutInput.side/distance/parent`, a pure planning function (`planColumns`, next to `planOrbit`) producing per-person offsets from an anchor, a per-tick custom force asking again every tick (`orbitForce` became `planForce`, `orbitTarget` `planTarget`, `orbit`/`orbitCenter` `plan`/`planCenter`, one `arranged` check for both modes), endpoints that drag anywhere and carry their columns, and pins released on entering the mode.

| Area | Decision |
| --- | --- |
| Rows | Inside a group people are ordered by the row of their `parent` in the previous group, then year, then id (determinism). Rows are at least one slot apart (slot = 2 × (radius + label room), as for rings) and each is as close to its parent's height as that allows: pool-adjacent-violators over the rows, so children stand beside the person who introduced them and a column with many children is centered on them. A parent missing from the previous group counts as height 0, i.e. year order. Only the parent is used, not every neighbour in the previous column: the parent links form a tree, so they never cross. |
| Lanes | A group of more than 12 people (`COLUMN_MAX_ROWS`) widens into lanes instead of growing taller (person i goes to lane i mod L, row ⌊i / L⌋, so the order still reads top to bottom). Without it one crowded distance made a column of 40+ rows and Fit zoomed out to unreadable. Lanes are at least 124 px apart (a name is wider than a slot), groups 40 px further apart than lanes, so distances read as separate bands. This deviates from "one column per distance": it is one group of lanes per distance, headed once. |
| First column | It starts 118 (half of the widest endpoint name pill, 28 characters) + the person's radius + label room from the endpoint (168 px), not at the cluster layout's first ring (about 124 px): the pill sits under the endpoint and a column that close would touch it. |
| Unverified people | A selected person's contextual contacts, or the ones a legend chip reveals, never move anybody and never count toward the endpoints' separation. They stand in lanes **behind the endpoint** of the side of the person they link to (A's to its left, B's to its right), at that person's height; one linked to somebody just placed follows in a later round, farther out. First tried beside the person (the gutter between groups) and past the outermost group; both collide with real people (the next group's children stand exactly there) or with the middle band, so selecting someone shoved the columns. Behind an endpoint is free space by construction; the price is a longer dashed line to the person they belong to. |
| Guides | `NetworkLayout.columns` (`ColumnGuide`: anchor, side, hops, dx, half, top, bottom, relative to the endpoint, so dragging it carries its bands) is the same array until the plan changes (`sameColumns`), so the per-tick subscription does not re-render. One dashed band per group, all the same height, headed by the count. Headers are drawn at a constant size on screen (`12 / zoom`) and share the room of the narrowest band: "n links" while it fits, then the bare number, then only every fifth. `rings` stays empty outside the cluster layout and `columns` outside this one. |
| Separation | `COLUMN_MIN_SEPARATION` 640, the two sides' reach plus the middle band and a 120 px gap, as for the clusters; the plan is placed around the center fixed when the mode starts. |
| Toolbar | Eight buttons. The layout button still toggles time and free; group-around-endpoints and the new columns button are pressed toggles (pressing the active one returns to free, the other one switches over, both fit the camera). A popup menu with the four layouts would be more compact, but `useModalFocus` handles Esc at the document in the capture phase, so a menu could not take Esc before the overlay closed. At 375 px the eight buttons are 334 px in a 342 px row (one line). |

Verified in the browser with a synthetic 160-person exploration (dark at 1280 px and 375 px wide; light at 1280 px, with long endpoint names): columns A 1–4 left, B 4–1 right, bands and headers, select-to-reveal (maximum movement of anybody else 3 px, the contacts behind A), Fit. The default view folds leaves, so 73 of the 160 people were drawn; the full 150-person layout is checked by the unit test only. Unit tests: `planColumns` (mirrored sides, rows by parent and spacing, lanes, unverified people, endpoint pill clearance), the settled layout (columns, drag, arrivals, selection, pins, guides cleared on leaving, determinism) and a 150-person world with no two people within 60 px. Limits: with the default folding (73 of the 160 people drawn) Fit sat at 0.35 zoom on an 828 × 543 stage, so names are unreadable until the user zooms; the headers scroll away with the plan when zoomed in (a pinned header strip would fix that); in a widened group the children of one parent can spread over several lanes of the same row.

## Category and corridor layouts, and the layout menu (2026-10-15)

| Area | Decision |
| --- | --- |
| Category | `'category'`: one pod per field (`planCategories`, biggest first), each a grid of slots in year order under a title, in a tinted panel in the category's colour. The pods are shelf-packed into a block whose proportions are as close to 1.7:1 as the packing allows (every row width that adds one more pod is tried); endpoint A stands left of the block and B right of it, outside every pod. Pod coordinates are the layout's own and fixed (offsets anchored to `CENTER`), so dragging an endpoint never moves them. Titles keep a readable size on screen (14-34 px). |
| Corridor | `'corridor'`: `corridorSpine(view)` (view model) is the chain when there is one, else the way up the `parent` chain from each endpoint to the closest-approach pair (the gap between them stays open), else just A and B; each person's index goes to the layout as `spine`. `planCorridor` puts the spine on a centre line, A and B at its ends and the others a fraction `along` of the way between the endpoints' *live* positions; everybody else belongs to the nearest spine person by links (the earlier one on a tie), hangs in lanes above and below them, a slot of height per link (first-link people alternate sides, deeper ones stay on their parent's side, rows ordered by their parents' lane); the line is as long as the ribs need; people linked to nobody wait in rows underneath. The soft band behind the line is painted between the two endpoints each tick. |
| Menu | The old layout toggle and the rings and columns buttons are now one `LayoutMenu` button showing the current layout's icon with a small caret; it opens upwards with all six layouts, each just an icon and a name, the current one in the accent colour (`aria-checked`, no tick). The menu is a second toolbar: the same glass as the view controls (surface at 60%, border at 50%, 14px radius, `blur(24px)`, same shadow), drawn through a portal into a layer over the graph (`net-menu-host`, inside the dialog) rather than inside the toolbar, because a blur inside a blurred element only sees that element. Its height is capped to the graph panel (it scrolls, scrollbar hidden, when short) and it closes on a resize. `role="menu"` / `menuitemradio`, opens on the current layout, arrows/Home/End move, Esc closes the menu alone (a window capture listener runs before the overlay's own Esc handling), a press elsewhere closes it, focus returns to the button after a keyboard choice. Choosing an arranged layout (rings, columns, categories, corridor) releases all pins and frames the whole picture. Unpin all, hide lines and zoom stay beside it. |
| Shared | `LayoutInput` gained `category` and `spine` (in the simulation signature); `arranged` is every layout but the time line and free; `planTarget` understands `along` and `CENTER` offsets. |

## Maximized graph (2026-10-15)

A bare icon button (no panel, `canvas-floating-button` look) in the top-right corner of the graph, just below the year strip, toggles `maximized` in `ConnectionExplorer`. The body gets `is-maximized`: the inspection panel is `display: none` (still mounted, so its tab, search and scroll survive) and the graph takes the whole width; header and footer stay. Esc restores before it closes (after selection and search). Narrow screens have no button and ignore the state: there the graph already has the whole body and the inspection is a bottom sheet. A selection made while maximized still dims the rest, but its details are in the hidden panel until the graph is restored. **Superseded** by real full screen: see `real-fullscreen-graph.md` (the graph fills the viewport, the header and footer become a floating bar, and the panel floats and shows those details).

## Out of scope

- Changes to search, assessment, discovery limits, persistence or lifecycle beyond the success hold.
- Manual search steering, graph editing, or persisting layout/pins.
- Using this graph for saved successful paths in the Connection tab.
- Semantic-zoom label hiding (possible follow-up if folding proves insufficient).
- External reference links.
