# Layout Alternatives Brainstorm (Canvas Edge Cases)

**Context:** Following the implementation of the "Weave Launcher" and semantic prompt generation, a layout issue arises with highly constrained, contemporaneous prompts. When historical figures fall within compressed time spans (or when text widths outpace chronological spread), the traditional horizontal timeline bars stack heavily on the Y-axis. This results in a congested, highly vertical canvas (a "staircase" effect).

## The Adopted Solution: The Card Board (Masonry / Gallery Layout)
To prevent extreme vertical scrolling, the application will feature a secondary rendering mode that abandons chronological X-axis plotting in favor of structural organization. 

*   **How it works:** The traditional time axis (years horizontally) disappears, zooming is locked (fixed scale), and the background grid axes are hidden. Figures are displayed as uniform-sized structural cards. 
*   **The Layout Pattern:** A multi-level horizontal spread utilizing an organic, staggering offset to prevent the UI from looking like a rigid, boring spreadsheet.
*   **Organic Staggering:** Instead of aligning cards in perfect vertical columns, adjacent rows are mathematically offset (e.g., Row 2 begins indented by half a card width). Furthermore, rows can feature alternating densities (e.g., a "3-4-3-4" or "4-5-4" card pattern) mimicking the dynamic feel of the existing Relationship Mapper overlay.
*   **Handling Color/Discipline:** 
    1.  **Card Header/Border:** A thick colored strip at the top of the card (or glowing border) matching the category hue.
    2.  **Badges:** A colored pill/badge stating the category (e.g., "Artist").
    3.  **Grouped Tiers:** Card placement prioritizes grouping similar disciplines into general "zones" on the Y-axis to maintain visual logic.

#### Visualizing the Organically Staggered Gallery (ASCII Representation)
This illustrates the fixed-scale environment with chronological placement disabled. Note the visual offset between tiers, creating a more dynamic, "honeycomb" or masonry aesthetic rather than a rigid grid.

```text
[ Canvas Viewport ] (Zoom Disabled, Axes Hidden)

  Tier 1 [ Writers / Thinkers ]
  [ Card ]      [ Card ]      [ Card ]      [ Card ]      [ Card ]
  Machiavelli   Castiglione   Erasmus       More          Ficino
  
    Tier 2 [ Scientists / Artists ]
      [ Card ]      [ Card ]      [ Card ]      [ Card ]      [ Card ]   
      Botticelli    Bramante      Da Vinci      Copernicus    Vesalius
                              
  Tier 3 [ Leaders / Explorers ]
  [ Card ]      [ Card ]      [ Card ]      [ Card ]      [ Card ] 
  Borgia        Sforza        Columbus      Vespucci      Julius II
```
*UX Detail Note: If a specific "Seed Figure" was queried, their card receives a distinctive visual highlight (e.g., a glowing border). Otherwise, all cards hold equal weight. Panning seamlessly scrolls the layout horizontally.*

## Architectural Implementation: The Viewport Density Check Algorithm
A critical realization is that a timeline's density cannot be determined by the AI *prior* to generation, nor can it be reliably judged purely by chronological years (since text widths dictate how many figures fit physically side-by-side).

Therefore, the layout mode (Timeline vs. Gallery) is determined dynamically by the frontend **after data is fetched, but before rendering**.

### The Flow:
1.  **Data Fetch:** The backend returns the array of `HistoricalFigure[]`.
2.  **The Rendering Dry-Run:** The Layout Engine conducts a headless simulation of plotting the Timeline bars, utilizing the user's current viewport width and standard text-bounding calculations.
3.  **The Collision Metric:** The engine returns the `Max Vertical Lanes` required to render the dataset without any text/bar overlaps.
4.  **The Threshold Switch:**
    *   If `calculatedLanes <= THRESHOLD` (e.g., 6 lanes): Proceed with the classic **Timeline Layout**.
    *   If `calculatedLanes > THRESHOLD`: Abort Timeline layout and instantiate the **Gallery Card Layout**.

**Benefits of this Algorithm:**
*   **Resolution Adaptability:** An ultrawide monitor might safely render an 8-lane timeline, while a 13-inch laptop triggers the Gallery layout for the exact same dataset.
*   **Prompt Agnostic:** This engine gracefully handles *any* card from the Weave Launcher. A "Regional" prompt that happens to be highly compressed will switch to Gallery just as seamlessly as a "Seed Figure" prompt.