import { HistoricalFigure, DiscoveryCluster, ClusterPlacement } from '../types';
import { formatYear } from './formatters';
import { isTimelineFigureVisible } from './timelineFigures';
import { placeClusterBars } from './discoveryClusters';
const BASE_PIXELS_PER_YEAR = 10;
const ROW_HEIGHT = 180;
// Helper for line intersection checks (p1->p2 vs p3->p4)
function linesIntersect(p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, p4: {x:number, y:number}): boolean {
    const {x: x1, y: y1} = p1;
    const {x: x2, y: y2} = p2;
    const {x: x3, y: y3} = p3;
    const {x: x4, y: y4} = p4;

    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return false;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    // We use a slightly smaller range than 0-1 to allow touching endpoints but not crossing "bodies"
    return (ua > 0.05 && ua < 0.95) && (ub > 0.05 && ub < 0.95);
}

// Font size constants (matching Tailwind classes)
const FONT_SIZE_NAME = 22;      // text-[22px]
const FONT_SIZE_DATE = 18;      // text-lg
const FONT_SIZE_OCCUPATION = 18; // text-[18px]

// Character width multipliers (empirically derived)
const CHAR_WIDTH_UPPERCASE = 0.82;  // font-black uppercase → ~18px per char
const CHAR_WIDTH_BOLD = 0.78;       // font-bold → ~14px per char
const CHAR_WIDTH_CAPITALIZE = 0.75; // font-bold capitalized → ~13.5px per char

interface TextMeasurement {
  nameWidthPx: number;
  dateWidthPx: number;
  occupationWidthPx: number;
  totalWidthPx: number;
  totalWidthYears: number;
}

/**
 * Calculate accurate text width for a figure/event label
 * @param fig - The historical figure
 * @param includeDate - Whether to include date width
 * @returns Object with pixel and year-space widths
 */
export function calculateTextWidth(
  fig: HistoricalFigure,
  includeDate: boolean = true
): TextMeasurement {
  // Name width (always uppercase in rendering)
  const nameWidthPx = Math.ceil(fig.name.length * FONT_SIZE_NAME * CHAR_WIDTH_UPPERCASE);

  // Occupation width (capitalized)
  const occupationWidthPx = Math.ceil(fig.occupation.length * FONT_SIZE_OCCUPATION * CHAR_WIDTH_CAPITALIZE);

  // Date width - CRITICAL: This was missing for floating labels!
  let dateWidthPx = 0;
  if (includeDate) {
    const startYStr = formatYear(fig.birthYear);
    const endYStr = fig.deathYear >= new Date().getFullYear() ? '' : formatYear(fig.deathYear);
    // Format: "YYYY - YYYY" or "YYYY BC - YYYY" with " - " separator
    const dateTextLength = startYStr.length + (endYStr ? endYStr.length + 3 : 2);
    dateWidthPx = Math.ceil(dateTextLength * FONT_SIZE_DATE * CHAR_WIDTH_BOLD) + 60; // +60px padding
  }

  // Date and occupation are on the same line for floating labels, so add them together
  // Format: "YYYY - YYYY • occupation" - add bullet separator width (~15px)
  const dateAndOccupationWidthPx = dateWidthPx + occupationWidthPx + 15;

  const totalWidthPx = Math.max(nameWidthPx, dateAndOccupationWidthPx);
  const totalWidthYears = totalWidthPx / BASE_PIXELS_PER_YEAR;

  return {
    nameWidthPx,
    dateWidthPx,
    occupationWidthPx,
    totalWidthPx,
    totalWidthYears
  };
}

/**
 * Calculate total occupied width for collision detection
 * Accounts for bar width, text content, and padding
 */
function calculateOccupiedWidth(
  fig: HistoricalFigure,
  forFloatingLabel: boolean = false
): number {
  const duration = fig.deathYear - fig.birthYear;
  const isEvent = fig.category === 'EVENTS';
  const isShort = duration < 15;

  // For short events in PASS 1: only the tiny bar matters
  if (!forFloatingLabel && isEvent && isShort) {
    return duration;
  }

  // For floating labels - FIX: Now includes date width!
  if (forFloatingLabel) {
    const textMeasurement = calculateTextWidth(fig);

    // Account for min-w-[200px] constraint (line 1124)
    const MIN_FLOATING_WIDTH_PX = 200;
    const contentWidthPx = Math.max(textMeasurement.totalWidthPx, MIN_FLOATING_WIDTH_PX);

    // Add padding: pl-2 = 8px
    const paddingPx = 8;
    const totalWidthPx = contentWidthPx + paddingPx;

    return (totalWidthPx / BASE_PIXELS_PER_YEAR) + 5; // +5 years buffer
  }

  // For standard elements
  const textMeasurement = calculateTextWidth(fig);
  const barWidthPx = Math.max(duration * BASE_PIXELS_PER_YEAR, 40);
  const paddingPx = 4; // px-1 = 4px total horizontal padding
  const maxContentWidthPx = Math.max(textMeasurement.totalWidthPx, barWidthPx) + paddingPx;

  return (maxContentWidthPx / BASE_PIXELS_PER_YEAR) + 5;
}

// Helper functions for simplified short event placement

function tryPlaceLabelInGap(
    figure: HistoricalFigure,
    gapLevel: number,
    horizontalOffset: number,
    labelWidth: number,
    barLevel: number,
    occupiedGaps: { start: number; end: number }[][],
    placedVectors: { x1: number; y1: number; x2: number; y2: number }[]
): { success: boolean; visualY?: number } {
    const LABEL_MARGIN = 10;

    // Don't allow negative gap levels (gap -0.5 would be above row 0, which doesn't exist)
    if (gapLevel < 0) {
        return { success: false };
    }

    const gapIndex = Math.floor(gapLevel);
    const labelStart = figure.birthYear + horizontalOffset;
    const labelEnd = labelStart + labelWidth;

    // Check box collision with existing gaps
    let hasOverlap = false;
    if (gapIndex >= 0 && gapIndex < occupiedGaps.length) {
        const gapIntervals = occupiedGaps[gapIndex];
        hasOverlap = gapIntervals.some(interval =>
            (labelStart < interval.end + LABEL_MARGIN) &&
            (labelEnd + LABEL_MARGIN > interval.start)
        );
    }

    if (hasOverlap) {
        return { success: false };
    }

    // Check connector crossing with existing vectors
    // Center labels vertically in gaps - use same offset for both directions
    const visualOffset = 175; // Centered in gap (empirically determined)
    const visualY = gapIndex * ROW_HEIGHT + visualOffset;

    const barVecX = figure.birthYear * BASE_PIXELS_PER_YEAR;
    const barVecY = barLevel * ROW_HEIGHT + 80;
    const labelVecX = labelStart * BASE_PIXELS_PER_YEAR;

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

    return { success: true, visualY };
}

function removeBarInterval(
    level: number,
    barStartYear: number,
    occupiedRows: { start: number; end: number; type: 'bar' | 'label' }[][]
): boolean {
    if (level < 0 || level >= occupiedRows.length) {
        console.error(`removeBarInterval: Invalid level ${level}`);
        return false;
    }

    const intervals = occupiedRows[level];
    const barIndex = intervals.findIndex(
        interval => interval.type === 'bar' && Math.abs(interval.start - barStartYear) < 0.1
    );

    if (barIndex === -1) {
        console.error(`removeBarInterval: Bar not found at level ${level}, start ${barStartYear}`);
        return false;
    }

    intervals.splice(barIndex, 1);
    return true;
}

function findNextAvailableRow(
    figure: HistoricalFigure,
    startLevel: number,
    occupiedRows: { start: number; end: number; type: 'bar' | 'label' }[][],
    barWidth: number
): number {
    const MARGIN = 6;
    const MAX_ROWS_TO_SEARCH = 20;

    const collisionEnd = figure.birthYear + barWidth;

    for (let searchLevel = startLevel; searchLevel < startLevel + MAX_ROWS_TO_SEARCH; searchLevel++) {
        if (searchLevel < occupiedRows.length) {
            const intervals = occupiedRows[searchLevel];
            const hasOverlap = intervals.some(interval =>
                (figure.birthYear < interval.end + MARGIN) &&
                (collisionEnd + MARGIN > interval.start)
            );

            if (!hasOverlap) {
                return searchLevel;
            }
        } else {
            return searchLevel;
        }
    }

    return -1;
}

function addBarInterval(
    level: number,
    barStartYear: number,
    barWidth: number,
    occupiedRows: { start: number; end: number; type: 'bar' | 'label' }[][]
): void {
    while (occupiedRows.length <= level) {
        occupiedRows.push([]);
    }

    occupiedRows[level].push({
        start: barStartYear,
        end: barStartYear + barWidth,
        type: 'bar'
    });
}

function recordLabelInterval(
    gapLevel: number,
    labelStart: number,
    labelWidth: number,
    occupiedGaps: { start: number; end: number }[][]
): void {
    const gapIndex = Math.floor(gapLevel);

    while (occupiedGaps.length <= gapIndex) {
        occupiedGaps.push([]);
    }

    occupiedGaps[gapIndex].push({
        start: labelStart,
        end: labelStart + labelWidth
    });
}

function recordConnectorVector(
    figure: HistoricalFigure,
    barLevel: number,
    labelYearOffset: number,
    labelVisualY: number,
    placedVectors: { x1: number; y1: number; x2: number; y2: number }[]
): void {
    const barVecX = figure.birthYear * BASE_PIXELS_PER_YEAR;
    const barVecY = barLevel * ROW_HEIGHT + 80;
    const labelVecX = (figure.birthYear + labelYearOffset) * BASE_PIXELS_PER_YEAR;

    placedVectors.push({
        x1: barVecX,
        y1: barVecY,
        x2: labelVecX,
        y2: labelVisualY
    });
}


export function calculateTimelineLayout(figures: HistoricalFigure[], clusters: DiscoveryCluster[] = [], placements: Record<string, ClusterPlacement> = {}) {
    const visibleFigures = figures.filter(isTimelineFigureVisible);
    const tempLayout = placeClusterBars(visibleFigures, clusters, placements, calculateOccupiedWidth);
    const memberIds = new Set(clusters.flatMap(cluster => cluster.memberIds));
    const fixedIds = new Set(tempLayout.filter(item => memberIds.has(item.figure.id) && placements[item.figure.id]?.level === item.level
        && (item.figure.category !== 'EVENTS' || item.figure.deathYear - item.figure.birthYear >= 15 || item.labelLevel !== undefined)).map(item => item.figure.id));
    const occupiedRows: { start: number; end: number; type: 'bar' | 'label' }[][] = [];
    const occupiedGaps: { start: number; end: number }[][] = [];
    const getOccupiedWidth = calculateOccupiedWidth;
    tempLayout.forEach(item => {
        addBarInterval(item.level, item.figure.birthYear, getOccupiedWidth(item.figure), occupiedRows);
        if (fixedIds.has(item.figure.id) && item.labelLevel !== undefined) {
            recordLabelInterval(item.labelLevel, item.figure.birthYear + (item.labelYearOffset ?? 0), getOccupiedWidth(item.figure, true), occupiedGaps);
        }
    });
    // --- PASS 2: Place Floating Labels for Short Events (Gaps Only, with Bar Relocation) ---
    const placedVectors: { x1: number, y1: number, x2: number, y2: number }[] = [];
    tempLayout.forEach(item => {
        if (fixedIds.has(item.figure.id) && item.labelLevel !== undefined) {
            recordConnectorVector(item.figure, item.level, item.labelYearOffset ?? 0, Math.floor(item.labelLevel) * ROW_HEIGHT + 175, placedVectors);
        }
    });
    
    const MAX_RELOCATION_ATTEMPTS = 10;

    tempLayout.forEach(item => {
        const { figure, level } = item;
        const duration = figure.deathYear - figure.birthYear;
        const isEvent = figure.category === 'EVENTS';
        const isShort = duration < 15;

        if (!isEvent || !isShort || fixedIds.has(figure.id)) return;

        const labelWidth = getOccupiedWidth(figure, true);
        // Label positioned at center of bar + 10 years offset
        const barCenter = duration / 2;
        const horizontalOffset = barCenter + 3;

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

            // Create new row for bar and place label in gap below
            const emergencyBarLevel = occupiedRows.length;
            const emergencyGapLevel = emergencyBarLevel + 0.5;

            item.level = emergencyBarLevel;
            item.labelLevel = emergencyGapLevel;
            item.labelYearOffset = horizontalOffset;

            // Add bar interval to new row
            occupiedRows.push([{
                start: figure.birthYear,
                end: figure.birthYear + getOccupiedWidth(figure, false),
                type: 'bar'
            }]);

            // Record label in gap below the new row
            recordLabelInterval(emergencyGapLevel, figure.birthYear + horizontalOffset, labelWidth, occupiedGaps);

            // Record connector vector (bar to label below)
            const visualOffset = 175; // Same as tryPlaceLabelInGap
            const visualY = emergencyBarLevel * ROW_HEIGHT + visualOffset;
            recordConnectorVector(figure, emergencyBarLevel, horizontalOffset, visualY, placedVectors);
        }
    });

    // --- PASS 3: Post-Placement Overlap Detection & Resolution ---
    interface OverlapInfo {
      figureId: string;
      layoutIndex: number;
      overlapsWith: string[];
      isFloatingLabel: boolean;
    }

    function detectOverlaps(): OverlapInfo[] {
      const overlaps: OverlapInfo[] = [];
      const OVERLAP_THRESHOLD = 2; // Years

      tempLayout.forEach((item, index) => {
        const { figure, level, labelLevel, labelYearOffset } = item;
        const duration = figure.deathYear - figure.birthYear;
        const isEvent = figure.category === 'EVENTS';
        const isShort = duration < 15;
        const hasFloatingLabel = isEvent && isShort && labelLevel !== undefined;

        const overlapsWith: string[] = [];

        if (hasFloatingLabel) {
          // Check floating label overlaps
          const labelWidth = calculateOccupiedWidth(figure, true);
          const labelStart = figure.birthYear + (labelYearOffset ?? 0);
          const labelEnd = labelStart + labelWidth;
          const labelRow = Math.floor(labelLevel ?? level);

          tempLayout.forEach((other, otherIndex) => {
            if (index === otherIndex) return;

            const otherDuration = other.figure.deathYear - other.figure.birthYear;
            const otherIsEvent = other.figure.category === 'EVENTS';
            const otherIsShort = otherDuration < 15;

            // Check against other floating labels
            if (otherIsEvent && otherIsShort && other.labelLevel !== undefined) {
              const otherLabelRow = Math.floor(other.labelLevel);
              if (Math.abs(labelRow - otherLabelRow) < 1) {
                const otherLabelWidth = calculateOccupiedWidth(other.figure, true);
                const otherLabelStart = other.figure.birthYear + (other.labelYearOffset ?? 0);
                const otherLabelEnd = otherLabelStart + otherLabelWidth;

                if ((labelStart < otherLabelEnd + OVERLAP_THRESHOLD) &&
                    (labelEnd + OVERLAP_THRESHOLD > otherLabelStart)) {
                  overlapsWith.push(other.figure.id);
                }
              }
            }

            // Skip checking against standard elements - floating labels are in gaps,
            // which are vertically separated from row content
            // Only check against other floating labels (already done above)
          });
        } else {
          // Check standard element overlaps
          const width = calculateOccupiedWidth(figure, false);
          const end = figure.birthYear + width;

          tempLayout.forEach((other, otherIndex) => {
            if (index === otherIndex) return;
            if (Math.abs(level - other.level) > 0.6) return; // Not in same row

            const otherDuration = other.figure.deathYear - other.figure.birthYear;
            const otherIsEvent = other.figure.category === 'EVENTS';
            const otherIsShort = otherDuration < 15;

            if (otherIsEvent && otherIsShort && other.labelLevel !== undefined) return;

            const otherWidth = calculateOccupiedWidth(other.figure, false);
            const otherEnd = other.figure.birthYear + otherWidth;

            if ((figure.birthYear < otherEnd + OVERLAP_THRESHOLD) &&
                (end + OVERLAP_THRESHOLD > other.figure.birthYear)) {
              overlapsWith.push(other.figure.id);
            }
          });
        }

        if (overlapsWith.length > 0) {
          overlaps.push({
            figureId: figure.id,
            layoutIndex: index,
            overlapsWith,
            isFloatingLabel: hasFloatingLabel
          });
        }
      });

      return overlaps;
    }

    function resolveOverlaps(overlaps: OverlapInfo[]): void {
      // Prioritize floating labels (easier to move)
      const sortedOverlaps = [...overlaps].sort((a, b) => {
        if (a.isFloatingLabel && !b.isFloatingLabel) return -1;
        if (!a.isFloatingLabel && b.isFloatingLabel) return 1;
        return 0;
      });

      sortedOverlaps.forEach(overlap => {
        const item = tempLayout[overlap.layoutIndex];
        if (fixedIds.has(item.figure.id)) return;
        const { figure, level } = item;

        if (overlap.isFloatingLabel) {
          // Try to relocate floating label to opposite gap
          const labelWidth = calculateOccupiedWidth(figure, true);
          const barCenter = (figure.deathYear - figure.birthYear) / 2;
          const horizontalOffset = barCenter + 3;

          const currentLabelLevel = item.labelLevel ?? level;
          const isCurrentlyAbove = currentLabelLevel < level;
          const newGapLevel = isCurrentlyAbove ? level + 0.5 : level - 0.5;

          const newPlacement = tryPlaceLabelInGap(
            figure, newGapLevel, horizontalOffset, labelWidth,
            level, occupiedGaps, placedVectors
          );

          if (newPlacement.success) {
            // Remove old gap interval
            const oldGapIndex = Math.floor(currentLabelLevel);
            if (oldGapIndex >= 0 && oldGapIndex < occupiedGaps.length) {
              const labelStart = figure.birthYear + (item.labelYearOffset ?? horizontalOffset);
              const intervals = occupiedGaps[oldGapIndex];
              const intervalIndex = intervals.findIndex(
                interval => Math.abs(interval.start - labelStart) < 0.1
              );
              if (intervalIndex !== -1) {
                intervals.splice(intervalIndex, 1);
              }
            }

            // Update placement
            item.labelLevel = newGapLevel;
            item.labelYearOffset = horizontalOffset;
            recordLabelInterval(newGapLevel, figure.birthYear + horizontalOffset, labelWidth, occupiedGaps);
            recordConnectorVector(figure, level, horizontalOffset, newPlacement.visualY!, placedVectors);
          } else {
            console.warn(`Could not resolve overlap for floating label: ${figure.name}`);
          }
        } else {
          console.warn(`Detected overlap for standard element: ${figure.name}`);
        }
      });
    }

    // Execute overlap detection and resolution
    const detectedOverlaps = detectOverlaps();
    if (detectedOverlaps.length > 0) {
      console.log(`Detected ${detectedOverlaps.length} overlaps, attempting resolution...`);
      resolveOverlaps(detectedOverlaps);
    }

    // Determine total rows for canvas height. 
    // We check both regular rows and if any gaps push beyond the visual bounds
    const maxRowIndex = occupiedRows.length;
    const maxGapIndex = occupiedGaps.length;
    const effectiveTotalRows = Math.max(maxRowIndex, maxGapIndex + 0.5); 

    return { layoutData: tempLayout, totalRows: Math.ceil(effectiveTotalRows) };

}
