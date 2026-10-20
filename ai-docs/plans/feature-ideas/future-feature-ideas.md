# Future Feature Ideas (Brainstorm Backlog)

Candidate features to be refined individually into full implementation plans under `ai-docs/plans/feature-ideas/`. Each idea is designed around ChronoWeave's core principles: strict historical grounding, catalog-referenced single-shot JSON AI tasks, canvas-scoped persistence, dual `timeline` / `gallery` layout support, and reuse of shared foundations (`canvasCamera.ts`, `connectionKnowledge.ts`, Wikidata integration, and `canvasHistory.ts`).

| # | Idea | Summary | AI Work | Effort |
| --- | --- | --- | --- | --- |
| 1 | [Intellectual & Causal Lineage](#1-intellectual--causal-lineage-lineage-of-an-idea) | Trace non-contact influence, mentorship, and event causality as a directed flow across centuries | 1 new method | M–L |
| 2 | ["In Their Lifetime" Horizon Lens](#2-in-their-lifetime--personal-worldview-lens) | Reframe the canvas to a single figure's lifespan, age ruler, lived events, and generational handoffs | Optional 1-shot summary | S–M |
| 3 | [Crucible Year Inspector & Density Sparkline](#3-turning-point--crucible-year-inspector) | Spot peak historical clustering on the year ruler and inspect a 1-shot synthesis of any selected year | 1 new method | S–M |
| 4 | [Geographic Footprint via Wikidata](#4-geographic-footprint-where-on-earth-via-wikidata-coordinates) | Plot verifiable birth, death, activity, and event coordinates from Wikidata on an interactive mini-map | None (Wikidata only) | M–L |
| 5 | ["The Missing Piece" Blindspot Analyzer](#5-the-missing-piece--blindspot--counter-perspective-analyzer) | Surface underrepresented disciplines, regions, or catalyst events for the current canvas and weave them in | 1 new method | M |
| 6 | [Shared Knowledge Graph Explorer](knowledge-graph-explorer.md) | *(Promoted to full plan)* Explore the cumulative IndexedDB network of all verified people and contacts discovered across every canvas | Reuses `explainPersonalContact` | M |
| 7 | ["Chrono-Sort" Timeline Puzzle](#7-chrono-sort--timeline-puzzle-game-zero-ai-local-mode) | Zero-AI tactile game where players place scrambled figures/events onto the timeline and see year accuracy | None (100% local) | S–M |
| 8 | [Portable Canvas Cartridges & Poster Export](#8-portable-canvas-cartridges--annotated-story-exports) | Export/import self-contained `.chronoweave` snapshots and print-ready SVG/PNG timeline infographics | None | M |

---

## 1. Intellectual & Causal Lineage ("Lineage of an Idea")

While **Six Degrees** requires direct *personal contact* during overlapping lifespans (explicitly excluding influence through works like *"Einstein read Newton"*), much of intellectual, artistic, and political history travels across centuries through texts, institutions, mentorships, and catalytic events.

### Concept & Behavior
- **Entry:** A **"Trace Lineage"** action on any figure or event, offering two directional modes:
  - **Roots:** Who and what on this canvas shaped this person or event?
  - **Ripples:** Who and what on this canvas did this person or event shape?
- **Visuals:**
  - Draws a directed left-to-right **tree / DAG flow** across the timeline (or gallery) using a distinct visual treatment from Six Degrees' amber personal-contact thread (for example, indigo/teal lines with directional chevrons).
  - Each directed edge carries an explicit relationship category badge: **Mentor → Student**, **Read & Cited**, **Artistic / Scientific Influence**, **Rival Tradition**, or **Event Catalyst**.
  - Stepping through nodes uses the shared animated camera (`flyCamera` in `src/utils/canvasCamera.ts`).
- **Historical distinction:** Clearly labeled as **Intellectual / Causal Influence** rather than personal contact, never polluting the Six Degrees personal-contact store or general relationship cache.

### Architectural Fit
- **AI Task:** `fetchLineageGraph(focus, catalog, direction, signal)` returning validated catalog node IDs and typed directed edges with 1–2 sentence factual justifications.
- **Cache:** `chrono_lineage_<canvasId>_<figureId>_<direction>` registered in `isCanvasCacheKey` (`src/utils/canvasHistory.ts`).

### Open Questions to Refine Later
- Should Lineage stay strictly within the current canvas catalog in v1, or optionally allow 1-hop off-canvas discovery injection like Expand Timeline?

---

## 2. "In Their Lifetime" — Personal Worldview Lens

Selecting a single year highlights everyone alive at that moment, and Relationship Mapping shows direct connections, but there is no mode that reframes the canvas through **one person's lived span of history**.

### Concept & Behavior
- **Entry:** **"Lived Horizon"** in a figure's action bar (for people only).
- **Viewport & Ruler:**
  - Smoothly fits the horizontal camera (`fitCameraToBounds`) to the figure's `birthYear`–`deathYear` interval.
  - Adds a secondary **Personal Age Ruler** (`Age 0` … `Age N`) directly beneath the calendar year ruler.
- **Visual Tiers on Canvas & Sidebar:**
  - **Lived Events:** Historical events overlapping their lifespan display the person's age when the event began (e.g., *"Thirty Years' War begins — Galileo is 54"*).
  - **Verified Contacts:** Figures with positive cached assessments stay at full prominence at the top of the horizon summary.
  - **Unmet Contemporaries:** Other canvas figures alive during their lifetime remain visible in a distinct band, explicitly labeled as contemporaries rather than known contacts.
  - **Generational Baton Passes:** Highlights figures who died in the focus person's early childhood or were born within ~5 years of the focus person's death (visualizing historical handoffs, such as Galileo dying in 1642 and Newton being born in 1642/1643).

### Architectural Fit
- **Zero-AI Core:** Computing age rulers, overlapping events, contemporary bands, and generational handoffs is 100% deterministic from existing canvas data and cached assessments.
- **Optional AI Task:** `fetchLivedHorizonSummary(figure, overlappingEvents, contemporaries, signal)` for a 2-paragraph synthesis of how the world changed between the person's birth and death (`chrono_horizon_<figureId>`).

### Open Questions to Refine Later
- How should the gallery layout represent the Lived Horizon (e.g., grouping cards into *Lived Events*, *Known Contacts*, *Contemporaries*, and *Baton Passes*)?

---

## 3. Turning Point / "Crucible Year" Inspector

Currently, `Ctrl/Cmd + Click` selects a year on the timeline and filters the sidebar to figures alive in that year, treating every year as a flat alphabetical list.

### Concept & Behavior
- **Ruler Density Sparkline (Local):** Render a subtle, low-profile histogram/sparkline along the timeline's top year ruler showing where active lifespans, births/deaths, and events cluster most densely. Users can immediately spot high-density "crucible periods" before zooming in.
- **Examine Year Action:** When a year is selected (`selectedYear`), a compact **"Examine {Year}"** button appears in the sidebar header or year indicator.
- **Year Almanac / Crucible View:**
  - Shows a structured snapshot of that year (or ±1 year window): events underway, figures in their prime, young newcomers, and elder statesmen, with exact ages calculated locally.
  - Requests a 1-shot AI synthesis explaining what made that moment a historical crossroads on this canvas—how the active events and living figures intersected.

### Architectural Fit
- **AI Task:** `fetchYearCrucible(year, activeFigures, activeEvents, context, signal)` grounded strictly to the canvas entries alive or underway in `year`.
- **Cache:** `chrono_crucible_<canvasId>_<year>` in `canvasHistory.ts`.

### Open Questions to Refine Later
- Should the sparkline weight event starts/ends and relationship density higher than raw lifespan overlap so peak ticks reflect dramatic moments?

---

## 4. Geographic Footprint ("Where on Earth?") via Wikidata Coordinates

Both `meanwhile.md` and `explore-their-work.md` avoid AI-generated maps because LLM coordinates can hallucinate. However, ChronoWeave already resolves canonical Wikidata QIDs (`src/services/wikidata*`) for identity deduplication and portraits.

### Concept & Behavior
- **Verifiable Data Source:** Fetch geographic coordinates directly from Wikidata claims for resolved canvas entities—Birthplace (`P19`), Place of Death (`P20`), Work Location (`P937`), or Event Location (`P276`)—via their linked place entities' coordinate claims (`P625`). Never ask the AI model to guess coordinates.
- **Atlas Drawer / Split View:**
  - A toggleable map panel showing pins/clusters for the current canvas's figures and events.
  - **Two-way highlighting:** Hovering or selecting a bar on the timeline highlights its locations on the map; selecting a region or pin on the map highlights the corresponding bars on the canvas.
  - **Integration with other modes:**
    - During **Time-Lapse**, pins light up and shift geographically as the year cursor sweeps forward.
    - During **Six Degrees**, the active chain can optionally display its geographic hops alongside the chronological thread.

### Architectural Fit
- **Wikidata Guardrails:** Follows `AGENTS.md` strictly—Wikidata coordinate lookups are never counted as AI `task()` calls, never block or fail canvas builds, never re-key figure IDs, and cache cleanly by QID in IndexedDB/localStorage.

### Open Questions to Refine Later
- What lightweight, dependency-minimal vector basemap (e.g., bundled Natural Earth SVG/GeoJSON coastlines) best matches ChronoWeave's paper/glass light and dark themes without external tile-server keys?

---

## 5. "The Missing Piece" — Blindspot & Counter-Perspective Analyzer

Generated timelines and repeated figure expansions naturally gravitate toward the most famous figures or a dominant region/discipline, leaving historical blindspots within the user's chosen era or theme.

### Concept & Behavior
- **Entry:** An **"Analyze Blindspots"** (or **"What's Missing?"**) action in the control panel when a canvas is active.
- **Analysis:** Sends the current canvas catalog (`{id, name, birthYear, deathYear, category, occupation}`) and `weaveContext` to the model.
- **Output Cards:** Displays 3 structured perspective cards within the **exact same time span**:
  1. **Underrepresented Discipline:** e.g., *"Your Renaissance canvas is rich in Artists and Leaders, but lacks the Scientists and Printers who circulated their work."*
  2. **Parallel Geography / Counter-Perspective:** e.g., *"Your 17th-century canvas focuses on Western Europe; explore contemporaneous figures in Edo Japan or Safavid Persia."*
  3. **Missing Catalyst Event or Bridge Figure:** e.g., *"Several figures on your canvas were shaped by the 1648 Peace of Westphalia, which is not yet on the timeline."*
- **Actionable Weaving:** Each card previews 3–5 specific historical figures/events and offers **"Weave into This Canvas"** (which validates and injects them as a retained discovery cluster via `addDiscoveryCluster`) or **"Weave as New Canvas"**.

### Architectural Fit
- **AI Task:** `fetchCanvasBlindspots(catalog, weaveContext, signal)` returning 3 structured proposals with candidate figures/events that pass existing lifespan and minimum 3-year event duration rules.
- **Cache:** `chrono_blindspots_<canvasId>_<catalogHash>` in `canvasHistory.ts`.

### Open Questions to Refine Later
- When injecting a blindspot pack into a **Follow a Figure** canvas, should it be disabled (respecting the focus-only rule) or offered only as **"Weave as New Canvas"**?

---

## 6. Shared Knowledge Graph Explorer ("The Global Web")

Six Degrees already stores every verified personal contact and canonical person across all canvases and models in the persistent `chronoweave-six-degrees-v2` IndexedDB database (`src/services/connectionKnowledge.ts`). Currently, that cross-canvas graph is invisible unless a specific Six Degrees search traverses it.

### Concept & Behavior
- **Entry:** A **"Knowledge Web"** button in the launcher header or top control panel showing total verified people and links discovered across the user's history.
- **Interactive Global Graph:**
  - Opens an expanded version of the `ConnectionExplorer.tsx` SVG network displaying all verified people and personal-contact edges accumulated in IndexedDB across every canvas the user has ever explored.
  - Highlights **"Bridge Figures"**—people who connect clusters discovered in different canvases (for example, a figure who linked a *Scientific Revolution* canvas to an *Enlightenment* canvas).
  - **Inspect & Launch:** Clicking any node shows its stored profile and verified contacts, lists which saved canvases in `CanvasHistory` contain that person (with a 1-click jump), or offers **"Weave Follow-a-Figure Canvas"** around them.

### Architectural Fit
- **Zero AI Cost:** Reads directly from `connectionKnowledge.ts` (`chronoweave-six-degrees-v2`) and `portraitStore`, reusing `ConnectionExplorer` layout, pan/zoom, and virtualized sidebar lists.

### Open Questions to Refine Later
- When the global IndexedDB graph grows to hundreds of nodes, should the view default to showing connected components with $\ge 3$ nodes and a search filter?

---

## 7. "Chrono-Sort" — Timeline Puzzle Game (Zero-AI Local Mode)

Complements the **[Who Am I? Quiz](who-am-i-quiz.md)** with a fast, tactile chronological puzzle that requires zero AI calls and works completely offline.

### Concept & Behavior
- **Entry:** Available alongside **"Quiz me"** (or as a mode switch inside the quiz dialog) whenever a canvas has at least 6 entries.
- **Gameplay Mechanics:**
  - Selects 6–10 figures/events from the current canvas and deals them one by one as "unplaced cards" with their birth/death/event years hidden.
  - **Place on the Timeline:** The user drags or clicks the target year on the timeline where they believe the figure lived or the event began.
  - **Reveal & Scoring:** The bar animates into its true chronological span, showing the exact year delta (e.g., *"Spot on! Within 4 years"* or *"Off by 65 years"*), highlighting which already-placed figures were actually contemporaries.
- **Persistence:** Tracks high scores alongside `quizBest` in the canvas snapshot.

### Architectural Fit
- **100% Local:** Uses existing canvas figures/events, requires no `IAIService` changes, and reuses the canvas coordinate/year conversion helpers.

### Open Questions to Refine Later
- Should Chrono-Sort be a standalone micro-mode or a tab inside the **Who Am I? Quiz** modal?

---

## 8. Portable Canvas Cartridges & Annotated Story Exports

All canvases, discovery clusters, verified relationships, and Six Degrees paths currently live only in browser storage (`localStorage` and `IndexedDB`), capped at 20 history entries. Users cannot share an explored canvas with a friend/student or export a clean visual artifact.

### Concept & Behavior
- **Canvas Cartridge (`.chronoweave.json`):**
  - **Export:** Bundles the current canvas snapshot (`figures`, `config`, `weaveContext`, retained discovery clusters, and scoped `chrono_*` caches for verified relationships, biographies, and Six Degrees paths) into a downloadable JSON file. Strictly strips any provider settings or API keys.
  - **Import:** Drag-and-drop or pick a `.chronoweave.json` file in the launcher or history bar to validate and load it into `CanvasHistory` without making any AI requests.
- **High-Res Poster / Vector SVG Export:**
  - Generates a clean, self-contained SVG (and rasterized high-DPI PNG) of the current timeline or active Six Degrees chain.
  - Includes a formatted header block (canvas prompt, year span, era band), the year ruler, category legend, figure bars/cards, and optional numbered footnotes for active Six Degrees links.

### Architectural Fit
- **Pure Client-Side Serialization:** Uses existing snapshot structures in `src/utils/canvasHistory.ts` with schema validation on import so malformed or untrusted files cannot corrupt storage or inject HTML/scripts.

### Open Questions to Refine Later
- Should imported cartridges also merge their verified Six Degrees edges into the shared `chronoweave-six-degrees-v2` IndexedDB store, or keep them strictly scoped to the imported canvas's `chrono_sd2_path_` cache?
