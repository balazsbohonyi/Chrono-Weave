# Six Degrees refactor

Status: design interview complete; refactoring plan ready for implementation.
Date: 2026-10-12.
Scope of this session: settle the design and write this refactoring plan.

## Objective

Replace the single-chain proposal and local-repair approach with a reusable contact graph and a search expanding from both endpoints. Increase discovery success, especially across generations, while preserving the behavior of other features and the accuracy of accepted links.

A result reports the length of the chain found. It does not claim the globally shortest possible historical chain.

## Decisions settled with the user

| Area | Decision |
| --- | --- |
| Qualifying connections | Personal interactions, plus direct wartime opposition between the exact pair in a named battle or campaign. |
| Excluded relationships | Influence through works or ideas; shared eras, places, professions, institutions, movements, family trees, or a larger war without a qualifying interaction or specific direct opposition. |
| Evidence source | AI assessments only, using the configured provider/model. No historical-source retrieval or additional service subscription. |
| Initial search time | Up to three minutes, with a useful result sooner whenever a chain is accepted. Offer explicit continuation when a budget is exhausted. |
| Historical distance | Attempt any pair. Remove the 400-year refusal. Every adjacent pair still needs overlapping lifespans. |
| Chain limit | At most 20 intermediate people, meaning at most 21 links and 22 people including endpoints. |
| Completion | Return the first accepted chain, selecting the shortest route in the graph discovered so far. |
| Reuse | A shared Six Degrees contact network across canvases, including accepted contacts learned outside a successful final chain. |
| Model changes | Accepted contacts remain reusable across providers/models. New models can discover more contacts and reconsider unresolved ones. |
| Uncertainty | A separate assessment accepts clear contacts; promising uncertain or conflicting proposals receive one focused reassessment within a budget segment. Unresolved contacts do not enter an accepted chain. |
| Existing Six Degrees records | Start fresh. Retire existing paths and contact assessments from the new feature while keeping existing canvases and people. |
| Search UI | A large, separate live-network overlay above the current canvas. |
| Network interaction | Pan, zoom, and inspect people/contact evidence. No manual branch prioritization, suggested bridge input, or manual graph editing in this refactor. |
| Interrupted searches | Save explored branches locally. Resume explicitly after a canvas switch or reload; never restart AI work automatically. |
| Evaluation | Demonstrate measured improvement, emphasizing non-overlapping lifetimes, without weaker contact accuracy. No fixed 80% success promise. |

The wartime rule is an explicit exception to a literal acquaintance or handshake chain: Napoleon and Wellington at Waterloo qualify even without a meeting or correspondence. Membership on opposing sides of a larger war, by itself, does not.

## Priority real-world cases

The user reported these unsuccessful searches:

1. Isaac Newton — William Shakespeare.
2. Isaac Newton — Albert Einstein.
3. Isaac Newton — Napoleon Bonaparte.
4. Albert Einstein — Steve Jobs.

Also include Niccolò Machiavelli — Leonardo da Vinci as a regression case for a missed direct working connection.

These are mandatory evaluation cases, not assumed ground-truth positive chains. Establish which have reviewable qualifying chains before scoring discovery failures. Review every returned link independently of the search model. An unresolved case remains an exploratory case rather than becoming evidence that no historical chain exists.

Einstein — Jobs also exercises the distinction between lifespan overlap and contact: overlap is an eligibility check, never evidence that two people interacted.

## Scope boundaries

Preserve the current behavior of:

- Canvas generation and the launcher, including Strict Time Span, Historical Era, Follow a Figure, Region & Culture, Theme or Discipline, and Freeform.
- Map Relationships and Expand Timeline, including their broader relationship definition and caches.
- Biography/deep-dive generation and general relationship explanations.
- Provider settings, credential priority, model selection, and all currently supported providers.
- Canvas history, existing figures/events, selection, filters, layout, camera state, and sidebar state.
- Timeline and gallery layouts, and the existing successful-chain weaving and reveal behavior.

Implementation may add Six Degrees-specific integration points to shared files. It must not change the default behavior of shared prompts, assessment functions, or storage helpers used by other features.

Production additions outside scope: historical-source retrieval, an influence-chain mode, manual search steering, a new backend, a provider-settings redesign, and a general-purpose graph framework.

## Search design

### Search-local graph and shared knowledge

Maintain two related structures:

- **Shared knowledge:** canonical people, accepted undirected contacts, unresolved assessment records, and assessment provenance. Learned contacts are reusable across canvases.
- **Search session:** endpoints, canvas association, explored branches from each endpoint, pending candidates, attempted assessments, discovery history, selected/expanded nodes, and segment budgets.

Candidates and unresolved contacts are hypotheses, not accepted graph edges. Only accepted edges may compose a successful chain. A discovered person can exist in search storage without becoming a member of any canvas.

### Ordered search

1. Validate the endpoint identities: people only, distinct people, defensible dates. Do not refuse an endpoint based on the historical gap.
2. Load shared knowledge and a matching unfinished session, if any. Offer explicit Resume or Start a new search when a checkpoint exists.
3. Look for an accepted path in shared knowledge. Run shortest-path search with the 21-link bound and validate the assembled route before settlement.
4. If the endpoint lifespans overlap and their direct contact is not already accepted, request a compact assessment of the exact pair. An unresolved result must not veto indirect routes.
5. Use one whole-chain proposal as a bounded fast candidate source. Retain the provider-neutral structural parser where useful, remove the preference that restricts off-canvas people, and treat all proposed links as candidates. A null, unverified, or structurally unusable proposal falls through to graph exploration; it does not end the search.
6. Discover contact candidates from both endpoints and later from their promising accepted contacts. Ask for a small diverse batch of people, each with a concrete proposed interaction or specific direct opposition.
7. Assess candidate pairs separately in compact batches. Discovery claims and supplied descriptions remain unverified data; they are not proof for the assessor.
8. Add accepted contacts to shared knowledge and the session graph. Check for a bounded accepted route after every accepted batch.
9. Continue expanding promising branches from both sides until a route succeeds, a budget expires, or no eligible candidates remain in the explored frontier.
10. Return the first accepted route. Otherwise checkpoint the session and show the appropriate paused or unresolved state.

Whole-chain proposals are a fast starting point, not the governing search strategy. The engine can connect accepted pieces from different proposals and different earlier searches instead of locking itself to a route and repairing only its gaps.

### Frontier selection and diversity

Use a bounded, goal-directed bidirectional search rather than exhaustive expansion of every acquaintance.

Rank branches using:

- Shortest accepted distance from the corresponding endpoint.
- Progress toward the other side's historical period, as a soft preference.
- Potential overlap or identity matches with the opposite frontier.
- Contacts already present in shared knowledge.
- Diversity of social roles and networks: family/service contacts, collaborators, teachers/students, correspondents, patrons, and specific wartime opponents.

Do not impose monotonic time travel: a valid chain can temporarily move away from the target period. Rotate between promising and less-explored branches so a famous but unhelpful hub does not consume every expansion.

Canvas membership is identity/context information, not a reason to prefer a weak contact over a stronger off-canvas one.

For non-overlapping endpoints, explicitly ask for contacts that can carry the search toward the other period. Do not ask whether the endpoints themselves met.

Discovery is iterative for each expanded person: remember the round and contacts already proposed for that person, then request additional distinct contacts in later rounds when useful. One short batch must not mark that person's entire historical contact network as exhausted. Rotate away from unproductive repeated rounds rather than indefinitely requesting the same acquaintances.

Exclude repeated candidate **pairs**, not everyone already known to the search. Canvas people and people in the opposite frontier must remain eligible discoveries: excluding them would remove the very meeting points the search needs. Supply selected opposite-frontier references and assess promising cross-frontier pairs as well as newly introduced people. Frontier overlap by identity and a newly accepted edge between the frontiers are both valid ways to join a route.

### Starting operational limits

These are implementation defaults to tune using measurements, not additional user preferences:

| Limit | Starting value |
| --- | --- |
| Wall-clock time per segment | 180 seconds, including queued work and retries |
| Intermediates | 20 |
| Whole-chain seed proposals | One per fresh segment when useful; avoid repeating an unchanged seed request |
| Contact candidates per expanded person | Up to 6 |
| People expanded in one discovery task | Up to 4 |
| Pairs in one compact assessment task | Up to 8 |
| Model tasks per segment | At most 32, including focused reassessment tasks |
| New candidate people per segment | At most 160 |
| Candidate pairs attempted per segment | At most 320, deduplicated |
| Focused reassessment | At most one extra assessment for a promising unresolved pair in a segment |

Provider-level corrective retries and rate-limit retries must obey the same wall-clock deadline. The model-task ceiling is a task limit, not a promise about the number of transport retries.

Continue grants a fresh segment budget while retaining the graph, queues, explored identities, and attempt history. Reconsider an unresolved pair when the model or relevant context changes; avoid spending every new segment repeating identical uncertain checks.

Counts and timing may be recorded for diagnostics and evaluation. Preserve the existing product decision not to show AI request counts or pretend that the search has a known completion percentage.

## Contact assessment

Introduce a compact Six Degrees assessment with:

- Exact pair references.
- Verdict: accepted or unresolved.
- Interaction type.
- A brief concrete description identifying how the exact people interacted or directly opposed one another.
- A named episode/battle/campaign for wartime opposition.
- Dates when confidently known, without inventing dates to satisfy a schema.
- An uncertainty reason for unresolved results.

Deterministic structural contradictions are separate blocked conditions: events, self-links, conflicting identities, invalid dates, non-overlapping lifespans, and duplicate people in an assembled route.

A model's inability to establish contact is **unresolved**, not a permanent negative fact. General relationship rejections and legacy contact rejections must not veto the new Six Degrees search.

An accepted verdict requires meaningful interaction evidence, not just a nonempty string. Prompts and reviewed evaluation cases enforce the semantic standard; parsers enforce references, types, required evidence fields, and structural chronology. Do not introduce fragile keyword matching that substitutes for a historical assessment.

Accepted contacts carry provider/model, assessment version, and timestamp provenance. They remain reusable across model changes as chosen by the user. Deterministic identity or chronology contradictions still invalidate an edge; model reuse does not override structural correctness.

No UI wording should imply retrieval of archival sources. Distinguish proposed, AI-supported/accepted, and unresolved contacts.

## Person identity

- Maintain a stable shared person identity separately from canvas figure IDs.
- Preserve existing canvas IDs; map shared identities to matching canvas figures when weaving.
- Normalize spelling, accents, punctuation, and whitespace using the existing name utility.
- Handle explicit canonical names/aliases with compatible dates and identity context. Never merge different people based on a partial name, title, regnal number, or shared surname.
- Keep uncertain identity matches separate until resolved. Resolve promising cross-frontier alias collisions within the search budget.
- Do not silently adjust supplied dates or substitute a different person to make a contact fit.
- Map new successful-chain members to the existing HistoricalFigure shape and preserve occupations, categories, descriptions, and full lifespans.

## Provider operations and isolation

Keep existing general service contracts and defaults intact. Add Six Degrees-specific operations to IAIService and implement them for Gemini, OpenRouter, and Ollama:

1. **Discover personal contacts:** bounded batches, goal context, existing references, previously explored candidates, and qualified new-person details.
2. **Assess personal contacts:** compact independent assessments for supplied pairs, with uncertainty and the specific-opposition rule.
3. **Explain an accepted contact:** reader-facing narrative generated on demand from the accepted record.

Keep prompt builders and parsers provider-neutral, following the existing shared-foundation pattern. Add suitable Gemini JSON tasks/schemas; retain compatible JSON prompting and validation for OpenRouter and Ollama.

Reuse existing transport, queuing, retry, and credential mechanisms. All new operations must propagate AbortSignal and segment deadlines through transport and corrective retries. Do not change global concurrency policies for unrelated features.

The existing fetchConnectionPath operation may remain as the seed-proposal task, with Six Degrees prompt/validation changes. Remove the old production local-repair orchestration once the new engine replaces it; do not ship two competing search engines or an unused compatibility framework.

The Connection tab's Why action must use the accepted Six Degrees contact record and its dedicated narrative path. It must bypass general negative-cache lookup and must not add negative verdicts to general relationship caches. If narrative generation cannot expand an accepted record reliably, show the stored compact evidence rather than altering general relationships or pruning figures.

## Persistence and fresh start

### New storage

Use a dedicated versioned IndexedDB database for the shared person/contact network and resumable search sessions. Keep it outside the canvas localStorage cleanup path. Provide an injectable in-memory repository for engine tests and an in-session fallback when persistent storage is unavailable.

Persist new successful paths with their canvas under a distinct versioned Six Degrees path namespace. Register only these canvas-bound path records with canvas-history serialization.

No credentials or API headers belong in knowledge records, checkpoints, diagnostics, or benchmark reports.

Apply bounded storage/retention and safe recovery for malformed records. Eviction may remove reusable search knowledge or old checkpoints, but must not remove canvas people or make retained successful paths unreplayable. Path entries retain the compact contact evidence needed for replay.

If persistence fails, keep the current search usable and accurately indicate that cross-reload resume is unavailable; do not silently promise a saved checkpoint.

### Legacy records

Start with an empty new contact network. Do not import old accepted contact assessments or saved paths as knowledge, and do not display old paths as new Recent connections.

Preserve existing canvas figures, woven IDs, clusters, categories, range, and view state.

Before retiring old path metadata, retain every existing canvas member protected by the union of legacy saved-path IDs and woven IDs. This is essential because Follow a Figure uses that union to prevent pruning people who have an explicit general relationship rejection against the focus.

Perform migration idempotently, with per-canvas version markers and durability before removing obsolete records. Handle current and historical canvases, including lazy migration on activation. A failed write must leave legacy membership protection intact. Logical retirement under a new namespace is sufficient; destructive cleanup is not required to launch the new feature.

Leave general assessments, maps, relationship narratives, biographies, provider settings, and non-Six-Degrees history records untouched.

## Search lifecycle and continuation

| Trigger | Required behavior |
| --- | --- |
| Accepted route | Weave missing chain members into the active canvas, save the route, close the exploration overlay, and reveal the chain. |
| Time/work budget exhausted | Save checkpoint, leave the network visible in a paused state, and offer Continue searching. |
| No eligible candidates in explored branches | Show that this search did not establish a chain; offer a fresh expansion attempt or new search, without claiming historical impossibility. |
| Stop | Abort active work, checkpoint completed exploration, and show a paused network with Resume. |
| Close overlay / Escape | Stop and checkpoint, then return focus to the canvas; no background search. |
| Canvas switch / launcher / another relationship action | Stop and checkpoint; preserve existing action precedence and stale-result guards. |
| Reload | Restore resumable state on demand; never generate automatically. |
| Provider/model change | Stop the current segment; explicit resume uses the newly configured model, retaining accepted contacts and revisiting relevant unresolved records. |
| Transport/authentication failure | Preserve the checkpoint, show the actual error, and allow a corrected configuration or later resume. |

Scope checkpoints by canvas and unordered endpoint identities, with orientation retained for the displayed request. Resume from the reverse endpoint order must orient the same search correctly.

Checkpoint completed accepted contacts and useful candidate/frontier state at safe boundaries. Pending operations are returned to the queue on restore. Responses received after cancellation are discarded; earlier completed assessments may finish their durable write but may not mutate a stale canvas or restart a search.

Before a final canvas mutation, validate that the request is still current, resolve shared identities against the current canvas, enforce the chain bound and every edge's accepted/structurally valid status, and calculate new figures from that canvas's current state.

## Live exploration overlay

Use a large responsive modal overlay with:

- A and B as clear endpoint anchors.
- A live graph of the current search's explored people and links.
- Distinct styles and text labels for proposed/checking, accepted, unresolved, and structurally blocked contacts.
- Pan, zoom, fit-to-network, and node/edge selection.
- A compact inspection pane with known identity details and stored contact evidence.
- Current phase, elapsed search context, and Stop/Continue/Resume/Back to canvas controls appropriate to the state.

This is a separate view of search state. It must not add exploratory nodes to the timeline or alter the underlying canvas layout/camera.

Only inspect existing evidence during an active search; inspection must not silently launch extra biography or explanation requests that consume the search budget. Proposed people show their names and tentative status rather than presenting unchecked biography details as facts.

Use bounded deterministic graph layout and stable node positions, with endpoints anchored on opposing sides. Render with SVG and existing styling primitives unless measurements establish a need for a graph dependency. Retain cycles and cross-links in the actual graph; the renderer's layout must not constrain search.

Do not continually refit after the user pans or zooms. Preserve selection as new batches arrive. Respect reduced motion, support keyboard selection and a readable list alternative, trap/restore modal focus using existing utilities, and do not rely on color alone.

Provide compact mobile layout/inspection without changing the rest of the app's layout. Scope CSS to Six Degrees components and use existing theme tokens.

The successful route still appears in the existing Connection tab, with its chain length, compact evidence, lazy Why explanations, and new Recent connections. Reuse the existing weaving, amber thread, timeline/gallery rendering, camera flight, skip, and reduced-motion behavior. Verify the full 21-link limit against the existing eight-second reveal cap.

## Module responsibilities

Names below describe the intended boundaries; avoid additional abstractions unless implementation needs them.

| Module | Responsibility |
| --- | --- |
| src/services/connectionPath.ts | Replace findConnection's old orchestration with the bounded bidirectional engine and typed outcomes. |
| src/services/connectionGraph.ts (new) | Person/contact graph, identity mapping, bounded shortest paths, frontier selection, and serializable session data. |
| src/services/connectionAI.ts (new) | Provider-neutral contact task wiring, short references, compact parsing, and validators; reuse pathService for seed proposals. |
| src/utils/connectionKnowledge.ts (new) | Versioned shared persistence, session checkpoints, recovery, and injectable repository boundary. |
| src/services/connectionFlow.ts | Start/replay/resume decisions and guarded settlement; successful-chain canvas mutation stays here. |
| src/hooks/useConnection.ts | React lifecycle/state, checkpoint availability, operation cancellation, and overlay wiring. |
| src/components/ConnectionExplorer.tsx (new) | Large overlay, live graph, inspection, and search controls. |
| src/components/ConnectionPanel.tsx | Successful chains, evidence, lazy explanation actions, new saved paths, and access to paused searches. |
| src/services/prompts.ts | New Six Degrees prompts and narrow seed-prompt changes; preserve general task prompts. |
| Provider implementations / src/types.ts | New operations, shared types, schemas, and test-double updates. |
| src/utils/connectionPaths.ts / src/utils/canvasHistory.ts | New path version and membership-safe legacy retirement. |
| src/App.tsx | Narrow integration: active canvas identity, repository injection, Six Degrees explanation callback, and overlay rendering. |

Keep engine state and persistence independent of React. Keep general relationship assessment code and its defaults as-is; the new engine should not need to weaken or globally rewrite them.

## Implementation stages

### 1. Capture baseline and fixtures

- Record the current focused test baseline and run the full suite/typecheck/build before production edits.
- Add the reviewed evaluation rubric and priority case definitions.
- Capture old-engine outcomes with the configured model before replacing it, including elapsed time, search outcome, and manual link review.
- Retain baseline artifacts outside shipped application code. Keep live evaluation separate from the default test command.

Exit: baseline is repeatable and distinguishes reviewed positives, exploratory cases, and invalid-link controls.

### 2. Define contact tasks and graph primitives

- Add compact contact/person/session types and new provider-neutral task parsing.
- Implement new AI operations in all three provider adapters.
- Implement accepted/unresolved distinction, deterministic blocking, provenance, stable identities, and bounded shortest-path search.
- Add meaningful tests for false contact admission, identities, chronology, cycles, path bounds, and malformed responses.

Exit: contacts can be proposed and independently assessed without changing general relationships.

### 3. Implement shared storage and safe migration

- Add the versioned repository and checkpoint schema.
- Add new per-canvas successful-path records.
- Retire legacy Six Degrees knowledge while preserving permanent member protection before Follow a Figure pruning.
- Test reload recovery, malformed records, write failures, history isolation, and retention.

Exit: new knowledge can be shared and resumed without losing any existing canvas people or unrelated caches.

### 4. Replace the search engine

- Implement graph-first lookup, compact direct check, seed candidates, two-sided discovery, batch assessment, diverse frontier expansion, focused reassessment, and early success.
- Integrate all segment limits and cancellation.
- Return explicit connected, paused, explored-without-connection, and recoverable-error outcomes.
- Remove the old local-repair loop and known-bad AI pair vetoes from production search.

Exit: deterministic fake-model scenarios demonstrate alternative-route discovery, cross-generation bridging, cross-canvas reuse, continuation, and no stale side effects.

### 5. Integrate lifecycle, explanation, and settlement

- Wire search, resume, checkpoint availability, and provider changes through existing operation guards.
- Separate Six Degrees Why from the general assessment/cache path.
- Reuse weaveConnectionIntoCanvas and versioned path saving.
- Extend successful-chain validation and reveal coverage to 20 intermediates.

Exit: only complete accepted chains alter the active canvas, and all supported lifecycle interruptions stop work safely.

### 6. Build the live exploration overlay

- Implement the network, stable layout, inspection, responsive controls, accessibility, and paused/error states.
- Wire it to immutable search snapshots rather than canvas rendering internals.
- Verify node status/evidence, focus restoration, graph inspection, mobile layout, and both app themes.

Exit: the user can inspect exploration without steering it, and return to the original canvas or successful-chain reveal.

### 7. Evaluate and document

- Run the required automated checks and browser workflows.
- Compare the new engine with baseline using the agreed rubric and priority pairs.
- Tune operational limits/branch selection when results justify it; record the changes and measured outcomes.
- Update the README, architecture notes, AGENTS.md feature guidance, and existing Six Degrees feature documentation to describe the final behavior.

Exit: measured discovery improvement with reviewed contact accuracy, passing regressions, and documentation matching the implementation.

## Validation and success criteria

### Deterministic automated coverage

- Exact-person contact rules, including the named-battle/campaign exception and rejection of broad shared-war context.
- Lifespan overlap is necessary but insufficient for accepting a contact.
- General and legacy negative assessments cannot veto the new engine.
- A null/failed seed proposal still leads to alternate graph exploration.
- Both frontiers expand, meet on shared identities, and connect through accepted cross-frontier edges.
- A later discovery round can return new contacts for an already expanded person; excluding previously proposed pairs does not exclude known people or opposite-frontier bridges.
- Chronological detours are possible; duplicate/cyclic routes are not returned.
- Off-canvas bridge discovery and correct matching to existing canvas figures.
- First accepted route, shortest route in the discovered graph, and the 20-intermediate boundary.
- One focused reassessment of promising uncertainty, without accepting unresolved links.
- Shared accepted contacts from earlier searches/canvases/models.
- Independent budgets, deduplication, bounded retries, explicit continuation, and no repeated identical seed loop.
- Checkpoint/reload/reverse-orientation/provider-change behavior.
- Cancellation at discovery, assessment, persistence, and settlement boundaries.
- Failed, paused, stale, or cancelled searches never add exploratory people to a canvas.
- Fresh-start migration preserves all legacy path/woven membership protections, including Follow a Figure reload behavior.
- Successful-chain weaving, range/category updates, new path persistence, and both canvas reveals.

Retain all existing general relationship, discovery, Follow a Figure, provider/settings, history, layout, camera, biography, and launcher checks. Run bun test, npm run typecheck, and npm run build.

### Browser verification

Use the T3 collaborative preview for:

- Starting from a canvas person or typed endpoint.
- Inspecting the live network during discovery and reassessment.
- Stop, Escape, overlay close, Continue, and return to the canvas.
- Switching canvas/provider during a search and explicitly resuming.
- Reloading a paused search without automatic AI requests.
- Successful reveal and Why in timeline and gallery layouts.
- Legacy history/member preservation after fresh-start migration.
- Theme, narrow viewport, reduced-motion, and keyboard behavior.
- Normal Map Relationships, Expand Timeline, Follow a Figure, settings, history, and biography workflows.

### Discovery evaluation

Start with the five named priority cases and a small reviewed smoke set. Expand to at least 20 reviewed positive pairs across contemporaries, different generations, different disciplines/regions, and longer temporal gaps. Add unsupported-link controls; do not label arbitrary distant endpoint pairs as impossible.

For comparable old/new runs:

- Use the same selected model, endpoint identities, initial canvas context, and three-minute ceiling.
- Score every returned contact against the same agreed rubric, including the wartime exception.
- Report cold-start success separately from warm shared-knowledge success.
- Distinguish pairs allowed by the old limits from newly eligible long-gap/long-chain cases.
- Repeat reviewed cases where model variability changes conclusions; report uncertainty rather than selecting favorable runs.
- Record full accepted-chain success, partial progress, unsupported contacts, elapsed time, model-task usage, and stop reason.
- Keep fixture references for human review; do not feed reviewed source material or expected chains to the AI-only production solver.

A gain counts only when more reviewed connectable pairs produce a complete qualifying chain. Unsupported contacts do not count as successes. Require improvement overall and in the non-overlapping-lifetime group, with no loss of reviewed contact accuracy.

The priority exploratory cases receive a case-by-case report even when a qualifying reference chain cannot yet be established. Do not promise that every named pair will connect.

If the first measured result misses the goal, revisit candidate diversity, frontier ranking, compact assessment quality, and budget allocation before weakening the contact definition or adding excluded source-retrieval scope.

## Review before execution

Check the completed implementation plan/diff against these decisions:

- Other features use their original prompts, general assessment semantics, cache rules, and provider configuration.
- New Six Degrees code does not read a legacy/general rejection as a contact veto.
- Persisted accepted contacts and paused search state have separate meanings.
- Identity mapping cannot silently substitute or merge people.
- A live network edge cannot become a successful-chain edge merely because it is drawn.
- Every lifecycle exit stops work and protects the canvas.
- Migration preserves members before retiring metadata.
- Provider/model reuse and the specific wartime-opposition exception match the user's choices.
- Operational defaults remain tunable by evidence, while user-selected behavior remains fixed.
