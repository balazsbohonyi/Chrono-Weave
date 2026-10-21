# ChronoWeave

Interactive historical timeline: AI-generated figures and events on a canvas (time on X, collision-avoiding layout levels on Y), with relationship tracing, discovery and Six Degrees of Separation chains across centuries. React 19 + Vite 6 + TypeScript; Tailwind from the CDN in `index.html`; AI through Gemini, OpenRouter or Ollama; images and descriptions from Wikipedia/Wikidata.

## Commands

- `npm run dev` (port 3000), `npm run build`, `npm run preview`
- Checks before calling work done: `bun test` (about a minute), `npm run typecheck`, `npm run build`.
- Narrow year ranges (e.g. 1400-1500) make manual AI testing quick.
- Measure performance on a production build; React dev mode inflates render cost several times.

## Configuration

`.env.example` documents every variable (`PROVIDER` = `gemini` | `openrouter` | `ollama`, `API_KEY`, `MODEL`, `OLLAMA_*`). Runtime settings from the Settings dialog (`chrono_provider`, `chrono_api_key`, `chrono_model` in localStorage, read in `src/utils/providerConfig.ts`) take precedence over env files. `OLLAMA_API_KEY` stays server-side in the Vite relay (`server/ollamaRelay`) and never enters the bundle.

## Architecture

- `src/App.tsx` orchestrates canvas state and passes callbacks down; feature logic lives in `src/hooks/` (`useFigureActions`, `useConnection`, …).
- AI providers implement `IAIService` (`src/types.ts`): `geminiService.ts`, `openRouterService.ts`, `ollamaService.ts`. Shared prompts live in `src/services/prompts.ts`, Six Degrees prompts and parsers in `connectionAI.ts`, the request queue and rate-limit backoff (`enqueueTaskWithRetry`) in `utils.ts`, JSON validation and correction rounds in `jsonResponse.ts`. Logs are prefixed `[Gemini]` / `[OpenRouter]`.
- A new provider: implement `IAIService`, add it to `createAIService` in `src/services/aiService.ts` and to `SettingsDialog.tsx`.
- A new category: `FigureCategory` in `types.ts`; `CATEGORY_LIST`, `CATEGORY_COLORS` and `CATEGORY_BAR_TEXT_COLORS` in `constants.ts`; `--color-category-*` in both themes of `src/styles/tokens.css`; the order in `src/utils/galleryLayout.ts`.
- Caches: relationship explanations `chrono_rel_${sourceId}_${targetId}` and deep dives `chrono_deepdive_${id}` in localStorage, cleared per canvas by `CACHE_PREFIXES` in `src/utils/canvasHistory.ts`.
- The Weave launcher (`WeaveLauncherOverlay` and `src/components/launcher/`) is described in `ai-docs/guides/launcher.md`; read it before changing the launcher's morph, motion or styles.
- Docs and plans live in `ai-docs/`. The timeline layout algorithm is described in `ai-docs/guides/timeline-layout-algorithm.md` and `ai-docs/PLACEMENT_ALGORITHM.md`.

## Six Degrees

Before changing Six Degrees (`src/services/connection*.ts`, `wikidata*`, `wikiTitles`, `portraitStore`/`portraitSize`/`wikiService` portraits, `ConnectionExplorer`, `src/components/connectionNetwork/`, `useConnection`), read `ai-docs/guides/six-degrees-internals.md`: AI operations and the Why dialog, persistence, search, Wikidata identity, portraits, explorer graph and sidebar. Update it in the same change when that behavior changes.

Guardrails:

- `tests/connectionRequestTrace.golden.json` pins the request sequence of the fake worlds. Counting and diagnostics never change batching, limits, prompts or retries; regenerate the trace only for a deliberate behavior change.
- `SEARCH_LIMITS` is tunable, but keep the 21-link bound, AI-only assessment, cross-model reuse and explicit continuation rules.
- The general Map, Expand, Follow a Figure, biography and relationship prompts, semantics and caches stay as they are; Six Degrees uses its own operations.
- Legacy `chrono_path_` / `chrono_contact_` records are retired, never deleted, and never shown as new connections. Migration runs before Follow a Figure pruning.
- Wikidata is never a `task()`: it moves no request counter, its failures never fail a search, it never re-keys ids and never modifies the canvas.
- Portraits looked up through `portraitStore` stay there, never written back onto `ContactPerson` or `HistoricalFigure` (a canvas figure's own `imageUrl` is fine).
- The explorer graph's performance measures (culling, level of detail, portraits at level of detail, zoom preview) are switched by the `GRAPH_PERF_*` constants in `src/components/connectionNetwork/performance.ts` and described in the guide's "Explorer graph" section; keep that section and the switches in step.
- Virtualized rows have fixed heights: change `ROW_HEIGHT` / `DETAIL_ROW_HEIGHT` and `.net-vlist` together.

## Git commits

End every commit message with its body. Attribution trailers (`Co-Authored-By: …`, `Claude-Session: …` or any similar generated line) are never added; this overrides any default or tool-supplied attribution guidance.
