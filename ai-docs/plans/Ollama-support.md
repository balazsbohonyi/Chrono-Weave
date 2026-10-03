# Plan: Ollama Provider Integration

Date: 2026-10-03

Status: Implemented on `feat/ollama-support`; subsequent feedback is recorded below.

The original plan and the cloud amendment are reproduced verbatim below. Later decisions in the implementation feedback section supersede conflicting original behavior.

## Original agreed plan

The agreed scope is **Ollama through your local server**, supporting local models and cloud models through your signed-in Ollama account.

Example configuration:

```dotenv
PROVIDER=ollama
MODEL=gpt-oss:20b-cloud
OLLAMA_BASE_URL=http://localhost:11434
```

No API key is required for this connection.

The implementation plan:

1. **Add `OllamaService`** implementing all six `IAIService` methods: timeline generation, tracing, discovery, relationship explanations, biographies, and connection testing. Use Ollama’s native `/api/chat` endpoint.

2. **Extend configuration handling** to recognize Ollama and its server URL. Keep dialog settings above environment defaults, allow keyless Ollama settings, and remember settings separately for each provider. Migrate existing saved settings.

3. **Update the Settings dialog** with an Ollama provider option, editable server URL, model suggestions loaded from `/api/tags`, Refresh, manual model entry, and Test Connection. Show the actual effective configuration.

4. **Preserve your chosen behavior:**
   - Automatically generate the initial timeline when no timeline is cached.
   - Keep the displayed timeline when settings change.
   - Allow Build to regenerate the same year range.
   - Continue sharing cached biographies and explanations across models.

5. **Handle generation reliably.** Keep century batches—21 generation requests for 600–1600 before retries—with limited concurrency and request timeouts. Request and validate JSON; allow one corrective retry for unusable output. Ollama Cloud currently lacks enforced structured outputs. [Ollama docs](https://docs.ollama.com/capabilities/structured-outputs)

6. **Preserve data on failure.** Commit a replacement timeline only after generation succeeds. Show actionable errors for connection failures, missing models, cloud authentication, rate limits, and invalid responses. Prevent requests from an earlier configuration from overwriting newer results.

7. **Verify and document.** Test keyless configuration, settings migration, provider switching, model listing, response validation, and failure preservation. Run TypeScript/build checks and exercise the dialog and AI features against your local server. Update `.env.example` and README.

The interview decisions are settled. No application files have been changed yet.

## Direct Ollama Cloud amendment

The plan now includes **both local Ollama and direct Ollama Cloud**.

- **Dialog:** Add Local server / Ollama Cloud mode selection. Remember each mode’s model settings separately and load suggestions from its model catalog.
- **Reasoning (updated 2026-10-04):** Default Ollama reasoning off, with an opt-in Settings checkbox and `OLLAMA_REASONING` environment configuration. Persist per mode. GPT-OSS uses low/medium effort for off/on because it cannot disable reasoning completely. Forward the same settings through either connection path.
- **Authentication (updated 2026-10-04):** Local mode remains keyless. Cloud mode requires an API key, saved in the dialog's provider profile in localStorage like Gemini/OpenRouter keys, or supplied through server-side `.env`. This supersedes the original session-only decision.
- **Connection:** Add a small local server relay for cloud requests, supporting development and locally served production builds. It sends the required Bearer authorization header and keeps environment credentials out of the frontend bundle. [Ollama authentication docs](https://docs.ollama.com/api/authentication)

Proposed cloud configuration:

```dotenv
PROVIDER=ollama
OLLAMA_MODE=cloud
MODEL=gemma4:31b
OLLAMA_API_KEY=your_ollama_api_key
```

Local configuration remains:

```dotenv
PROVIDER=ollama
OLLAMA_MODE=local
MODEL=gpt-oss:20b-cloud
OLLAMA_BASE_URL=http://localhost:11434
```

All earlier decisions remain: automatic initial generation, century batches, shared answer caches, explicit Build after settings changes, and preservation of the current timeline on failure.

This updates the plan; implementation hasn’t started.

## Implementation feedback — 2026-10-03

- Page load restores a cached timeline or waits for **Weave History**. It no longer generates a timeline automatically when the cache is empty.
- Model selection uses a catalog dropdown with refresh and manual entry. GPT-OSS requests use low reasoning effort.
- The cloud relay runs inside the Vite development and preview servers; it has no separate startup command.
- Events shorter than three years are filtered out of both generated and cached timelines without date validation errors or changing dates. Empty event batches are allowed; reversed dates still require correction.
- **Map Relationships** caches connected figure IDs for the source and the current timeline figures, alongside the existing explanation and biography caches. Closing dialogs, clearing curves and reloading reuse the map. Changes to timeline figures require a fresh map.
- An empty map automatically invokes **Expand Timeline** within the current range. If expansion finds nothing, show a message with no floating source card or curves. Remember the completed empty expansion for that source and canvas; explicit **Expand Timeline** can retry. Successful discovery caches its connections against the expanded timeline.
- Failed or superseded mapping and expansion requests do not commit empty cache results or stale timeline changes.

Local setup, cloud-through-local and direct-cloud examples, cache behavior and troubleshooting are documented in [the Ollama guide](../../docs/ollama.md). Verification evidence is tracked in [ISA.md](../../ISA.md).

## Relationship mapping correction — 2026-10-04

- Known pairs are reusable from either figure, including existing cache entries and reloads. Completed searches still cover one canvas; adding or removing unrelated figures keeps unchanged known pairs while allowing a new search for remaining candidates.
- Cached curves are displayed immediately. A failed request for additional connections preserves them and does not mark the search complete. If all candidate connections are already known, no model request is needed.
- Ollama receives short candidate references instead of internal timeline IDs. The service translates references and unambiguous names to actual candidate IDs, removes self references and retains valid links when other entries are unknown. Unknown-only or malformed results receive specific correction feedback and remain errors if correction fails.
- Relationship explanations are reused in either direction, with source and target details swapped for the current dialog.
- Relationship and biography dialogs render Markdown in model-generated text, including existing cached responses. Formatting supports emphasis, lists, links, quotations, tables and code; embedded raw HTML is ignored and unsafe link schemes are rejected.
