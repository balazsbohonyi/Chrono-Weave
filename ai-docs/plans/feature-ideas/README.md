# Wow-factor features

Seven features that add story, motion, play, parallel exploration, and historical material to an explored canvas. Each has its own plan.

| Plan | Summary | AI work | Effort |
| --- | --- | --- | --- |
| [Time-Lapse playback](time-lapse.md) | Sweep the selected year across the canvas; bars light up and fade as lives begin and end | Optional ticker only | S–M |
| [Guided Story Tour](story-tour.md) | AI-written narrated tour; the camera flies between figures with captions | 1 new method | M–L |
| [Six Degrees](six-degrees.md) | Connect two people (up to ~400 years apart) through a verified chain of personal contacts | 2 new methods + existing verification | L |
| [Dinner Party / Persona Chat](persona-chat.md) | Chat with a figure, or seat several at a table to debate | 1 new method | M |
| [Who Am I? quiz](who-am-i-quiz.md) | Clue-by-clue riddles answered by clicking the right bar | 1 new method | M |
| [Meanwhile: parallel histories](meanwhile.md) | Compare two saved canvases on a shared time axis, with optional AI comparisons | 1 optional explanation method; companion generation later | M–L |
| [Explore their work](explore-their-work.md) | Inspect sourced artworks, documents, inventions, and other historical objects | 1 optional explanation method + source retrieval | M–L + editorial work |

Suggested order: Time-Lapse, then Story Tour (reuses the playback transport and the camera animation), then Six Degrees. Persona Chat and the quiz are independent. If Six Degrees is built first, it builds the animated camera foundation itself (its step 0).

The two exploration plans are independent of that sequence and of the playback/animated-camera foundations. Between them, build **Meanwhile** first to reuse canvas history, then **Explore their work** for richer visual and sourced learning. Their first versions do not add or replace timeline figures: Meanwhile reads two snapshots, and museum objects use a separate model. Each plan specifies its own cache ownership and modal lifecycle.

## Shared foundations

Several plans depend on the same building blocks. Build each once, in the first plan that needs it.

1. **Animated camera** (`src/utils/canvasCamera.ts`). Today `TimelineCanvas` jumps the camera to a search result (`setViewState` in the auto-zoom effect). Add a `flyCamera(from, to, durationMs, onFrame, signal)` tween with ease-in-out and a zoom-out-then-in arc for long distances. Extract the figure-to-world-bounds calculation from the auto-zoom effect into a pure helper reusable for both layouts (`timeline`, `gallery`). Respect `prefers-reduced-motion` by jumping. Any user pan/zoom/wheel cancels the flight. Used by Time-Lapse (follow mode), Story Tour, and Six Degrees.
   **Built with Six Degrees.** It now exists: `flyCamera`, `cameraAt` (the ease-in-out, zoom-out-then-in arc), `fitCameraToBounds` and `unionBounds` live in `src/utils/canvasCamera.ts`; `timelineFigureBounds` (`timelineLayout.ts`) and `galleryCardBounds` (`galleryLayout.ts`) measure a figure in each layout; and `useConnectionReveal` (`src/hooks/useConnectionReveal.ts`) runs a camera sequence for either canvas, including skip, cancel on pan/zoom/wheel, and reduced motion. Time-Lapse follow mode and Story Tour should reuse these rather than add their own.
2. **Playback transport** (`src/components/PlaybackBar.tsx`). A bottom-centred bar with play/pause, step back/forward, speed, a progress scrubber, and close. Keyboard: Space toggles, ←/→ step, Escape closes. Used by Time-Lapse and Story Tour.
3. **New AI tasks.** Each feature adds one `IAIService` method. Follow the existing pattern:
   - prompt builder in `src/services/prompts.ts`, using `HISTORIAN_SYSTEM_PROMPT`, `READER_STYLE`, `YEAR_RULES`, and `JSON_ONLY`;
   - a provider-neutral parser/validator beside the prompt (as in `weaveService.ts`), run through `generateValidatedJson` so every provider gets one corrective retry;
   - a new `JsonTask` value with a Gemini response schema; OpenRouter and Ollama use plain JSON;
   - implement in `geminiService.ts`, `openRouterService.ts`, and `ollamaService.ts`, and add the methods to any test doubles.
4. **Canvas-scoped caches.** New cache prefixes (`chrono_tour_`, `chrono_path_`, `chrono_quiz_`, `chrono_persona_`, `chrono_compare_`, `chrono_objects_`, `chrono_object_explanation_`) must be added to `isCanvasCacheKey` in `src/utils/canvasHistory.ts` so they are saved with, restored with, and evicted with their canvas. Comparison results belong to the primary canvas and fingerprint both inputs; museum caches store bounded metadata and text, not image bytes.
5. **Grounding rule.** The AI can only reference figures by ID from a supplied catalog of the current canvas (`{id, name, birthYear, deathYear, category, occupation}`). Parsers drop unknown IDs, except where the referenced figures form an ordered chain: Six Degrees rejects a whole path proposal containing an unknown ID (triggering the corrective retry), because dropping a node would silently break the chain. Meanwhile supplies two catalogs and uses canvas-qualified references; Explore their work additionally supplies reviewed object/source records and validates their source references. In the first versions, only Six Degrees may add timeline figures, and only after relationship verification. Meanwhile's later companion generation creates a separate saved canvas through the existing build pipeline.
6. **Busy/modal rules.** Each mode is mutually exclusive with the others and with launching, history switching, discovery, and mapping. Switching canvases (`CanvasHistory`) or opening the launcher stops the active mode and aborts its requests, matching how `buildController`/`traceController` work today.

Run `bun test`, `npm run typecheck`, and `npm run build` after each plan, and update the README's Key Features section.
