
import React, { useRef, useState, useMemo, useEffect, useLayoutEffect } from 'react';
import { HistoricalFigure, LayoutData, ViewState, FigureCategory } from '../types';
import ActionBar from './ActionBar';
import { formatYear } from '../utils/formatters';
import { CATEGORY_COLORS } from '../constants';
import { getTextColorForBackground } from '../services/utils';

interface TimelineCanvasProps {
  figures: HistoricalFigure[];
  startYear: number;
  endYear: number;
  onHoverYear: (year: number | null) => void;
  onYearClick: (year: number, figures: HistoricalFigure[]) => void;
  onRelationshipClick: (figure: HistoricalFigure) => void;
  onEmptyClick: () => void;
  selectedYear: number | null;
  relationshipState?: {
    sourceY: number;
    relatedIds: string[];
    targetId: string;
    sourceFigure: HistoricalFigure;
    sourceImageUrl: string | null;
  } | null;
  highlightedFigureIds: string[];
  focusedFigureId?: string | null;
  isSearchFocusActive?: boolean;
  newlyDiscoveredIds?: Set<string>;
  discoverySourceId?: string | null;
  onDiscover?: (figure: HistoricalFigure) => void;
  onTrace?: (figure: HistoricalFigure, clientY: number) => void;
  onInspect?: (figure: HistoricalFigure) => void;
  isDiscovering?: boolean;
  onLayoutChange?: (levels: Map<string, number>) => void;
  onCanvasInteraction?: () => void;
  isBusy?: boolean;
  isSidebarCollapsed: boolean;
  hasSidebarSelection: boolean;
  selectedCategories: Set<FigureCategory>;
  isLegendCollapsed: boolean;
}

// Config
const BASE_PIXELS_PER_YEAR = 10; 
const ROW_HEIGHT = 180; 
const BAR_CENTER_OFFSET = 45; 
const AXIS_INTERVAL = 50; 
const SIDEBAR_OPEN_WIDTH = 544; 
const FLOATING_CARD_WIDTH = 320; 

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
 * @param isUppercase - Whether name is rendered in uppercase
 * @param includeDate - Whether to include date width
 * @returns Object with pixel and year-space widths
 */
function calculateTextWidth(
  fig: HistoricalFigure,
  isUppercase: boolean,
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
    const textMeasurement = calculateTextWidth(fig, true, true);

    // Account for min-w-[200px] constraint (line 1124)
    const MIN_FLOATING_WIDTH_PX = 200;
    const contentWidthPx = Math.max(textMeasurement.totalWidthPx, MIN_FLOATING_WIDTH_PX);

    // Add padding: pl-2 = 8px
    const paddingPx = 8;
    const totalWidthPx = contentWidthPx + paddingPx;

    return (totalWidthPx / BASE_PIXELS_PER_YEAR) + 5; // +5 years buffer
  }

  // For standard elements
  const textMeasurement = calculateTextWidth(fig, true, true);
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

const TimelineCanvas: React.FC<TimelineCanvasProps> = ({ 
  figures, 
  startYear, 
  endYear,
  onHoverYear,
  onYearClick,
  onRelationshipClick,
  onEmptyClick,
  selectedYear,
  relationshipState,
  highlightedFigureIds,
  focusedFigureId,
  isSearchFocusActive = false,
  newlyDiscoveredIds = new Set<string>(),
  discoverySourceId = null,
  onDiscover,
  onTrace,
  onInspect,
  isDiscovering = false,
  onLayoutChange,
  onCanvasInteraction,
  isBusy = false,
  hasSidebarSelection,
  selectedCategories,
  isLegendCollapsed
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const warnedCategoriesRef = useRef<Set<string>>(new Set());

  const [viewState, setViewState] = useState<ViewState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const wasSearchFocusedOnDown = useRef(false);
  
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [hoverYearVal, setHoverYearVal] = useState<number | null>(null);

  // Discovery Action Bar State
  const [hoveredFigureId, setHoveredFigureId] = useState<string | null>(null);
  const [actionBarCoords, setActionBarCoords] = useState<{top: number, left: number} | null>(null);
  const currentMousePosRef = useRef({ x: 0, y: 0 });
  
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const floatingCardRef = useRef<HTMLDivElement>(null);
  const [activeCardWidth, setActiveCardWidth] = useState(FLOATING_CARD_WIDTH);

  useLayoutEffect(() => {
      if (relationshipState && floatingCardRef.current) {
          setActiveCardWidth(floatingCardRef.current.getBoundingClientRect().width);
      }
  }, [relationshipState, figures]); 

  // --- SIDEBAR ANIMATION STATE ---
  const targetSidebarWidth = hasSidebarSelection ? SIDEBAR_OPEN_WIDTH : 20;

  const animatedWidthRef = useRef(targetSidebarWidth);
  const [animatedSidebarWidth, setAnimatedSidebarWidth] = useState(targetSidebarWidth);

  useEffect(() => {
    const startVal = animatedWidthRef.current;
    const endVal = targetSidebarWidth;
    
    if (Math.abs(startVal - endVal) < 0.5) {
        animatedWidthRef.current = endVal;
        setAnimatedSidebarWidth(endVal);
        return;
    }

    let startTime: number;
    let rAF: number;
    const duration = 300; 

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percent = Math.min(progress / duration, 1);
      const ease = -(Math.cos(Math.PI * percent) - 1) / 2;
      const newVal = startVal + (endVal - startVal) * ease;
      
      animatedWidthRef.current = newVal;
      setAnimatedSidebarWidth(newVal);

      if (progress < duration) {
        rAF = requestAnimationFrame(step);
      } else {
        animatedWidthRef.current = endVal;
        setAnimatedSidebarWidth(endVal);
      }
    };

    rAF = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rAF);
  }, [targetSidebarWidth]);


  // 1. Calculate Layout (Multi-Pass)
  const { layoutData, totalRows } = useMemo(() => {
    const priorityIds = new Set<string>();
    if (discoverySourceId) priorityIds.add(discoverySourceId);
    newlyDiscoveredIds.forEach(id => priorityIds.add(id));

    const priorityFigures: HistoricalFigure[] = [];
    const standardFigures: HistoricalFigure[] = [];

    figures.forEach(fig => {
        // FILTER: Remove extremely short events < 3 years
        if (fig.category === 'EVENTS' && (fig.deathYear - fig.birthYear < 3)) {
            return;
        }
        if (priorityIds.has(fig.id)) {
            priorityFigures.push(fig);
        } else {
            standardFigures.push(fig);
        }
    });

    priorityFigures.sort((a, b) => a.birthYear - b.birthYear);
    standardFigures.sort((a, b) => a.birthYear - b.birthYear);

    // Merge: Priority -> Standard (Mixed)
    const sortedFigures = [...priorityFigures, ...standardFigures];
    
    // --- PASS 1: Place Bars ---
    // We map occupied intervals per level (row)
    const occupiedRows: { start: number, end: number, type: 'bar' | 'label' }[][] = [];
    // We also map "Gaps" between rows. Gap K is between Row K and Row K+1.
    const occupiedGaps: { start: number, end: number }[][] = [];

    const tempLayout: LayoutData[] = [];
    const MARGIN = 6; 

    const getOccupiedWidth = (fig: HistoricalFigure, forFloatingLabel = false) => {
        return calculateOccupiedWidth(fig, forFloatingLabel);
    };

    sortedFigures.forEach(fig => {
        const width = getOccupiedWidth(fig);
        const collisionEnd = fig.birthYear + width;

        let placedLevel = -1;
        
        // Find first row that fits
        for (let r = 0; r < occupiedRows.length; r++) {
            const intervals = occupiedRows[r];
            const hasOverlap = intervals.some(interval => {
                return (fig.birthYear < interval.end + MARGIN) && (collisionEnd + MARGIN > interval.start);
            });

            if (!hasOverlap) {
                placedLevel = r;
                intervals.push({ start: fig.birthYear, end: collisionEnd, type: 'bar' });
                break;
            }
        }

        if (placedLevel === -1) {
            placedLevel = occupiedRows.length;
            occupiedRows.push([{ start: fig.birthYear, end: collisionEnd, type: 'bar' }]);
        }

        tempLayout.push({ figure: fig, level: placedLevel });
    });

    // --- PASS 2: Place Floating Labels for Short Events (Gaps Only, with Bar Relocation) ---
    const placedVectors: { x1: number, y1: number, x2: number, y2: number }[] = [];
    
    const MAX_RELOCATION_ATTEMPTS = 10;

    tempLayout.forEach(item => {
        const { figure, level } = item;
        const duration = figure.deathYear - figure.birthYear;
        const isEvent = figure.category === 'EVENTS';
        const isShort = duration < 15;

        if (!isEvent || !isShort) return;

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
  }, [figures, discoverySourceId, newlyDiscoveredIds]);

  useEffect(() => {
      if (onLayoutChange) {
          const levelMap = new Map<string, number>();
          layoutData.forEach(({ figure, level }) => {
              levelMap.set(figure.id, level);
          });
          onLayoutChange(levelMap);
      }
  }, [layoutData, onLayoutChange]);

  // 2. Auto-Zoom logic
  useEffect(() => {
    if (focusedFigureId && containerRef.current && !isDiscovering && isSearchFocusActive) {
        const item = layoutData.find(l => l.figure.id === focusedFigureId);
        
        if (item) {
            const rect = containerRef.current.getBoundingClientRect();
            const viewportW = rect.width;
            const viewportH = rect.height;

            const { figure, level } = item;
            const worldLeft = (figure.birthYear - startYear) * BASE_PIXELS_PER_YEAR;
            const duration = figure.deathYear - figure.birthYear;
            const worldWidth = Math.max(duration * BASE_PIXELS_PER_YEAR, 4);
            const worldCenterX = worldLeft + worldWidth / 2;
            
            const worldTop = level * ROW_HEIGHT + 60;
            const worldCenterY = worldTop + 60; 

            const targetScale = 1.2; 

            const newTranslateX = (viewportW / 2) - (worldCenterX * targetScale);
            const newTranslateY = (viewportH / 2) - (worldCenterY * targetScale);

            setViewState({
                scale: targetScale,
                translateX: newTranslateX,
                translateY: newTranslateY
            });
        }
        return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutData, focusedFigureId, isDiscovering, isSearchFocusActive]);

  const contentWidth = (endYear - startYear) * BASE_PIXELS_PER_YEAR;

  // 3. Interaction Handlers
  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;

    if (highlightedFigureIds.length > 0 && onCanvasInteraction) {
        onCanvasInteraction();
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewState(prev => {
      const scaleSensitivity = 0.001;
      let newScale = prev.scale * (1 - e.deltaY * scaleSensitivity);
      newScale = Math.max(0.1, Math.min(5, newScale));
      const scaleRatio = newScale / prev.scale;
      const newTranslateX = mouseX - (mouseX - prev.translateX) * scaleRatio;
      const newTranslateY = mouseY - (mouseY - prev.translateY) * scaleRatio;

      return {
        scale: newScale,
        translateX: newTranslateX,
        translateY: newTranslateY,
      };
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Check if clicking on the close button - allow it to propagate normally
    const target = e.target as HTMLElement;
    if (target.closest('button[data-close-selection]')) {
      // Don't prevent default, don't capture, just let the onClick handler work
      return;
    }

    e.preventDefault();
    wasSearchFocusedOnDown.current = isSearchFocusActive && highlightedFigureIds.length > 0;

    if (highlightedFigureIds.length > 0 && onCanvasInteraction) {
        onCanvasInteraction();
    }

    if (e.button === 0 || e.button === 1) {
        setIsDragging(true);
        const pos = { x: e.clientX, y: e.clientY };
        setLastMousePos(pos);
        dragStartPos.current = pos;

        if (containerRef.current) {
            containerRef.current.setPointerCapture(e.pointerId);
        }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);

    if (containerRef.current) {
        try {
            containerRef.current.releasePointerCapture(e.pointerId);
        } catch (e) {
            // Pointer capture may not have been set (e.g., on close button click)
        }
    }

    if (isBusy) return;

    const dist = Math.hypot(e.clientX - dragStartPos.current.x, e.clientY - dragStartPos.current.y);

    if (dist < 5 && e.button === 0) {
        // Check if we clicked on the close button
        const hitElement = document.elementFromPoint(e.clientX, e.clientY);
        if (hitElement?.closest('button[data-close-selection]')) {
            return;
        }

        if (wasSearchFocusedOnDown.current) {
            wasSearchFocusedOnDown.current = false;
            return;
        }

        // HIT TEST FOR FIGURE
        // Because of pointer capture on container, the e.target will likely be the container.
        // We use elementFromPoint to find what is visually under the cursor.
        const figureId = hitElement?.closest('[data-figure-id]')?.getAttribute('data-figure-id');
        
        if (figureId) {
             const figure = figures.find(f => f.id === figureId);
             // If we found a figure and we are in relationship mode...
             if (figure && relationshipState) {
                 // If it's one of the related figures, trigger the click
                 if (relationshipState.relatedIds.includes(figureId)) {
                    onRelationshipClick(figure);
                    return; 
                 }
                 // If not related, we let it fall through to empty click (below) which clears state
             }
        }

        if (hoverYearVal !== null) {
             const clickedYear = hoverYearVal;
             
            if (!relationshipState) {
                const activeItems = layoutData.filter(({ figure }) => 
                    clickedYear >= figure.birthYear && clickedYear <= figure.deathYear
                );
                activeItems.sort((a, b) => a.level - b.level);
                const sortedFigures = activeItems.map(item => item.figure);
                onYearClick(clickedYear, sortedFigures);
            } else {
                onEmptyClick();
            }
        } else {
            onEmptyClick();
        }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault(); 
    currentMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (isDragging) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      
      setViewState(prev => {
          let nextX = prev.translateX + dx;
          // Clamp panning logic
          if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const viewportWidth = rect.width;
              // The timeline width in screen pixels
              const totalTimelineWidth = contentWidth * prev.scale;
              
              // We allow a generous buffer so you can pan a bit past the edge
              const buffer = viewportWidth * 0.8;
              
              // Max translation (Left side of timeline is near right side of screen)
              const maxTranslateX = buffer; 
              // Min translation (Right side of timeline is near left side of screen)
              const minTranslateX = viewportWidth - totalTimelineWidth - buffer;
              
              nextX = Math.min(maxTranslateX, Math.max(minTranslateX, nextX));
          }

          return {
            ...prev,
            translateX: nextX,
            translateY: prev.translateY + dy,
          }
      });
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      
      const worldX = (relX - viewState.translateX) / viewState.scale;
      const year = (worldX / BASE_PIXELS_PER_YEAR) + startYear;
      
      if (relX >= 0 && relX <= rect.width) {
        setCursorX(relX);
        setHoverYearVal(year);
        onHoverYear(year);
      } else {
        setCursorX(null);
        setHoverYearVal(null);
        onHoverYear(null);
      }
    }
  };

  const handlePointerLeave = () => {
     if (!isDragging) {
        setCursorX(null);
        onHoverYear(null);
        setHoverYearVal(null);
     }
  };

  const handleBarEnter = (e: React.PointerEvent, figureId: string) => {
      if (isDiscovering || isBusy) return;
      if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
      }
      if (hoveredFigureId !== figureId) {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
              setHoveredFigureId(figureId);
              setActionBarCoords({
                  left: currentMousePosRef.current.x,
                  top: currentMousePosRef.current.y
              });
          }, 500); 
      }
  };

  const handleBarLeave = () => {
      if (isDiscovering || isBusy) return; 
      if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
      }
      hideTimerRef.current = setTimeout(() => {
          setHoveredFigureId(null);
          setActionBarCoords(null);
      }, 200);
  };

  const handleActionBarEnter = () => {
      if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
      }
  };

  const handleActionBarLeave = () => {
      if (isDiscovering) return;
      hideTimerRef.current = setTimeout(() => {
          setHoveredFigureId(null);
          setActionBarCoords(null);
      }, 200);
  };


  
  const contentHeight = (totalRows + 1) * ROW_HEIGHT + 100;
  
  const tickStart = Math.floor((startYear - 500) / AXIS_INTERVAL) * AXIS_INTERVAL;
  const tickEnd = Math.ceil((endYear + 500) / AXIS_INTERVAL) * AXIS_INTERVAL;
  const ticks = [];
  for (let y = tickStart; y <= tickEnd; y += AXIS_INTERVAL) {
      ticks.push(y);
  }

  const hoveredLayoutItem = hoveredFigureId ? layoutData.find(l => l.figure.id === hoveredFigureId) : null;
  const isSearchMode = highlightedFigureIds.length > 0 && !isDiscovering && isSearchFocusActive;
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-default';

  // Calculate screen position for red selected year line
  const selectedYearScreenX = selectedYear !== null 
    ? ((selectedYear - startYear) * BASE_PIXELS_PER_YEAR * viewState.scale) + viewState.translateX 
    : null;

  // Determine top offset for axes based on filters
  const axisTopOffset = isLegendCollapsed ? '55px' : '115px';

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none bg-[#f4ecd8] touch-none ${cursorClass}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
        {/* LAYER 1: Grid Lines */}
        <div 
            className="absolute top-0 left-0 h-full pointer-events-none z-0"
            style={{
                width: '100%', 
                transform: `translateX(${viewState.translateX}px) scaleX(${viewState.scale})`,
                transformOrigin: 'top left',
            }}
        >
            {ticks.map(year => (
                 <div key={year} className="absolute top-0 bottom-0 border-l border-gray-400/40" style={{ left: (year - startYear) * BASE_PIXELS_PER_YEAR }} />
            ))}
        </div>

      {/* LAYER 1: Red Ghost Line (Behind Everything) */}
      {selectedYearScreenX !== null && (
          <div
              className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-0 pointer-events-none"
              style={{ left: selectedYearScreenX }}
          />
      )}

      {/* Red Label - Above Selection Rectangles */}
      {selectedYearScreenX !== null && (
          <div
              className="absolute bg-red-600 text-white text-xs font-mono py-1 rounded shadow-lg z-[50] flex items-center"
              style={{ left: selectedYearScreenX + 12, bottom: '35px', paddingLeft: '8px', paddingRight: '4px', gap: '8px' }}
          >
              {formatYear(Math.floor(selectedYear!))}
              <button
                data-close-selection
                onMouseDown={(e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseUp={(e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEmptyClick();
                }}
                className="p-0.5 hover:bg-red-700/50 rounded transition-colors cursor-pointer flex-shrink-0"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
          </div>
      )}

      {/* LAYER 1.5: Selection Rectangles (Behind Content) */}
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform z-5 pointer-events-none"
        style={{
          transform: `translate(${viewState.translateX}px, ${viewState.translateY}px) scale(${viewState.scale})`,
          width: contentWidth,
          height: contentHeight
        }}
      >
        {layoutData.map((item) => {
          const { figure, level } = item;
          const duration = figure.deathYear - figure.birthYear;
          const left = (figure.birthYear - startYear) * BASE_PIXELS_PER_YEAR;
          const top = level * ROW_HEIGHT + 60;

          const isSelected = selectedYear !== null && figure.birthYear <= selectedYear && figure.deathYear >= selectedYear;

          if (!isSelected) return null;

          const isEvent = figure.category === 'EVENTS';
          const isShort = duration < 15;

          // For short events: only wrap the bar
          if (isEvent && isShort) {
            const BAR_VERTICAL_OFFSET = 32;
            const barWidth = Math.max(duration * BASE_PIXELS_PER_YEAR, 4);
            const padding = 12;

            return (
              <div
                key={`sel-rect-${figure.id}`}
                className="absolute bg-white/95 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-black/5 pointer-events-none"
                style={{
                  left: `${left - padding}px`,
                  top: `${top + BAR_VERTICAL_OFFSET - 8}px`,
                  width: `${barWidth + padding * 2}px`,
                  height: `${28 + 16}px`
                }}
              />
            );
          }

          // For standard figures: use centralized width calculation
          const measurement = calculateTextWidth(figure, true, true);
          const barWidth = Math.max(duration * BASE_PIXELS_PER_YEAR, 10);
          const maxWidth = Math.max(measurement.totalWidthPx, barWidth);

          // Add horizontal and vertical padding
          const hPadding = 15;
          const vPadding = 8;

          return (
            <div
              key={`sel-rect-${figure.id}`}
              className="absolute bg-white/95 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-black/5 pointer-events-none"
              style={{
                left: `${left - hPadding}px`,
                top: `${top - vPadding}px`,
                width: `${maxWidth + hPadding * 2}px`,
                height: `${90 + vPadding * 2}px`
              }}
            />
          );
        })}
      </div>

      {/* LAYER 2: Content */}
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform z-20"
        style={{
          transform: `translate(${viewState.translateX}px, ${viewState.translateY}px) scale(${viewState.scale})`,
          width: contentWidth,
          height: contentHeight
        }}
      >
        {layoutData.map((item) => {
          const { figure, level } = item;
          const duration = figure.deathYear - figure.birthYear;
          const width = Math.max(duration * BASE_PIXELS_PER_YEAR, 4); 
          const left = (figure.birthYear - startYear) * BASE_PIXELS_PER_YEAR;
          const top = level * ROW_HEIGHT + 60; 

          const isTracingTarget = relationshipState?.relatedIds.includes(figure.id);
          const isNew = newlyDiscoveredIds.has(figure.id);
          const isFocused = focusedFigureId === figure.id;
          const isHighlighted = highlightedFigureIds.includes(figure.id);
          const isEvent = figure.category === 'EVENTS';
          
          let barBackgroundColor = CATEGORY_COLORS[figure.category];

          if (!barBackgroundColor) {
              if (!warnedCategoriesRef.current.has(figure.category)) {
                  console.warn(`Render: Unknown category detected: "${figure.category}" (assigned to ${figure.name}). Defaulting to LEADERS & BADDIES.`);
                  warnedCategoriesRef.current.add(figure.category);
              }
              barBackgroundColor = CATEGORY_COLORS['LEADERS & BADDIES'];
          }
          
          // Calculate text color based on contrast ratio with background
          const textColor = getTextColorForBackground(barBackgroundColor);
          let textColorClass = textColor === 'white' ? 'text-white' : 'text-black';
          
          let containerOpacityClass = "opacity-100";
          let animationClass = "";
          let shadowClass = "";
          let wrapperClass = "";

          // Filter Logic
          if (selectedCategories.size > 0 && !selectedCategories.has(figure.category)) {
              containerOpacityClass = "opacity-10 grayscale";
          }

          if (isSearchMode) {
              if (isFocused) {
                  barBackgroundColor = '#000000';
                  textColorClass = `text-${getTextColorForBackground(barBackgroundColor)}`;
                  shadowClass = "shadow-2xl z-50";
                  animationClass = "animate-pulse-limited";
                  containerOpacityClass = "opacity-100";
              } else {
                  containerOpacityClass = "opacity-20 grayscale";
              }
          } else {
              if (isHighlighted && !isSearchMode) {
                   shadowClass = "shadow-md ring-2 ring-black/20";
              }

              if (discoverySourceId === figure.id) {
                  barBackgroundColor = '#4f46e5';
                  textColorClass = `text-${getTextColorForBackground(barBackgroundColor)}`;
                  shadowClass = "shadow-xl z-50 ring-4 ring-indigo-200";
              } else if (isTracingTarget) {
                  barBackgroundColor = '#3b82f6';
                  textColorClass = `text-${getTextColorForBackground(barBackgroundColor)}`;
                  shadowClass = "shadow-xl z-50";
              } else if (isNew) {
                  barBackgroundColor = '#fbbf24';
                  textColorClass = `text-${getTextColorForBackground(barBackgroundColor)}`;
                  shadowClass = "shadow-md z-30";
              }
          }

          // Special Rendering for Short Events (< 15 Years)
          if (isEvent && duration < 15) {
              const labelLevel = item.labelLevel ?? level;
              const labelOffset = item.labelYearOffset ?? 10;

              const BAR_VERTICAL_OFFSET = 32;

              const labelLeft = (figure.birthYear + labelOffset - startYear) * BASE_PIXELS_PER_YEAR;

              const isGap = labelLevel % 1 !== 0;

              // Center labels vertically in gaps - use same offset for both directions
              const gapVisualOffset = 175; // Centered in gap (empirically determined)
              const labelContainerTop = isGap
                ? Math.floor(labelLevel) * ROW_HEIGHT + gapVisualOffset
                : labelLevel * ROW_HEIGHT + 60 - 15;

              return (
                <div
                    key={figure.id}
                    className={`absolute pointer-events-none ${containerOpacityClass} z-10`}
                    style={{
                        left: 0,
                        top: 0,
                        width: 0,
                        height: 0,
                        overflow: 'visible'
                    }}
                >
                     {/* The Bar Itself */}
                     <div
                        key={`bar-${figure.id}`}
                        data-figure-id={figure.id}
                        className={`absolute h-[28px] rounded-sm z-10 pointer-events-auto cursor-pointer ${shadowClass} ${animationClass}`}
                        style={{
                            left: `${left}px`,
                            top: `${top + BAR_VERTICAL_OFFSET}px`,
                            width: `${Math.max(width, 4)}px`,
                            backgroundColor: barBackgroundColor
                        }}
                        onPointerEnter={(e) => handleBarEnter(e, figure.id)}
                        onPointerLeave={handleBarLeave}
                     />

                     {/* Floating Label */}
                     <div
                        key={`label-${figure.id}`}
                        data-figure-id={figure.id}
                        className={`absolute flex flex-col items-start min-w-[200px] z-20 pointer-events-auto cursor-pointer pl-2 origin-left ${animationClass}`}
                        style={{
                             left: `${labelLeft}px`,
                             top: `${labelContainerTop}px`,
                        }}
                        onPointerEnter={(e) => handleBarEnter(e, figure.id)}
                        onPointerLeave={handleBarLeave}
                     >
                         <span className="text-[22px] font-black text-black leading-none uppercase drop-shadow-sm filter-none whitespace-nowrap">
                             {figure.name}
                         </span>
                         <span className="text-lg font-bold text-gray-700 leading-none mt-1 whitespace-nowrap">
                            {formatYear(figure.birthYear)} - {figure.deathYear >= new Date().getFullYear() ? '' : formatYear(figure.deathYear)} • <span className="capitalize opacity-90">{figure.occupation}</span>
                         </span>
                     </div>
                </div>
              );
          }

          // Standard Rendering
          return (
            <div
              key={figure.id}
              data-figure-id={figure.id}
              className={`absolute flex flex-col items-start group antialiased transition-all duration-500 ease-in-out px-1 pointer-events-auto cursor-pointer ${containerOpacityClass} ${animationClass} ${wrapperClass}`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: 'max-content', 
                minWidth: `${Math.max(width, 10)}px`, 
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
              }}
              onPointerEnter={(e) => handleBarEnter(e, figure.id)}
              onPointerLeave={handleBarLeave}
            >
              <div className="text-[22px] font-black text-black leading-tight mb-1 uppercase w-full text-left drop-shadow-sm whitespace-nowrap">
                  {figure.name}
              </div>

              <div className="relative w-full flex items-center">
                  {isNew && !isSearchMode && (
                      <div className="absolute -left-6 top-1/2 -translate-y-1/2 text-amber-500 drop-shadow-md z-50">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                          </svg>
                      </div>
                  )}

                  <div 
                    className={`h-[28px] flex items-center pl-4 pr-2 rounded-md transition-all duration-300 ${shadowClass}`}
                    style={{ 
                        width: `${Math.max(width, 10)}px`,
                        backgroundColor: barBackgroundColor 
                    }}
                  >
                    <span className={`text-lg font-bold ${textColorClass} whitespace-nowrap`}>
                        {formatYear(figure.birthYear)} - {figure.deathYear >= new Date().getFullYear() ? '' : formatYear(figure.deathYear)}
                    </span>
                  </div>
              </div>

              <div className="text-[18px] font-bold text-black mt-1 whitespace-nowrap w-auto text-left leading-tight opacity-90 group-hover:opacity-100 capitalize">
                {figure.occupation}
              </div>
              
            </div>
          );
        })}
      </div>

      {/* LAYER 2.5: Connector Lines (Manhattan Routes) */}
      <svg className="absolute inset-0 pointer-events-none z-30 w-full h-full overflow-visible">
          {layoutData.map(item => {
              const { figure, level, labelLevel, labelYearOffset } = item;
              const duration = figure.deathYear - figure.birthYear;
              const isEvent = figure.category === 'EVENTS';

              // Filter matches the logic in the main rendering loop
              if (!isEvent || duration >= 15) return null;

              // If filtering categories, also hide the route
              if (selectedCategories.size > 0 && !selectedCategories.has(figure.category)) {
                  return null;
              }

              // --- Calculation Logic (Matches Main Loop) ---
              const width = Math.max(duration * BASE_PIXELS_PER_YEAR, 4);
              const left = (figure.birthYear - startYear) * BASE_PIXELS_PER_YEAR;
              const top = level * ROW_HEIGHT + 60;

              const BAR_VERTICAL_OFFSET = 32;
              const BAR_HEIGHT = 28;

              const barCenterX = left + width / 2;

              const isBelow = (labelLevel ?? level) > level;
              const startY = isBelow
                 ? top + BAR_VERTICAL_OFFSET + BAR_HEIGHT
                 : top + BAR_VERTICAL_OFFSET;

              const labelLeft = (figure.birthYear + (labelYearOffset ?? 10) - startYear) * BASE_PIXELS_PER_YEAR;

              const isGap = (labelLevel ?? level) % 1 !== 0;
              // Center labels vertically in gaps - use same offset for both directions
              const gapVisualOffset = 175; // Centered in gap (empirically determined)
              const labelContainerTop = isGap
                ? Math.floor(labelLevel ?? level) * ROW_HEIGHT + gapVisualOffset
                : (labelLevel ?? level) * ROW_HEIGHT + 60 - 15;

              const endX = labelLeft;
              const endY = labelContainerTop + 13;

              // --- Projection to Screen Space ---
              const toScreenX = (val: number) => (val * viewState.scale) + viewState.translateX;
              const toScreenY = (val: number) => (val * viewState.scale) + viewState.translateY;

              const sStartX = toScreenX(barCenterX);
              const sStartY = toScreenY(startY);
              const sEndX = toScreenX(endX);
              const sEndY = toScreenY(endY);

              // Manhattan / Elbow Routing with Radius
              const dx = sEndX - sStartX;
              const dy = sEndY - sStartY;
              const absDx = Math.abs(dx);
              const absDy = Math.abs(dy);

              const signX = dx > 0 ? 1 : -1;
              const signY = dy > 0 ? 1 : -1;

              const radius = 15;
              const r = Math.min(radius, absDx, absDy);

              let pathD = "";

              if (r < 2) {
                  pathD = `M ${sStartX} ${sStartY} L ${sStartX} ${sEndY} L ${sEndX} ${sEndY}`;
              } else {
                  pathD = `M ${sStartX} ${sStartY} ` +
                          `L ${sStartX} ${sEndY - signY * r} ` +
                          `Q ${sStartX} ${sEndY} ${sStartX + signX * r} ${sEndY} ` +
                          `L ${sEndX} ${sEndY}`;
              }

              // Manual Arrow Head Calculation to ensure it scales
              const arrowLength = 6 * Math.max(0.5, viewState.scale); // Scale the arrow head
              // Determine direction of last segment: Horizontal from center to right/left
              // Last segment is Horizontal: from something to sEndX, sEndY
              // Vector is (signX, 0)

              // Actually we just know it ends horizontally
              const arrowTipX = sEndX;
              const arrowTipY = sEndY;

              // Backwards points
              // Rotate vector (-signX, 0) by +/- 30 degrees
              // Or just manually:
              // x_back = tipX - signX * len * cos(30)
              // y_top = tipY - len * sin(30)
              // y_bot = tipY + len * sin(30)

              // Simpler: 45 degree chevron
              const wingX = arrowTipX - (signX * arrowLength);
              const wingYTop = arrowTipY - arrowLength * 0.6;
              const wingYBot = arrowTipY + arrowLength * 0.6;

              const arrowPath = `M ${wingX} ${wingYTop} L ${arrowTipX} ${arrowTipY} L ${wingX} ${wingYBot}`;

              return (
                  <g key={`connector-${figure.id}`}>
                    <path
                        d={pathD}
                        fill="none"
                        stroke="black"
                        strokeWidth="1.5"
                        className="opacity-80"
                    />
                    {/* Arrow at end */}
                    <path
                        d={arrowPath}
                        fill="none"
                        stroke="black"
                        strokeWidth="1.5"
                        className="opacity-80"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                  </g>
              );
          })}
      </svg>

      {/* LAYER 3: Relationship SVG Overlay */}
      {relationshipState && (
        <svg className="absolute inset-0 pointer-events-none z-40 w-full h-full overflow-visible">
            {relationshipState.relatedIds.map(id => {
                const layoutItem = layoutData.find(l => l.figure.id === id);
                if (!layoutItem) return null;
                
                const { figure, level } = layoutItem;
                const duration = figure.deathYear - figure.birthYear;
                const worldWidth = Math.max(duration * BASE_PIXELS_PER_YEAR, 4);
                const worldLeft = (figure.birthYear - startYear) * BASE_PIXELS_PER_YEAR;
                const worldTop = level * ROW_HEIGHT + 60;
                
                const screenX = (worldLeft * viewState.scale) + viewState.translateX;
                const screenY = (worldTop * viewState.scale) + viewState.translateY;
                const screenWidth = worldWidth * viewState.scale;
                
                const targetX = screenX + screenWidth; 
                const targetY = screenY + (BAR_CENTER_OFFSET * viewState.scale);
                const startX = window.innerWidth - animatedSidebarWidth - activeCardWidth;
                const startY = relationshipState.sourceY;
                
                const pathD = `M ${startX} ${startY} C ${startX - 250} ${startY}, ${targetX + 250} ${targetY}, ${targetX} ${targetY}`;
                
                return (
                    <g key={id}>
                        <path 
                            d={pathD} 
                            fill="none" 
                            stroke="#3b82f6" 
                            strokeWidth="2px" 
                            className="animate-pulse"
                        />
                        <circle cx={startX} cy={startY} r="3" fill="#3b82f6" />
                        <circle cx={targetX} cy={targetY} r="8" fill="#dbeafe" />
                        <circle cx={targetX} cy={targetY} r="4" fill="#3b82f6" />
                    </g>
                );
            })}
        </svg>
      )}

      {/* LAYER 3: Labels (Bottom) - Plain */}
      <div 
            className="absolute bottom-0 left-0 h-12 pointer-events-none z-[70]"
            style={{ width: '100%' }}
      >
         <div style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                transform: `translateX(${viewState.translateX}px) scaleX(${viewState.scale})`,
                transformOrigin: 'top left',
         }}>
            {ticks.map(year => {
                const left = (year - startYear) * BASE_PIXELS_PER_YEAR;
                return (
                    <div key={year} className="absolute top-0 bottom-0" style={{ left }}>
                        {/* REMOVED SHORT TICK LINE */}
                        <span 
                             className="absolute top-3 -translate-x-1/2 text-[12px] font-serif text-gray-600 font-bold whitespace-nowrap"
                             style={{ transform: `scaleX(${1/viewState.scale}) translateX(-50%)` }} 
                        >
                            {formatYear(year)}
                        </span>
                    </div>
                )
            })}
         </div>
      </div>

       {/* LAYER 3b: Labels (Top) - Fixed Position below Header/Filters */}
       <div 
            className="absolute left-0 h-10 pointer-events-none z-[60] transition-[top] duration-300 ease-in-out"
            style={{ width: '100%', top: axisTopOffset }}
      >
         <div style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                transform: `translateX(${viewState.translateX}px) scaleX(${viewState.scale})`,
                transformOrigin: 'top left',
         }}>
            {ticks.map(year => {
                const left = (year - startYear) * BASE_PIXELS_PER_YEAR;
                return (
                    <div key={year} className="absolute top-0 bottom-0" style={{ left }}>
                        {/* REMOVED SHORT TICK LINE */}
                        <span 
                             className="absolute top-3 -translate-x-1/2 text-[12px] font-serif text-gray-600 font-bold whitespace-nowrap"
                             style={{ transform: `scaleX(${1/viewState.scale}) translateX(-50%)` }} 
                        >
                            {formatYear(year)}
                        </span>
                    </div>
                )
            })}
         </div>
      </div>

      {/* LAYER 3.5: Cursor Line - Blue */}
      {cursorX !== null && (
        <div
            className="absolute top-0 bottom-0 w-px bg-blue-500/70 z-30 pointer-events-none"
            style={{ left: cursorX }}
        >
            <div
                className="absolute left-2 bg-blue-600 text-white text-xs font-mono px-2 py-1 rounded shadow-lg transition-all duration-300 z-[100]"
                style={{ bottom: '35px' }}
            >
                {formatYear(Math.floor(hoverYearVal || 0))}
            </div>
        </div>
      )}

      {/* LAYER 4: Floating Source Card */}
      {relationshipState && (
          <div 
            ref={floatingCardRef}
            className="absolute z-50 pointer-events-auto flex items-center gap-2 p-4 bg-white/90 backdrop-blur-md border border-gray-200 rounded-xl shadow-2xl w-fit"
            style={{
                right: `${animatedSidebarWidth}px`, 
                top: `${relationshipState.sourceY}px`,
                maxWidth: `${FLOATING_CARD_WIDTH}px`,
                transform: 'translateY(-50%)',
                transition: 'top 0s' 
            }}
          >
             <button
                 onClick={(e) => { e.stopPropagation(); onEmptyClick(); }}
                 className="absolute -top-2 -right-2 bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full p-1 shadow-md border border-gray-200 z-50 transition-colors"
             >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                 </svg>
             </button>

             <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-500 rounded-full ring-4 ring-blue-100"></div>

             <div className="flex-1 min-w-0">
                 <h3 className="font-bold text-gray-900 text-xl leading-tight truncate">{relationshipState.sourceFigure.name}</h3>
                 <div className="text-sm text-gray-500 font-mono font-semibold">
                     ({formatYear(relationshipState.sourceFigure.birthYear)} — {formatYear(relationshipState.sourceFigure.deathYear)})
                 </div>
                 <p className="text-xs text-emerald-800 font-bold uppercase tracking-wide mt-1 truncate">
                     {relationshipState.sourceFigure.occupation}
                 </p>
             </div>
             
             {relationshipState.sourceImageUrl && (
                 <div className="w-16 h-16 bg-gray-200 rounded-[10px] flex-shrink-0 overflow-hidden shadow-sm border border-gray-100">
                    <img src={relationshipState.sourceImageUrl} alt={relationshipState.sourceFigure.name} className="w-full h-full object-cover object-top" />
                 </div>
             )}
          </div>
      )}

      {/* LAYER 5: Discovery Action Bar */}
      {hoveredLayoutItem && actionBarCoords && onDiscover && onTrace && onInspect && !isDiscovering && !relationshipState && !isBusy && (
          <ActionBar 
              figure={hoveredLayoutItem.figure}
              onDiscover={onDiscover}
              onTrace={onTrace}
              onInspect={onInspect}
              isDiscovering={!!isDiscovering}
              style={actionBarCoords}
              onMouseEnter={handleActionBarEnter}
              onMouseLeave={handleActionBarLeave}
          />
      )}
    </div>
  );
};

export default TimelineCanvas;
