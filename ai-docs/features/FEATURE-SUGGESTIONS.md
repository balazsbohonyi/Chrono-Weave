# ChronoWeave Feature Suggestions

Here is a brainstorming list of features that would elevate **ChronoWeave** from a visualization tool to a fully immersive historical research platform.

### 1. **Semantic Filtering & Color Coding**
Currently, all bars are green. We could parse the `occupation` field (or ask Gemini to return a `category` enum) to assign distinct colors to different types of figures.
*   **Feature:** Add a legend/filter UI (e.g., "Rulers" = Purple, "Artists" = Orange, "Scientists" = Blue).
*   **Interaction:** Users can toggle these categories on/off to see the density of specific disciplines over time.

### 2. **The "Context Layer" (Historical Events)**
History doesn't happen in a vacuum. We could add a specific "Events" lane at the bottom or top of the timeline.
*   **Feature:** While fetching people, also fetch major historical events (wars, treaties, inventions, pandemics) for the same range.
*   **Visual:** Display these as vertical markers or spans (e.g., "The Renaissance" as a background shade, "Battle of Waterloo" as a flag pin) to see who lived through what events.

### 3. **"Chat with History" (Persona Mode)**
Since we are already using Gemini, we can make the sidebar interactive.
*   **Feature:** When a user selects a specific figure (e.g., Leonardo da Vinci), add a "Chat" input in the sidebar.
*   **Implementation:** Initialize a chat session with a system prompt like: *"You are Leonardo da Vinci. Answer questions using the knowledge available up to your death year (1519)."*

### 4. **Relationship Mapping (The "Who Knew Who?" Button)**
*   **Feature:** When selecting a figure, highlight other figures on the timeline who:
    *   Were contemporaries (already visible via vertical line).
    *   **New:** Were likely to have met, influenced, or fought with the selected person (calculated via AI).
*   **Visual:** Draw bezier curves connecting the selected card in the sidebar to the bars of related figures on the timeline.

### 5. **The "Era Zeitgeist" Summary**
*   **Feature:** When a user zooms into a specific 50-year block, generate a dynamic "Era Summary" card floating in the corner.
*   **Content:** "The late 1400s in this dataset is dominated by Italian Artists and Explorers, characterized by the discovery of the New World and the height of the Florentine Renaissance."

### 6. **Compare Mode**
*   **Feature:** Allow the user to `Ctrl + Click` two different figures.
*   **Action:** The sidebar changes to a "Comparison View," asking Gemini to analyze:
    *   Did they overlap?
    *   How did their philosophies differ?
    *   Who had a larger impact on modern society?

### 7. **Search & "Jump To" Navigation**
*   **Feature:** A search bar to find specific names.
*   **Interaction:** Typing "Napoleon" instantly pans and zooms the camera to center his bar and opens his details pane.

### 8. **Procedural Backgrounds (Atmosphere)**
*   **Visual:** Change the background style based on the century being viewed.
    *   1300-1500: Parchment texture, old map aesthetics.
    *   1700-1800: Neoclassical crisp lines or revolutionary grit.
    *   1900+: Modernist, cleaner lines, perhaps blueprint style.

### 9. **Export as Infographic**
*   **Feature:** A button to rasterize the current view (including the sidebar info) into a high-res PNG or PDF. This makes the tool useful for teachers or students creating presentations.

### 10. **Contextual Discovery (Rabbit Hole Mode)**
*   **Feature:** A dynamic discovery tool to expand the timeline organically.
*   **Interaction:** Hovering over a figure reveals an Action Bar (after a short delay). Clicking "Discover" fetches 5 new historical figures who were related to or interacted with the source figure and injects them into the canvas.
*   **Behavior:**
    *   Intelligent "Tetris" layout that shifts existing bars to accommodate new ones.
    *   Visual highlighting of newly discovered figures.
    *   Automatic relationship tracing between the source and the new figures.
    *   Toast notifications summarizing the discovery results.
