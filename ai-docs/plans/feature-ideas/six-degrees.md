# Six Degrees: connect two people through personal contacts

Implemented refactor, 2026-10-12. The [settled refactor specification](../six-degrees/six-degrees-refactor.md) records the user decisions.

Pick two people and ChronoWeave searches for a chain of **personal contacts** between them. People the accepted chain needs that are missing from the canvas are woven in, the camera flies along the chain while an amber thread draws, and the sidebar lists the chain with evidence for every link. Each link needs an independent AI assessment; unaccepted links never appear as successful connections. Production assessments use model knowledge and do not retrieve historical sources.

“Six Degrees” is the name of the idea, not a promise of exactly six: the result reports the real path length.

## Scope and principles

- **People only.** A, B, and every intermediate are people. Events are never endpoints or nodes.
- **Contact only.** Every adjacent pair needs overlapping defensible lifespans and a supported personal interaction: meeting, teaching, correspondence, collaboration, family interaction, or direct service. Family ties alone and influence through a work (“Einstein read Newton”) do not count. The refactor also permits direct opposition between those exact people in a named battle/campaign; common institutions/eras and broad opposing-war membership do not qualify.
- **Any historical gap is eligible.** There is no upfront distance refusal. Searches are bounded to 20 intermediates and a finite budget; an unsuccessful exploration does not prove historical impossibility.
- **Honest uncertainty.** A model's inability to establish contact remains unresolved, not a permanent negative fact. Proposed names and discovery claims are not established contacts.
- **No request counts** or invented completion percentages are shown.

## Behavior

### Entry and picking B

- A **“Connect to…”** action in the figure actions (`useFigureActions.tsx`), shown for people only, sets that figure as **A** and enters **picking mode**. It is available through the existing canvas and sidebar figure actions.
- A banner at the top reads: *“Connecting from Leonardo da Vinci: pick a person on the canvas or type a name. Esc to cancel.”*
- **Pick a person already on the canvas.** Click their timeline bar or gallery card to choose **B**. Events, A itself, and invalid/conflicting identities cannot be picked; an attempted invalid selection shows its reason in the picker. A distant person remains eligible regardless of the gap between their lifespan and A's.
- **Type the name of a canvas person.** The banner suggests canvas people first. Select a suggestion, or use the arrow keys and Enter. A unique exact normalized name already on the canvas is matched synchronously and treated like a picked person, including validation and saved-path replay; identifying that person needs no AI call.
- **Type the name of someone off-canvas.** Submit the banner field with Enter or **Connect**. `resolveFigure(name)` identifies the typed person. Unknown, ambiguous, event, self, or otherwise invalid results return an inline error and retain the typed text. The resolved canonical identity is matched against compatible canvas people before treating B as new; dates are never silently changed to force a match.
- A valid off-canvas B is searched just like an on-canvas endpoint. It is added together with any missing intermediates **only when a complete accepted chain succeeds**. Stopping or failing to establish a chain leaves canvas membership unchanged.
- Esc, **Cancel**, or starting another figure action leaves picking mode.
- Connect is allowed on **Follow a Figure** canvases too: the user requested this connection explicitly. Woven-in people are marked as newly discovered and remain permanent members, even if they are not generally related to the Follow focus.
- The launcher Surprise Me “Six Degrees” suggestion card remains an unbuilt stretch goal.

### Search

1. Resolve exact identities, replay a valid versioned canvas path, or offer an existing checkpoint explicitly.
2. Look for an accepted route in shared knowledge, bounded to 21 links/20 intermediates.
3. Assess contemporaneous endpoints directly; an unresolved verdict does not veto indirect routes.
4. Use one whole-chain proposal as unverified seed candidates, then explore from both endpoints and their accepted contacts. Null or unusable seeds fall through to discovery.
5. Discover diverse batches with temporal progress as a soft preference; retain chronological detours. Exclude repeated pairs, not known people or the opposite frontier. Additional discovery rounds can return new contacts.
6. Assess pairs independently in compact batches and give promising uncertainty one focused reassessment per context/segment. Only accepted edges compose a route. After each accepted batch, return the shortest route in the graph discovered so far; do not claim a globally shortest historical chain.

Operational defaults: 180 seconds including queueing/retries, 32 model tasks, 160 new people, 320 attempted pairs, up to four discovery sources/six contacts per source and eight assessments per batch. Defaults are tunable; selected contact rules and explicit continuation are fixed. Identity normalization handles accents/punctuation/spacing; partial names and conflicting dates never silently merge people. Promising aliases require compatible canonical resolutions within the same budget.

### Exploration and interruption

A large separate overlay shows proposed/checking, AI-supported, unresolved and structurally blocked contacts. Pan, zoom, fit, select nodes/edges, or use the readable list. Inspection reads stored evidence and does not trigger extra AI work. The underlying timeline's people, layout and camera are untouched during exploration.

Stop leaves a paused network. Closing/Escape, another relationship action, canvas/launcher changes or provider/model changes stop work and checkpoint it. Reload restores paused-search availability without automatically calling the model. Resume/Continue is explicit; Continue supplies a fresh budget with queues, rounds, identities and accepted exploration retained. Reverse endpoints orient the same unordered checkpoint correctly. Transport errors preserve useful exploration and allow corrected Settings or later resume. Empty explored frontiers mean this exploration did not establish a chain, not historical impossibility.

### Busy and abort rules

- Search participates in the existing relationship-action operation guards: starting it aborts running Map/Expand work, and a replacement action stops the search.
- `isConnecting` joins `isBusy`. During exploration, pan and zoom operate on the separate network overlay; the underlying canvas layout and camera stay unchanged.
- Stop, Esc, overlay close, canvas/launcher changes, and provider/model changes abort active work. Completed contacts and useful search state can be checkpointed, but no incomplete path is saved as a successful connection and no exploratory person is woven in.
- Late responses cannot change a stale canvas, restart a stopped search, or settle an incomplete chain.

### Weaving in (success only)

Guarded settlement validates the current request, exact identities, chronology, accepted contacts and chain bound immediately before mutation. It maps shared identities to current canvas IDs, weaves missing people with full lifespans/occupations/categories/descriptions, and saves a new path. The existing amber thread, camera flight, gallery/timeline drawing, skip and reduced-motion behavior remain. The 21-link reveal stays within the existing eight-second cap.

- New people are added to `figures`, as with Expand Timeline, and look like every other figure. They are permanent canvas members: closing the connection does not remove them, and there is no special undo for weaving.
- **Timeline layout:** each consecutive run of new people becomes an `addDiscoveryCluster` anchored on the existing chain node just before the run.
- **Gallery layout:** new people are appended without discovery clusters.
- The canvas range (`config.start` / `config.end`) extends with small padding when new people fall outside it. Active category filters widen to show the added categories; a themed canvas also widens `activeCategories` for categories it gains.
- A toast confirms the result, for example: *“Wove in 3 people to connect Leonardo and Newton: …”* If no new people were needed, it reports the degree count.
- Woven IDs remain protected independently of the Recent connections cap, so a person once rejected against a Follow a Figure focus survives reload and path eviction.

### Reveal

- **Camera:** frame the whole chain first, then fly node to node with the shared animated camera while each thread segment draws, and finally settle on the whole chain.
  - The total time is capped at about eight seconds, with shorter segments on long chains, including the new 21-link maximum.
  - Clicking or pressing Esc during the reveal skips to the finished state.
  - User pan, zoom, or wheel interrupts the camera flight. With `prefers-reduced-motion`, the camera jumps and the thread appears without animation.
- **Thread:** both timeline bars and gallery cards have their own SVG connection layer. The amber dashed thread draws above the people through a mask, so its dashes stay still while a link is revealed. Both layouts retain their shared Manhattan routing with rounded corners.
- **Focus view:** people off the chain are ghosted at 7% opacity and greyscale. Chain members fade in as the thread reaches them, receive numbered badges and amber outlines, and are all visible once the reveal finishes. Category filters do not dim active chain members during reveal or replay; existing people's saved filter selections are unchanged.
- **Leaving the view:** Esc after the reveal, the Connection tab's close button, or clicking a ghosted person hides the active connection. The ghosted-person click then acts as a normal canvas click. Woven members and saved connections remain.

### Sidebar: CONNECTION tab

- The existing sidebar has a **Connection** tab next to **Figures / Events**. It appears while a connection is active, the canvas has valid saved paths, or paused explorations are available. Showing a successful connection opens the sidebar if collapsed.
- **Header:** for example, *“Leonardo da Vinci and Isaac Newton are 4 degrees apart.”*
- **Chain:** cards from A to B use the existing sidebar card style, portraits/descriptions and figure actions.
- **Between cards:** a slim vertical thread connector shows compact accepted-contact evidence and a **Why?** button opening the existing explanation dialog.
- **Why:** its dedicated Six Degrees task expands the accepted contact record. It bypasses general negative/narrative caches, writes no general negatives and never prunes figures. If expansion cannot reliably support the record, the dialog shows stored compact evidence.
- **Camera sync:** the current person's card is highlighted during the flight and scrolled into view. Clicking a chain card flies the camera to that person. Reduced motion disables smooth scrolling.
- **Close:** hides the active thread while saved connections and paused explorations remain accessible.
- **Recent connections:** newest first, at most `MAX_RECENT_CONNECTIONS` per canvas. Clicking an entry replays its reveal without model calls. A request in the reverse direction displays the saved chain reversed.
- **Paused explorations:** opening an entry reads stored state without running a model. Resume/Continue or a fresh search requires an explicit choice.

### Persistence

- Only complete accepted chains enter **Recent connections**. New `chrono_sd2_path_` records use unordered endpoint keys and retain ordered node IDs, identities, compact contact proofs and a timestamp.
- Successful paths remain canvas-bound: they save, restore and evict with that canvas's history. The recent cap and hiding paths whose members no longer exist on the canvas are retained.
- Permanent membership remains in `chrono_woven_ids`, independently of saved-path eviction.
- Shared contact knowledge and resumable sessions now live separately in versioned IndexedDB; their retention cannot make a retained self-contained successful path unreplayable.
- Legacy paths/contact verdicts are not imported as shared knowledge or displayed as new Recent connections. Membership-safe migration is described below.

## AI tasks

All supported providers retain their existing credential, settings, queueing and retry behavior. Prompt builders remain in `prompts.ts`, with provider-neutral parsing and validation.

- **`fetchConnectionPath(from, to, options, signal)`** accepts `{ catalog, maxIntermediates }` and returns `{ nodes, links } | null`. Canvas catalog entries use short references mapped back to real IDs. New people carry names, full lifespans, occupations, categories and descriptions. It supplies unverified seed candidates; the refactor no longer uses it for local repairs or treats its claims as proof. Canvas people are available without being preferred over better off-canvas bridges.
- **`resolveFigure(name, signal)`** returns one canonical person or `null` for unknown, ambiguous or non-person names. The result passes the existing people validation, then compatible canvas matching and endpoint checks. The resolver's general prompt is unchanged.
- **`discoverPersonalContacts` / `assessPersonalContacts` / `explainPersonalContact`** are the dedicated Six Degrees discovery, independent compact assessment and accepted-contact narrative operations. Gemini has corresponding JSON schemas; OpenRouter and Ollama use the same provider-neutral contracts.
- Map Relationships, Expand Timeline, Follow a Figure, biographies and general relationship explanations continue using their original prompts, semantics and caches. Six Degrees does not use their verdicts as contact vetoes.

## Modules and storage

- `connectionGraph.ts`: shared person identity, structural validation, bounded shortest paths, frontier ranking and serializable sessions.
- `pathService.ts`: existing seed/typed-resolution task wiring, short-reference mapping and proposal/person validation.
- `connectionAI.ts`: dedicated discover/assess/explain contracts, short references, parsing and provenance; adapters for Gemini, OpenRouter and Ollama preserve existing transport/settings mechanisms.
- `connectionPath.ts`: graph-first bidirectional engine and segment limits; no production local-repair loop or legacy/general negative veto.
- `connectionKnowledge.ts`: `chronoweave-six-degrees-v2` IndexedDB, injectable memory fallback, bounded retention, safe recovery and checkpoints. Knowledge is shared across canvases/models and carries provider/model/version/timestamp provenance; no credentials are stored.
- `connectionFlow.ts` / `useConnection.ts`: start/replay/explicit-resume decisions, lifecycle and guarded canvas settlement.
- `ConnectionExplorer.tsx`: scoped responsive SVG network; `ConnectionPanel` and existing thread/reveal components show success.
- `connectionPaths.ts` / `canvasHistory.ts`: `chrono_sd2_path_` records carry their own identity/contact evidence so shared-knowledge eviction cannot invalidate a retained route. Permanent woven IDs remain in their existing namespace.
- `weaveConnection.ts`: unchanged pure canvas weaving, discovery-cluster runs, range/category extension and permanent additions.
- `useConnectionReveal.ts` / `canvasCamera.ts` / `connectionThread.ts` / `ConnectionThread.tsx`: existing shared reveal, animated camera and masked thread geometry for both layouts.

Legacy paths/contact verdicts are not imported or displayed as new Recent connections. Per-canvas `chrono_sd2_members_` migration preserves the legacy path/woven membership union before Follow a Figure pruning. Logical retirement leaves old metadata in place, so failed writes keep protection. Current and historical canvases migrate lazily on activation. Other prompts, caches, settings/history and UI behavior retain their original semantics.

## Retained implementation details

- **Direct link only between contemporaries.** The compact direct check is skipped without a model call when A and B's lifespans never overlapped. This blocks only their direct edge, not an indirect search.
- **References, not canvas IDs.** Seed proposals still use `A`, `B` and short catalog references; new discovery and assessment tasks also use short references, which validators map back to exact identities.
- **Typed-name errors stay in the picker.** Resolution failures retain the draft and show an inline message. Events and self-selections receive their own refusal; distant pairs no longer do. Unknown off-canvas proposals never acquire biographies or actions merely because they were drawn during exploration.
- **Amber outlines and badges.** The successful-chain focus view retains crisp outlines rather than glow: timeline people have 2px outlines (3px for the current person), gallery cards 3px (4px current), and numbered badges. `--color-connection` supplies deeper amber in light theme and lighter amber in dark; `--color-connection-contrast` colours badge numbers. Event connectors are ghosted with their labels. Gallery cards remain exempt from the reduced-motion opacity rule that would cancel ghosting/category dimming.
- **Manhattan routes.** Both layouts share `manhattanThread` in `src/utils/connectionThread.ts`. A link leaves and enters the sides horizontally, with a rounded vertical run between. Overlapping bars/cards route past both on the same side, with 28px clearance and a preference for route continuity. Where arrival and departure share an edge, `separateSharedSide` offsets the lines 6px around its centre and staggers their turns to avoid crossing next to the person. The thread may cross ghosted people.
- **Camera and toolbar.** Resetting zoom interrupts a reveal. Toggling layout first interrupts it, so the other canvas shows the finished thread rather than replaying. The Connection tab scrolls the current card with `block: 'nearest'`. `revealLinkMs` distributes time within `CONNECTION_REVEAL_MAX_MS`.
- **Camera contract.** Canvases receive `connection: { nodeIds, playId, animate }`. `animate` becomes false when reveal ends, so remounting or changing layout retains the finished thread.
- **Retained constants.** `MAX_RECENT_CONNECTIONS = 20`, `PATH_CATALOG_LIMIT = 150`, and `CONNECTION_REVEAL_MAX_MS = 8000` retain their roles. `MAX_PATH_INTERMEDIATES` is now 20; the old distance/repair constants were replaced by the bounded engine's tunable `SEARCH_LIMITS`.
- **Not built.** The launcher Surprise Me suggestion card and any special undo for woven-in people remain outside scope.

## Verification

Run bun test, npm run typecheck and npm run build. Review returned contacts independently under the personal-interaction/named-opposition rubric. The five priority cases are mandatory reports, not assumed historical positives. No discovery-improvement claim is justified while provider availability/quota blocks comparable runs.
