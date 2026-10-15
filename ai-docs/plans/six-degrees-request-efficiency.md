# Six Degrees request efficiency: implementation and measurement plan

Status: A, D, C, B, E and G implemented on 2026-10-15 without the measurement program; see "As implemented" below. Everything after that section is the original plan and is kept for the reasoning, not as a description of what exists.
Date: 2026-10-15.

## As implemented (read this first)

**Decision:** the pre-registered live measurement (cases, A/A, paired arms, gates G1 to G5, T1 simulator, T2 replay, warm snapshots, batch benchmark) was dropped as too expensive. The changes were implemented directly and are verified by mocked tests (`bun test`, typecheck, build) and by manual use. None of the efficacy predictions in this plan or in the guide has been measured; they remain hypotheses. The measurement harness that had been built under `ai-docs/evaluation/six-degrees/` was removed.

| Stage | Where | What it does |
| --- | --- | --- |
| A counters | `connectionGraph.ts` (`ConnectionDiagnostics`), `connectionPath.ts` | Per segment `requests` by kind, `assessBatches`, `discoverSources`, `pairAsks` by reason, `validationRetries`, and a whole-session `total`. All optional. The way to check a change by hand: read `session.diagnostics` after a search |
| D | `connectionAI.ts` (`parseContactAssessmentsPartial`, `requestContactAssessment`), `connectionPath.ts` (`assess`) | A reply keeps its valid items. Pairs whose item was invalid, duplicated or missing get one targeted follow-up. A pair still unanswered is "not assessed": nothing stored, no attempt, `CandidateContact.failures`, given up for the segment after two tries, cleared on the next segment. |
| C | `connectionPath.ts` (`ASSESSMENT_PAIRS_BY_PROVIDER`, `assessmentPairsFor`) | Ollama 16 pairs per assessment request; other providers keep `SEARCH_LIMITS.assessmentPairs` (8). An explicit `limits.assessmentPairs` always wins |
| B | `connectionPath.ts` (`pending`, `shouldSend`, `assess`) | One ordered pool replaces the separate fresh and focused calls |
| E | `connectionAI.ts`, `prompts.ts` (`buildContactDiscoveryPrompt`), `connectionPath.ts` | One discovery request carries up to `discoveryPeople` sources from each end, each with the opposite endpoint as its `goal` |
| G | `connectionPath.ts` (`attemptContext`), `connectionGraph.ts` (`migrateAttemptContext`), `connectionKnowledge.ts` (`recoverSession`) | A re-ask key is only provider, model, both names and both alias lists; stored seven-element keys are cut to six on load |

Not implemented: the experiments F (triage), H (local concurrency) and I (known-bridge probe).

### Deviations from the plan below

1. **B waits only when waiting can help.** The plan's fill rule says to wait for the next discovery unless the pool is full, holds a join pair, no discovery will follow, or half a batch is waiting with no time to wait. As implemented, "a discovery will follow" additionally requires that the next discovery reaches at least one person never expanded before. Reason: only accepted contacts move the frontier outward, so waiting while the sources are the same already-expanded people just spends extra discovery requests on re-expanding the endpoints (seen in the fake worlds: two extra discoveries before the first assessment). Without this, early rounds got slower, not cheaper.
2. **Seed-route pairs are sent at once** (new `CandidateContact.seed`). They are the model's whole candidate chain, so testing them immediately can finish the search; the plan's rule did not mention them.
3. **D's "unresolved" mark is not used.** The plan marked a twice-failed pair `unresolved` as a session-candidate status. As implemented the pair stays `proposed` with a failure count, because the network view and inspector treat `unresolved` as having an assessment. The effect is the same: never a stored verdict, never an attempt, asked afresh next segment.
4. **D's follow-up lives inside one task.** The targeted follow-up is a second HTTP request inside the same `task()`, so `requests.assess` counts one request even when a follow-up happens (the counters track logical requests, not HTTP calls).
5. **C is Ollama only**, per the plan's "Ollama only until the others are measured", and was set to 16 without the planned batch benchmark. 12 was the fallback if 16 shows drift.
6. **E's discovery references** are split when both ends are expanded (8 from each end's cluster instead of 16 from one), to keep the prompt size in check.
7. The golden request trace (`tests/connectionRequestTrace.golden.json`) was regenerated for B, E and C on purpose: every fake world takes the same number of requests or fewer (for example the three-hop chain 7 to 5, the wide-discovery world 11 to 9).

### Ambiguous identities and the frontier (2026-10-15)

**Bug.** A search from Steven Pinker to Carolyn Shoemaker stopped after about 45 s as `explored` (`stopReason: 'frontier-explored'`, "This exploration did not establish a chain") with almost nothing to expand, and "Resume searching" repeated it instantly with 0 tasks. The saved session held 359 people, every one within 17 accepted links of both endpoints. The only 16-link route ran through Guy Debord, who exists in the store as 1926-1994 and 1931-1994 (the store had 26 such names, 52 records, among 962 people). `shortestContactPath` refuses any route through a name that exists as several records (conflicting dates stay separate identities, see `samePerson`), but `selectFrontier`, the join detection in `pending()` and the clusters in the loop walked `acceptedDistances`, which does not. Everyone looked reachable from both ends, `selectFrontier` (it requires `!opposite.has(person)`) returned nothing for both sides, and `outcome()` then found no route. Without the ambiguous identities the Pinker side was only 40 people.

**Fix.** One rule, one graph (`connectionGraph.ts`):

- `ambiguousNames(people)` and `routeExclusions(people, endpoints)` are the rule that used to sit inside `shortestContactPath`: a name with several non-canonical records is out of every route except a requested endpoint's own record. It is read from `knowledge.people` (the whole store), never from `session.people`: a twin record with no accepted contact sits in no session but still makes the name ambiguous.
- `routeDistances(start, people, contacts, [from, to])` is reach over exactly the graph `shortestContactPath(from, to)` routes over, so "reachable from both ends" implies a chain exists (test: they agree for every ordered pair). The search uses it for `selectFrontier` (new required `people` argument, the store), `pending()` join detection, the loop's reach, `clusterOf` and the opposite references. Ambiguous people are never expanded: no route can use them.
- `acceptedDistances` is unchanged in meaning and still feeds `attachShared` (which people are shown and saved with the session) and the network view.
- When the search ends `explored`, `ambiguousBridge(from, to, …)` checks whether the accepted contacts do link the endpoints but only through ambiguous names; if so the phase says "No chain: accepted contacts link them only through Guy Debord (1926-1994 or 1931-1994), recorded with conflicting dates" (several names are joined with "and"). `stopReason` stays `frontier-explored`; no UI file changed (`ConnectionExplorer` already shows `session.phase`). It is recomputed on every `explored` ending, so an explicit resume of an exhausted session shows the same text with 0 tasks.

**Resolving the duplicates (decided 2026-10-15: option 1 below, implemented).** Excluding both records of such a name made a chain that needs it unreturnable however well each link was supported, so the engine now asks the model which dates are right. In `findConnection`, `outcome()` (the "is there a chain" check: at the start, after every assessment, after an alias merge) calls `resolveDuplicate()` whenever no route exists but `ambiguousBridge` finds an accepted chain through such names:

- One `resolveFigure(name)` request (kind `identity`, label "Resolving which dates are right for …") per name on the shortest accepted bridge, before the seed request or any discovery. Prompts, batching and retries are untouched. `SEARCH_LIMITS.identityChecks` (4) bounds these requests per segment. The name is recorded in `session.attempts` under `duplicates:<name>` with a context of provider, model and the records' dates, so resuming never repeats the question, and another model, or a new record of the name, is asked again.
- Eligibility (`resolvableDuplicates`): at least two records, none an endpoint, and all birth years and all death years within `DUPLICATE_DATE_TOLERANCE_YEARS` (10) of each other. Farther apart means namesakes of another generation (a father and a son), which are not asked about and stay ambiguous. This is an extra guard on top of the plan: it never changes a date, it only decides whether the question is worth asking.
- The answer must name exactly one record (`duplicateKeeper`): exactly those birth and death years, under a name that contains or is contained in the record's. Unknown person (`null`), dates matching no record, several records, or another person settle nothing; the records stay separate, the search goes on and the ambiguity message above still applies. `buildResolveFigurePrompt` already returns `null` for names it cannot tell apart, which is the natural guard for real namesakes.
- On a match every other record is merged into the keeper with the existing `mergeResolvedIdentity` (retired record keeps its id and gets `canonicalId`; every contact, candidate, round and attempt follows). `identifyPerson` now maps a name and dates that match a retired record to the surviving person, so a model that keeps proposing the old dates lands on the survivor instead of an unusable record. The store keeps the answer, so later searches on other canvases or models find the chain with no request.
- A retired record can be a canvas figure or an endpoint of another saved session, so two things follow it: a finished chain starts and ends with `options.from` and `options.to` (the figures that were asked for) instead of a figure rebuilt from the survivor's dates, which would have woven a second copy of the person onto the canvas; and `findConnection` follows `canonicalId` through a resumed session (`mergeResolvedIdentity` on its retired people), takes the survivor's key and records the old one in `retiredKeys`, instead of failing with "Checkpoint belongs to another canvas or pair".
- Limits: only the identities on the shortest accepted bridge are considered, so if each of them is ineligible or already asked, a longer bridge through an eligible name is not asked about; and an intermediate person whose canvas figure carries the retired dates is woven next to that figure as the survivor (the endpoints are exempt, see above).
- Known cost of this choice: accepted contacts judged for the retired record's dates move onto the survivor, and are dropped (as invalid, by `validAccepted`/`recoverKnowledge`) if their year or overlap no longer fits the survivor's dates. If the model names the wrong record, links go to a person they were not judged for; the tolerance and the exact-match rule limit that, they do not remove it.

Golden trace: the existing worlds are byte-identical. Of the three worlds added for this work, `a chain through a person with conflicting date records is not a route, so both ends keep expanding until a clean bridge is found` and `a chain only through conflicting date records ends explored once both ends are exhausted, and resuming repeats it without requests` now start with `identity 1` (the fake resolver knows nobody, so the answer is inconclusive and the search goes on as before), and `one identity request settles which dates are right for the name on the only accepted bridge, and that finishes the search` is just `identity 1`.

**Not implemented: option 2, a route through one record of an ambiguous name** (never two records of one name in one route). Pro: no request at all. Con: reach is no longer a plain BFS (the "not both records of a name" constraint makes shortest-route search a forbidden-pairs problem, hard in general; workable at this size by retrying with a conflicting record excluded, but more code), `routeDistances` and `selectFrontier` would have to agree with it or the original inconsistency returns, and it shows a person under one date pair while the store holds another. Mixed routes (an edge judged for one record, the next for the other) would have to stay forbidden. It remains a possible last resort for names the resolver cannot settle.

### Settings to know when tuning by hand

| Setting | Where | Default | Effect |
| --- | --- | --- | --- |
| `ASSESSMENT_PAIRS_BY_PROVIDER` | `connectionPath.ts` | `{ ollama: 16 }` | Pairs per assessment request for a provider; add `gemini` or `openrouter` entries to try them. Lower to 12 if answers get lazy late in a long list |
| `SEARCH_LIMITS.assessmentPairs` | `connectionPath.ts` | 8 | Default for providers without an entry |
| `SEARCH_LIMITS.discoveryPeople` | `connectionPath.ts` | 4 | Now per end: up to 8 sources per discovery request |
| `SEARCH_LIMITS.candidates` | `connectionPath.ts` | 6 | Contacts per source; a two-end request can return up to 48 |
| `shouldSend`, `worthWaiting` | `connectionPath.ts` | see deviation 1 | The fill rule. Making `shouldSend` return true always restores "send whenever something is pending" |
| `MAX_ASSESSMENT_FAILURES` | `connectionPath.ts` | 2 | Tries per pair per segment before an unanswered pair is left alone |
| `SEARCH_LIMITS.identityChecks` | `connectionPath.ts` | 4 | Identity requests per segment for names with conflicting date records on an accepted bridge; 0 turns the check off |
| `DUPLICATE_DATE_TOLERANCE_YEARS` | `connectionGraph.ts` | 10 | How close the birth years, and the death years, of a name's records must be before the resolver is asked about them |

### What to look for when testing by hand

Compare against the old behavior with `session.diagnostics` (or the Network tab): fewer assessment requests per search, batches near the provider's size, one discovery request per round instead of one per end, no repeated identical questions after another search added accepted neighbors, and no search aborting because one item of an assessment reply was malformed. Watch for the risks the plan named: a chain found one or two discovery rounds later than before (the fill rule's delay), lazier answers late in a 16-pair batch, and larger discovery replies.
Source analysis: `ai-docs/guides/six-degrees-requests/optimizing-six-degrees-requests.md` (the option letters A to I below are that guide's). Its section 9 is the validation outline this plan expands.

## Objective

Send fewer model requests, and spend fewer seconds, per successful Six Degrees connection, without lowering the accuracy of accepted links and without weakening any invariant in `AGENTS.md` or `ai-docs/plans/six-degrees-refactor.md`: AI-only assessment, each pair judged independently with discovery claims withheld, one re-ask per promising unresolved pair per segment, the 21-link bound, cross-model reuse, explicit Continue, and no change to global concurrency policy.

Non-goals: improving discovery success rate, changing the contact definition, adding source retrieval, touching the general Map/Expand/Follow/biography prompts or caches, and any new UI.

## How we will know (pre-registered, confirm before the first live run)

All comparisons are paired by case and repeat against the baseline engine, same provider, same model, same cold or warm knowledge.

**Guardrails, every change:**

| # | Guardrail | Threshold |
| --- | --- | --- |
| G1 | Accepted-link precision (blind review, rubric in the eval README) | not lower than baseline by more than 5 points, pooled |
| G2 | The four unsupported direct-edge controls | accepted in 0 runs |
| G3 | Chain found within twice the segment budget | not lost in more than 1 paired run in 12 |
| G4 | Segments ending in status `error` (not quota) | not higher than baseline |
| G5 | `bun test`, `npm run typecheck`, `npm run build` | green; golden request traces unchanged where behavior should be unchanged |

**Efficacy, per change** (the guide's model predicts these; they are hypotheses, not results). B, C and E change packing, which is mechanical, so their primary metric is a **normalized, low-variance** one that stage A records. Requests to success depends on the path the model happens to take, so it is an outcome guardrail, not the efficacy test.

| Change | Primary efficacy metric (must show) | Model prediction |
| --- | --- | --- |
| D keep valid items | G1 to G5 hold; zero change in requests on healthy replies | 0 requests saved; removes abort risk |
| C batch size 8 to 16 | assessment requests per pair-ask down at least 30%; malformed replies at most 8% | about -35% |
| B mix re-asks, fill batches (measured on top of C) | assessment requests per pair-ask down a further 20%; batch fill rate at least 0.8; rounds to success not worse by more than 0.5 (median) | about -33% on top of C |
| E both ends in one discovery | discovery requests per source expansion down at least 40%; accepted share of discovered pairs within 5 points of baseline | about -50% |
| G identical prompts not re-asked | context-change re-asks are 0 when the prompt is unchanged; still re-asked when model or alias changes | at least 3 pair-asks per run |

**Outcome guardrails, all efficacy stages:** requests to success and seconds to chain must not be worse than baseline by more than the A/A spread. The combined target (requests per success down 30%, seconds to chain down 25%; the model predicts -37% and -30%) is **reported**, and gates only if the A/A spread on that metric is under 15%.

**Rule for noisy metrics:** if the A/A spread on a metric is at least that change's threshold, T3 can only check guardrails on it, and T1 carries the efficacy claim for it.

A change that passes the guardrails but misses its efficacy line is dropped or re-scoped, not shipped for its own sake.

## What is measured

| Metric | Definition | Source |
| --- | --- | --- |
| Requests by kind | seed, direct, assess, discover, identity, per segment and per session | engine counters (stage A) |
| HTTP calls | wire calls per search, including validation and rate-limit retries | harness fetch wrapper (ground truth) |
| Pair-asks by reason | fresh, focused (re-ask), contextChange | engine counters |
| Assessment batch histogram | pairs per assessment request, in order; fill rate = pairs / (requests x batch size) | engine counters |
| Requests to success | requests issued until the closing batch returns, successful runs only | counters and wire log |
| Requests per success | total requests in all runs / number of successes (ratio of sums) | derived |
| Seconds to chain | wall seconds from start to the accepted chain; success within 180 s derived from the wire timeline | wire log |
| Rounds to success | discovery requests issued before success (detects delay from filling batches) | counters |
| Malformed replies | validation retries; segments ended by them | transport observer |
| Prompt and reply size | characters per request kind (a token proxy) | wire log |
| Accepted-link precision | blind review of every returned link | review protocol below |

Request counts and seconds are the cost; success within budget and precision are the cost of getting them wrong. Never report one without the other.

## Evidence tiers

| Tier | Answers | Model calls | Deterministic | Lives in |
| --- | --- | --- | --- | --- |
| T0 mocked tests | does each change do what it claims, and are invariants kept | none | yes | `tests/`, run by `bun test` |
| T1 simulated worlds | request counts and rounds across thousands of searches, including the delay from filling batches | none | yes (seeded) | `ai-docs/evaluation/six-degrees/sim.ts`, run explicitly |
| T2 offline replay | does triage keep the edges that mattered | none | yes | `ai-docs/evaluation/six-degrees/replay.ts` on exported sessions |
| T3 live A/B | real request counts, seconds, precision, malformed-reply rates on the real model | yes, quota | no (repeated, interleaved) | `ai-docs/evaluation/six-degrees/run.ts` and a summarizer |

T1 and T2 are cheap filters that decide what is worth a T3 run. Only T3 supports a claim about the real model, and only for the model it ran on.

## Stages

Each stage is its own change on this branch, in this order. Stages that edit `connectionPath.ts`, `connectionAI.ts` or `prompts.ts` never run in parallel with each other.

### 0. Freeze the baseline (S)

- Record the baseline commit. The engine files are unchanged from `HEAD` (`b9901ca`); create a detached checkout `D:/develop/benchmarks/ChronoWeave-<sha>` with `node_modules` junctioned, as the eval README already describes, so every arm can be compared against the identical engine.
- Add `ai-docs/evaluation/six-degrees/efficiency-cases.ts` (see "Cases").
- No behavior change.

Gate: the baseline checkout runs the existing five priority cases with `--dry-run`.

### 1. A: per-reason counters and a measurable harness (M, two parallel sessions)

Two sessions can run at once because they touch different files. The only coupling is the `diagnostics` shape below, fixed here.

**Engine session** (`src/`, `tests/`). It follows this stage exactly: one `assess` kind (not separate fresh and focused kinds), reasons carried by `pairAsks` and `assessBatches`, no UI change, and the golden-trace gate below.

```ts
// ConnectionSession.diagnostics in src/services/connectionGraph.ts; every new field optional
diagnostics: {
  tasks: number; people: number; pairs: number; stopReason?: string;          // existing: last segment only
  requests?: Partial<Record<'seed' | 'direct' | 'assess' | 'discover' | 'identity', number>>;  // this segment
  assessBatches?: number[];        // pairs per assessment request, in order
  discoverSources?: number[];      // sources per discovery request, in order
  pairAsks?: { fresh: number; focused: number; contextChange: number };      // this segment
  validationRetries?: number;      // this segment; best-effort, delta around task()
  total?: { segments: number; requests: Record<string, number>; pairAsks: Record<string, number>; elapsedMs: number }; // whole session
}
```

- `task(kind, label, call)` at `connectionPath.ts:102` takes a kind and increments `requests[kind]`; `assess()` pushes the batch size and classifies each pair by reason. `contextChange` means the pair had a prior attempt whose context differs and it was not a focused re-ask.
- Validation retries: a tiny observer in `jsonResponse.ts` and the Ollama loop in `ollamaService.ts` counts correction rounds; `task()` reads the delta around its call (requests are serial, so the delta is safe).
- Old stored sessions lack the fields; every reader treats them as absent. `ConnectionSession.version` stays 2.
- No change to batching, limits, prompts or retries.

**Harness session** (`ai-docs/evaluation/six-degrees/`):

- `run.ts` gains `--arm=<name>`, `--limits=assessmentPairs=16,wallMs=360000,tasks=64`, `--repeat=N`, `--order=abba`, `--cases=<set>`, and writes one JSON line per run. It currently passes no `limits`, counts only service-method calls (`modelTasks`), and hard-codes `AbortSignal.timeout(180_000)` per case, so the outer timeout must follow `wallMs` or a raised limit is silently cut off.
- A wire logger in the existing `globalThis.fetch` wrapper records each provider POST: kind (from the prompt's first line), start, end, status, prompt and reply characters.
- `summarize.ts` produces the paired tables and bootstrap intervals described under "Reporting".
- `sim.ts` (T1) and `replay.ts` (T2) skeletons.

Gate: (i) engine counters sum to `diagnostics.tasks` in every test; (ii) on a mocked transport the engine counters equal the wire log exactly; (iii) golden trace: the sequence of (kind, batch size) on the existing `fakeContacts` worlds is byte-identical before and after this stage; (iv) a live pilot of 2 cases x 2 repeats on the baseline produces the first **measured** requests-by-kind table. That table confirms or overturns the guide's inferred numbers (assessment share, re-ask share, context-change re-asks, malformed-reply rate), and the order of stages 2 to 6 is revisited if it does.

### 2. D: keep valid items from a partial reply (M)

- `parseContactAssessments` (`connectionAI.ts:24`) returns the valid items plus the refs that failed. `requestContactAssessment` makes at most one targeted follow-up for failed refs only. Refs still failing come back as **not assessed**: a transport failure must not be stored as negative evidence.
- `assess()` (`connectionPath.ts:194` to `:199`) stops throwing on `results.length !== batch.length` and on a single `validAccepted` failure. Affected pairs return to `proposed` with a small per-pair failure count (a new optional field on `CandidateContact`). After 2 failures a pair is marked `unresolved` **as a session-candidate status only**, with a reason that says the model did not answer. That mark is never written to `knowledge.contacts`, and is not counted in `triedPairs` or `attempts`, so a later segment or another model still asks it afresh. A reply with no valid items, or that is not an array, still throws as today.
- The three transports go through the same shared path (`generate` in Gemini, OpenRouter and Ollama), so one change covers all.

T0 tests: partial reply keeps valid items; failed refs re-asked once and only those; a reply with every item invalid still fails the task; a failed pair is never recorded as a verdict and does not count as an attempt; fuzzed replies can never produce an accepted contact that fails `validAccepted`; the three provider adapters in `tests/connectionProviders.test.ts` style.
Gate: G5 and healthy-reply golden traces unchanged. No live efficacy claim; this stage buys safety for C.

### 3. C: assessment batch size (S code, M measurement)

The size is already overridable per call (`limits.assessmentPairs`), so measurement needs no engine change.

1. **Batch benchmark (live, about 75 requests per pass).** The 20 reviewed positives, the 4 controls, and at least 12 negatives from "Decisions" (about 36 pairs), sent to `assessPersonalContacts`. Size 1 does not depend on order, so it runs once (36 requests). Sizes 8, 12, 16 and 24 (5, 3, 3 and 2 requests) run in each of three fixed shuffled orders (39 requests). Run three passes, about 45 minutes in total. Record recall of positives, accepted controls and negatives, unresolved rate, malformed-reply rate, reply latency and reply size, and accuracy **by position in the batch** (lazy tail). This isolates the batch-size effect from search dynamics.
2. **Search A/B (live).** The "request-heavy" case set at 8, 12 and 16 on the same engine.
3. Pick the smallest size that meets the efficacy line and the guardrails. Land it as a per-provider default (Ollama only until the others are measured); `SEARCH_LIMITS.assessmentPairs` becomes a map or a provider lookup.

Gate: the C row of the thresholds table; D already landed.

### 4. B: one assessment pool, filled before sending (M)

- One candidate pool, ordered: pairs that join the two accepted-reachable sets first, then fresh pairs, then re-ask-eligible pairs. Set `focused` per pair; drop the separate `assess(true)` call; keep `attempt.focusedSegment` so a pair is re-asked at most once per segment.
- Fill rule: send when the pool holds at least the batch size, **or** it holds a join pair, **or** no discovery will follow (budget, exhausted frontier, final drain), **or** the pool has at least half a batch and the next discovery would not fit the remaining time. Otherwise wait for the next discovery.
- T0: invariant tests (one re-ask per pair per segment; unresolved never accepted; join pair sent immediately; final drain sends the remainder; early exit after the closing batch). Update `connectionPath.test.ts` "one focused reassessment per promising uncertainty context" if its request-count assertions change.
- T1: measure the delay the lab does not price (rounds to success and seconds to chain vs baseline over thousands of seeded worlds) **before** any live run.

Gate: B row; T1 shows rounds to success no worse than +0.5 at the median and no worse than +1 at the 90th percentile.

### 5. E: both ends in one discovery request (M to L)

- `ContactDiscoveryRequest.sources[i]` gains its own `goal`; `buildContactDiscoveryPrompt` (`prompts.ts:207`) lists a goal per source instead of one `Goal on the opposite side`; the parser keeps mapping `s1..sN` to sources. Up to 4 sources from each end.
- `selectFrontier` is called for both ends and the alternation (`side`, `connectionPath.ts:239`, `:250`) goes away; `discoveryPeople` becomes per end.
- Measure prompt growth and reply latency from the wire log; the guide's lab assumes 1.3x and flags it assumed.
- T0: each source receives the goal of the **opposite** end; budgets (`people`, `pairs`) respected; the "later rounds exclude pairs" and "both frontiers" tests still pass.

Gate: E row, plus accepted share of discovered pairs per request within 5 points of baseline.

### 6. G: attempt cache keyed on what the prompt sends (S)

- `attemptContext()` (`connectionPath.ts:174`) keeps provider, model, both names and both alias lists, and drops the accepted-neighbor keys, because the assessment prompt sends none.
- **Migration:** stored attempts hold the old JSON array. On load, rewrite each context to its first six elements, so upgrading does not trigger a mass re-ask of every stored attempt.
- T0: a new accepted neighbor does not re-ask; a changed alias, name or model does; migrated and fresh contexts compare equal.

Gate: G row. Stage A's `contextChange` counter before and after is the evidence.

### 7. Experiments, each its own flagged change (F, H, I)

- **F triage.** T2 first: export the stored sessions and compute recall@K of the proposed score over the edges that ended on chains, with no new requests. Proceed to T3 only if recall@K is at least 0.9 at the K that would meet the efficacy line.
- **H local concurrency.** Needs a measured provider limit first (requests per minute under 2 and 3 in flight, on the user's model). Six Degrees only; no change to the global queue.
- **I known-bridge probe.** T1 for upside; T3 only if T1 shows a gain.

### 8. Close the loop (S)

Rerun the lab with measured parameters (`q`, `u`, flip rate, seconds per request, batch fill rate) and update `03-optimization-lab.html` and the guide's tables so they quote measurements, not inferences. Add one line to the Six Degrees section of `AGENTS.md` for the counters. Archive the report.

## Cases

Defined in `efficiency-cases.ts`. Names are public figures; none of the reviewed-case reference routes or sources is ever sent to the production solver.

| Set | Contents | Used for |
| --- | --- | --- |
| Request-heavy (9) | Harriot to Halley, Newton to Shakespeare, Newton to Einstein, Newton to Napoleon, Elvis to Kennedy, Galileo to Columbus, Edison to Thorne, Boccaccio to Ficino, Botticelli to Petrarch | T3 requests, seconds, success |
| Composed reviewed routes (3) | Einstein, Thomson, Rutherford to Jobs (`reviewed-cases.ts`) | T3 requests and precision against reference routes |
| Batch benchmark (24 + negatives) | 20 reviewed positives, 4 controls, reviewed negatives | stage 3 |
| Stress, not scored for success (1) | Chomsky to Sagan (seven segments, no chain) | request volume when no chain exists |

The 20 direct reviewed positives alone cannot test batching: each resolves in the direct check with one pair. They matter for precision in the batch benchmark, not for request counts.

## Live run design

- **Arms:** baseline checkout and the change under test, plus an **A/A** run of the baseline against itself on 2 cases x 3 repeats first. Its spread is the smallest effect this design can see; report it next to every result.
- **Repeats and order:** at least 3 repeats per case per arm, ordered ABBA per case so provider load and time of day cancel. Fresh repository for every cold run.
- **Cold and warm reported separately.** Warm means every arm starts from the **same** saved snapshot of accepted contacts, not from knowledge it built itself, or the arms stop being comparable. The snapshot must not contain the answer: it is built from a **disjoint warm-up set** (the 20 reviewed direct positives plus chains from outside the case list), and then **leave-one-out** is applied per case, removing every contact accepted during that case's own cold baseline runs. Otherwise both arms would answer from shared knowledge with about zero requests and the comparison would measure nothing. The user's real knowledge store is never used as a warm start, since it already holds Harriot to Halley, Elvis to Kennedy and the other chains.
- **Ceiling:** limits raised to twice the product budget (`wallMs` 360 s, `tasks` 64) so cost to success is not truncated; success within the real 180 s and 32 tasks is derived afterwards from the wire timeline. One run yields both.
- **Provider and model:** `ollama/gpt-oss:120b-cloud`, the model every stored run used. Pin the model string; log any change. Cloud models drift, so a baseline is rerun inside the same window as each arm, never reused from last week.
- **Size and time:** 12 cases (9 request-heavy, 3 composed) x 3 repeats x 2 arms is 72 searches, about 2 to 4 hours at the observed 7 to 13 s per request. Run a pilot first (2 cases x 2 repeats x 2 arms) to check quota and variance. Stop a run early on repeated quota errors; record it as unscored, not as a failure.
- **Prerequisite for Ollama cloud:** the dev server must be running, since the harness rewrites the relay path to `http://localhost:3000`.

## Review protocol

- Every returned link of every successful run is rated against the existing rubric (exact identities, overlapping lifespans, a concrete personal interaction or exact named-battle opposition; influence, era, institution and kinship fail).
- **Blind:** the review sheet hides arm and run order; a script joins ratings back afterwards.
- Precision is pooled per arm. With about 12 cases x 3 repeats x 5 links, roughly 180 links per arm, only a large drop is detectable. State that in the report: G1 is a guard, not proof.
- A reference route does not validate a different returned route.

## Reporting

- Raw per-run JSON lines and the wire logs in `ai-docs/evaluation/six-degrees/efficiency/<date>-<arm>/`; one `REPORT.md` per stage with the tables below.
- Paired differences per (case, repeat), median and interquartile range, a bootstrap interval over cases, and the A/A spread. No p-values.
- Every table lists requests by kind, HTTP calls, seconds, segments, success within 180 s, rounds to success, malformed replies, and precision, cold and warm apart.
- Exported saved-session data (stage 7) stays out of git by default; see Decisions.

## Risks

| Risk | Mitigation |
| --- | --- |
| Live runs are noisy and few | A/A spread reported; ABBA; thresholds stated as point estimate plus interval; T1 does the heavy lifting on mechanics |
| One model, one provider | Say so; Gemini and OpenRouter keep batch size 8 until measured |
| Fill rule delays an early exit | T1 measures it before live; join-pair exception; rounds-to-success guardrail |
| Salvage hides a real model problem | `validationRetries` and not-assessed counts are reported; a rising rate is a finding |
| Stored sessions break on upgrade | New fields optional; context migration in stage 6; version unchanged |
| The simulator flatters the change | Calibrate T1 to the **measured** numbers from the stage-A pilot (new pairs per discovery slot, unresolved share, flip rate, batch fill, requests per round), not to the lab's closed form, which was itself fitted to the Harriot run. Then treat the closed form as the thing under test: the real baseline engine in T1 must land within 10% of the pilot's requests and pair-asks per discovery round (identity and unattributed requests are outside the simulation). If not, fix the model, not the claim |
| Quota or cost | Pilot first; one provider; stop rules above |
| Reviewing by the same model family | Review is human or an independent source check, per the eval README |

## Decisions needed (defaults if you say nothing)

1. **Live budget.** Default: Ollama cloud only, pilot first, up to about 4 hours of runs per stage that reaches T3. Say if quota makes that wrong, or if Gemini should be measured too.
2. **Negatives for the batch benchmark.** False-accept rate needs at least 12 pairs reviewed as having no qualifying contact. Default: I draft candidates from the reviewed people; you or another independent reviewer approves them. Without them, stage 3 measures recall, unresolved-rate drift and position effects only.
3. **Batch size as a setting.** Default: an internal per-provider constant, not user-visible.
4. **Exported session data.** Default: kept under `ai-docs/evaluation/six-degrees/data/`, gitignored. It holds only public names and model text, but also your canvas history.
5. **Change granularity.** Default: one commit per stage on this branch, each with its own gate result in the message.
6. **In-app transport counters.** Default: task-level counters plus the validation-retry delta in the app; HTTP-level counts only in the harness.

## Sequencing

```
0 baseline freeze
1 A engine counters  ||  1 harness + sim + replay skeletons      (parallel, different files)
   pilot on baseline -> measured table -> revisit order if it surprises us
2 D salvage -> 3 C batch size -> 4 B pool -> 5 E both ends -> 6 G cache key     (sequential)
7 F / H / I experiments, only if their T1/T2 gate passes
8 recalibrate the lab and guide, AGENTS.md line, archive report
```

Each engine stage ends with `bun test`, `npm run typecheck` and `npm run build`, then T1 where it applies, then T3.

## Definition of done

- Stages 0 to 6 landed with their gates recorded, or dropped with the evidence recorded.
- A report that states, for the user's model, requests per success and seconds to chain before and after, with the A/A spread and the precision guard.
- Counters persisted in saved sessions, so the next investigation starts from measurements.
- The guide and the lab quote measured parameters, and `AGENTS.md` mentions the counters.
