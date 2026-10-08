# Layout Alternatives Brainstorm (Canvas Edge Cases)

**Context:** Following the implementation of the "Weave Launcher" and semantic prompt generation, a layout issue arises with highly constrained, contemporaneous prompts (like "Follow a Figure"). When all historical figures fall within the exact same 60-100 year span, the traditional horizontal timeline bars stack heavily on the Y-axis, resulting in a congested, highly vertical canvas.

The following alternatives were brainstormed to handle highly compressed, contemporaneous timeline structures:

## Concept 1: The "Constellation" Network Layout (Force-Directed Graph)
*Note: Deprioritized due to visual clutter from too many connection lines.*

If the prompt is inherently about a **Seed Figure** (where the AI's primary job is mapping contemporaries around a central person), we abandon the strict timeline grid entirely and adopt a network graph, much like a solar system.

*   **How it works:** The Seed Figure is a large node in the exact center of the canvas. Their contemporaries float around them in a physics-based, force-directed graph (using something like `d3-force` or even just a calculated radial layout on the canvas).
*   **Color Coding:** Instead of long timeline bars, each figure is represented as a circular node (or a card). The node/card borders or backgrounds use the existing category color coding (e.g., scientists are blue, artists are green).
*   **Connections:** The AI-generated relationships are explicitly drawn as lines connecting the satellite figures to the Seed figure, or even to each other.
*   **Why it works:** It visually reinforces the *concept* of the prompt (Influence & Relationships) rather than the strict chronological dates, which are less important when everyone lived in the exact same 50-year period.

## Concept 2: The Card Board (Masonry / Flex Layout)
*Status: Primary Solution for contemporaneous prompts ("Seed Figure").*

This aligns with using the existing Relationship Cards. We essentially turn the canvas into a "Gallery" or "Board" of people for that era.

*   **How it works:** The traditional time axis (years horizontally) disappears, zooming is locked (fixed scale), and the background grid axes are hidden. Figures are displayed as uniform-sized structural cards. 
*   **The Layout Pattern:** A strict, multi-level horizontal spread. The Seed Figure is large and prominently anchored in the center (or far left). Contemporaries are placed strictly horizontally across predefined vertical tiers (lanes). The engine distributes cards evenly left-to-right to maintain a horizontal aspect ratio.
*   **Handling Color/Discipline:** 
    1.  **Card Header/Border:** A thick colored strip at the top of the card or around the border.
    2.  **Badges:** A colored pill/badge in the corner of the card explicitly stating the category (e.g., a green badge saying "Artist").
    3.  **Grouped Tiers:** We can assign specific vertical tiers to specific categories to create visual organization without relying on a chronological X-axis.

#### Visualizing the Tiered Horizontal Spread (ASCII Representation)
This illustrates a fixed-scale environment where chronological X/Y placement is disabled in favor of a strictly horizontal, multi-tier layout.

```text
[ Canvas Viewport ] (Zoom Disabled, Axes Hidden)

  Tier 1 [ Thinkers/Writers ]
  [ Card ]      [ Card ]      [ Card ]      [ Card ]      [ Card ]
  Machiavelli   Castiglione   Erasmus       More          Pacioli
  
  Tier 2 [ Artists/Scientists ] (Featuring the Seed Figure)
  [ Card ]      [ Card ]      +---------------------+     [ Card ]      [ Card ]
  Botticelli    Bramante      |  ⭐️ SEED FIGURE ⭐️  |     Copernicus    Vesalius
                              |  Leonardo Da Vinci  |
                              +---------------------+ 
  Tier 3 [ Leaders/Explorers ]
  [ Card ]      [ Card ]      [ Card ]      [ Card ]      [ Card ]      [ Card ]
  Borgia        Sforza        Columbus      Vespucci      Medici        Julius II
```
*Note: Because this is rendered on the HTML5 canvas, mouse panning still allows the user to slide the board horizontally to view items overflowing the viewport.*

## Concept 3: The "Zoomed Timeline" with Granular Grid (The Horizontal Solution)
If we want to keep the existing bar layout, the issue might not be the layout itself, but the *scale*.

*   **How it works:** Currently, the timeline might draw vertical columns for every 10 years or 50 years. When the total time bound is small (e.g., a 60-year lifespan), the engine needs to dynamically change the scale.
*   **The Fix:** The timeline grid switches its tick marks. Instead of demarcating every 50 years, it draws a subtle vertical line for *every single year*, with major ticks every 5 years. 
*   **The Layout Algorithm:** Ensure the layout engine aggressively packs bars on the Y-axis. If two people lived at the same time but don't overlap, they should share a horizontal lane. 
*   **The Caveat:** In an era where *everyone* overlaps heavily (e.g., Contemporaries of Leonardo da Vinci, where almost everyone lived through the exact same 1480-1510 period), the placement algorithm cannot place them on the same horizontal line. They *must* stack on the Y-axis to prevent bars from rendering on top of each other. Therefore, even with zooming, this layout will inevitably remain highly vertical.

## Concept 4: The "Spiderweb" or "Relative Swimlane" Timeline
If we keep the timeline layout, we alter its orientation and absolute values.

*   **How it works:** The central Seed Figure gets a massive, highlighted "Swimlane" right through the vertical center of the screen. Other figures are plotted above and below them.
*   **Relative Timeline:** Instead of the X-axis being absolute "Years" (1452, 1453...), the X-axis becomes the "Age of the Seed Figure" (e.g., -10 years before their birth, Year 0, Year 10...). This anchors everyone's lifespan *relative* to the person the user cares about.
*   **The Caveat:** Similar to Concept 3, because the contemporaries chronologically overlap with the Seed Figure (and with each other), the layout engine must push them into separate vertical lanes. The resulting visualization will still be very tall/vertical, emphasizing why purely chronological plotting struggles with highly dense, contemporary groups.

## UI Data Architecture Implication (Pre-Flight Updates)
If we adopt adaptive multi-layouts (like swapping between Timeline and Network structures), the "Pre-Flight Validation JSON" schema from the Weave Launcher should append a new directive:

```json
{
  "layoutStrategy": "TIMELINE" // Alternatively: "GALLERY"
}
```
*   **Logic Example:** The AI evaluates "The Roman Empire" (spans 500 years) and assigns `"TIMELINE"`. 
*   **Logic Example:** The AI evaluates "Leonardo da Vinci" (spans 67 years, focus on one seed figure) and assigns `"GALLERY"`. 
*   This grants the frontend absolute clarity on which rendering engine to initialize based on the prompt's historical shape.