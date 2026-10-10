# Six Degrees: connect any two figures

Pick two figures, possibly centuries apart, and ChronoWeave finds a chain of real, documented relationships between them, for example Cleopatra → Julius Caesar → Cicero → … → Einstein. People the chain needs that are missing from the canvas are woven in, and the path is drawn as an animated thread. Every link is checked by the existing relationship verification; unverified links never appear as connections.

## Behavior

- **Entry.**
  - A "Connect to…" action in the figure action bar sets that figure as **A**. A picker then asks for **B**: click any bar on the canvas, or type a name. Typed names may be people who are not on the canvas.
  - A "Six Degrees" card in the launcher's Surprise Me area that suggests famous pairs is a stretch goal; not in v1.
- **Search.** A progress overlay shows steps: "Proposing a path…", "Verifying Cleopatra → Julius Caesar…", and so on. Each verified link ticks green as it completes. It can be cancelled at any time without changing the canvas.
- **Path rules.**
  - 1–6 intermediate people (at most 7 links). Intermediates should be people; an event may appear as a node only when its participants' roles are concrete (the person-event rules in `RELATIONSHIP_RULES`).
  - Each adjacent pair must pass `assessRelationships` (a positive, evidence-bearing assessment). Verified links are cached in the normal `chrono_assessment_` cache.
- **Repair loop.** If a link fails verification, ask the AI for a replacement for the failed segment only (between the last verified node and the next node, or B), with the failed pair excluded. At most 2 repairs. If it still fails, show the longest verified partial path and say honestly that the path could not be completed.
- **Weaving in.** New intermediates are added like discoveries: they are placed through the discovery-cluster mechanism (`discoveryClusters`), marked as newly discovered, and the canvas range is extended if they fall outside it. Category filters for their categories are enabled. A failed search adds nothing.
- **Reveal.**
  - The camera flies along the chain (the shared animated camera), and a glowing thread draws segment by segment.
  - A side panel lists the chain as cards: each person with years, and between them the link's one-sentence evidence. Clicking a link opens the existing relationship explanation dialog; clicking a person opens their actions.
  - The degree count is announced: "Cleopatra and Einstein are 6 degrees apart."
- **Persistence.** Found paths are cached per canvas (`chrono_path_<A>_<B>`) and listed in the panel as "Recent connections" for that canvas. The thread can be re-shown from the list.

## AI task

`fetchConnectionPath(a, b, avoidPairs, catalog, signal)` → `{ nodes: Array<{ id?: string; name, birthYear, deathYear, occupation, category, description }>, links: Array<{ evidence: string }> }`.

- `a` and `b` are full figures (B may come from a name, see below). The catalog lets the AI reuse existing canvas figures by `id` instead of duplicating them.
- Prompt: include `RELATIONSHIP_RULES`, prefer the shortest path made of well-documented direct contacts (teacher, correspondent, collaborator, rival, family, commander), and forbid "influence on an era" links. Each consecutive pair's lifespans must overlap unless the link is the documented engagement with a specific work.
- Validation: the endpoints must equal A and B. Consecutive nodes must have plausible overlapping years or a "work" link, with no duplicates. New nodes must pass the same parsing as discovery figures (`parseWeaveFigures` rules). Existing canvas names are de-duplicated by canonical name.
- **B from a typed name.** Resolve it with a small request (`resolveFigure(name)` → a figure or `null`), which also enables "Connect Ada Lovelace to someone not on my canvas." If it cannot be resolved, show an error in the picker.

## Implementation

1. Types, prompts, parser, `JsonTask: 'path' | 'resolve'`, and three provider implementations.
2. `src/services/connectionPath.ts`: orchestrates propose → verify each link (`assessRelationships` per pair) → repair → result. Pure and testable with a fake service.
3. App: picker mode (reusing year-select style pointer handling), progress overlay, merging figures and clusters (share code with `handleDiscover`), and range extension.
4. `ConnectionPathPanel.tsx` and the thread rendering in both canvases.
5. Mutual exclusion and abort; add `chrono_path_` to `isCanvasCacheKey`.
6. Tests: the verification gate (a rejected link never shows as connected), the repair limit, the partial path, de-duplication against canvas names, and range extension.

## Open questions

- Should B be limited to people (not events)? This plan assumes people for v1.
- Maximum degrees: 6 intermediates is ambitious for weaker local models. Should it be configurable?
- Should the request count be shown? A 7-link path costs about 8–12 requests including verification.
