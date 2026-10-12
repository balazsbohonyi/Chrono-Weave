# ChronoWeave — Six Degrees implementation handover

Date: 2026-10-12.
Workspace: `D:\develop\projects\ChronoWeave`.
Next session: implement the settled Six Degrees refactor.

## Authoritative artifact

Read the complete [Six Degrees refactor plan](D:/develop/projects/ChronoWeave/ai-docs/plans/six-degrees-refactor.md). It contains the agreed behavior, search design, operational defaults, module responsibilities, seven implementation stages, migration requirements, and validation criteria.

This handover adds session state and a launch prompt. It does not replace or restate the plan. The older [Six Degrees feature document](D:/develop/projects/ChronoWeave/ai-docs/plans/feature-ideas/six-degrees.md) describes the implementation being replaced; use it for baseline context, not as the refactor specification.

## What happened in this session

- The user asked how intermediates are proposed and why Six Degrees rarely finds chains, particularly between people whose lives do not overlap.
- We read the feature documentation, traced the search, prompts, provider adapters, caches, UI lifecycle, and persistence, and explained the current limitations.
- The user explicitly invoked `grill-me` to settle the redesign. The interview is complete; its decisions are recorded in the plan.
- The user supplied four actual failed pairs. They and Machiavelli–Leonardo are listed in the plan's **Priority real-world cases** section.
- We produced the refactor plan. Production implementation has not started.
- The user then specifically confirmed that other features' prompts must remain unchanged. This is a hard scope boundary, especially for Map Relationships and Expand Timeline. Follow the plan's **Scope boundaries** and **Provider operations and isolation** sections.

Do not restart the design interview or infer new product scope from the earlier brainstorming. Suggestions that the user declined or narrowed are superseded by the settled plan.

## Repository state at handover

- Branch: `feat/six-degrees-refactor`.
- HEAD: `88ccd35` — `feat: refine Six Degrees connection verification and reveal`.
- `ai-docs/plans/six-degrees-refactor.md` is a staged new file.
- This handover is a new file; it has not been staged or committed by this session.
- No production-code changes were made during this session.

Recheck `git status` before editing. Preserve staged work and any newer user changes. No PR was created or worked on.

## Validation already performed

During the initial code investigation, this command passed:

```powershell
bun test tests/connectionPath.test.ts tests/pathService.test.ts tests/relationshipAssessment.test.ts tests/connectionFlow.test.ts tests/connectionProviders.test.ts
```

Result: **78 passed, 0 failed**, across five files.

These tests use fake/mocked AI responses and confirm mechanics; they do not measure historical discovery success. No live old-versus-new benchmark has been performed. The full test suite, typecheck, and production build still need to be run at implementation start and after the refactor, as specified in the plan.

## Historical and browser context

The user reported a Machiavelli–Leonardo route through Ludovico Sforza, who they believed was already on the canvas. We did not inspect that saved route or its exact evidence.

A [Museo Galileo account](https://brunelleschi.imss.fi.it/itineraries/itinerary/TheReturnToFlorence.html) describes Machiavelli seeing Leonardo at work with Cesare Borgia and helping him establish himself as a military engineer in Florence. This is useful reference context for reviewing the direct-connection regression case. It is not authorization to introduce source retrieval into the production solver.

The T3 collaborative preview successfully reached `http://localhost:3000/` during investigation, and a dev server was listening on port 3000. That preview profile contained no saved canvas history. Recheck current availability; do not assume it exposes the user's historical canvases or clear browser data to obtain a test state.

For browser verification, use T3 preview tools: start with `preview_status`, open a preview if necessary, and inspect before interacting.

## Start here

1. Read repository `AGENTS.md`, this handover, and the complete refactor plan.
2. Verify branch/working-tree state and establish the plan's stage-one baseline before replacing the old solver.
3. Follow the seven implementation stages and their exit criteria. Keep the approved design intact while resolving routine implementation details from the code.
4. Use the plan's final **Review before execution** checklist and **Validation and success criteria** sections to review the result.

Preserve a reproducible baseline using the current HEAD and/or recorded baseline artifacts before replacing the old engine. If configured credentials are unavailable for live comparisons, record that limitation, retain a repeatable baseline harness, and continue independent implementation work. Never report measured improvement from mocked tests or assume that every user-supplied pair has a qualifying historical chain.

Suggested skill: `Webdesign` for the live exploration overlay's implementation and visual verification, following the settled UI scope. The `grill-me` interview is already complete; use `handoff` again if another session boundary requires it.

## Ready-to-paste implementation prompt

```text
Implement the Six Degrees refactor in D:\develop\projects\ChronoWeave.

First read:
- AGENTS.md
- ai-docs/plans/six-degrees-refactor-handover.md
- ai-docs/plans/six-degrees-refactor.md, in full

The design interview is complete. The refactor document is the authoritative specification; proceed with implementation rather than restarting planning.

Keep Map Relationships, Expand Timeline, Follow a Figure, biographies, general relationship explanations, provider/settings behavior, and unrelated canvas/history/UI behavior as they are. In particular, preserve existing prompts, relationship semantics, and cache behavior used by those features. Add dedicated Six Degrees tasks and narrow integration points; change only Six Degrees-specific prompt behavior.

Work through the plan's seven implementation stages. Capture a reproducible old-engine baseline before replacing it. Implement the search engine, shared knowledge and identity handling, membership-safe fresh-start migration, resumable lifecycle, dedicated explanations, and live network overlay exactly within the agreed scope.

Read all user decisions from the plan, including the wartime-opposition exception, AI-only production assessments, cross-model reuse, and explicit resume rules. Treat operational defaults as tunable implementation parameters; preserve the user-selected behavior.

Preserve existing staged changes and newer user work. Use the existing provider adapters and supported providers. Resolve routine code questions by exploring the repository. Keep progress and actual validation outcomes recorded without rewriting settled product decisions.

Run meaningful tests, the full bun test suite, npm run typecheck, npm run build, and the plan's T3 collaborative-preview workflows. Evaluate the priority pairs and compare discovery success with the old engine using the plan's contact-accuracy rubric. Clearly distinguish real historical/model evaluation from mocked mechanics tests.

If live benchmarking is blocked by unavailable credentials or external state, record the missing evidence and preserve a repeatable comparison harness while continuing independent implementation work. Do not claim that the discovery-success goal has been verified without the required comparison.

Carry the implementation and appropriate verification through completion. Report what changed, test/browser outcomes, measured discovery results, and any remaining material limitations.
```
