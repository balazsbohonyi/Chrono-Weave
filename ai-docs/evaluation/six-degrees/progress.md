# Implementation and validation record

Recorded 12–13 October 2026. Authoritative decisions remain in the unchanged refactor plan and handover. Initially staged plan additions remain staged; implementation and validation changes have not been staged or committed.

## Seven implementation stages

1. **Baseline captured before replacement.** Old engine preserved in detached checkout `D:/develop/benchmarks/ChronoWeave-88ccd35`, commit `88ccd35f53103a55f4a0cd09422e98c0611a5bc1`, with dependencies junctioned to the workspace. Baseline: 319 tests passed, 0 failed, 34 files, 53.77 seconds; typecheck/build passed. Five actual priority attempts captured in `old-priority.json` before replacement.
2. **Dedicated tasks/types implemented.** Provider-neutral discovery, independent compact assessment, and accepted-contact explanations use all three existing adapters/transports. Only the Six Degrees seed prompt changed among existing prompts. Includes the exact named-battle/campaign opposition exception, unresolved verdicts, optional defensible dates, and provenance. No production source retrieval or general prompt/cache changes.
3. **Storage, identity, migration implemented.** Versioned IndexedDB repository with bounded retention, recovery, serialized checkpoints, stale-run protection, and memory fallback. Discovery aliases remain hypotheses until canonical resolution; partial names/surnames cannot merge identities or repair dates. Per-canvas successful paths retain independent proofs. Legacy path/woven membership is protected before Follow pruning, including historical activation and failed writes; legacy knowledge is logically retired without deletion.
4. **Engine replaced.** Graph-first shortest accepted route, compact direct check, one seed candidate source, alternating frontier discovery, independent batches, rotation/later rounds, cross-frontier bridges, canonical alias questions, focused reassessment, early success. Tunable defaults: 180 seconds, 32 tasks, 160 new people, 320 attempted pairs, 4 discovery sources × 6 contacts, 8 assessment pairs. Selected 20-intermediate bound retained. No old repair loop or general/legacy rejection vetoes.
5. **Lifecycle, settlement, Why integrated.** Explicit continuation retains graph/frontier/history with fresh budgets, including reverse endpoints and changed models. Every exit cancels work. Interrupted focused reassessment retains prior uncertainty and pending work. Only complete current accepted chains alter the canvas. Dedicated Why bypasses general caches and falls back to compact evidence. Existing reveal retained.
6. **Live overlay implemented.** Scoped SVG network, stable anchors/positions, status labels/dashes, pan/zoom/fit, read-only inspection/list, elapsed context and lifecycle controls, keyboard/focus handling, theme tokens, responsive/reduced-motion CSS. No exploratory canvas additions or inspection model tasks. Desktop preview verified; actual narrow viewport remains blocked below.
7. **Documentation/checks performed; historical success criterion unverified.** README, architecture, AGENTS feature guidance and older feature documentation updated. Automated checks and substantial T3 workflows passed. Repeatable cold/warm comparison harness and actual priority artifacts retained. Upstream errors prevent reviewed discovery/accuracy scoring: required measured improvement is **not established**.

## Automated outcomes

| Check | Actual result |
| --- | --- |
| Old checkout `bun test` | 319 passed, 0 failed, 34 files; 53.77 seconds |
| Final workspace `bun test` | **311 passed, 0 failed, 38 files; 60.45 seconds** (`final-tests.log`) |
| `npm run typecheck` | Passed, exit 0 |
| `npm run build` | Passed, exit 0; 361 modules; main JS 877.39 kB / 247.25 kB gzip |
| Baseline/current general prompt isolation | **65 comparisons passed**, including legacy contact-only explanation variants |
| Harness dry runs | Old five-priority, new 23 reference cases, four direct-edge controls selected successfully; no model requests |
| `git diff --check` | Passed; repository CRLF normalization notices only |

The baseline already exceeded Vite's 500 kB bundle-warning threshold; the final build still warns. General feature tests remain; obsolete repair-loop tests were replaced, so totals differ. Synthetic model tests establish mechanics, **not historical accuracy**. Earlier focused logs contain superseded failures; `final-tests.log` is the final complete result.

Coverage includes alternative routes after unusable seeds, both frontiers/later rounds, detours, off-canvas bridges, cross-canvas/model graph reuse, bounds/shortest routes, uncertainty and interrupted focused resume, deadlines/cancel-ignoring transport, completed-batch checkpoints, exact/ambiguous identities and safe aliases, failed/stale writes, membership migration, independent saved proofs, accepted settlement, provider tasks and existing reveal coverage.

## T3 collaborative preview

Model-dependent checks used the explicitly **synthetic** local Ollama transport in `browser-fixture.ts`, never imported into the app. Reconnected `tab_5` with `preview_open`; status available/visible. Measured app viewport 1536 × 960 CSS pixels while T3 reported a 1280 × 800 setting.

| Workflow | Observed result |
| --- | --- |
| Canvas-person / typed starts | Passed, including identified off-canvas endpoint |
| Live graph / status / pan / zoom / inspection | Passed; inspection adds no calls; exploratory canvas membership unchanged |
| Focused reassessment | Live Checking/reassessment inspected; Stop restored unresolved verdict with pending focused work queued; explicit Resume returned to focused task |
| Stop / Escape / close / Back | Passed; requests stopped, no stale weaving, modal focus restored to invocation button |
| Continue after work budget | Opening/reload made zero calls; explicit Continue started fresh segment; exhausted branches without impossibility claim |
| Paused reload | Checkpoints listed, overlay closed, zero automatic calls; explicit open/Resume worked |
| Dark/light and keyboard | Passed; trap/selection/dismissal/restoration checked; screenshots retained |
| Timeline/gallery success and Why | Off-canvas members woven, three-link amber thread/sidebar/replay; dedicated narrative left general caches unchanged |
| Model change | Settings test/save of second synthetic model passed; explicit continuation retained earlier accepted contacts/provenance |
| Legacy history / Follow preservation | History activation passed; legacy path hidden from new Recent list; marker saved; four protected people survive general focus rejection and reload |
| Normal Map / Expand / biography | Original general task prefixes/semantics passed; expansion adds figure, biography shows original response |
| Normal Follow a Figure build | Launcher/preflight/generation/general verification passed, yielding focus and accepted candidate |
| Reduced-motion reveal | JavaScript `matchMedia` emulation: all three gallery links immediate, mask offsets zero. Actual OS/CSS preference not emulated |
| Narrow/mobile | **Unverified:** valid preset/freeform resize calls repeatedly timed out/disconnected host, including 390 × 844 after reconnection |

Canvas/history/settings switches were exercised after Stop/Back. Direct provider/canvas switching while a request was inflight was not exercised: the modal hides history and makes underlying controls inert. Automated operation/settlement cancellation coverage is separate from direct browser interruption evidence. No substitute-browser result is claimed. Actual reduced-motion OS/CSS behavior remains unverified.

Evidence: `preview-dark.png`, `preview-light.png`, `preview-gallery.png`, `preview-reassessment.png`, `preview-reduced-reveal.png`. Original browser settings/history/theme restored; synthetic knowledge/checkpoints removed selectively. Preview returned to real `http://localhost:3000/`; cleanup confirmed no fixture transport, fixture canvas or shared fixture people. Unrelated browser data preserved.

## Actual priority comparison

Both engines used configured Gemini `gemini-3.6-flash`, identical exact endpoint identities, initial two-person canvas, cold knowledge/caches and a 180-second ceiling. Credentials existed; upstream availability/daily quota did not. Baseline artifacts predate the later isolated-worker/transport-counter harness enhancement; none reached the ceiling. Old task counts were not captured. Each new attempt recorded one task, no completed contact assessment and no accepted partial chain.

| Pair | Old elapsed / stop | New elapsed / stop | Historical scoring |
| --- | --- | --- | --- |
| Newton → Shakespeare | 125.966 s / HTTP 503 | 100.952 s / quota error | Unscored; reference route exploratory |
| Newton → Einstein | 123.836 s / HTTP 503 | 95.131 s / quota error | Unscored; reference route exploratory |
| Newton → Napoleon | 124.853 s / HTTP 503 | 95.258 s / quota error | Unscored; reference route exploratory |
| Einstein → Jobs | 112.131 s / HTTP 503 | 95.294 s / quota error | Unscored; source-backed five-link reference prepared, with search/catalog source caveats |
| Machiavelli → Leonardo | 95.302 s / HTTP 429 | 95.338 s / quota error | Unscored; Museo Galileo supports direct working-contact reference |

These are actual external attempts, not mocked evaluation. There are **zero scoreable discovery runs**, not a 0/5 historical success rate. Elapsed values measure failed upstream retries, not discovery gain. No returned contacts were available for accuracy/unsupported-claim review. Cold/warm improvement, overall gain, non-overlapping-lifetime gain and no loss of historical contact accuracy remain **unverified**.

`reviewed-cases.ts` prepares 20 source-backed direct positives, three composed routes and four unsupported direct-edge controls. References are never supplied to production. Some institutional pages were accessible only through search/catalog passages; corpus is science/technology-heavy. Stronger long-gap/region coverage and expert review remain useful. Independently score every returned old/new contact under the agreed rubric once upstream access permits; no contact-rule weakening or operational tuning was justified by these unavailable results.

Missing external evidence: matched-model successful old/new runs and variability repeats, reviewed edge accuracy, cold/warm gains, narrow T3 viewport, actual reduced-motion OS/CSS behavior, direct inflight provider/canvas browser interruptions. Repeat commands and fixture cleanup are in this directory's README.
