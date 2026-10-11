# ChronoWeave: Next-Gen Canvas Generation Plan

## 1. Executive Summary & Rationale
Currently, ChronoWeave generates timelines based strictly on century boundaries. To align with how users naturally study history, we are introducing conceptual and semantic timeline generation powered by our LLM backends (Gemini, OpenRouter, Ollama). 

To avoid "blank page syndrome" where a user isn't sure what the app is capable of, we are introducing a highly guided, card-based "Weave Launcher." This launcher abstracts away the complexity of calculating historical years and elegantly manages the UI filters dynamically. 

## 2. UI / UX Application & Layout

### 2.1 Triggering the Launcher
*   **Header Re-design:** The permanent Start Year and End Year input fields in the application header will be removed. 
*   **Launch Action:** They will be replaced by a single, prominent `[🪄 Weave New Canvas]` button (styled appropriately for the main header). 
*   **Empty State:** If the app loads with no cached timeline, the Weave Launcher should be open by default in the center of the screen to guide the user immediately.

### 2.2 The Glassmorphism UI
*   **Visual Style:** The Weave Launcher will appear as a full-screen, blurry glassmorphism overlay. This perfectly matches the design language currently used in the "Relationship Map" modal.
*   **State Preservation:** The existing canvas timeline remains fully visible in the background beneath the blur. The old canvas will *only* be replaced once the new requested canvas is successfully generated and fully loaded, ensuring the user is never left looking at an empty screen during load times.

### 2.3 The 6-Card Grid
The core of the launcher is a beautifully spaced grid of 6 Strategy Cards. Each card includes a title, a short description, and 3-5 concrete examples to spark inspiration.

1.  📅 **Strict Time Span**
    *   *Description:* Explore a specific century or span of years.
    *   *Examples:* 1800 - 1900 | 14th Century | 500 BC - 0 AD
2.  🏛️ **Historical Era**
    *   *Description:* Dive into a defined historical period, civilization, or dynasty.
    *   *Examples:* The Renaissance | The Edo Period | The Bronze Age Collapse | The Ming Dynasty
3.  👤 **Follow a Figure (Seed Generation)**
    *   *Description:* Map a timeline centered around a single person's life and their contemporaries.
    *   *Examples:* Cleopatra | Leonardo da Vinci | Albert Einstein | Genghis Khan
4.  🌍 **Region & Culture**
    *   *Description:* Focus the timeline heavily on a specific geography of the world.
    *   *Examples:* Ancient Egypt | Pre-colonial America | The Ottoman Empire | Feudal Japan
5.  🧬 **Theme or Discipline**
    *   *Description:* Trace the evolution of a specific field, discipline, or idea.
    *   *Examples:* History of Aviation | Women in Science | Evolutionary Biology | Renaissance Art
6.  ✨ **Freeform / Custom**
    *   *Description:* Combine properties for a highly customized weaving experience.
    *   *Examples:* Scientific breakthroughs during the Ottoman Empire | Female rulers before 1500 | Industrial Revolution Inventors

### 2.4 Interaction: Focus Mode (Option A Transition)
When a user clicks one of the cards, we use a "Focus Transition" to maintain a clean UI:
1.  **Fading out:** The other 5 cards in the grid immediately fade out (opacity transition).
2.  **Centering:** The selected card animates to slide into the absolute center of the screen.
3.  **Revealing the Input:** The card expands downwards to reveal a large, prominent text input field (or two number fields in the case of the "Strict Time Span" card).
4.  **Action Buttons:** A `[Begin Weaving]` primary button appears, alongside a `[Back/Cancel]` button to return to the 6-card grid.

### 2.5 The "Surprise Me" Module
This is a distinctive feature located *below* the 6-card grid to trigger spontaneous historical discovery.
*   **Iconography:** Uses a 🎲 Dice Icon to signify randomness.
*   **The Flow:**
    1.  User clicks the dice button.
    2.  An inline loading spinner appears with the text: *"Consulting the archives..."*
    3.  A fast request goes to the AI to pick an interesting niche history subject.
    4.  The UI updates to show the selected topic: *"Weaving: The Golden Age of Piracy (1650 - 1730)"*
    5.  The UI *does not* start building yet. Instead, two action buttons appear: **[ ▶ Build Timeline ]** (to commit to the generation) or **[ ↻ Spin Again ]** (to fetch a different random topic).

---

## 3. Architecture & Data Flow

### 3.1 The "Pre-Flight" Validation AI Check
Before we can run the heavy generation loops required for a ChronoWeave canvas, we must convert the user's natural language into hard canvas bounds and validate the prompt.
*   **When it fires:** Immediately after the user types their prompt (e.g., "Ancient Egypt") and clicks `[Begin Weaving]`.
*   **The Payload:** The AI is sent a generic validation prompt combined with the `Card Type` the user selected, giving the model context on how to interpret the text.

### 3.2 Pre-Flight JSON Structure
The prompt requires the AI to return a strict JSON object with this exact shape:
```json
{
  "isValid": true,
  "errorMessage": null,
  "inferredStartYear": -3100,
  "inferredEndYear": -30,
  "themeDescription": "History of Ancient Egypt",
  "activeCategories": ["ALL"] 
}
```
*   **Model Compatibility:** Since some Ollama models do not reliably adhere to strict schemas, we will utilize the codebase's existing fallback architecture. Functions in `ollamaService.ts` and `geminiService.ts` already use regex to strip Markdown JSON fences and safely `JSON.parse` with internal retry logic.

### 3.3 Dynamic Filter Enforcement (`activeCategories`)
The `activeCategories` field allows the AI to tell the UI if certain categories are irrelevant.
*   **Behavior:** If the user generated "Women in Science", the AI will return `["SCIENTISTS"]`. The UI will then automatically disable/hide the toggles in the Legend for Writers, Leaders, Entertainers, etc. This cleans up the sidebar footprint and prevents the system from querying for disciplines that shouldn't exist in the context.
*   **Default:** Returns `["ALL"]` for broad eras where any category applies.

### 3.4 Handling Rejections & Errors
*   **Behavior:** If the AI determines the prompt is nonsense (e.g., user types "Pizza"), it returns `"isValid": false` and a descriptive, friendly `"errorMessage"`.
*   **UI Layout:** This error message must be rendered directly *below* the active text input field on the glassmorphism overlay in red or warning text. We strictly avoid jarring popup alerts, keeping the user in their focused state so they can easily edit their text.

---

## 4. Canvas Mathematics (Bounds Calculation)
Because the Canvas layout engine needs explicit start and end markers to draw horizontal grid lines and properly calculate x-axis pixel offsets, we must pad the AI's returned years to prevent dots from squishing against the edges of the screen.

**The Math Algorithm:**
1.  **Duration:** Calculate total time span (`inferredEndYear` - `inferredStartYear`).
2.  **10% Padding:** Multiply `duration * 0.10` to get the pad amount.
3.  **Apply Padding:** 
    *   Subtract padding from Start Year.
    *   Add padding to End Year.
4.  **Divisible by 10 Rounding (Outwards):** Extend the padded numbers *outwards* to the nearest integer cleanly divisible by 10.

**Mathematical Examples:**
*   **Example A (Ming Dynasty):** 
    *   AI returns: `1368` to `1644`
    *   Duration: `276` years.
    *   10% = `27.6`.
    *   Padded: Start `1340.4`, End `1671.6`.
    *   *Rounded Outwards to 10:* Final Canvas Bounds = **1340 to 1680**.
*   **Example B (Cleopatra):** 
    *   AI returns: `-69` to `-30`.
    *   Duration: `39` years.
    *   10% = `3.9`.
    *   Padded: Start `-72.9`, End `-26.1`.
    *   *Rounded Outwards to 10:* Final Canvas Bounds = **-80 to -20**.

---

## 5. Required Implementation Steps
When implementation begins, these are the target changes and files:

1.  **React UI Components:** 
    *   Create `WeaveLauncherOverlay.tsx` (the blurred full-screen mode).
    *   Update Header application bar to replace century inputs with the launch button.
    *   Create nested card components and the Option A transition logic.
    *   Create the "Surprise Me" sub-component.
2.  **AI Prompts & Services:**
    *   In `src/services/prompts.ts`, define the new `PRE_FLIGHT_PROMPT`, including instructions on how to parse the Card Type and user query.
    *   Update `geminiService.ts` and `ollamaService.ts` to include a new API method: `validateWeaveQuery()`.
3.  **Internal State (App.tsx / Context):**
    *   Update timeline configuration state to accept and store the dynamic `activeCategories` constraint limit.
    *   Implement the bounding box padding/rounding math in a utility function.
    *   Hook up the Legend/Sidebar toggles to honor the `activeCategories` limitations.