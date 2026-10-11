# Six Degrees: connect two people through personal contacts

Pick two people and ChronoWeave finds a chain of real, documented **personal contacts** between them, a "handshake chain" such as Leonardo da Vinci → Verrocchio → … → Isaac Newton. People the chain needs that are missing from the canvas are woven in, the camera flies along the chain while a glowing thread draws, and the sidebar lists the chain with the verified evidence for every link. Every link is checked by the existing relationship verification; unverified links never appear as connections.

"Six Degrees" is the name of the idea, not a promise of exactly six: the result reports the real path length.

## Scope and principles

- **People only.** A, B, and every intermediate are people. Events are never endpoints or nodes.
- **Contact only.** Each link needs overlapping lifespans and a documented personal interaction: met, taught, corresponded, worked with, family, served under, fought. Influence through a work ("Einstein read Newton") does not count. This is what makes it degrees of *separation* rather than intellectual lineage.
- **Honest limits.** A contact link moves about one adult lifetime through history, so distant pairs are refused upfront instead of failing after many requests.
- **No request counts** are shown anywhere.

## Limits (code-only constants in `src/constants.ts`)

| Constant | Default | Meaning |
| --- | --- | --- |
| `MAX_PATH_INTERMEDIATES` | `10` | Most people between A and B (at most 11 links). |
| `YEARS_PER_DEGREE` | `40` | Conservative years bridged per intermediate, used by the feasibility check. |
| `MAX_PATH_REPAIRS` | `3` | Total repair calls per search. |
| `MAX_RECENT_CONNECTIONS` | `20` | Saved paths listed per canvas. |
| `PATH_CATALOG_LIMIT` | `150` | Most canvas people sent as catalog. |

With these defaults, pairs up to about 400 years apart are reachable (Leonardo → Newton about 120 years, Dante → Galileo about 240 years). Cleopatra → Einstein is refused.

## Behavior

### Entry and picking B

- A **"Connect to…"** action in the figure actions (`useFigureActions.tsx`), shown for people only, sets that figure as **A** and enters **picking mode**.
- A banner at the top reads: *"Connecting from Leonardo da Vinci: pick a person on the canvas or type a name. Esc to cancel."*
- **Click a bar** to pick B. Events, A itself, and people beyond the feasibility limit are dimmed and cannot be picked.
- **Type a name** in the banner field. Canvas people are suggested first. A name that is not on the canvas is resolved with `resolveFigure(name)`. If it resolves to `null`, an event, or A, the picker shows an inline error ("Couldn't identify that person"). A resolved B goes through the same feasibility check and is woven in with the intermediates.
- Esc, or starting any other action, leaves picking mode.
- **Feasibility check (no AI call).** The gap is `max(0, later.birthYear − earlier.deathYear)`, where living people use the current year as their death year. If `gap > MAX_PATH_INTERMEDIATES × YEARS_PER_DEGREE`, B is refused with an honest message: *"Cleopatra and Einstein lived about 1,900 years apart. A chain of personal contacts would need about 48 people, more than the limit of 10."*
- Connect is allowed on Follow a Figure canvases too (unlike Expand Timeline): the user asked for this connection explicitly, and woven-in people are marked as newly discovered.
- A "Six Degrees" suggestion card in the launcher's Surprise Me area is a stretch goal, not part of v1.

### Search

1. **Saved path.** If this canvas already has a saved path for the pair (in either direction), replay the reveal immediately with no AI calls. A reversed request shows the chain reversed.
2. **Direct link.** Check A → B with the cached assessment, or one `assessRelationships(A, [B])` call. If the link is positive, the result is "1 degree apart". If it is negative, add the pair to `avoidPairs`.
3. **Propose.** `fetchConnectionPath(A, B, …)` returns a full path or `null`. A pure validator rejects the proposal, with one corrective retry through `generateValidatedJson`, when any of these hold:
   - the endpoints are not A and B;
   - a node is an event;
   - there are more than `MAX_PATH_INTERMEDIATES` intermediates;
   - consecutive lifespans do not overlap;
   - a person appears twice;
   - an `id` is not in the catalog;
   - a new node fails the `parseWeaveFigures` people rules.

   New nodes whose canonical name matches a canvas person are mapped to that person. `null` means "no path found", not an error.
4. **Verify every link** one at a time with `assessRelationships`. Cached `chrono_assessment_` entries cost nothing. Verification does not stop at the first failure.
5. **Repair locally.** For each failed link X → Y, call `fetchConnectionPath(X, Y, …)` with all known-bad pairs in `avoidPairs` and `maxIntermediates` set to the remaining budget. Verified links are kept. Verify the new bridge and repair again if needed, up to `MAX_PATH_REPAIRS` repair calls in total.
6. **Result.**
   - **Success:** weave in, save, reveal.
   - **Failure:** the canvas is unchanged and nothing is saved. The sidebar shows the verified pieces with marked gaps ("Couldn't find a verified link between Vasari and Rubens") and **Try again**. Try again starts a fresh search that keeps the known-bad pairs and reuses cached assessments.

### Progress

- A dedicated **`ConnectionProgress`** card has the same glass style and position as `ProgressOverlay`, plus a **Cancel** button.
- It shows the current phase: "Identifying Henry VIII…", "Checking for a direct link…", "Proposing a path…", "Repairing Vasari → Rubens…".
- Below the phase is a live list titled *"Checking proposed links…"*. Each link appears with a spinner and turns into a green ✓ or a red ✗. Long lists scroll inside the card.
- Proposed names are never presented as facts.

### Busy and abort rules

- The search runs through `beginRelationshipAction()`: starting it aborts any running map or expand action, and the reverse also holds.
- A new `isConnecting` flag joins `isBusy`. Pan and zoom stay free during the search.
- Cancel, Esc, a canvas switch, or opening the launcher aborts the search. The canvas is unchanged and nothing is saved, but completed assessments stay cached.

### Weaving in (success only)

- New people are added to `figures` and to `newlyDiscoveredIds`, the same way Expand Timeline adds them. They are permanent canvas members; closing the connection does not remove them. There is no special undo in v1.
- **Timeline layout:** each consecutive run of new people becomes one `addDiscoveryCluster` anchored on the existing chain node just before the run.
- **Gallery layout:** new people are appended without clusters, matching discovery.
- The canvas range (`config.start` / `config.end`) is extended with small padding when new people fall outside it. Category filters for their categories are enabled.
- A toast confirms the result: *"Wove in 3 people to connect Leonardo and Newton: …"*.

### Reveal

- **Camera:** frame the whole chain first, then fly node to node with the shared animated camera while each thread segment draws, and finally settle on the whole chain.
  - The total time is capped at about 8 seconds, so each segment gets less time on long chains.
  - Clicking or pressing Esc skips to the finished state.
  - With `prefers-reduced-motion`, the camera jumps and the thread appears without animation.
- **Thread:**
  - **Timeline:** a new SVG layer beside the connector layer (`TimelineCanvas.tsx`, "Connector Lines"), drawn with an animated `stroke-dashoffset`.
  - **Gallery:** its own SVG layer between card placements.
- **Sidebar: CONNECTION tab.** The existing sidebar gets a third tab next to FIGURES / EVENTS. The tab appears while a connection is active or the canvas has saved paths, and opens the sidebar if it is collapsed.
  - **Header:** *"Leonardo da Vinci and Isaac Newton are 4 degrees apart."*
  - **Chain:** cards from A to B, using the existing sidebar card style with portrait, description, and `SidebarCardActions`.
  - **Between cards:** a slim connector with a vertical thread line, the verified `RelationshipExplanation.evidence`, and a **Why?** button that opens the existing relationship explanation dialog.
  - **Camera sync:** the card for the current node is highlighted during the flight, and clicking a card flies the camera to that person.
  - **✕** hides the active thread but keeps the tab while saved paths exist.
  - **Recent connections:** listed below the chain, newest first, at most `MAX_RECENT_CONNECTIONS`. Clicking an entry replays its reveal.

### Persistence

- Only successful paths are saved, under `chrono_path_<idA>_<idB>` with sorted ids. Each entry stores the node ids in A → B order, the verified evidence for each link, and a timestamp.
- `chrono_path_` is added to `isCanvasCacheKey`, so paths are saved, restored, and evicted with their canvas.
- When more than `MAX_RECENT_CONNECTIONS` paths exist, the oldest are dropped. Paths referencing ids no longer on the canvas are hidden silently.

## AI tasks

Both tasks follow the shared-foundation pattern:

- prompt builders in `prompts.ts`;
- a provider-neutral parser and orchestration in a new service;
- `JsonTask` gains `'path' | 'resolve'`, with Gemini response schemas; OpenRouter and Ollama use plain JSON;
- implementations in `geminiService.ts`, `openRouterService.ts`, and `ollamaService.ts`, plus all test doubles.

### `fetchConnectionPath(from, to, options, signal)`

- **Options:** `{ catalog, avoidPairs, maxIntermediates }`.
- **Returns:** `{ nodes: Array<{ id: string } | NewPerson>, links: Array<{ claim: string }> } | null`. `NewPerson` has `name, birthYear, deathYear, occupation, category, description`.
- **Used for both purposes:** the first proposal (A → B) and each repair (X → Y with a smaller budget).
- **Catalog:** canvas people only, as `{id, name, birthYear, deathYear}`. It includes those whose lives fall between the endpoints with about 50 years of padding, capped at `PATH_CATALOG_LIMIT`, preferring those closest to the timeline between the endpoints.
- **Prompt:**
  - `RELATIONSHIP_RULES` without the work-engagement exception;
  - every consecutive pair needs overlapping lifespans and documented personal contact;
  - prefer the shortest path through well-documented people;
  - never use the pairs in `avoidPairs`;
  - return `null` when no confident path is known.
- `claim` is used for the model's reasoning and the progress labels only. The UI shows evidence from verification, never `claim`.

### `resolveFigure(name, signal)`

- **Returns:** one person (`NewPerson` shape) or `null`.
- Returns `null` for unknown, ambiguous, or non-person names.
- The result goes through the same people parsing rules, and its canonical name is matched against the canvas first.

## Implementation

0. **Shared animated camera** (README foundation 1), built here because Time-Lapse and Story Tour do not exist yet:
   - a pure `flyCamera(from, to, durationMs, onFrame, signal)` with ease-in-out and a zoom-out-then-in arc for long distances;
   - a pure figure-bounds-to-camera helper extracted from the auto-zoom effect, for both layouts;
   - reduced-motion jumps, and any user pan, zoom, or wheel cancels the flight;
   - update the README to note that it now exists.
1. Constants, types, prompts, parsers, `JsonTask: 'path' | 'resolve'`, and the three provider implementations.
2. `src/services/connectionPath.ts`: a pure, testable orchestrator (fake service and storage) covering the direct check, propose, validate, verify all, local repair, and result/partial result, with progress callbacks and an `AbortSignal`. It also contains the feasibility helper and the catalog builder.
3. App:
   - picking mode, with the banner, name field, and dimming;
   - the `ConnectionProgress` card;
   - `isConnecting` in `isBusy`;
   - merging figures and clusters, sharing code with the relationship action merge;
   - range and filter extension.
4. Sidebar CONNECTION tab (chain, evidence connectors, Recent connections) and the thread layers in both canvases.
5. Persistence: `chrono_path_` cache entries, the `isCanvasCacheKey` addition, the recent list, and replay.
6. Tests (`bun test`):
   - **Verification gate:** a rejected link never appears as connected.
   - **Proposal validation:** wrong endpoints, events, duplicates, non-overlapping lifespans, unknown ids, and too many intermediates.
   - **Repair:** keeps verified links, honours `avoidPairs` and the remaining budget, and stops after `MAX_PATH_REPAIRS`.
   - **Failure:** partial result with gaps, and the canvas is unchanged.
   - **Direct link:** a short-circuit to 1 degree.
   - **Feasibility:** the threshold, including living people.
   - **Catalog:** trimming and the cap.
   - **De-duplication:** new nodes are matched against canvas names by canonical name.
   - **Clusters and range:** anchoring per run of new people, and range extension.
   - **Cache:** sorted-id keys, reversed replay, the recent cap, and stale entries hidden.
   - **Abort:** cancelling leaves the canvas and the path cache untouched.
   - **Camera:** `flyCamera` easing, cancellation, and reduced motion.

Run `bun test`, `npm run typecheck`, and `npm run build`, and update the README's Key Features section.
