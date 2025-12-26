# Implementation Plan: Simplified Short Event Placement Algorithm

## Overview

Simplify the Pass 2 floating label placement algorithm in TimelineCanvas to only use immediate gaps (±0.5 levels) and add bar relocation capability when both gaps are blocked. This eliminates complex fallback strategies and makes the algorithm deterministic and predictable.

## User Requirements

1. **Simplified label placement**: Floating labels ONLY in immediate gaps (±0.5 levels)
2. **No fallbacks**: Remove "same row horizontal offset", "±1/±2 level rows", "large horizontal offset" candidates
3. **Deterministic direction**: Try gap above first, then gap below (no random hashing)
4. **Bar relocation**: If both gaps blocked, move the short event bar to next available row and retry
5. **Sequential row search**: When relocating, try level+1, level+2, etc. until valid placement found
6. **Keep two-pass structure**: Modify existing Pass 2 to include bar relocation capability

## Benefits

- **Simpler**: Reduces complex 12+ candidate search to deterministic 2-attempt logic
- **Predictable**: Same input always produces same output (no randomization)
- **Shorter connectors**: Labels always ±0.5 levels from bars (±90px), reducing crossing probability
- **Better debugging**: Clear decision trail for why labels are placed where they are
- **Maintainable**: Extracted helper functions with clear responsibilities

## Critical Files

- **[TimelineCanvas.tsx](d:\develop\projects\ChronoWeave\components\TimelineCanvas.tsx)**
  - Lines 171-441: Core layout algorithm (Pass 1 and Pass 2)
  - Lines 274-441: Pass 2 to be completely replaced
  - Lines 52-66: `linesIntersect` helper (used, no changes needed)
  - Lines 966-1030: Short event rendering (no changes needed)
  - Lines 1084-1206: Manhattan routing SVG (no changes needed)

## Implementation Steps

### Step 1: Create Helper Functions

Add these helper functions before the `useMemo` hook (around line 170):

#### 1.1 `tryPlaceLabelInGap()`
- **Purpose**: Attempts to place a label in a specific gap position
- **Inputs**: figure, gapLevel, horizontalOffset, labelWidth, barLevel, occupiedGaps, placedVectors
- **Returns**: `{ success: boolean, visualY?: number }`
- **Logic**:
  - Validate gapLevel >= -0.5
  - Calculate label interval [labelStart, labelEnd]
  - Check box collision against `occupiedGaps[gapIndex]` intervals
  - Check connector crossing against `placedVectors` using `linesIntersect`
  - Return success if both checks pass

#### 1.2 `removeBarInterval()`
- **Purpose**: Removes a bar interval from occupiedRows
- **Inputs**: level, barStartYear, occupiedRows
- **Returns**: boolean (success/failure)
- **Logic**:
  - Find interval where `type === 'bar'` and `start ≈ barStartYear`
  - Remove using `splice()`
  - Log error if not found

#### 1.3 `findNextAvailableRow()`
- **Purpose**: Finds next available row that can fit a bar
- **Inputs**: figure, startLevel, occupiedRows, barWidth
- **Returns**: Row index or -1 if none found within limit
- **Logic**:
  - Search from startLevel to startLevel + MAX_ROWS_TO_SEARCH (20)
  - For each row, check if bar would overlap existing intervals
  - Return first row with no overlap
  - Return -1 if exhausted search

#### 1.4 `addBarInterval()`
- **Purpose**: Adds a bar interval to occupiedRows
- **Inputs**: level, barStartYear, barWidth, occupiedRows
- **Returns**: void
- **Logic**:
  - Ensure row exists (create if needed)
  - Push `{ start, end, type: 'bar' }` to `occupiedRows[level]`

#### 1.5 `recordLabelInterval()`
- **Purpose**: Records a label interval in occupiedGaps
- **Inputs**: gapLevel, labelStart, labelWidth, occupiedGaps
- **Returns**: void
- **Logic**:
  - Calculate gapIndex = Math.floor(gapLevel)
  - Ensure gap array exists
  - Push `{ start, end }` to `occupiedGaps[gapIndex]`

#### 1.6 `recordConnectorVector()`
- **Purpose**: Records a connector vector path
- **Inputs**: figure, barLevel, labelYearOffset, labelVisualY, placedVectors
- **Returns**: void
- **Logic**:
  - Calculate bar center coordinates (x1, y1)
  - Calculate label start coordinates (x2, y2)
  - Push to placedVectors

### Step 2: Replace Pass 2 Algorithm

**Location**: Lines 274-441

**Remove**:
- Lines 287-289: Hash-based direction preference
- Lines 292-321: Complex candidate generation
- Lines 329-396: Candidate iteration loop
- Lines 398-401: Emergency fallback logic

**Replace with**:

```typescript
// Constants
const MAX_RELOCATION_ATTEMPTS = 10;

tempLayout.forEach(item => {
    const { figure, level } = item;
    const duration = figure.deathYear - figure.birthYear;
    const isEvent = figure.category === 'EVENTS';
    const isShort = duration < 15;

    if (!isEvent || !isShort) return;

    const labelWidth = getOccupiedWidth(figure, true);
    const horizontalOffset = duration + 2; // Clear the bar

    let currentBarLevel = level;
    let placementSuccessful = false;
    let relocationAttempts = 0;

    while (!placementSuccessful && relocationAttempts < MAX_RELOCATION_ATTEMPTS) {
        // Try gap above first (-0.5)
        const aboveGapLevel = currentBarLevel - 0.5;
        const abovePlacement = tryPlaceLabelInGap(
            figure, aboveGapLevel, horizontalOffset, labelWidth,
            currentBarLevel, occupiedGaps, placedVectors
        );

        if (abovePlacement.success) {
            item.level = currentBarLevel;
            item.labelLevel = aboveGapLevel;
            item.labelYearOffset = horizontalOffset;

            recordLabelInterval(aboveGapLevel, figure.birthYear + horizontalOffset, labelWidth, occupiedGaps);
            recordConnectorVector(figure, currentBarLevel, horizontalOffset, abovePlacement.visualY!, placedVectors);

            placementSuccessful = true;
            break;
        }

        // Try gap below (+0.5)
        const belowGapLevel = currentBarLevel + 0.5;
        const belowPlacement = tryPlaceLabelInGap(
            figure, belowGapLevel, horizontalOffset, labelWidth,
            currentBarLevel, occupiedGaps, placedVectors
        );

        if (belowPlacement.success) {
            item.level = currentBarLevel;
            item.labelLevel = belowGapLevel;
            item.labelYearOffset = horizontalOffset;

            recordLabelInterval(belowGapLevel, figure.birthYear + horizontalOffset, labelWidth, occupiedGaps);
            recordConnectorVector(figure, currentBarLevel, horizontalOffset, belowPlacement.visualY!, placedVectors);

            placementSuccessful = true;
            break;
        }

        // BOTH GAPS BLOCKED: Relocate bar to next available row
        const barWidth = getOccupiedWidth(figure, false);
        const newBarLevel = findNextAvailableRow(
            figure, currentBarLevel + 1, occupiedRows, barWidth
        );

        if (newBarLevel === -1) {
            // No available rows - create new row at bottom
            currentBarLevel = occupiedRows.length;
            occupiedRows.push([{
                start: figure.birthYear,
                end: figure.birthYear + barWidth,
                type: 'bar'
            }]);
            relocationAttempts++;
            continue;
        }

        // Remove old bar interval
        removeBarInterval(currentBarLevel, figure.birthYear, occupiedRows);

        // Add new bar interval
        addBarInterval(newBarLevel, figure.birthYear, barWidth, occupiedRows);

        currentBarLevel = newBarLevel;
        relocationAttempts++;
    }

    // Emergency fallback if exhausted attempts
    if (!placementSuccessful) {
        console.warn(`Failed to place label for ${figure.name} after ${MAX_RELOCATION_ATTEMPTS} relocations`);

        const emergencyLevel = occupiedRows.length;
        item.level = emergencyLevel;
        item.labelLevel = emergencyLevel;
        item.labelYearOffset = horizontalOffset;

        occupiedRows.push([{
            start: figure.birthYear,
            end: figure.birthYear + getOccupiedWidth(figure, false),
            type: 'bar'
        }]);
        occupiedRows[emergencyLevel].push({
            start: figure.birthYear + horizontalOffset,
            end: figure.birthYear + horizontalOffset + labelWidth,
            type: 'label'
        });
    }
});
```

### Step 3: Testing

**Manual visual tests**:
1. Load timeline with 10-20 short events in narrow time range (e.g., 730-750 CE)
2. Verify all labels are in immediate gaps (±0.5 levels from bars)
3. Verify no overlapping labels or bars
4. Reload page multiple times - verify identical layout (deterministic)
5. Check console for any relocation warnings

**Edge cases to verify**:
- Short event at level 0 (gap above is -0.5, should try below first or relocate)
- Dense timeline with many short events on same row
- Very long label names (30+ characters)
- Mix of short events and standard events

## Expected Changes Summary

- **Add**: 6 new helper functions (~150 lines total)
- **Replace**: Pass 2 main loop (lines 274-441 → ~80 lines)
- **Remove**: ~167 lines of old complex logic
- **Net change**: ~60 lines reduction, significantly simpler logic

## Step 4: Code Cleanup - Remove Deprecated Code

After implementing the new algorithm, the following code sections become completely unused and should be removed:

### 4.1 Variables to Remove

**Lines 287-289**: Hash-based direction randomization
```typescript
// DELETE - No longer using random direction
const idHash = figure.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
const preferBelow = idHash % 2 === 0;
```

**Lines 292**: Candidates array initialization
```typescript
// DELETE - No longer using candidates array
const candidates: { dLevel: number, dYear: number }[] = [];
```

**Lines 323-324**: Best placement tracking variables
```typescript
// DELETE - Using immediate placement instead
let bestPlacement = { level: level, offset: horizontalSafetyOffset + 50 };
let foundSafePlacement = false;
```

**Lines 326-327**: Bar vector coordinates (will be calculated inside helper functions)
```typescript
// DELETE - Moving to recordConnectorVector helper
const barVecX = figure.birthYear * 10;
const barVecY = level * ROW_HEIGHT + 80;
```

### 4.2 Functions/Blocks to Remove

**Lines 295-303**: `addLayer` helper function
```typescript
// DELETE - No longer building multi-layer candidates
const addLayer = (dist: number, xOffset: number) => {
    const below = { dLevel: dist, dYear: xOffset };
    const above = { dLevel: -dist, dYear: xOffset };
    if (preferBelow) {
        candidates.push(below, above);
    } else {
        candidates.push(above, below);
    }
};
```

**Lines 305-321**: All candidate building logic
```typescript
// DELETE - Entire candidate generation section
// Layer 1: Same Row (Standard Stepped Look)
candidates.push({ dLevel: 0, dYear: horizontalSafetyOffset });

// Layer 2: Immediate Gaps (+/- 0.5)
addLayer(0.5, horizontalSafetyOffset);

// Layer 3: Adjacent Rows (+/- 1)
addLayer(1, horizontalSafetyOffset);

// Layer 4: Farther Gaps (+/- 1.5)
addLayer(1.5, horizontalSafetyOffset);

// Layer 5: Farther Rows (+/- 2)
addLayer(2, horizontalSafetyOffset);

// Fallback: Massive horizontal offset (Same Row) - Prevents dropping to bottom
candidates.push({ dLevel: 0, dYear: horizontalSafetyOffset + 80 });
```

**Lines 329-396**: Entire candidate iteration loop
```typescript
// DELETE - Replacing with deterministic gap attempts
for (const cand of candidates) {
    const targetLevel = level + cand.dLevel;
    const targetStart = figure.birthYear + cand.dYear;
    const targetEnd = targetStart + labelWidth;

    if (targetLevel < -0.5) continue;

    const LABEL_MARGIN = 10;

    // 1. Check Collision Box
    let hasOverlap = false;
    const isGap = targetLevel % 1 !== 0;

    if (isGap) {
        // ... gap collision check ...
    } else {
        // ... row collision check ...
    }

    // 2. Check Vector Crossing
    let hasVectorCrossing = false;
    if (!hasOverlap) {
        // ... vector crossing check ...
    }

    if (!hasOverlap && !hasVectorCrossing) {
        bestPlacement = { level: targetLevel, offset: cand.dYear };
        foundSafePlacement = true;
        break;
    }
}
```

**Lines 398-401**: Old emergency fallback
```typescript
// DELETE - Replacing with relocation + better fallback
if (!foundSafePlacement) {
    bestPlacement = { level: occupiedRows.length, offset: horizontalSafetyOffset };
}
```

**Lines 406-423**: Old interval marking logic
```typescript
// DELETE - Moving to recordLabelInterval helper
// Mark Occupied
const isGap = bestPlacement.level % 1 !== 0;
const finalStart = figure.birthYear + bestPlacement.offset;
const finalEnd = finalStart + labelWidth;

if (isGap) {
    const gapIndex = Math.floor(bestPlacement.level);
    while (occupiedGaps.length <= gapIndex) {
        occupiedGaps.push([]);
    }
    occupiedGaps[gapIndex].push({ start: finalStart, end: finalEnd });
} else {
    const rowIndex = bestPlacement.level;
    while (occupiedRows.length <= rowIndex) {
        occupiedRows.push([]);
    }
    occupiedRows[rowIndex].push({ start: finalStart, end: finalEnd, type: 'label' });
}
```

**Lines 425-439**: Old vector recording logic
```typescript
// DELETE - Moving to recordConnectorVector helper
// Record Vector
let finalVisualOffset = 60;
if (isGap) {
    const isBelow = bestPlacement.level > level;
     finalVisualOffset = isBelow ? 175 : 145;
}
const finalVisualY = Math.floor(bestPlacement.level) * ROW_HEIGHT + finalVisualOffset;

placedVectors.push({
    x1: barVecX,
    y1: barVecY,
    x2: (figure.birthYear + bestPlacement.offset) * 10,
    y2: finalVisualY
});
```

### 4.3 Comments to Update

**Line 274**: Update comment to reflect new algorithm
```typescript
// BEFORE:
// --- PASS 2: Place Floating Labels for Short Events ---

// AFTER:
// --- PASS 2: Place Floating Labels for Short Events (Gaps Only, with Bar Relocation) ---
```

**Line 285**: Update comment to be more specific
```typescript
// BEFORE:
const horizontalSafetyOffset = duration + 2; // Always clear the bar

// AFTER:
const horizontalOffset = duration + 2; // Position label just past the bar
```

**Line 291**: Remove this comment entirely (it references reverted code)
```typescript
// DELETE:
// Generate candidates dynamically - REVERTED to "Stepped" Look preference
```

### 4.4 Total Lines Removed

**Deprecated code to delete**: Lines 287-289, 291-303, 305-321, 323-324, 326-327, 329-396, 398-401, 406-439
**Total lines removed**: ~145 lines

**New code added**: ~230 lines (helper functions + new algorithm)
**Net change**: +85 lines (but much simpler and more maintainable)

### 4.5 Cleanup Checklist

- [ ] Remove `idHash` and `preferBelow` variables (lines 287-289)
- [ ] Remove `candidates` array declaration (line 292)
- [ ] Remove `addLayer` helper function (lines 295-303)
- [ ] Remove all candidate building logic (lines 305-321)
- [ ] Remove `bestPlacement` and `foundSafePlacement` variables (lines 323-324)
- [ ] Remove `barVecX` and `barVecY` variables (lines 326-327)
- [ ] Remove candidate iteration loop (lines 329-396)
- [ ] Remove old emergency fallback (lines 398-401)
- [ ] Remove old interval marking logic (lines 406-423)
- [ ] Remove old vector recording logic (lines 425-439)
- [ ] Update Pass 2 comment (line 274)
- [ ] Rename `horizontalSafetyOffset` to `horizontalOffset` for clarity
- [ ] Remove "REVERTED" comment (line 291)
- [ ] Verify no other references to removed variables exist

## Rollback Plan

If issues arise:
1. Git revert the changes to TimelineCanvas.tsx
2. Original Pass 2 algorithm remains functional
3. No database or state migrations required

## Post-Implementation

After successful implementation:
1. Update [ai-docs/timeline-layout-algorithm.md](d:\develop\projects\ChronoWeave\ai-docs\timeline-layout-algorithm.md) to reflect new algorithm
2. Document that Issues #1 and #2 may still exist (routes crossing bars, labels crossed by routes)
3. Note that these will be addressed in future iterations

---

**Plan Version**: 1.0
**Date**: 2025-12-26
**Related Documentation**: [timeline-layout-algorithm.md](d:\develop\projects\ChronoWeave\ai-docs\timeline-layout-algorithm.md)
