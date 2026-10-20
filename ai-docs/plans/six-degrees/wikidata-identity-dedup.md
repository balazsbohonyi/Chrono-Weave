# Six Degrees: deduplicate people and correct their years with Wikidata

Status: implemented and committed (2026-10-17). Deviations from the plan below: the ingestion and reconcile tests live in `tests/connectionWikidata.test.ts` and `tests/connectionFlow.test.ts` (not `connectionPath.test.ts`), and two worlds were added to `tests/connectionTraceWorlds.ts` (the golden file only gained their two entries). The BCE risk was resolved with Socrates: SPARQL numbers years astronomically (`-0469` is 470 BCE), so `historicalYear` shifts years of 0 or below by one. Diagnostics `merged` and `corrected` count distinct proposals, not events.

## Context

Six Degrees can show the same person twice. In the saved 9-degree session, **J. Robert Oppenheimer (1904)** and **Robert Oppenheimer (1906)** are two nodes.

The cause is that `samePerson` (`src/services/connectionGraph.ts:75`) merges two records only when the name (or an alias) **and** both years match exactly. The existing repairs don't reach this pair:
- `resolvableDuplicates` only compares records with an identical canonical name.
- The alias-collision check in `findConnection` (`connectionPath.ts:391`) needs identical years and covers at most 2 pairs per round.

Both names redirect to the same Wikipedia page, `Q132537` (verified live), so a Wikidata QID is the missing identity signal. Wikidata also holds the correct years (1904–1967 here).

Outcome: every person the search or a reopened session touches is resolved to a QID. Same QID means one person, merged. The years come from Wikidata, not the model.

### Who gets resolved

**Every person who enters the store, not only suspected duplicates.** Duplicates cannot be known beforehand: the Oppenheimer pair differs in both name and years, so only the shared QID reveals it. Year correction also applies to a person with no twin.

Entry points, resolved in one batch each:
- endpoints,
- seed-route proposals,
- discovery candidates (one batch per round, before they are proposed or assessed),
- canvas figures used as prompt references (confirmed by the user). `identifyPerson` turns them into store records, so they can create duplicates too.

Skipped: anyone who already has a `qid`, or a `qidCheckedAt` newer than 30 days.

Cost: at most 160 new people per segment is about 4 Wikipedia title calls and 4 SPARQL calls (plus at most 8 name-search fallbacks per batch). The result is then stored on the record. The first reopen of a large saved session costs about one title call and one SPARQL call per 50 people.

**No commits until the user says so.** When asked to commit later: no attribution trailers (AGENTS.md).

## Settled decisions (from the grilling)

| # | Decision |
|---|---|
| Scope | Six Degrees only (search, shared store, explorer). The canvas timeline is untouched, and so are portraits (they keep their own fetch). |
| When | At ingestion: resolve new people before they are proposed or assessed. Any Wikidata failure falls back to today's behaviour, never blocks or errors a search, and is retried later. |
| Resolve | Wikipedia title lookup (batched 50, redirect-aware), then fall back to `wbsearchentities`. No prompt changes, so no changes to AI request counts. |
| Guards | A QID is accepted only if the entity is human (`P31=Q5`) **and** both Wikidata years are within 10 years of the proposed years (the existing `DUPLICATE_DATE_TOLERANCE_YEARS`). A failed guard leaves the person as today (no QID, no change, not dropped). |
| Years | Deprecated claims ignored. Precision coarser than year is ignored (keep the model's year for that field). `preferred` rank wins. If normal-rank claims disagree (Newton 1642/1643), take the one nearest the model's year. No P570 on a human means `deathYear` = current year. BCE is a signed year. Missing birth keeps the model's. |
| Fetch | SPARQL batches of about 50 QIDs, 8 s timeout, `Api-User-Agent` header. No second path: failure means "failed", nothing saved, retried next pass. |
| Ids | Stable and opaque. Existing records never re-key. A record gains `qid`, and a QID lookup lets later proposals with the model's old years land on it. |
| Variants (Q17a) | Each person keeps up to 6 `{name, birthYear, deathYear}` variants ever supplied. `samePerson` matches through them, so canvas figures and saved paths with old years still match. Canvas figures are never modified. A newly woven figure uses the corrected years. |
| Survivor | An endpoint wins. Otherwise the record whose years already equal Wikidata's. Otherwise the one with more valid accepted contacts. Otherwise the first recorded. It keeps its own name, and the other name becomes an alias. Merge goes through `mergeResolvedIdentity`. |
| Invalid contacts | A contact that stops validating after a date correction is left stored and ignored by `validAccepted`. Nothing is deleted. |
| Existing data | Reconcile a session when it is opened or resumed. Results are saved on the store's person records. No global sweep. Saved paths (Recent connections) stay as snapshots. |
| AI identity | QID is authoritative. Same QID means merge with no AI request. Different QIDs means no AI request. If either is unresolved, today's AI logic runs. Same-name namesakes with different QIDs stay excluded from routes as today (deferred). |
| Endpoints | Get a QID and corrected years on their Six Degrees records only. A non-endpoint duplicate merges into the endpoint. Header and canvas dates are not touched. |
| Memory | Match: stored forever. Miss or failed guard: `qidCheckedAt`, retried after 30 days. Network failure: nothing stored. |
| UI | Silent. Counters only in `diagnostics`. |
| Tests | Injected resolver (absent means identical to today, so the existing golden trace and tests are untouched), fake resolver in new tests, recorded real responses as fixtures, a manual live smoke script. |

## Design

### 1. New `src/services/wikidataService.ts`

Pure parsing and guards, plus thin fetchers that take an injected `fetch`.

- `titlesToQids(names, fetchImpl, signal)`: Wikipedia `query` with `prop=pageprops&ppprop=wikibase_item&redirects=1`, 50 titles per call. Reuse the normalized/redirect mapping that `fetchBatchWikipediaImages` (`wikiService.ts` lines 83-103) already has. Extract it into a small shared helper rather than copying it, and keep portrait behaviour byte-identical.
- `searchCandidates(name, …)`: `wbsearchentities` (type item, `limit` 5, `language` en), only for title misses and capped per call.
- `fetchClaims(qids, …)`: one SPARQL query per batch of 50, returning **one row per claim** through a `UNION` with a `?kind` column (`human` / `birth` / `death`, plus time, precision, rank). This avoids the birth × death cross product that a naive query returns. Payload is about 3 KB per person, against about 350 KB for `wbgetentities` with `props=claims`.
- `lifespanFrom(claims, proposed)`: pure. Implements the years rules above and returns `{ birthYear?, deathYear? }`.
- `acceptIdentity(proposed, wikidata)`: pure. Implements the guards (human, tolerance, overlap).
- `createWikidataResolver(deps)`: implements the exported `WikidataResolver` interface. `resolve(inputs, signal)` returns a `Map` keyed by `name|birth|death`. Each value is `{ qid, birthYear, deathYear }` (matched), `'miss'` (definitive no or failed guard, persisted as `qidCheckedAt`) or absent (network failure, not persisted).

Constants live here: title batch 50, SPARQL batch 50, timeout 8000 ms, pool 3, search fallbacks per call 8, candidates 5, miss retry 30 days, minimum precision 9, variants cap 6. Tolerance is imported from `connectionGraph.ts`.

### 2. Model changes in `src/services/connectionGraph.ts`

- `ContactPerson` gains `qid?`, `variants?` (up to 6) and `qidCheckedAt?`.
- `samePerson` also matches through variants, and when both sides carry the same `qid`. Existing alias semantics are unchanged: discovery-proposed aliases stay hypotheses.
- `identifyPerson(people, input, resolved?)` keeps its signature and behaviour when `resolved` is absent. With it:
  1. Find a live record by QID (following the `canonicalId` chain) and add the input as a variant.
  2. Otherwise match by `samePerson` (variants included), attach the QID and apply the corrected years.
  3. Otherwise create a record whose id is built from the corrected years.
- New `chooseSurvivor(group, endpoints, knowledge)` implements the survivor rule.
- New `reconcileIdentities(knowledge, session | undefined, resolved, endpoints)`:
  1. Apply resolutions to existing records: set `qid`, correct the years, push the old name and years into `variants`.
  2. Group by QID.
  3. Merge each group with `mergeResolvedIdentity`.
- `mergeResolvedIdentity`:
  - Make `session` optional so a store-only record can be merged.
  - After re-pointing, **drop self-pairs** (a contact between the two duplicates becomes `[X, X]`) and **de-duplicate contacts per `pairKey` and verdict**, keeping the newest `assessedAt`. This is strictly safer than today, since today neither is handled.
- `canvasPerson` and `settleConnection` need no code change: they call `samePerson`, which now sees variants.
- `connectionFlow.ts:167` and `App.tsx:665` call `identifyPerson` unresolved. They match through variants, so they stay unchanged.

### 3. Ingestion in `src/services/connectionPath.ts`

- `ConnectionSearchOptions` gains an optional `wikidata?: WikidataResolver`. Absent means every code path is exactly as today.
- Before each group of `identifyPerson` calls, one batched `await resolve(...)` prefetches results (cached on the record, so each person is looked up once):
  - endpoints (151-152),
  - seed proposals (331-334),
  - canvas-figure references (366),
  - discovery candidates (378-381): one batch per round, before the loop.
- At the start of a search with a saved session, run `reconcileIdentities` over the session's people and then the existing retired-record following (161-167).
- Skip AI identity requests when QIDs decide: both the alias-collision step (389-410) and `resolveDuplicate` (205-228). Unresolved people still use today's AI path.
- Wikidata calls are **not** `task()` calls: `SEARCH_LIMITS.tasks`, batching and retries are unchanged. They run inside the existing wall-clock deadline and use the shared `signal`.

### 4. Reconcile on open (no search running)

- New `reconcileSession({ repository, resolver, session, signal })`, next to `finishedExploration` in `connectionFlow.ts`.
  - It loads the store, resolves the session's unresolved people, applies and merges, persists with `repository.checkpoint`, and returns the updated session.
  - It also maps the `chain` ids onto survivors, since a chain person may have been merged into another id.
- `useConnection.openSavedExploration` (`useConnection.ts:239`) opens the explorer immediately, then reconciles in the background and swaps in the updated session. It never blocks opening.
- Resume goes through `findConnection`, so step 3 covers it.

### 5. Persistence and diagnostics

- `recoverKnowledge`'s `person()` (`src/utils/connectionKnowledge.ts:24`) whitelists `qid` (matching `/^Q\d+$/`), `variants` (validated, at most 6) and `qidCheckedAt` (finite number).
- `ConnectionDiagnostics.wikidata?: { lookups, resolved, merged, corrected, failed }` is per segment, whitelisted in `recoverDiagnostics`, and counted without touching batching, limits, prompts or retries.

### 6. Docs

- Copy this plan to `ai-docs/plans/six-degrees/wikidata-identity-dedup.md` as the first implementation step. Plan mode only allows this file today.
- Add a short paragraph to the "Six Degrees persistence and isolation" section of `AGENTS.md`: QID identity, variants, stable ids, the Q9 AI-skip rule, the diagnostics counters, and the Q4 guards.

## Work breakdown (one working tree, uncommitted, in this order)

1. `wikidataService.ts` plus parsing, plus fixtures and tests.
2. Person model: `qid`, `variants`, `samePerson`, `identifyPerson`, `chooseSurvivor`, `reconcileIdentities`, `mergeResolvedIdentity` fixes, recovery whitelist.
3. Ingestion in `findConnection` plus identity-request skipping.
4. `reconcileSession` and the `useConnection` open path.
5. Diagnostics counters.
6. Docs (the `ai-docs` copy plus `AGENTS.md`).

## Verification

- `bun test` (about 60 s, 500+ tests), `npm run typecheck`, `npm run build`.
- **Existing golden trace unchanged:** `tests/connectionRequestTrace.golden.json` must stay byte-identical for every existing world, because no resolver is passed there. Add **one new world** (a duplicate pair resolved by QID) and record only its new entry. This is the deliberate change from Q9(b).
- New tests:
  - `tests/wikidataService.test.ts`: parsing from **recorded real responses** in `tests/fixtures/wikidata/`. Cases: Oppenheimer, Newton (1642/1643 claims), a living person (Jennifer Lopez), a BCE person (Socrates), a disambiguation page ("Newton"), precision-9 dates (Hitler's birth), and a deprecated claim. One test per guard failing.
  - `tests/connectionIdentity.test.ts`: same-QID merge, survivor rule, endpoint wins, self-pair and duplicate-contact cleanup, `identifyPerson` landing on a corrected record by QID and by variant, `canvasPerson` matching a canvas figure through a variant (no second Oppenheimer on the canvas), invalid-contact left ignored.
  - `tests/connectionPath.test.ts`: ingestion with a fake resolver, the identity request skipped when QIDs decide, the AI path still used when unresolved, failure falling back, diagnostics counters.
  - `tests/connectionKnowledge.test.ts`: whitelist and recovery of the new fields.
  - `tests/connectionFlow.test.ts`: `reconcileSession` on a reopened solved session, with the chain mapped onto survivors.
- **Live smoke (manual, outside CI):** `scripts/wikidataSmoke.ts` runs against the real APIs. It checks that "Robert Oppenheimer" and "J. Robert Oppenheimer" both resolve to `Q132537` with 1904–1967, that Newton lands on 1643, that "Newton" alone is rejected, and that Socrates' BCE year matches the app's sign convention (see Risks).
- **Browser check:** the real saved session lives in the user's own Chrome (see memory notes), not the preview pane. Use the throwaway `harness.html` and `harness.tsx` approach (synthetic session containing both Oppenheimer records, dev port 3001), confirm one node remains, then delete the harness. Then ask the user to reopen their saved session in their Chrome.

## Risks and things to confirm while building

1. **BCE years in SPARQL:** RDF `xsd:dateTime` may use astronomical numbering (year 0 exists), while the JSON API does not. Verify with Socrates in the smoke test and normalise to the app's convention before relying on it.
2. **SPARQL availability and rate limits:** failure is "failed, retry later". The 8 s timeout and a small pool keep the search from stalling.
3. **Wrong-person matches** are bounded by the human check and the 10-year guard. A father and son within 10 years of each other could still collide, which is accepted.
4. **Living-person death year:** a historical person with a missing P570 would get today's year, but the 10-year guard against the model's death year rejects that.
5. **Mapping `chain` ids** onto merge survivors when reopening a solved session needs its own test.
6. **Hot loops:** `knowledge.people.find(... samePerson ...)` now looks at variants (at most 6). Add a QID index if profiling shows a cost.

## Out of scope

- Canvas timeline duplicates.
- Portrait lookups.
- Letting same-name namesakes with different QIDs coexist in routes (deferred).
- Migrating saved paths.
- Any new UI.
