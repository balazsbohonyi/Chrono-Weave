# Six Degrees: where the model requests go, and how to send fewer

Status: analysis only. Nothing under `src/` was changed. Written 2026-10-14 against branch `feat/six-degrees-refactor`.

Tags used for every number below: **[measured]** read straight from stored data or code, **[derived]** arithmetic on measured values, **[inferred]** reconstructed from stored state (the stored session has no event log), **[assumed]** a guess, shown only so a knob has a starting value.

## Files in this folder

| File | What it is |
| --- | --- |
| `01-how-the-search-works.html` | The loop, each request type, the retry layers, the budgets, and a request timeline. Start here. |
| `02-harriot-to-halley-walkthrough.html` | A real 6-degree chain from your canvas history, replayed from the stored session. |
| `03-optimization-lab.html` | An interactive cost model. Toggle each idea in section 6 and watch requests and seconds change. |
| `optimizing-six-degrees-requests.md` | This file. |

All three HTML files are single files with no network dependencies. Open them directly in a browser.

---

## 1. Short answer

**The premise needs one correction.** The engine does not send one prompt per candidate connection. Batching already exists:

- Assessment: up to **8 pairs per request** (`SEARCH_LIMITS.assessmentPairs`, `src/services/connectionPath.ts:66`).
- Discovery: up to **4 source people per request, 6 contacts each**, so up to 24 candidate names per request (`discoveryPeople: 4`, `candidates: 6`).

So "send batches instead of one prompt per pair" is mostly already the design. The remaining waste is elsewhere.

**"Per figure" is one interleaved loop, not two searches.** The loop alternates which end's frontier it expands (`side` flips each iteration, `connectionPath.ts:239`, `:250`). Assessment is one shared pool for both ends. Each round costs roughly one discovery request plus the assessments for the pairs it created.

In the Harriot to Halley run **[inferred side attribution, counts from `rounds`]**: the **Halley end** had 8 source expansions (Halley, Boyle, Huygens, Hooke, then Rømer, Wren, Flamsteed, Newton), so at least 2 discovery requests; the **Harriot end** had 9 (Harriot twice, Raleigh, Dee, Hues, Percy twice, Lower twice), so at least 3, because one person is never expanded twice in the same request. All 35 newly assessed pairs went through the one shared assessment pool. In total 17 source expansions and at least 5 discovery requests over the two segments.

**What actually multiplies requests** (details in sections 3 to 5):

1. **Assessment dominates.** One discovery request creates up to 24 candidate pairs. In the Harriot to Halley run that was about 13 new pairs per discovery request **[derived]**, which becomes about 21 pair-asks once the re-asks are counted: roughly 3 assessment requests per discovery request, so about three quarters of all requests.
2. **Fresh and re-ask pairs are sent in separate batches.** `assess()` and `assess(true)` never share a request (`connectionPath.ts:243`, `:245`), although the prompt already supports a per-pair `focused` flag. Each flush leaves a part-empty batch. The saving from fixing that alone is small (about 0.4 requests per round in the model); it matters mostly because it lets bigger batches fill.
3. **Most pairs come back unresolved, then get asked again.** In that run 23 of 35 assessed pairs were unresolved on the first ask **[measured]**, and every one of them was re-asked once.
4. **The 180 s wall clock ends most long runs, not the 32-task cap.** A request takes about 7 s at the median and 13 s in the Harriot run **[measured]**, so 180 s is roughly 14 to 26 requests.
5. **Every task is really up to 6 or 12 HTTP calls** under validation and rate-limit retries (section 3).
6. **Continue starts a new segment, and the in-flight request is lost.** When the 180 s deadline aborts a request, its pairs go back to `proposed` and are asked again in the next segment (`connectionPath.ts:310`). Five of your 30 saved explorations hit the time budget at least once, and four needed three or more segments **[measured]**.

**Highest-value, lowest-risk changes** (ranked in section 6):

1. Add per-reason request counters first, so the rest can be measured.
2. Make the assessment parser keep valid items (no request saving, but it removes the failure that bigger batches make likelier).
3. Raise the assessment batch size from 8 to 16. This is the largest safe lever.
4. Put fresh and re-ask pairs into the same batches, filled before sending.
5. Expand both ends in one discovery request.

On the calibrated Harriot segment these take about 12 requests to about 8 (and 159 s to 111 s) **[derived]**. Best-first triage could go further (about 7), but it risks missing real contacts and needs the evaluation harness before anyone trusts it.

**Do not** merge discovery and assessment into one call, and do not remove the re-ask. Both are covered in section 7.

---

## 2. How a search runs

Entry point: `findConnection()` in `src/services/connectionPath.ts:76`. Constants: `SEARCH_LIMITS` at `:66`.

| Limit | Value | Source |
| --- | --- | --- |
| Wall clock per segment | 180 s (includes queueing and retries) | `wallMs` |
| Model tasks per segment | 32 | `tasks` |
| New people per segment | 160 | `people` |
| Pairs assessed per segment | 320 | `pairs` |
| Discovery sources per request | 4 | `discoveryPeople` |
| Contacts per source | 6 | `candidates` |
| Pairs per assessment request | 8 | `assessmentPairs` |
| Longest accepted chain | 21 links | `MAX_CONTACT_LINKS`, `connectionGraph.ts:7` |

Order of work:

1. **Typed name only:** `resolveFigure` (1 request, outside the 32-task count, `connectionPath.ts:324`). Picking a figure on the canvas costs nothing here.
2. **Load shared knowledge from IndexedDB and look for a path** through accepted contacts (`outcome()`, `:151`). Free. If a chain already exists the search ends with zero requests. 11 of your 30 saved explorations finished this way in their last run **[measured]**.
3. **Direct check** if the two lifespans overlap: one request, one pair (`:214`).
4. **Seed route:** one request that proposes a whole chain (`fetchConnectionPath`, `:218`). Runs once per context (provider, model, endpoints, canvas figure ids). It turns into at most 21 candidate pairs.
5. **The loop** (`:240`), repeated until a chain is accepted or a budget ends it. One iteration is, in this order:
   1. Assess every **fresh** pair, 8 per request, looping until none are left (`:243`).
   2. Assess one batch of **re-asks** (`assess(true)`, up to 8, `:245`). Eligible: unresolved, has a discovery claim, asked exactly once in this segment, not yet re-asked.
   3. **Discover**: one request for the next side's frontier, up to 4 people times 6 contacts (`:257`). The new pairs are assessed at the start of the next iteration.
   4. **Identity checks**: 2 requests per alias collision, at most 2 collisions per iteration (`:277` to `:296`). Rare.
   5. **Cross-frontier pairs**: up to 4 frontier people times the first 2 opposite-frontier people are queued without a claim (`:298`). Free to queue, paid when assessed.
   6. Checkpoint (free). After every assessment batch the graph is searched again, so success exits early.
6. **Stop** on a chain, 32 tasks, 180 s, 160 people, 320 pairs, or an explored frontier. Anything but a chain is saved as a paused checkpoint; **Continue** starts a fresh segment on the same state.

Frontier choice (`selectFrontier`, `connectionGraph.ts:164`): people reachable from one end but not the other, least-expanded first, then a score of graph distance plus temporal distance. A person whose last two rounds produced nothing is skipped.

---

## 3. Request catalog

"Items" is the batch size. "HTTP worst case" is per task and comes from the retry layers described below the table.

| Task | Trigger | Items per request | In the 32-task cap | Appears in DevTools as |
| --- | --- | --- | --- | --- |
| `resolveFigure` | Typed name as the other end | 1 name | No | model POST |
| Direct assess | Lifespans overlap | 1 pair | Yes | model POST |
| Seed route | Once per context | catalog of up to 150 canvas people | Yes | model POST |
| Assess (fresh) | Pairs from discovery or seed | up to 8 pairs | Yes | model POST |
| Assess (re-ask) | Unresolved pair with a claim | up to 8 pairs | Yes | model POST |
| Discover | Each loop iteration | up to 4 sources x 6 contacts | Yes | model POST |
| Identity check | Alias collision between frontiers | 1 name, 2 per collision | Yes | model POST |
| Why (explanation) | Clicking Why on a link | 1 link | No (App.tsx) | 1 to 2 model POSTs + 1 Wikipedia GET |
| Portraits | New accepted people appear | up to 50 names | No | Wikipedia GET, no model |

**Retry layers.** One task is not one HTTP call:

- *Validation retry.* `generateValidatedJson` (`jsonResponse.ts:41`) sends the prompt, and if the reply fails the parser it sends it again with a correction. Two rounds at most. The Ollama transport does the same inside its own loop (`ollamaService.ts:148`).
- *Rate-limit retry.* Gemini and OpenRouter go through `enqueueTaskWithRetry`, which retries 429/503 up to 5 times with 3, 6, 12, 24, 48 s backoff (`utils.ts:48`). Ollama retries 429/503 up to 2 more times with 1 s and 2 s waits and gives up at once on quota messages (`ollamaService.ts:167`).
- *Queue.* Gemini and OpenRouter share one global queue with a 1 s gap between requests (`utils.ts:32`). Ollama has its own per-service serial queue and no gap (`ollamaService.ts:144`). Either way requests are strictly sequential.

| Provider | Worst case per task | Typical |
| --- | --- | --- |
| Ollama | 2 rounds x 3 tries = 6 | 1 |
| Gemini / OpenRouter | 2 rounds x 6 tries = 12 | 1 |

The task cap counts tasks, not HTTP calls (plan line 130). Retries only consume the 180 s clock.

**Failure is all-or-nothing today.** `parseContactAssessments` throws on one malformed item (`connectionAI.ts:24`). The batch is re-sent once. If the second reply is also bad, the whole segment ends with status `error` ("Search interrupted"), not a pause (`connectionPath.ts:302`). A larger batch makes this more likely, which is why section 6 puts salvage before batch size.

---

## 4. Evidence from your own canvas history

Read-only snapshot taken 2026-10-14 from `chrono_canvas_history` (localStorage) and the `knowledge` store of IndexedDB `chronoweave-six-degrees-v2`. Every request in it ran on **`ollama/gpt-oss:120b-cloud`**. The knowledge store was growing while I read it (1,867, then 1,887, then 1,913 verdicts), so treat counts as a snapshot, not a constant.

Caveats that apply to everything in this section:

- `diagnostics.tasks`, `.pairs`, `.people` describe the **last segment only**. They reset on every call (`let tasks = 0`, `connectionPath.ts:86`). Do not add them up across segments. `elapsedMs` is cumulative.
- A saved session has no event log. Anything about *order* or *task type* below is **[inferred]** from `rounds[].lastExpanded`, `attempts[].segment` and the counters.
- Yield numbers describe one model's output. They say nothing about whether the accepted contacts are historically true. Accuracy is still unverified.

**All 30 saved explorations [measured]**

| Result | Count |
| --- | --- |
| Connected | 26 |
| Paused (cancelled or budget) | 3 |
| Explored without a chain | 1 |
| Last run used 0 model requests (answered from the shared graph) | 11 |
| Hit the 180 s budget at least once (stored stop reason, kept after a later success) | 5 |
| Needed 3 or more segments | 4 (Chomsky to Sagan 7, Edison to Thorne 7, Newton to Shakespeare 5, Galileo to Columbus 3) |
| Most attempt records (pairs plus identity checks) | 271 (Chomsky to Sagan), 261 (Edison to Thorne), 239 (Newton to Shakespeare) |

Time per request, from single-segment connected runs with at least one task (`elapsed / tasks`): median **7.0 s**, range 4.4 to 12.3 s, 11 runs **[derived]**. The Harriot final segment ran at 13.1 s per task. At those speeds 180 s allows about 14 to 26 requests, so the 32-task cap is rarely what stops a run.

Recorded verdicts: 1,913, of which 784 accepted and 1,129 unresolved **[measured]**. 206 of the unresolved records belong to a pair that also has an accepted record, which means some pairs flipped on a later ask. So 59% is not a clean first-ask failure rate, but it shows that unresolved is the common answer.

**Thomas Harriot to Edmond Halley (6 links) [measured unless tagged]**

- Chain: Harriot, William Lower, Johannes Kepler, Galileo Galilei, Marin Mersenne, Christiaan Huygens, Halley.
- 2 segments, 338 s total. Segment 1 ended on the time budget, segment 2 connected in 158 s with 12 tasks, 43 pair-assessments, 5 new people.
- 160 candidate edges in the session: **123 were already in the shared graph (free)**, 37 were proposed by discovery, 2 of those were blocked by the lifespan rule, **35 were assessed**.
- First ask on the 35: 12 accepted, 23 unresolved.
- Re-ask: all 23 unresolved were re-asked once. Of the 20 that stayed in the same context, **8 flipped to accepted (40%)**, 12 stayed unresolved. Two of the three newly assessed edges on the final chain (Lower to Kepler, Mersenne to Huygens) only exist because of that re-ask.
- 3 pairs show count 1 together with a stored re-ask segment. The only path that produces that state is: asked, re-asked, then asked again after the attempt context changed. So at least **3 identical-prompt re-asks** happened **[derived, lower bound]**. See section 6, option G.
- Of the final 6 links: 3 were free (Kepler to Galileo, Galileo to Mersenne, Huygens to Halley), 3 were newly assessed.
- Only 3 of the 35 assessed pairs ended up on the chain (9%). The other accepted pairs are not wasted: they are now in the shared graph and are why 11 of 30 explorations needed no requests.
- Segment 2 task mix: the identity check ran in segment 2 (23 attempt records end in segment 2 and only 22 are pairs), so 2 of the 12 tasks were identity requests **[derived]**. 8 sources were expanded (`lastExpanded = 2`), so at least 2 discovery requests, and a seed re-run is possible, which leaves 6 to 8 assessment requests **[inferred]**. 43 pair-assessments need only 6 requests if every batch is full, so batch packing cost at most 2 requests.

---

## 5. Why it feels like too many

1. Assessment is about 3 of every 4 requests in a round (3.07 of 4.07 in the model), because each discovery request fans out into 13 to 24 pairs.
2. Re-ask batches are separate requests, usually smaller than 8, at most one per iteration (any overflow carries to the next iteration).
3. Unresolved is the majority answer, so most pairs are asked twice.
4. The queue is serial, so every request adds its full latency to a 180 s budget. A saved request is saved seconds.
5. Retry multipliers are invisible in the task count but visible in the Network tab. Under rate limiting, one task can show as 6 or 12 calls.
6. Hard pairs need several segments, and each Continue is a new run of the same loop.
7. The Network tab also shows **Wikipedia portrait lookups**. `useNetworkPortraits` fetches whenever the set of accepted people on screen changes (`useNetworkPortraits.ts:31`), and a failed lookup is not remembered. These are cheap and not model calls, but they look like extra traffic during a search.

---

## 6. Optimization options, ranked

Invariants every option must keep (`AGENTS.md` and `ai-docs/plans/six-degrees/six-degrees-refactor.md`): AI-only assessment, each pair judged independently with discovery claims withheld (plan line 84), one re-ask per promising unresolved pair per segment (line 128), the 21-link bound, cross-model reuse, explicit Continue, and no change to global concurrency policy (line 178).

Estimates come from `03-optimization-lab.html`. Its closed-form model is calibrated to the Harriot final segment and reproduces it closely: 12.1 requests, 43.0 pair-asks and 159 s, against 12 tasks, 43 pair-assessments and 158 s measured. It is steady-state per discovery round, so a single segment can differ by a request either way. "Requests" below are the model's totals for that segment.

| # | Change | Where | Requests, Harriot segment (model) | Risk to invariants | Needs |
| --- | --- | --- | --- | --- | --- |
| A | Per-reason request counters | `task()` at `connectionPath.ts:102`, `diagnostics` | none (measurement) | none | nothing |
| D | Keep valid items, re-ask only failed refs | `connectionAI.ts:24`, `jsonResponse.ts:41` | none by itself; removes segment-ending errors | none | nothing |
| C | `assessmentPairs` 8 to 16 | `SEARCH_LIMITS` | 12.1 to 10.0 | longer replies, more per-item errors | D |
| B | Mix re-asks into fresh batches, fill batches | `assess()` filter, `:180` | 10.0 to 8.7 with C (12.1 to 11.4 alone) | none: prompt already has per-pair `focused` | A |
| E | Both ends in one discovery request | `buildContactDiscoveryPrompt` (single target today), `:207` | 8.7 to 7.7 | prompt gains a goal per source | A |
| F | Best-first triage: assess top K, defer the rest | `assess()` ordering | 7.7 to about 6.6 (K = 12, recall assumed 85%) | can delay or miss a real contact | evaluation harness |
| G | Key the attempt cache on what the prompt sends | `attemptContext()`, `:174` | at least 3 pair-asks saved per run | must preserve plan line 132 | A |
| H | Local concurrency for assessment batches | Six Degrees only | 0 requests; with everything above, 111 s to 90 s (2 at a time) | provider rate limits | A |
| I | Probe known bridges before paying for discovery | cross-frontier block, `:298` | experiment | none | A, evaluation |

### A. Count requests by reason (do this first)

`diagnostics` has `tasks`, `people`, `pairs` only. Add counters by kind (seed, direct, assessFresh, assessFocused, discover, identity), pairs by reason (fresh, focused, contextChange), and, from the transport wrapper, HTTP calls, validation retries, rate-limit retries. Wrap `task()` with a `kind` argument. Without this, sections 4 and 6 stay partly inferred, and G cannot be confirmed.

### B. Mix re-asks into fresh batches

Today each iteration sends fresh batches until the pool is empty, then one separate batch of re-asks. The prompt payload is `focused: pair.focused ?? false` per pair (`prompts.ts:222`), so a single request can carry both. Build one list: fresh pairs first, then re-ask eligible pairs, cut at `assessmentPairs`, set `focused` per pair. Delete the separate `assess(true)` call. Keep the "one re-ask per pair per segment" rule (`attempt.focusedSegment`).

*Fill batches.* Do not send a batch below about half full if a discovery request is going to run anyway: let it fill from that discovery's pairs. Exception: a pair whose two ends sit in the two different reachable sets can close the chain; send those immediately so early success is not delayed. *Cost of waiting:* a part-full batch can sit unasked until the next discovery lands, which delays an early exit by up to one round. The model assumes perfect packing and prices none of that delay, so its savings from B are an upper bound; the join-pair exception is what limits the delay in practice.

*Savings.* Small on its own and honest about it: per discovery round 4.07 requests become 3.69 at batch size 8 (12.1 to 11.4 for the segment). The part-empty flush is the same size whatever the batch size, so mixing matters more once batches are 16: 3.00 per round becomes 2.34 **[derived]**. Tests should confirm that no pair is ever re-asked twice in one segment.

### D. Keep valid items from a partial reply (do this before C)

`parseContactAssessments` is all-or-nothing, and a second failure ends the segment with `error`. Change it to return the valid items plus the list of failed refs, accept the valid items, and re-ask only the failed refs (one extra, small request). If the failed refs fail again, leave those pairs unresolved and continue instead of throwing. The `validAccepted` check at `connectionPath.ts:199` can also drop one item instead of aborting. This does not reduce request count; it removes the failure that larger batches would otherwise make more likely, and it stops one bad item from discarding seven good ones.

### C. Raise the assessment batch size

`assessmentPairs: 8` becomes 16. Assessment replies are one short object per pair, so 16 is well inside typical output limits. With D in place the cost of a bad item is one small extra request. Model: 12.1 requests become 10.0 for the Harriot segment, and with mixing (B) 8.7. Validate on the reviewed cases that accepted-edge precision does not drop (models can get lazier late in a long list). Try 12 first if 16 shows drift; 12 alone saves almost nothing here (12.0), because 13 fresh pairs still need two flushes, so the benefit is lumpy and the lab shows where the steps fall.

*Why not 24 or 32.* The gain flattens (merged, R = 2: 8.7 requests at 16, 7.8 at 24, 7.3 at 32) while error odds per reply rise with size **[assumed 0.5% per item: 7.7% of replies malformed at 16, 11.3% at 24]** and reply latency rises with it too; the lab shows the curve. Without D, every malformed reply costs a whole batch.

### E. Expand both ends in one discovery request

This is the "batch across the two figures" idea. Today the loop alternates sides, one discovery request each, and `buildContactDiscoveryPrompt` takes a single `target` (the "Goal on the opposite side"). Give each source its own goal and send up to 4 sources from each end (8 total) in one request. The assessment pool is already shared. It halves discovery requests, but discovery is only about 1 of 5 requests in a round, so the saving is modest (one request in the Harriot segment) and the prompt grows. Worth doing after B and C.

### F. Best-first triage

Rather than assess every new pair, score them and send the best K per round; keep the rest queued for later rounds. Candidate features: the discovery claim is concrete (names a year, place or work), the pair joins the two reachable sets, temporal progress toward the other end, and the source's round. At K = 8, a round of 13 new pairs needs one fresh batch instead of two, and 5 re-asks instead of 9. This is the largest possible saving and the only one that can lose a real contact. **[assumed]** 85% of useful edges are inside the top K; run the reviewed cases and report requests per success and recall before enabling it.

### G. Do not re-ask identical prompts

`attemptContext()` (`connectionPath.ts:174`) builds a key from provider, model, both names, aliases, **and the accepted contacts of both people**. The assessment prompt sends none of the accepted contacts (`prompts.ts:222` sends names, aliases, years, occupation). So when a person gains an accepted contact elsewhere in the graph, every unresolved pair involving them looks like new context and is asked again with the same prompt. Plan line 132 asks to reconsider on changed model or *relevant* context, and to avoid "repeating identical uncertain checks". Restrict the key to what the prompt contains. Observed lower bound: 3 such re-asks in the Harriot run. Confirm with counter A before and after. If a later prompt version does include neighbours, they belong in the key then.

### H. Local concurrency

Assessment batches inside one round are independent. Running 2 at a time halves their wall time. It does not reduce request count, and it increases burst rate, so it needs a measured provider limit first. Plan line 178 says not to change global concurrency policy, so it must be a Six Degrees only path with its own cap.

### I. Probe known bridges first

`selectFrontier` and the cross-frontier block pick only the first 2 opposite-frontier people (`opposite.slice(0, 2)`, `:298`) after an arbitrary `slice(0, 16)`. Instead, rank every lifespan-compatible pair between the two reachable sets and assess the top batch before spending a discovery request. In the Harriot data the only measured cross-frontier contribution was zero pairs, so the value is unknown. Treat it as an experiment.

### Token cost (not request count)

Each discovery prompt carries up to 80 reference people with aliases and occupations. Trimming references to name and years, or to the nearest 40 by time, shrinks input without changing request count. Low priority.

---

## 7. Rejected ideas

| Idea | Why not |
| --- | --- |
| Merge discovery and assessment into one "propose and verify" call | The assessor must not see the proposer's claim (plan line 84, `prompts.ts:220`). A model verifying its own claim in the same reply defeats independent acceptance. |
| Remove the re-ask | 8 of 20 re-asks flipped to accepted, and two of the three new edges on the Harriot chain depend on it. Make it cheaper (B), not absent. |
| Accept unresolved pairs to save checks | Breaks "unresolved never enters a chain". |
| Skip pairs already judged by another model | Cross-model reuse is a feature, and an `unresolved` record is per model. |
| Raise the batch size without D | Bigger batch means more chances for one bad item to end the segment. |
| Treat lifespan overlap as a soft hint | It is already a hard gate (`blockedContact`, `connectionGraph.ts:78`) that costs no request. |

---

## 8. What to expect

On the calibrated Harriot segment (lab preset "Harriot, segment 2", 13.1 s per request), applying the ideas cumulatively **[derived from the lab model]**:

| Step | Requests | Seconds | Chance a search aborts on malformed replies |
| --- | --- | --- | --- |
| Today | 12.1 | 159 | 0.9% |
| + D (keep valid items) | 12.1 | 159 | 0 |
| + C (16 per batch) | 10.0 | 134 | 0 with D, 2.4% without |
| + B (mix re-asks, fill batches) | 8.7 | 120 | 0 with D |
| + E (both ends in one discovery) | 7.7 | 111 | 0 with D |

The abort column uses the assumed 0.5% per-item error rate, so read it as a direction, not a forecast. F (triage, K = 12) would take the last row to about 6.6 requests and 95 s, but it asks half as many pairs and needs the recall check in section 9 first. H (concurrency 2) takes 111 s to 90 s. G affects repeat runs more than this one.

At the median speed of 7.0 s per request the same steps run 85 s down to 62 s, so most searches would fit one segment either way. The savings matter most for hard pairs. With 6 discovery rounds at 9 s per request, today's 28.4 requests and 256 s need two segments; the full set above needs 15.1 requests and 163 s, one segment **[derived]**.

For long explorations (Chomsky to Sagan: 271 attempt records over 7 segments) assessment volume dominates, so B, C and F matter most; E matters least.

---

## 9. Validation plan

There is no live benchmark harness in the repository any more; one has to be built again before the live steps below can be run.

1. Land A. Re-run the five priority pairs and the reviewed cases cold and warm. Record requests by kind, HTTP calls, seconds, and segments.
2. Land B and D. Mocked tests: mixed batches keep one re-ask per pair per segment; a partial reply keeps its valid items; a second malformed reply no longer ends the run.
3. Land C behind a setting (8, 12, 16). Compare accepted-edge precision on the reviewed cases and the four unsupported-control cases (they must stay unresolved).
4. Land E and G. Prompt tests that both ends' goals reach the right source; attempt cache tests that a changed neighbour does not trigger a re-ask but a changed alias or model does.
5. Only then try F and I, reporting requests per success **and** recall of the reviewed chains.

Report cold and warm separately, as the harness README requires.

---

## 10. Open questions

- Which limit hurts: the provider's requests-per-minute, a daily quota, or the 180 s clock? B, C, E reduce all three; H reduces only the clock.
- Does the Ollama cloud plan count requests or tokens? If tokens, trimming discovery references matters more than batch size.
- Is a segment that ends on `error` after a malformed batch common in practice? A (counting validation retries) will answer that.

---

## Appendix: model parameters used by the lab

| Parameter | Value | Tag | Basis |
| --- | --- | --- | --- |
| Assessment batch size | 8 | measured | `SEARCH_LIMITS` |
| Discovery sources x contacts | 4 x 6 = 24 slots | measured | `SEARCH_LIMITS` |
| New assessed pairs per discovery slot | 0.54 | derived | 43 pair-assessments / (1 + 0.66) / 2 discovery requests / 24 slots |
| Share of pairs unresolved on first ask | 0.66 | measured | 23 of 35 (Harriot); 0.59 across all stored verdicts |
| Re-ask flips to accepted | 0.40 | measured | 8 of 20 |
| Seconds per request | 7.0 median, 13.1 Harriot | measured | stored `elapsedMs / tasks` |
| Discovery requests in the Harriot segment | 2 | inferred | 8 sources expanded / 4 per request |
| Identity requests | 2 | derived | one stored identity attempt, recorded in segment 2 |
| Context-churn re-asks per round | 0 (lower bound 3 per run) | measured floor | state analysis in section 4 |
| Per-item reply error rate | 0.5% | assumed | only drives the risk meter |
| Triage recall in top K | 85% | assumed | only drives the triage estimate |

**Formulas** (per discovery request; `sides` is 2 when both ends share a request, else 1):

```
newPairs   = S x C x q x sides
fresh      = min(newPairs, K) + crossPairs + churnPairs      (K = triage cap, off = no cap)
reask      = u x fresh
assess     = merge ? (fresh + reask) / B
                   : ceil(fresh / B) + max(1, reask / B)     (the re-ask flush is one batch per iteration)
total      = seed + identity + other + discoveryRequests x (1 + assess)
seconds    = requests x latency (+ 1 s gap on Gemini/OpenRouter), assessment part divided by concurrency
```

"other" is 2 in the Harriot preset: the part of the 12 tasks the stored state cannot attribute (a seed re-run, smaller discovery batches, or carry-over pools). It is held constant in every variant, which makes the savings slightly conservative.

The model reproduces the Harriot segment (12.1 requests vs 12 tasks, 43.0 pair-asks vs 43, 159 s vs 158 s). It was calibrated on that run, so that match is a fit, not a validation.
