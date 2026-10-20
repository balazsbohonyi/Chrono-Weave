# Shared Knowledge Graph Explorer: the global contact web

Explore the cumulative network of every verified personal contact discovered across all Six Degrees searches and saved canvases. While a Six Degrees search explores contacts between two specific people, the **Knowledge Graph Explorer** opens the shared `chronoweave-six-degrees-v2` database (merged with any accepted contacts preserved in saved canvas paths) as a single, read-only historical network. Users can pan, zoom, filter by category or connected island, trace shortest known chains between any two people in the network, read full **Why?** narratives, jump to saved canvases containing a person, or immediately weave a new **Follow a Figure** canvas.

Status: Proposed. Builds directly on the implemented Six Degrees network overlay (`ConnectionExplorer`, `NetworkGraph`, `NetworkInspector`, `connectionGraph.ts`, and `connectionKnowledge.ts`).

## Scope and principles

- **Accepted contacts only.** Only live people (`!person.canonicalId`) and valid accepted personal contacts (`validAccepted(contact, people)`) appear in the global graph. Unresolved, proposed, checking, and structurally blocked pairs—as well as isolated people with zero accepted contacts—are excluded.
- **Self-contained + shared union.** Load accepted contacts from `chronoweave-six-degrees-v2` (`connectionRepository().loadKnowledge()`) and merge in any accepted contacts and people snapshots stored in `chrono_sd2_path_` entries on the current canvas and in `CanvasHistory`, so routes from older canvases remain present even if IndexedDB was cleared or evicted.
- **Zero AI cost to explore.** Opening the explorer, switching layouts, filtering, searching, inspecting evidence, and tracing shortest known paths between two people make no AI model requests. Only clicking **Why?** on a contact edge (`explainPersonalContact`) or **Weave Follow a Figure** (`buildTimeline`) invokes the AI service.
- **Endpoint-free by default, pair-traceable on demand.** The graph opens without fixed `A` and `B` search endpoints, using uniform Six Degrees node styling and layouts that do not require two hubs (`time`, `free`, `category`). Picking any two people in the graph as `A` and `B` computes and lights up the shortest known chain between them (of any link length) and unlocks the endpoint-oriented layouts (`corridor`, `columns`, `cluster`).

## Behavior

### Entry and empty state

- **ControlPanel header button.** Add a **Knowledge Web** icon button in `ControlPanel` (`canvas-header-actions`), available whenever the app is not busy (`!isBusy`).
- **Connection sidebar tab.** Make the **Connection** tab available in `Sidebar` (or add a **Knowledge Web** action inside `ConnectionPanel` above Recent connections / Paused explorations) so users can open the global graph directly from the Six Degrees sidebar panel.
- **Empty state.** The entry buttons stay enabled even before the user has run a Six Degrees search. When the merged graph has zero accepted contacts, the explorer opens with a clear empty state explaining how Six Degrees searches verify personal contacts across centuries and accumulate them here, with a button to return to the canvas.

### Graph presentation and layouts

- **Uniform styling when endpoint-free.** With no `A` and `B` endpoints selected, all nodes use the standard Six Degrees AI-supported styling (portraits via `useNetworkPortraits`, neutral/amber rings and edges). No `A` or `B` badges are drawn, and no endpoint free-zones are reserved.
- **Available layouts:**
  - **Endpoint-free (`A` and `B` not both set):** Offer **Timeline** (`time`), **Free** (`free`), and **Categories** (`category`, rendering category pods without flanking endpoint anchors). If the user's saved layout preference (`readNetworkViewPrefs().mode`) is an endpoint-only layout (`cluster`, `columns`, `corridor`), fall back to `time` without overwriting their saved preference for two-endpoint Six Degrees searches.
  - **When `A` and `B` are both selected:** Unlock all six layouts (`time`, `free`, `cluster`, `columns`, `category`, `corridor`).
- **Leaf folding.** Reuse the `NETWORK_FOLD_THRESHOLD` (`+n` badges) rule for degree-1 leaves so crowded hubs remain legible. Selected people, pinned people, and members of an active `A ↔ B` chain never fold.

### Filtering and connected islands

- **Filter bar / legend.** Since every edge in the global explorer is an accepted contact, replace the unverified status chips (`Proposed`, `Unresolved`, `Structurally blocked`) with global filtering controls:
  - **On current canvas** toggle chip: filters the graph to people present on the active canvas (`samePerson` match against `figures`) plus their direct accepted contacts (1 hop), so users can see how the current canvas connects to the wider web. Disabled when the current canvas has no matching people in the graph.
  - **Isolate island** toggle chip (available when a person or contact is selected, or when `A` is chosen): hides disconnected components and shows only the connected component reachable from the selected person/contact.
  - **Category filter chips:** toggleable chips for the figure categories present in the global graph (`CATEGORY_LIST` excluding `'EVENTS'`), filtering visible nodes (and edges whose endpoints are both visible) while keeping any active `A ↔ B` chain visible.
- **Footer summary.** When endpoint-free, the footer replaces the `A`/`B` side counters with global counts: **"{P} people · {C} personal contacts · {I} connected {island|islands}"** (reflecting the full merged store, with filtered counts shown when a filter is active). When `A` and `B` are selected, show the `A`/`B` side counts and chain degree summary alongside the global counts.

### Tracing a path between any two people (`A ↔ B`)

- **Selecting endpoints.**
  - A compact route bar in the explorer header (where endpoints sit in `ConnectionExplorer`) shows two slots: **From (A)** and **To (B)**.
  - In the inspector's person detail view, offer **"Set as start (A)"** (or **"Set as destination (B)"** when `A` is already chosen, plus **"Swap A ↔ B"** / **"Clear route"** in the header).
- **Path calculation.**
  - As soon as both `A` and `B` are set, compute the shortest accepted path between them in the global graph using breadth-first search with `routeExclusions(people, [a, b])` (preventing ambiguous same-name conflicting-date records from masquerading as bridges), **without** the 21-link search cap (`maxLinks = Infinity`).
  - **Connected (`A` and `B` in the same island):** Light up the chain in lime (`--color-chain-path`), show the **"{N} {degree|degrees}"** badge between `A` and `B` in the header, add the toggleable **Connection** chip in the legend, and list the ordered chain steps in the inspector.
  - **Disconnected (`A` and `B` in different islands):** Show both endpoints in the header with an explicit status badge: **"Different islands — no known path yet"** (or report an `AmbiguousBridge` notice if a path exists only through conflicting-date namesakes). Keep `corridor` disabled when no chain connects `A` and `B`.
- **Read-only inside the explorer.** Tracing a route in the Knowledge Graph Explorer never mutates the underlying canvas or weaves missing people in.

### Inspector: people, contacts, and actions

Reuse `NetworkInspector` and `VirtualList` (keeping `ROW_HEIGHT` and `DETAIL_ROW_HEIGHT` synchronized with `.net-vlist`):
- **Main lists:** **People** and **Contacts** tabs with instant search across all accepted people and contacts (matching names, aliases, occupations, and contact interaction types), sorted alphabetically.
- **Person detail view:**
  - Shows portrait, name, lifespan years, occupation, explicit aliases, and their list of accepted contacts.
  - **Path tracing controls:** **"Trace path from here (Set as A)"** / **"Trace path to here (Set as B)"** and **"Isolate this island"**.
  - **Saved canvases ("Appears on"):** Match the selected `ContactPerson` against the current canvas (`figures`) and every snapshot in `CanvasHistory` (`history`) using `samePerson`.
    - If present on the **current canvas**, show a **"Current canvas: {prompt}"** chip. Clicking it closes the Knowledge Graph Explorer and flies the canvas camera (`flyCamera` / `focusPerson`) to that figure.
    - If present on one or more **saved history canvases**, list each as a clickable chip showing its formatted prompt and year range. Clicking a history chip closes the explorer, activates that canvas via `commitCanvas(snapshot)`, and focuses/flies the camera to the matching figure once installed.
  - **Weave Follow a Figure:** A **"Weave Follow a Figure canvas"** button. Clicking it closes the Knowledge Graph Explorer, opens the Weave Launcher in its active build progress state, and immediately starts `buildTimeline({ mode: 'figure', query: person.name })` (archiving the outgoing canvas in history once the build succeeds, with normal failure preservation if validation or generation fails).
- **Contact (edge) detail view:**
  - Shows both portraits, names, interaction type, optional year and episode, compact accepted evidence, and model provenance.
  - **Why? button:** Clicking **"Why?"** calls the existing `openConnectionExplanation(sourceFigure, targetFigure, contact)` flow (`explainPersonalContact` with `recordedContactSection(contact)` as the first section and compact evidence fallback). `RelationshipPopover` opens above the Knowledge Graph Explorer while the explorer stays mounted and `suspended` (`inert`), so closing the `RelationshipPopover` (via X, backdrop, or Escape) returns directly to the exact same state in the Knowledge Graph Explorer. Clicking a biography icon inside `RelationshipPopover` opens the person's biography and returns to the explanation on close.

### Background Wikidata reconciliation

- When the Knowledge Graph Explorer opens, run a non-blocking background pass over any live people in the loaded knowledge store that still satisfy `needsWikidata(person)` (`src/services/connectionGraph.ts`), batched cleanly through the existing `WikidataResolver`.
- If Wikidata resolves QIDs, corrects dates, or merges duplicate records via `reconcileIdentities`, persist the updated `ContactKnowledge` back to `connectionRepository()` and smoothly update the explorer's in-memory graph (remapping any selected person/endpoints to their `chooseSurvivor` record).
- Follow the `AGENTS.md` Wikidata guardrail: never count as a model `task()`, never fail or block the explorer if offline or rate-limited, never re-key canvas IDs, and never modify the active canvas.

### Dismissal and modal rules

- **Mutual exclusion:** Opening the Knowledge Graph Explorer closes any open sidebar detail popovers or legend panels and is mutually exclusive with active canvas builds, Map/Expand actions, and running Six Degrees searches.
- **Layered Escape:** Handled via `useModalFocus`:
  1. If `RelationshipPopover` (from **Why?** or biography) or `LayoutInfoDialog` or `SixDegreesInfoDialog` is open above the explorer, Escape closes that top dialog first and restores focus inside the explorer.
  2. Inside the explorer, Escape steps back through inspector selection (`contact → person → main list`), then clears an active search query, then clears an active `A ↔ B` route selection, then un-maximizes the graph view, and finally closes the explorer and restores focus to the invoking button.
- Switching canvases via `CanvasHistory` or opening the Weave Launcher closes the explorer.

## Data, view model, and layout

### 1. Assembling the global knowledge snapshot (`src/services/knowledgeGraph.ts`)

Create a pure helper `buildGlobalKnowledgeSession(knowledge, canvases)` that constructs a synthetic `ConnectionSession`-compatible structure (or `GlobalKnowledgeGraph`) from:
1. `knowledge: ContactKnowledge` loaded from `connectionRepository().loadKnowledge()`.
2. Saved `ConnectionPathEntry` records read via `listConnectionPaths` across the current canvas and all `CanvasSnapshot` entries in `CanvasHistory` (recovering any `people` and `contacts` from `chrono_sd2_path_` records that might have been evicted from IndexedDB, deduplicated via `samePerson` and `settleContacts`).

Filter to:
- `contacts`: all assessments passing `validAccepted(contact, peopleById)`.
- `people`: all live records (`!person.canonicalId`) referenced by at least one valid accepted contact.
- Compute connected components (`components: Map<string, string>`, mapping each `person.id` to a deterministic component ID, plus `islandCount`).
- Map each `person.id` to matching canvases (`appearances: Map<string, Array<{ canvasId: string; isCurrent: boolean; prompt: string; years: string; figureId: string }>>`) using `samePerson`.

### 2. Extending `buildNetworkView` and `connectionNetworkLayout.ts`

- **Optional endpoints:** Allow `session.endpoints` to be empty (`['', '']`) when no `A` and `B` are selected in the global explorer.
  - In `buildNetworkView` (`src/services/connectionNetworkView.ts`): when endpoints are absent, every accepted person has `endpoint: null`, `side: 'none'`, `distance: null`, and `parent: null`. When `A` and `B` are selected in the global explorer, pass `[aId, bId]` as the active endpoints so `fromA`, `fromB`, `side`, `distance`, and `chain` (with `maxLinks = Infinity`) compute naturally.
  - Add optional filter parameters to `NetworkViewOptions`: `canvasPersonIds?: ReadonlySet<string>` (for the **On current canvas** filter, keeping those people plus their 1-hop accepted neighbors), `componentOf?: string | null` (for **Isolate island**), and `categories?: ReadonlySet<FigureCategory>` (for category filtering).
- **Layout adaptations (`src/services/connectionNetworkLayout.ts`):**
  - `time` and `free`: already work when `endpoints` is empty (`zones` is empty, `yearDomainFor` derives bounds from all visible people's birth/death years when endpoint bounds are absent).
  - `category` (`planCategories`): when no endpoints exist, partition the category pods around `CENTER` without reserving left/right endpoint anchor columns.
  - `cluster`, `columns`, `corridor`: enabled in `LayoutMenu` only when both `A` and `B` are selected (and `corridor` only when `A` and `B` are in the same connected island or have a closest approach).

### 3. Persisting reconciled knowledge without a search session

- Add `saveKnowledge(knowledge: ContactKnowledge): Promise<boolean>` to `ConnectionRepository` in `src/utils/connectionKnowledge.ts` so background Wikidata reconciliation in the Global Knowledge Graph can persist merged identities and QIDs without needing to write a dummy `ConnectionSession` checkpoint.

## Implementation

1. **Repository & Graph Assembly:**
   - Add `saveKnowledge(knowledge)` to `ConnectionRepository`, `MemoryConnectionRepository`, and `IndexedConnectionRepository` in `src/utils/connectionKnowledge.ts`.
   - Create `src/services/knowledgeGraph.ts` to merge `ContactKnowledge` with `chrono_sd2_path_` records from current + history canvases, compute connected components (`islandCount`, `componentById`), match canvas appearances via `samePerson`, and run unbounded BFS shortest-path (`shortestKnownChain`) with `routeExclusions`.
2. **View Model & Layout Support for Endpoint-Free Graphs:**
   - Update `src/services/connectionNetworkView.ts` so `buildNetworkView` handles empty endpoints (`['', '']`), unbounded chain highlighting, and the new global filters (`onCurrentCanvas`, `isolatedComponentId`, `categories`).
   - Update `src/services/connectionNetworkLayout.ts` so `yearDomainFor` and `planCategories` gracefully handle graphs with zero endpoints, and `LayoutMenu` disables endpoint-only layouts (`cluster`, `columns`, `corridor`) with a clear tooltip when `A` and `B` are not both selected.
3. **Hook & State (`src/hooks/useKnowledgeGraph.ts`):**
   - Manage open/close state, async loading from `connectionRepository()`, merging with `history` and current canvas `storage`, background Wikidata reconciliation (with stale-token guard), `A`/`B` endpoint selection, filter states, and action callbacks (`onExplain`, `onJumpToCanvas`, `onWeaveFigure`).
4. **UI Components:**
   - Adapt `src/components/ConnectionExplorer.tsx` and `src/components/connectionNetwork/NetworkInspector.tsx` (or wrap them via a `mode="global"` / `KnowledgeGraphExplorer` props contract) to render:
     - The global header with `A ↔ B` route picker/status bar (**"Pick two people to trace a known path"**, **"Different islands — no known path yet"**, or **"{N} degrees"** with **Clear route**).
     - The global filter bar (**On current canvas**, **Isolate island**, and category chips).
     - Person inspector sections for **Trace path (`Set as A` / `Set as B`)**, **Appears on canvases** chips, and **Weave Follow a Figure**.
     - Contact inspector **Why?** button wired to `openConnectionExplanation`, suspending the explorer while `RelationshipPopover` is open.
     - Global footer stats (**people · personal contacts · connected islands**).
   - Add the **Knowledge Web** entry button to `src/components/ControlPanel.tsx` and `src/components/ConnectionPanel.tsx`, and wire `App.tsx` for canvas jumping + camera flight and immediate `buildTimeline({ mode: 'figure', query })`.
5. **Documentation & Tests:**
   - Update `ai-docs/guides/six-degrees-internals.md` and `README.md`.
   - Add unit and component tests covering knowledge + saved-path merging, retired/unverified filtering, connected-component detection, endpoint-free view and layout calculation, unbounded `A ↔ B` pathfinding with `routeExclusions`, canvas appearance matching, and **Why?** / **Jump to canvas** / **Weave Follow a Figure** interactions.

## Acceptance checks

- Opening the Knowledge Graph Explorer makes zero AI requests (`tests/connectionRequestTrace.golden.json` remains untouched).
- Only live (`!canonicalId`) people with at least one valid accepted contact (`validAccepted`) appear; unresolved/proposed/blocked pairs and isolated people never appear.
- Accepted contacts from saved `chrono_sd2_path_` entries in the current canvas and `CanvasHistory` appear in the graph even if `chronoweave-six-degrees-v2` was cleared.
- When opened with no `A` and `B` selected, nodes use uniform Six Degrees styling, `time`/`free`/`category` layouts work without endpoint anchors, and endpoint-only layouts (`cluster`, `columns`, `corridor`) are disabled until two people are picked.
- Picking `A` and `B` in the same connected component lights up the shortest accepted chain in lime (even if longer than 21 links), displays the degree count, and unlocks `cluster`, `columns`, and `corridor`. Picking `A` and `B` in separate components clearly states **"Different islands — no known path yet"**.
- **On current canvas**, **Isolate island**, and **Category** filters update the visible graph while keeping virtualized inspector lists (`ROW_HEIGHT` / `DETAIL_ROW_HEIGHT`) aligned.
- Clicking **Why?** on any contact opens `RelationshipPopover` above the suspended explorer using `explainPersonalContact` (with compact evidence fallback); pressing Escape or closing the popover returns to the explorer with selection and scroll intact.
- Clicking a **Current canvas** or **Saved history canvas** chip on an inspected person closes the explorer, activates that canvas if needed, and flies the camera (`flyCamera`) to that person.
- Clicking **Weave Follow a Figure** closes the explorer and immediately starts a `figure`-mode timeline build in the launcher for that person.
- Run `bun test`, `npm run typecheck`, and `npm run build`.
