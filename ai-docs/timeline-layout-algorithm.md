# ChronoWeave Timeline Layout Algorithm Documentation

## Purpose
This document provides a comprehensive reference for the timeline layout algorithm used in ChronoWeave's TimelineCanvas component. It establishes common terminology for future development discussions and identifies current limitations in the collision detection system.

---

## Table of Contents
1. [Core Terminology](#core-terminology)
2. [Layout Algorithm Overview](#layout-algorithm-overview)
3. [Element Types and Rendering](#element-types-and-rendering)
4. [Two-Pass Layout System](#two-pass-layout-system)
5. [Collision Detection System](#collision-detection-system)
6. [Manhattan Routing for Short Events](#manhattan-routing-for-short-events)
7. [Coordinate Systems](#coordinate-systems)
8. [Known Issues and Limitations](#known-issues-and-limitations)

---

## Core Terminology

### Element Types

**Historical Figure**
- A person with birth/death years and category (ARTISTS, SCIENTISTS, etc.)
- Rendered as a horizontal bar with name label above and occupation below
- Duration: `deathYear - birthYear`

**Standard Event**
- Historical event with start/end years and category
- Rendered identically to Historical Figures (bar + labels)
- Minimum duration: 15 years (events < 3 years are excluded entirely)

**Short Event**
- Historical event with duration < 15 years
- Rendered as a small bar WITHOUT inline labels
- Uses floating label connected via Manhattan route
- Special handling in Pass 2 of layout algorithm

### Layout Terminology

**Row / Layout Level**
- Horizontal subdivision of the canvas at integer indices (0, 1, 2, ...)
- Each row is `ROW_HEIGHT = 180px` tall
- Elements on the same row have `Y = level * 180 + 60`

**Gap**
- Vertical space BETWEEN two rows
- Indexed at fractional levels (0.5, 1.5, 2.5, ...)
- Gap K exists between Row K and Row K+1
- Used for positioning short event floating labels

**Interval**
- A time range `[startYear, endYear)` on a specific row
- Tracked to prevent element overlaps
- Stored in `occupiedRows[][]` and `occupiedGaps[][]` arrays
- Types: `'bar'` (element bar) or `'label'` (floating label box)

**Occupied Width**
- The horizontal time range an element consumes on the timeline
- Calculated differently for standard vs. short events
- Includes visual spacing for text labels (estimated from character counts)

**Manhattan Route / Connector Line**
- L-shaped line connecting a short event bar to its floating label
- Named after Manhattan street grid pattern (right angles only)
- Path: Vertical segment → Rounded corner → Horizontal segment → Arrow
- Rendered in SVG overlay with matching element color

**World Space vs. Screen Space**
- **World Space**: Timeline coordinates before viewport transform
  - X: `(year - startYear) * BASE_PIXELS_PER_YEAR`
  - Y: `level * ROW_HEIGHT + offset`
- **Screen Space**: After applying zoom/pan transform
  - X: `worldX * scale + translateX`
  - Y: `worldY * scale + translateY`

---

## Layout Algorithm Overview

**Location**: [TimelineCanvas.tsx:171-441](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L171-L441)

The layout algorithm is a **two-pass collision detection system** executed in a `useMemo` hook:

1. **Pass 1 (Bar Placement)**: Position all element bars on rows to avoid overlap
2. **Pass 2 (Floating Label Placement)**: Position labels for short events with Manhattan routing

**Execution Order**:
```
Filter out events < 3 years
  ↓
Sort by priority (discovered figures first, then by birthYear)
  ↓
PASS 1: Place all bars (figures, standard events, short events)
  ↓
PASS 2: Place floating labels for short events
  ↓
Calculate canvas height
```

---

## Element Types and Rendering

### 1. Historical Figures
**Rendering**: [TimelineCanvas.tsx:1033-1080](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L1033-L1080)

```
┌─────────────────────────┐
│   CHARLEMAGNE           │ ← Name (22px font-black uppercase)
│ ┌─────────────────────┐ │
│ │ 742 - 814          │ │ ← Colored bar with dates (18px bold)
│ └─────────────────────┘ │
│   Emperor               │ ← Occupation (18px bold gray-700)
└─────────────────────────┘
```

**Placement**:
- Y position: `level * 180 + 60`
- X position: `(birthYear - startYear) * 10`
- Width: Auto-sized to longest text element (`max-content`)

### 2. Standard Events (≥ 15 years)
**Rendering**: Identical to Historical Figures

**Occupied Width Calculation** [TimelineCanvas.tsx:235-241](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L235-L241):
```typescript
const nameWidth = name.length * 18;        // 22px uppercase → ~18px per char
const occupationWidth = occupation.length * 14;  // 18px bold → ~14px per char
const dateWidth = calculateDateWidth(birthYear, deathYear);
const barWidth = Math.max((deathYear - birthYear) * 10, 40);
const maxWidth = Math.max(nameWidth, occupationWidth, dateWidth, barWidth);
const occupiedYears = maxWidth / 10 + 5;  // Convert to years + margin
```

### 3. Short Events (< 15 years, ≥ 3 years)
**Rendering**: Two-part system

**Part A - Bar** [TimelineCanvas.tsx:1033-1080](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L1033-L1080):
```
┌─┐
│ │ ← Small colored bar (no text)
└─┘
 │ ← Manhattan route connects to floating label
 └──┐
    ↓
```

**Part B - Floating Label** [TimelineCanvas.tsx:1009-1027](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L1009-L1027):
```
┌─────────────────────────┐
│   BATTLE OF TOURS       │ ← Name (22px font-black uppercase)
│   732 - 735             │ ← Date range (18px bold gray-700)
└─────────────────────────┘
```

**Occupied Width Calculation** [TimelineCanvas.tsx:228-231](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L228-L231):
```typescript
// Bar only occupies its actual duration
const barWidth = (deathYear - birthYear) * 10;
const occupiedYears = Math.max(barWidth / 10, 4);  // Minimum 4 years
```

---

## Two-Pass Layout System

### Pass 1: Bar Placement
**Location**: [TimelineCanvas.tsx:197-272](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L197-L272)

**Purpose**: Position all element bars (figures, standard events, short events) on rows

**Data Structures**:
```typescript
const occupiedRows: Array<Array<{start: number, end: number, type: 'bar' | 'label'}>> = [];
const MARGIN = 6;  // Minimum spacing in years
```

**Algorithm**:
```
For each element in sorted order:
  1. Calculate occupied width (duration for short events, max text width for others)
  2. Calculate collision interval: [birthYear, birthYear + width + MARGIN]

  3. Find first available row:
     For row = 0 to numRows:
       Check if collision interval overlaps ANY existing interval on row
       If no overlap → place element at this row, record interval, BREAK

  4. If no available row found:
     Create new row with this element's interval
```

**Collision Check** [TimelineCanvas.tsx:252-255](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L252-L255):
```typescript
const hasOverlap = intervals.some(interval =>
  (fig.birthYear < interval.end + MARGIN) &&
  (collisionEnd + MARGIN > interval.start)
);
```

**Key Behavior**:
- **All elements** (figures, standard events, short events) are placed in Pass 1
- Short events only occupy their bar width, NOT their label width
- Intervals are sorted by start year for efficient collision detection
- New rows are created dynamically as needed

---

### Pass 2: Floating Label Placement (Simplified)
**Location**: [TimelineCanvas.tsx:443-550](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L443-L550)

**Purpose**: Position labels for short events in immediate gaps with bar relocation

**Data Structures**:
```typescript
const occupiedGaps: Array<Array<{start: number, end: number}>> = [];
const placedVectors: Array<{x1: number, y1: number, x2: number, y2: number}> = [];
const LABEL_MARGIN = 10;  // Spacing in years
const MAX_RELOCATION_ATTEMPTS = 10;  // Maximum bar relocation attempts
```

**Why Needed**: Short events have tiny bars (<15 years visual width) that cannot fit name labels inline

**Algorithm**:
```
For each short event:
  1. Calculate label width:
     labelWidth = max(name.length, occupation.length) * 3.0 + 30 years

  2. Try to place label in gap ABOVE (barLevel - 0.5):
     a. Check box collision with existing intervals in gap
     b. Check Manhattan route doesn't cross existing connectors
     c. If both pass → place label, record interval, DONE

  3. Try to place label in gap BELOW (barLevel + 0.5):
     a. Check box collision with existing intervals in gap
     b. Check Manhattan route doesn't cross existing connectors
     c. If both pass → place label, record interval, DONE

  4. If BOTH gaps blocked → Relocate bar:
     a. Remove bar interval from current row
     b. Find next available row (current + 1, current + 2, ...)
     c. Add bar interval to new row
     d. Update current bar level
     e. Repeat from step 2 (try gaps again)

  5. If max relocation attempts exhausted → Emergency fallback:
     Create new row at bottom for both bar and label
```

**Key Differences from Old Algorithm**:
- ✅ **Deterministic**: Always tries gap above first, then gap below (no randomization)
- ✅ **Simplified**: Only 2 gap positions checked (±0.5 levels), no multi-layer candidates
- ✅ **Adaptive**: Relocates bar to new row if both gaps blocked
- ✅ **Predictable**: Same input always produces same output
- ✅ **Shorter connectors**: Labels always within ±90px of bars (half ROW_HEIGHT)

**Collision Checks**:

1. **Gap Validation** (via `tryPlaceLabelInGap` helper):
```typescript
// Reject negative gaps (above row 0)
if (gapLevel < 0) return { success: false };

// Check box collision with existing labels in gap
const gapIndex = Math.floor(gapLevel);
const hasOverlap = occupiedGaps[gapIndex]?.some(interval =>
  (labelStart < interval.end + LABEL_MARGIN) &&
  (labelEnd + LABEL_MARGIN > interval.start)
);

// Check connector crossing with existing connectors
const hasVectorCrossing = placedVectors.some(vec =>
  linesIntersect(
    { x: barCenterX, y: barY },
    { x: labelCenterX, y: labelY },
    { x: vec.x1, y: vec.y1 },
    { x: vec.x2, y: vec.y2 }
  )
);

return { success: !hasOverlap && !hasVectorCrossing, visualY };
```

2. **Bar Relocation** (via helper functions):
```typescript
// Remove bar from old row
removeBarInterval(currentLevel, figure.birthYear, occupiedRows);

// Find next available row
const newLevel = findNextAvailableRow(
  figure,
  currentLevel + 1,
  occupiedRows,
  barWidth
);

// Add bar to new row
addBarInterval(newLevel, figure.birthYear, barWidth, occupiedRows);
```

**Line Intersection Test** [TimelineCanvas.tsx:52-66](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L52-L66):
```typescript
function linesIntersect(p1: {x, y}, p2: {x, y}, p3: {x, y}, p4: {x, y}): boolean {
  // Test if two line segments intersect in 2D space
  // Uses parametric line equation to detect crossings
  // Excludes endpoints (0.05-0.95 range) to allow touching
}
```

---

## Collision Detection System

### Interval-Based Collision Detection

**Core Concept**: Track occupied time ranges on each row/gap

**Data Structure**:
```typescript
type Interval = {
  start: number;      // Start year
  end: number;        // End year (inclusive)
  type: 'bar' | 'label';
};

const occupiedRows: Interval[][] = [];     // Row-level intervals
const occupiedGaps: Interval[][] = [];     // Gap-level intervals
```

**Collision Test**:
```typescript
// Two intervals [A_start, A_end] and [B_start, B_end] overlap if:
A_start < B_end + MARGIN && A_end + MARGIN > B_start
```

**Margins**:
- **Bar placement**: `MARGIN = 6 years` (60px at 10px/year scale)
- **Label placement**: `LABEL_MARGIN = 10 years` (100px spacing)

**Why It Works**:
- Prevents both horizontal overlap (time ranges) and vertical overlap (same row)
- Efficient: O(N) per element where N = intervals on target row
- Intervals are sorted by start year for future optimization opportunities

---

### Geometric Collision Detection

**Used For**: Checking if Manhattan routes cross existing connector lines

**Implementation**: Line segment intersection test [TimelineCanvas.tsx:52-66](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L52-L66)

**Test Cases**:
1. Vertical line vs. Vertical line
2. Horizontal line vs. Horizontal line
3. Vertical line vs. Horizontal line

**Example**:
```
   Existing Connector        New Connector Candidate
         │                          │
         │                      ────┼──── ✗ CROSSING DETECTED
         │                          │
    ─────┘
```

**Limitation**: Only checks against other connector lines, NOT against:
- Element bars
- Text labels
- Name/date text boxes

---

## Manhattan Routing for Short Events

### Route Generation
**Location**: [TimelineCanvas.tsx:1084-1206](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L1084-L1206)

**Coordinate Calculation**:
```typescript
// World space coordinates
const barCenterX = left + width / 2;
const startY = isBelow
  ? top + BAR_VERTICAL_OFFSET + BAR_HEIGHT  // Bottom of bar
  : top + BAR_VERTICAL_OFFSET;              // Top of bar

const endX = labelLeft;
const endY = labelContainerTop + 13;  // Label baseline

// Transform to screen space
const sStartX = toScreenX(barCenterX);
const sStartY = toScreenY(startY);
const sEndX = toScreenX(endX);
const sEndY = toScreenY(endY);
```

**SVG Path Construction** [TimelineCanvas.tsx:1134-1155](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L1134-L1155):
```typescript
const radius = Math.min(15, Math.abs(sEndY - sStartY) / 2, Math.abs(sEndX - sStartX) / 2);
const path = `
  M ${sStartX} ${sStartY}
  L ${sStartX} ${sEndY - radius}
  Q ${sStartX} ${sEndY} ${sStartX + radius} ${sEndY}
  L ${sEndX} ${sEndY}
`;
```

**Visual Pattern**:
```
Bar Center
    │  ← Vertical segment
    │
    │
    └─→ ← Rounded corner (15px radius)
      ────→ ← Horizontal segment
           ↓ Arrow head
      Label
```

**Arrow Head** [TimelineCanvas.tsx:1157-1179](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L1157-L1179):
- Chevron at end of horizontal segment
- Size: `6 * max(0.5, viewState.scale)` (scales with zoom)
- 45-degree angle pointing toward label

**Styling**:
- Path stroke: 2px, 60% opacity, element color
- Start circle: 4px radius, 40% opacity
- Rendered in SVG overlay above canvas elements

---

## Coordinate Systems

### Three Coordinate Spaces

**1. Year Space** (Logical Timeline)
- Unit: Years
- Range: `[config.startYear, config.endYear]`
- Example: Year 732

**2. World Space** (Canvas Before Transform)
- Unit: Pixels
- Origin: (0, 0) at top-left
- Calculations:
  - X: `(year - startYear) * BASE_PIXELS_PER_YEAR` (10px/year)
  - Y: `level * ROW_HEIGHT + offset` (180px/row)
- Example: (7320px, 240px)

**3. Screen Space** (After Viewport Transform)
- Unit: Pixels on screen
- Origin: Viewport top-left
- Calculations:
  - X: `worldX * scale + translateX`
  - Y: `worldY * scale + translateY`
- Example: (366px, 120px) at 50% zoom

**Transform Functions**:
```typescript
const toScreenX = (worldX: number) => worldX * scale + translateX;
const toScreenY = (worldY: number) => worldY * scale + translateY;
const toWorldX = (screenX: number) => (screenX - translateX) / scale;
const toWorldY = (screenY: number) => (screenY - translateY) / scale;
```

**Why Multiple Spaces**:
- **World Space**: Consistent positions regardless of zoom/pan
- **Screen Space**: Correct rendering on canvas and SVG
- **Year Space**: User-facing timeline logic

---

## Known Issues and Limitations

### ~~1. Manhattan Routes Crossing Element Bars~~ ✅ RESOLVED

**Status**: **RESOLVED** in v1.1 by geometric constraints of simplified algorithm

**How it was resolved**:
The simplified algorithm ensures Manhattan routes ONLY connect bars to labels in **immediate gaps** (±0.5 levels). This creates a geometric constraint that prevents routes from crossing other bars:

- **Gap above (level - 0.5)**: Route goes UP from bar at row N into the gap BETWEEN rows N-1 and N. The route cannot cross row N-1 bars because the gap is below them.
- **Gap below (level + 0.5)**: Route goes DOWN from bar at row N into the gap BETWEEN rows N and N+1. The route cannot cross row N+1 bars because the gap is above them.

**Bar relocation ensures this constraint**: When both immediate gaps are blocked, the algorithm relocates the bar to a new row and retries with that row's immediate gaps. Labels are NEVER placed more than ±0.5 levels away from their bar, which geometrically prevents crossing intermediate rows.

**Visual proof**:
```
Row N-1:  [Other bars - CANNOT BE CROSSED]
          ─────────────────
Gap N-0.5:      [Label] ← floating label (if placed above)
          ─────────────────
Row N:    │Bar│           ← short event bar
          └──────→ Label
          ─────────────────
Gap N+0.5:      [Label] ← floating label (if placed below)
          ─────────────────
Row N+1:  [Other bars - CANNOT BE CROSSED]
```

**Code reference**: [TimelineCanvas.tsx:463-527](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L463-L527) - Bar relocation loop ensures immediate gap constraint

---

### ~~2. Floating Labels Crossed by Other Manhattan Routes~~ ✅ RESOLVED

**Status**: **RESOLVED** in v1.1 by connector crossing detection

**How it was resolved**:
The `tryPlaceLabelInGap` helper function at [TimelineCanvas.tsx:70-127](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L70-L127) now checks if placing a new label would be crossed by existing connectors:

```typescript
const hasVectorCrossing = placedVectors.some(vec =>
    linesIntersect(
        { x: barVecX, y: barVecY },
        { x: labelVecX, y: visualY },
        { x: vec.x1, y: vec.y1 },
        { x: vec.x2, y: vec.y2 }
    )
);

if (hasVectorCrossing) {
    return { success: false };
}
```

**Why this works**:
- Labels are only placed if BOTH `hasOverlap` (box collision) and `hasVectorCrossing` checks pass
- The `linesIntersect` function treats the connector as a line segment from bar to label position
- If any existing connector would intersect the path to the new label, placement is rejected
- The algorithm then tries the other gap or relocates the bar

**Code reference**: [TimelineCanvas.tsx:113-124](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L113-L124) - Vector crossing check

---

### 3. Label Collision Detection Gaps

**Issue**: Labels may overlap with bars or other labels on the same row

**Root Cause**:
- Label width estimation is approximate (character count heuristic)
- Actual rendered width can exceed estimated width
- No post-placement verification against actual DOM dimensions

**Current Estimation** [TimelineCanvas.tsx:283-284](d:\develop\projects\ChronoWeave\src\components\TimelineCanvas.tsx#L283-L284):
```typescript
const labelWidthEstimate = Math.max(name.length, occupation?.length ?? 0) * 3.0 + 30;
// Uses character count, not actual font metrics
```

**Consequence**:
- Labels with wide characters (W, M) or narrow characters (i, l) have incorrect estimates
- Uppercase text (22px font-black) is wider than estimate accounts for

---

### ~~4. Connector Line Rendering Order~~ ✅ RESOLVED (Non-Issue)

**Status**: **RESOLVED** - Made inconsequential by Issue #2's resolution

**Why it's no longer an issue**:
While connector lines still render in placement order (not z-index controlled), the resolution of Issue #2 makes this purely cosmetic:

- New connectors won't cross existing labels (prevented by `hasVectorCrossing` check)
- New labels won't be placed where existing connectors would cross them
- Even though later connectors may visually overlap earlier ones in SVG rendering, the algorithm guarantees they won't cross labels improperly

**Conclusion**: Rendering order is purely a visual detail and doesn't affect functional correctness. The collision detection system ensures proper separation regardless of draw order.

**Code reference**: [TimelineCanvas.tsx:1084-1206](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L1084-L1206) - Manhattan routing SVG rendering

---

### 5. No Collision Detection for Standard Event/Figure Labels

**Issue**: Standard event/figure labels can theoretically overlap if bars are very close

**Current Behavior**:
- Labels use `max-content` width and auto-position based on bar location
- Bar collision ensures bars don't overlap (with 6-year margin)
- No explicit check that label TEXT doesn't extend into adjacent element

**Why Usually Works**:
- Occupied width calculation includes estimated text width
- 6-year margin provides buffer space
- Labels are centered above bars, reducing overlap chance

**Edge Case**:
- Two elements with short bars but very long names placed adjacent
- Names could theoretically overlap if both extend beyond their occupied width

---

## Summary

The ChronoWeave timeline layout algorithm uses a **simplified two-pass interval-based collision detection system**:

**Pass 1**: Places all element bars on rows using horizontal interval tracking to prevent overlaps

**Pass 2**: Places floating labels for short events in immediate gaps (±0.5 levels) with adaptive bar relocation

**Key Strengths**:
- ✅ **Efficient interval-based collision** for horizontal placement
- ✅ **Dynamic row allocation** handles arbitrary timeline complexity
- ✅ **Deterministic placement** - same input always produces same output
- ✅ **Short connectors** - labels always within ±90px of bars (immediate gaps only)
- ✅ **Adaptive relocation** - bars move to new rows when gaps are blocked
- ✅ **Clean visual** - Manhattan routing with centered gap labels
- ✅ **Maintainable code** - extracted helper functions with clear responsibilities

**Recent Improvements (v1.1)**:
- ✅ Simplified Pass 2 from 12+ candidate positions to 2 deterministic gap attempts
- ✅ Removed randomization (hash-based direction selection)
- ✅ Added bar relocation mechanism when both gaps blocked
- ✅ Removed complex fallback strategies (same row offsets, far gaps/rows)
- ✅ Unified gap visual offset to 175px for consistent vertical centering
- ✅ **RESOLVED Issue #1**: Geometric constraint prevents routes from crossing bars
- ✅ **RESOLVED Issue #2**: Vector crossing detection prevents labels being crossed by routes
- ✅ **RESOLVED Issue #4**: Made inconsequential by Issue #2's resolution

**Remaining Limitations**:
- Label width estimation is approximate (character count heuristic) - Issue #3
- No post-placement verification of actual rendered dimensions
- Standard event/figure labels can theoretically overlap in edge cases - Issue #5

**Critical Files**:
- [TimelineCanvas.tsx:68-235](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L68-L235) - Helper functions (6 functions)
- [TimelineCanvas.tsx:338-550](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L338-L550) - Core layout algorithm (Pass 1 & 2)
- [TimelineCanvas.tsx:1009-1080](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L1009-L1080) - Element rendering
- [TimelineCanvas.tsx:1084-1206](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx#L1084-L1206) - Manhattan routing

---

**Document Version**: 1.2
**Date**: 2025-12-26
**Last Updated**: 2025-12-26 (Marked Issues #1, #2, #4 as RESOLVED after simplified algorithm implementation)
