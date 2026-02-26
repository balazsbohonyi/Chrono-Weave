# Plan: OpenRouter Service Integration

## Executive Summary
The goal is to introduce an agnostic AI layer to **ChronoWeave**, allowing the application to switch between the Google Gemini API and the OpenRouter API (which supports models like Claude 3.5, Llama 3, etc.).

To support this without hardcoding sensitive keys, we will implement a **Settings Dialog** that allows users to select their provider and input their OpenRouter credentials if needed.

## Architecture Overview

We will move from a direct dependency on `geminiService` to an **Adapter Pattern**:

1.  **`IAIService` (Interface):** Defines the contract for all AI operations (fetching figures, relationships, etc.).
2.  **`WikiService` (Shared):** Handles Wikipedia image and detail fetching (decoupled from AI logic).
3.  **`GeminiService` (Adapter):** Implements `IAIService` using `@google/genai`.
4.  **`OpenRouterService` (Adapter):** Implements `IAIService` using standard `fetch` calls to OpenRouter.
5.  **Service Initialization:** `App.tsx` will instantiate the correct service based on `localStorage` settings.

## Step-by-Step Implementation Plan

### Phase 1: Cleanup & Extraction
*Current Issue:* `geminiService.ts` contains Wikipedia fetching logic and generic rate-limiting utilities.
1.  **Extract `services/utils.ts`:** Move `enqueueTask`, `wait`, and `runWithRetry` here.
2.  **Extract `services/wikiService.ts`:** Move `fetchBatchWikipediaImages` and `fetchBatchFigureDetails` here.
    *   *Note:* `fetchBatchFigureDetails` will orchestrate calling the AI service for descriptions and WikiService for images.

### Phase 2: Interface Definition
Define the contract in `types.ts`:
```typescript
export interface IAIService {
  fetchHistoricalFigures(start: number, end: number): Promise<HistoricalFigure[]>;
  fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[]): Promise<string[]>;
  discoverRelatedFigures(target: HistoricalFigure, existingNames: string[], start: number, end: number): Promise<HistoricalFigure[]>;
  fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure): Promise<RelationshipExplanation | null>;
  fetchFigureDeepDive(figure: HistoricalFigure): Promise<DeepDiveData | null>;
}
```

### Phase 3: The Settings UI
Create `components/SettingsDialog.tsx` and update `components/ControlPanel.tsx`.

*   **Entry Point:** Add a "Gear" icon to the end of the `ControlPanel` toolbar.
*   **Dialog Fields:**
    1.  **Provider:** Dropdown (`Google Gemini`, `Open Router`).
    2.  **API Key:** Input (`type="password"`).
    3.  **Model ID:** Input (`type="text"`).
*   **Behavior:**
    *   **Google Gemini Selected:**
        *   API Key field: **Disabled** (App uses the internal `process.env.API_KEY`).
        *   Model ID field: **Disabled** (App uses hardcoded Gemini models).
    *   **Open Router Selected:**
        *   API Key field: **Enabled** (User must provide key).
        *   Model ID field: **Enabled** (User must provide model ID, e.g., `anthropic/claude-3-opus`).
*   **Persistence:**
    *   On "Save", settings are written to `localStorage`.
    *   On Page Load, the app reads these settings. If no provider is found, default to `Google Gemini`.

### Phase 4: Service Implementation
1.  **`services/geminiService.ts`:** Refactor to implement `IAIService`. It continues to use `process.env.API_KEY` and handles `gemini-2.5-flash`.
2.  **`services/openRouterService.ts`:** Create new service implementing `IAIService`.
    *   **Endpoint:** `https://openrouter.ai/api/v1/chat/completions`
    *   **Headers:** `Authorization: Bearer <USER_KEY>`, `HTTP-Referer`, `X-Title`.
    *   **JSON Handling:** Since OpenRouter models often return Markdown (e.g., ```json ... ```), implement robust parsing to extract JSON from the response.

### Phase 5: Integration
*   **`App.tsx`:**
    *   Add state/logic to read `localStorage` on mount.
    *   Initialize `aiService` (typed as `IAIService`) based on the provider setting.
    *   Pass `aiService` down to `Sidebar`, `ControlPanel`, etc., or use it directly in `App` effects.

## Storage Keys
*   `chrono_provider`: `gemini` | `openrouter`
*   `chrono_openrouter_key`: string
*   `chrono_openrouter_model`: string