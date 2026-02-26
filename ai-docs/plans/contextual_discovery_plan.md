# Contextual Discovery & Injection Plan

## Overview
This feature enables a "Rabbit Hole" mode where users can discover and inject new historical figures related to an existing figure on the canvas. This transforms the timeline from a static dataset into an endless exploration graph.

## 1. User Interface (The Action Bar)

### Behavior
*   **Trigger:** Hovering over a historical figure bar.
*   **Delay Mechanism:** The Action Bar will not appear immediately. It will have a **500ms - 800ms delay** to prevent UI clutter during rapid mouse movement. If the mouse leaves the bar before the timer fires, the action bar is cancelled.
*   **Position:** Floating slightly above or to the right of the hovered bar.
*   **Style:** Matches the `ControlPanel` aesthetic:
    *   `bg-white/50` (semi-transparent)
    *   `backdrop-blur-md` (glassmorphism)
    *   `rounded-xl`
    *   `shadow-lg`
*   **Controls:**
    *   **Primary Action:** "Discover Related Figures" (Icon: Network/Branching Node).
    *   **Future Extensibility:** Slot for Wiki links or Chat icons.

### Feedback States
*   **Loading:** When clicked, the icon transforms into a spinner.
*   **Progress:** A small progress indicator (or text label) appears within or attached to the Action Bar indicating "Analyzing Connections..." then "Tracing...".

## 2. Data & AI Logic

### Service Method: `discoverRelatedFigures`
*   **Input:** 
    *   Target Figure (Source)
    *   List of ALL current figure names (to avoid duplicates).
*   **Prompt Strategy:**
    *   "Find 5 historical figures active between [Start] and [End] who had direct interaction/relation with [Source]."
    *   "Exclude: [List of existing names]."
    *   **Constraint:** Must fit within the current timeline's global start/end years (to ensure visibility).
*   **Execution:** Single API call. No retries for "not enough results" to save latency.

## 3. State Management & Injection

### Data Flow
1.  User triggers action.
2.  App enters `isDiscovering` state.
3.  New figures are fetched.
4.  **Injection:** New figures are appended to the main `figures` array.
5.  **Tracking:** IDs of new figures are added to a `newlyDiscoveredIds` set.
    *   *Persistence:* These highlights remain until the timeline is fully rebuilt (via the main "Build" button in the top left).
6.  **Auto-Trace:** Immediately after injection, `handleTraceRelationships` is triggered for the *Source Figure* to visually connect the old node to the new nodes.

### Feedback (Toast)
*   **Component:** A new temporary notification component (`Toast`) appears at the bottom center.
*   **Content:** 
    *   Success: "Found 5 new figures: [Name 1], [Name 2]..."
    *   Failure: "No new significant connections found in this time period."

## 4. Layout & Animation

### Positioning Strategy
*   **Algorithm:** We continue to use the "Tetris" packing algorithm to ensure no overlaps. 
*   **Proximity:** Since the new figures are contemporaries (overlapping years), the sorting algorithm will naturally place them in a similar horizontal region. Vertical proximity is handled by the packing engine filling the first available slots.
*   **Shifting:** Existing bars may shift vertically to accommodate the new entries.

### Animation
*   **Technique:** CSS Transitions.
*   **Implementation:** The timeline bars will have `transition-all duration-500 ease-in-out` applied to their `top` and `left` properties.
*   **Effect:** When the layout recalculates, old bars will glide to their new rows, and new bars will fade in/slide into place.

## 5. Detailed Step-by-Step Implementation Plan

1.  **Create `Toast` Component:** Simple notification system.
2.  **Update `TimelineCanvas`:**
    *   Add hover delay logic (`setTimeout`/`clearTimeout`).
    *   Render the `ActionBar` overlay.
    *   Add CSS transitions to figure bars.
3.  **Update `geminiService`:** Add `discoverRelatedFigures` function.
4.  **Update `App.tsx`:**
    *   Handle the discovery flow.
    *   Manage `newlyDiscoveredIds` state.
    *   Trigger the Toast.
    *   Chain the `traceRelationships` call after injection.

## 6. Future Considerations
*   **Force-Directed Layout:** If the "Tetris" layout separates related figures too much, we may need a hybrid layout engine in the future that prioritizes Y-axis proximity for related clusters.
