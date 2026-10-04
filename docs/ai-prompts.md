# AI prompts and configuration

Edit task wording in [`src/services/prompts.ts`](../src/services/prompts.ts). Gemini, OpenRouter, and Ollama use the same builders for timeline people, events, discovery, relationship tracing, relationship explanations, and deep dives. The historian system instruction, connection check, and Ollama correction instruction also live here.

Edit counts, word limits, chunking rules, minimum event duration, and deep-dive section titles in [`src/constants.ts`](../src/constants.ts). These are code settings, not runtime Settings dialog options.

## Generation targets

| Setting | Default | Application |
| --- | ---: | --- |
| `HISTORICAL_FIGURES_COUNT` | 60 | Whole-range people for ranges of 200 years or less |
| `HISTORICAL_EVENTS_COUNT` | 30 | Whole-range events, always requested |
| `HISTORICAL_FIGURES_PER_CENTURY_CHUNK` | 20 | People per chunk for longer ranges |
| `HISTORICAL_EVENTS_PER_CENTURY_CHUNK` | 5 | Events per chunk for longer ranges |
| `TIMELINE_CHUNKING_THRESHOLD_YEARS` | 200 | Chunk only when the range exceeds this duration |
| `TIMELINE_CHUNK_YEARS` | 100 | Chunk length; a final partial chunk uses the same target |
| `DISCOVERY_FIGURES_COUNT` | 5 | Maximum new people per discovery |

For 1500–1600, requests target 60 people and up to 30 events. The per-century settings do not apply to this range. Counts are targets rather than enforced sizes: models can return fewer, date and duration filtering can remove entries, and deduplication can reduce totals. No automatic top-up requests are made.

## Historical selection

Accuracy takes priority over filling counts. People must have lives overlapping the range; significant activity within the period takes precedence over incidental overlap. Prompts seek breadth across regions and categories without rigid quotas, request canonical names, and retain full lifespan/event dates. Commonly accepted approximate dates are allowed with uncertainty noted in the description; entries without defensible dates should be omitted.

Events must last at least `MIN_EVENT_DURATION` years, measured as end minus start. Prompts discourage stretching short events and redundant umbrella/subevent coverage. Discovery and tracing require a concrete interaction, work, or role connecting the exact pair. Documented influence across generations qualifies when the recipient specifically engaged with the other's work; broad influence on an era or intellectual climate does not. Person-event links require an identifiable role in that particular event. Prompts check identity and regnal numbers, prefer abstention to uncertain matches, and use the same evidence standard for selection and explanation. Explanations distinguish contact from documented influence and avoid speculative filler or unsupported claims that no historical records exist.

Deep dives share the configured summary limit and section titles across providers. People use Early Life, Major Achievements, Key Relationships, and Historical Legacy. Events use Background, Main Developments, Key Participants, and Historical Impact. Quotations must be reliably attributable to the person; otherwise `famousQuote` is empty. Event quotations are empty.

## JSON and provider handling

Every task prompt describes its fields, types, and JSON response shape. Gemini additionally sends its existing API response schemas. OpenRouter parses model-generated JSON. Ollama requests JSON through instructions, validates the result, and allows one corrective retry; it does not send a `format` option.

Mapping and discovery propose connections rather than immediately admitting them to the canvas. Each proposed pair receives a separate explanation/assessment with `isRelevant` and `evidence` fields. Only an explicit positive verdict with nonempty concrete evidence is accepted. Rejected discoveries are not added as figures. Explicit verdicts accept minor JSON representation differences, and missing narrative sections are derived from supplied evidence rather than blocking the verdict. Missing verdicts and evidence-free positives receive one correction attempt. A persistently malformed candidate is skipped without discarding accepted candidates or caching a rejection. If no candidates pass and some could not be assessed, the action reports a readable error. Transport and authentication failures still stop the action. This is an additional model assessment, not independent source verification, so a fabricated positive verdict remains possible.

Assessment results are cached per pair under `chrono_assessment_*`, scoped to both historical identities. Both positive and negative verdicts are reused. An unassessed candidate adds one explanation request; an accepted verdict is also reused by the explanation dialog, avoiding a second contradictory generation.

[Ollama documents schema support for downloaded local models but currently excludes cloud inference](https://docs.ollama.com/capabilities/structured-outputs). Cloud models accessed through a local Ollama server still perform inference in the cloud. Adding local schema enforcement is deferred; it is not needed to share task prompts.

## Cached data and verification

Existing timelines, biographies, relationship maps, and explanations are not globally cleared. When mapping or expanding, legacy relationship IDs are assessed before display; a stored ID or discovery description alone is not evidence. Unsupported IDs are excluded from the refreshed map, while already-added figures remain on the timeline. Explanation dialogs prefer the assessed explanation over an older unassessed narrative. Biography caches retain their existing behavior.

Run `npm test`, `npm run typecheck`, and `npm run build` to check provider wiring, JSON handling, and compatibility. Tests use mocked model responses; they do not establish real-model historical accuracy or count completeness. Assess those using fresh generations over repeated runs, checking relevance, factual dates, duplicates, and geographic/category coverage as well as counts.
