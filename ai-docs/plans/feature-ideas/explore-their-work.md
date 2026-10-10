# Explore their work: a historical museum inside the canvas

Open a person's works or an event's surviving material instead of stopping at a biography. A painting, manuscript page, scientific diagram, invention, building, photograph, or document becomes a large inspectable object with a date, attribution, source, and a short explanation of why it matters. Selecting it shows where it belongs in the subject's history.

Status: Proposed. Start with a small curated collection of supported subjects; broader source discovery and visual annotations are later phases.

## Behavior

- **Entry.** Add "Explore their work" for supported people and "Explore historical material" for supported events in the shared `useFigureActions` policy, so timeline, gallery, and sidebar actions agree. This read-only action is available for any supported member of a Follow a Figure canvas, not just its focus. A biography/details dialog also offers the entry point.
- **Initial coverage.** Publish a bundled catalog covering 6–10 recognizable subjects and 3–5 objects per subject where reliable material exists. A Leonardo collection might contain artworks and notebook pages; a scientific figure might have an original diagram and an instrument; an event might have a document and a contemporary depiction. These are collection examples to research, not preapproved source records. Unsupported subjects show a clear "No collection available yet" message in the biography; do not display a broken action or invent filler.
- **Collection view.** A full-screen overlay retains the current modal aesthetic. The subject's compact card stays in the header, with a short collection introduction and a thumbnail grid beneath it. Cards show object title, date label, and object kind. Opening an object expands it into a viewer; returning restores the collection's scroll and selection.
- **Object viewer.** Show a large image with zoom, pan, Fit, keyboard zoom buttons, a persistent source link and credit, and a short factual caption. A side panel contains "What you are looking at", "Why it mattered", and optional "Look closer" observations. On narrow screens, place the explanation beneath the image. Load high-resolution imagery only after selection and keep the controls available if the image fails.
- **Time context.** A compact subject timeline inside the viewer places the object at its recorded date or date range. A "Show on canvas" control closes the viewer and focuses the subject; on a timeline layout it also reveals the object's year when it falls within the canvas subject interval. Preserve the user's zoom. For a gallery canvas, reveal the subject card without silently switching layouts. An object outside the canvas interval or the subject's lifespan is labelled honestly, for example as a later depiction or reproduction.
- **Connections.** Offer contextual chips for entries already on the canvas, such as a documented collaborator, patron, or participant. Only show a specific object-related role when an editorial record or retrieved source supports it. A broader "Also on this canvas" suggestion must be labelled as context; it cannot be presented as a documented relationship or written into relationship assessments.
- **Loading and failure.** Thumbnails appear independently; one failed image does not block the collection. Source captions remain useful without AI. AI explanation failure keeps the object and source visible with Retry. A missing/withdrawn source or unusable attribution removes that object from eligible results; do not substitute an AI-created image as historical material.
- **Dismissal.** Escape closes the topmost nested view first, returning from object to collection and collection to the invoking biography or canvas. Restore focus and scroll appropriately. Opening history or the launcher aborts work and closes the feature. Apply existing light/dark tokens and reduced-motion preferences.

## Historical and source rules

An object's association with a person/event, its date, the physical object's age, and the image's provenance are different facts. Keep them separate. Distinguish an original/contemporary record from a later depiction, a modern photograph of an old object, a replica, and a disputed attribution. Dates can be approximate, ranges, or unknown; never derive a precise year just to place a marker.

Every published object needs a stable source identifier, an object/document page, a retrievable image record where permitted, attribution/credit, a clear reuse status, and editorial evidence for its association with the subject. A successful HTTP request proves availability, not historical relevance. Use source metadata and explicit editorial review for the initial catalog, rather than an LLM's confidence or an AI-selected URL.

Use public-domain or explicitly reusable images whose required credit can be displayed. Preserve creator, holding institution, license name/link, and image credit where provided. Do not infer rights from an object's historical age or from its presence in an image search. This is a source eligibility rule for the collection, not a new user approval step.

Object dates are visual markers, not `HistoricalFigure` event records. The existing minimum three-year event duration must not cause single-date works to disappear or tempt generation of stretched event dates. Keep museum objects in their own model and cache; no new figure category or timeline-generation prompt change is needed.

## Data and source retrieval

Add types for `HistoricalObject`, `ObjectSource`, `ObjectDate`, and `ObjectExplanation`:
- `HistoricalObject`: stable source-qualified ID, title, kind, creator, subject association and its evidence, date, historical-material classification, source records, image variants/dimensions, alt text, and optional editorial observations/context roles.
- `ObjectDate`: display label, optional start/end years, and precision (`exact`, `approximate`, `range`, or `unknown`). Only source-supported numeric bounds enter time placement. Label creation dates separately from later photograph/scan dates.
- `ObjectSource`: canonical object page and image-record page, source ID, compact factual excerpts/metadata, attribution and reuse fields, and retrieval timestamp.
- `ObjectExplanation`: summary and sections, with source IDs referencing only the supplied source records; optional existing canvas entry refs are separately validated.

Create `src/data/historicalObjects.ts` as the initial curated catalog, keyed by canonical subject identity rather than generated canvas figure ID. Match canonical names plus dates and explicit editorial aliases; ambiguous names do not qualify. A partial name match alone cannot select a collection. Keep source record versions so editorial corrections invalidate stale explanations.

`src/services/artifactService.ts` resolves supported subjects and retrieves image metadata on demand through one source adapter, initially targeting Wikimedia Commons records paired with authoritative object/document pages. Catalog entries specify vetted record IDs; the service does not ask a model to guess image URLs. Confirm the chosen source's current official API, anonymous browser access, CORS behavior, attribution fields, and thumbnail limits before implementing its requests. If browser access is unsuitable, ship reviewed metadata with the catalog and use permitted direct image links; do not introduce an arbitrary-URL proxy.

Return usable objects independently and deduplicate by source-qualified ID, not title. Use bounded requests and `AbortSignal`; sanitize source metadata into plain text and allow only expected HTTPS source/image hosts. Interpret fetched descriptions as quoted source data, never as AI instructions or raw HTML to render. Initial implementation has one adapter and an explicit small catalog, not a multi-source scraping framework.

## AI task

`fetchObjectExplanation(figure, object, canvasCatalog, signal)` → `ObjectExplanation`.

Supply the retrieved/editorial source packet: title, dates, attribution, classification, subject association, concise factual excerpts, source IDs, and any recorded observations. Provide up to 10 relevant canvas entries for contextual chips. Make one request only when the user asks for a fuller explanation or opens an uncached object with explanation enabled; do not pre-generate prose for the entire collection.

Prompt guidance:
- Use the shared historian and reader style. Explain the recorded object in accessible language and connect it to supported historical circumstances.
- Treat provided sources as evidence and bound factual claims to them. A thin source packet receives a short explanation or an explicit limit, not invented depth.
- Never invent quotations, exact dates, attribution, relationships, source URLs, or details supposedly visible in the image. This v1 task is text-only; visual observations come from editorial notes or source descriptions and are identified accordingly.
- Return a 2–3 sentence summary and 2–3 sections, about 150–250 words total where material supports it. Attach supplied source IDs to sections. Reader-facing text distinguishes sourced object facts from AI interpretation.

Validate required content and source references. Reject source IDs outside the supplied packet and factual prose with no valid source reference; use one corrective retry through `generateValidatedJson`. Validate optional contextual entry IDs against the input catalog and role claims against the allowed editorial roles; unapproved roles are omitted. These structural checks cannot prove every generated sentence, so retain source access and the "AI explanation" label.

Add one `IAIService` method and an `object-explanation` JSON task with three provider implementations and a Gemini schema. Core collection viewing, editorial captions, source links, and image zoom do not require an AI provider. Dynamic object discovery is not a model method in v1.

## Persistence and lifecycle

- Cache compact collection metadata under `chrono_objects_<catalogVersion>_<subjectIdentity>` and explanations under `chrono_object_explanation_<inputFingerprint>`. Register both prefixes in `isCanvasCacheKey` so snapshots capture and evict their data correctly.
- Explanation fingerprints include the subject identity, object/source IDs and metadata version, relevant canvas catalog, and narrative version. Revalidate records on restoration; refreshed source facts invalidate associated prose.
- Cache at most 5 objects per subject in v1 and bound retained source excerpts and explanation lengths. Store metadata, URLs, and text only; never store images, data URLs, or full source documents in localStorage. High-resolution image data lives only in the browser/network cache.
- The open overlay, object zoom, collection scroll, and current object are transient. Closing and reopening within a session may retain them in memory; reload restores a closed canvas as it does today.
- Capture canvas cache ownership and request/session identity at invocation. Closing, switching canvases, changing subject, or opening the launcher aborts source/AI work and prevents late UI updates or cross-canvas writes. Completed metadata may be reused across providers; changing a model does not clear sourced objects.
- Show cached material when source retrieval is unavailable, with its retrieval date and a readable refresh error. Cached image URLs do not guarantee offline image availability. An explicit Refresh retries source metadata, not the timeline build.

## Implementation

1. Research and editorially validate the initial 6–10 subject collections. Capture source IDs, association evidence, dates, classification, image reuse metadata, captions, and stable image records; publish only complete eligible records.
2. Object/source/date types, `src/data/historicalObjects.ts`, identity matching, source validation, and the single-adapter `artifactService.ts`. Keep this independent of existing Wikipedia portrait enrichment.
3. `src/hooks/useHistoricalObjects.ts`: catalog eligibility, lazy retrieval, explanation requests, scoped caches, partial failures, refresh, and cancellation.
4. `HistoricalObjectCollection.tsx`, `HistoricalObjectViewer.tsx`, and a compact object date strip. Reuse pointer/zoom math where useful, `MarkdownContent` for explanatory prose, and `useModalFocus` for the active view.
5. Wire an optional object action through `useFigureActions`, `ActionBar`, `SidebarCardActions`, `CanvasProps`, both canvas renderers, and biography/event details. Preserve Follow a Figure action restrictions for unrelated mutation actions.
6. Object explanation prompt/parser, `JsonTask: 'object-explanation'`, all provider methods and test doubles, cache prefix support, and App lifecycle integration.
7. Update the application README with supported coverage, sourced-material behavior, and the distinction between catalog facts and AI explanation when implemented.

## Acceptance checks

- Supported subjects show only correctly associated, eligible objects. Similar names, missing records, unknown rights, and unreviewed associations cannot produce misleading collections.
- Original material, later depictions, photographs, replicas, disputed attribution, approximate dates, and unknown dates display distinct honest labels. Unknown dates do not become zero-year markers; exact-date objects are not filtered by minimum event duration.
- All displayed images have accessible source links and required credits. Image failure retains the caption and source; one failure does not discard other objects. Thumbnails do not trigger high-resolution downloads before selection.
- Source captions work without an AI connection. Explanation generation rejects unknown source IDs and invented role references, retries once for malformed output, and never changes figures, assessments, or history ordering.
- Timeline/gallery/sidebar entries agree, including nonfocus figures in Follow a Figure mode. Showing an object on the canvas uses a representable date only and does not change saved category/layout choices.
- Source refresh and editorial version changes invalidate stale explanations; bounded metadata survives history save/restore without storing image bytes. Cancellation cannot attach a previous subject's response to a new subject or canvas.
- Verify focus, nested Escape/back navigation, credits, image zoom/pan and reset, mobile layout, light/dark themes, and reduced motion manually. Test catalog identity/eligibility, date normalization, source/parser validation, partial failure, scoped caching, and cancellation; run `bun test`, `npm run typecheck`, and `npm run build` during implementation.

## Later phases and effort

M–L for the curated collection, viewer, and optional AI explanations, plus ongoing editorial work. After proving the interaction, add source-backed search for more subjects, multiple adapters only when needed, and optional "Look closer" hotspots whose normalized image coordinates and descriptions are authored or reviewed against the actual image. Dynamic retrieval needs its own relevance/date/attribution gate before results appear. Do not accept model-proposed URLs as reviewed records.

World maps, 3D reconstructions, AI-generated historical imagery, automatic canvas expansion, user uploads, and image-coordinate generation are outside v1. The key dependency to resolve before coding retrieval is a viable first source and a complete example collection; the viewer and source-caption experience can be prototyped with those reviewed records before AI is added.
