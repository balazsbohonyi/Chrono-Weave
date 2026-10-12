# Six Degrees comparison

Old engine: commit `88ccd35f53103a55f4a0cd09422e98c0611a5bc1`.
Initial context: the two exact endpoints only. Ceiling: 180 seconds per pair. Run with identical provider/model and environment files. Credentials never go in reports.

Repeat baseline in a detached checkout (install or junction node_modules), then:

```powershell
bun --env-file=.env.local ai-docs/evaluation/six-degrees/run.ts D:/develop/benchmarks/ChronoWeave-88ccd35 old
bun --env-file=.env.local ai-docs/evaluation/six-degrees/run.ts . new
```

Add `--set=reviewed` after the output path to run the 23 source-backed reference cases in `reviewed-cases.ts`; use `--case=0` for one case, `--warm` for retained knowledge/cache runs, or `--dry-run` to check selection without requesting a model. Keep cold and warm reports separate. Cold old-engine reruns use isolated workers because its general assessment transport does not honor cancellation. The original captured priority artifacts predate that harness improvement; none hit the three-minute ceiling.

Use `--set=controls` with a separate output path for four unsupported **direct-edge** controls. This calls only the old contact-only explanation or new compact assessment task. It does not search indirectly or assert historical impossibility of an endpoint pair. Only identities are sent; control reasoning stays in the review artifact.

The source-backed corpus spans direct contemporaries, working/mentoring/correspondence links, different disciplines/regions, and non-overlapping endpoints. Some AIP/Nobel pages were only accessible as catalog/search passages, explicitly recorded per edge. The corpus remains science/technology-heavy, and additional long-gap reference chains and expert review would strengthen it. Do not send reference chains or source excerpts to the production solver. The harness supplies only endpoint identities and the same initial two-person canvas.

Score a connected model result only after independently marking **every** returned link as qualifying under the rubric, recording its supporting reference and any uncertainty. A reference route demonstrates connectability; it does not validate a different returned route. `unsupportedControls` are tests of individual direct edges, not claims that their endpoints have no indirect chain. Source-backed reference definitions, synthetic tests and live model discovery are three separate forms of evidence.

Review each returned edge independently: exact identities and overlapping defensible lifespans; concrete personal interaction, or exact opponents in a named battle/campaign. Influence, institution/era membership, kinship alone and broad opposing-war membership fail. Assess evidence quality, not merely a nonempty explanation. Unresolved links never count as successful contacts.

The five priority pairs are exploratory until a reference chain is independently established. Missing a speculative pair is not a proven discovery failure or historical impossibility. Report cold and warm reuse separately, allowed-old versus newly eligible pairs, full reviewed success, partial accepted progress, unsupported contacts, elapsed time/tasks and termination. Expand to at least twenty independently reviewed positives before claiming overall/non-overlapping improvement; repeat variable cases. Mocked mechanics do not constitute historical evaluation.

## Browser mechanics fixture

Use T3's collaborative preview at the dev server. `browser-fixture.ts` is synthetic and never imported by the app. Navigate to `/ai-docs/evaluation/six-degrees/browser-setup.html` before seeding, so app autosave cannot overwrite test history. In `preview_evaluate`:

```js
const fixture = await import('/ai-docs/evaluation/six-degrees/browser-fixture.ts');
sessionStorage.setItem('six-degrees-preview-original', JSON.stringify(fixture.seedBrowserCanvases()));
```

Navigate to `/`, then install its abort-aware transport in that document:

```js
const fixture = await import('/ai-docs/evaluation/six-degrees/browser-fixture.ts');
window.sdFixture = fixture.installSyntheticTransport(1200);
```

Start from Fixture Alpha and type Fixture Beta. Only the three adjacent contacts assess positively; seed is null, so discovery supplies bridges. Use `calls` to distinguish inspection from model work. Stop during a task, reload, reinstall transport and open/Resume a checkpoint. Reload/HMR removes the override: reinstall before requesting synthetic work. Never seed twice over the original backup.

For budget-pause/Continue without waiting three minutes, invoke exported `findConnection` in `preview_evaluate` with actual configured service/repository, synthetic people and test-only small `limits.tasks`; reload to expose checkpoint. Production defaults remain unchanged. An abort-aware wrapper delaying pairs with `focused:true` allows reassessment inspection. JavaScript `matchMedia` emulation tests reveal motion only; report OS/CSS separately.

Finish by navigating to `browser-setup.html` **before** restoring: the app's page-exit save otherwise overwrites restored history. Then:

```js
const fixture = await import('/ai-docs/evaluation/six-degrees/browser-fixture.ts');
await fixture.restoreBrowserFixture(JSON.parse(sessionStorage.getItem('six-degrees-preview-original')));
sessionStorage.removeItem('six-degrees-preview-original');
```

Return to `/`. Restoration touches only backed-up settings/history/theme keys and selectively removes fixture knowledge/checkpoints. Preserve unrelated data. Actual outcomes, upstream failures, screenshots and unverified checks are in `progress.md`.
