
import React, { useRef, useState, useMemo, useEffect, useLayoutEffect } from 'react';
import { HistoricalFigure, LayoutData, ViewState, FigureCategory } from '../types';
import ActionBar from './ActionBar';
import { formatYear } from '../utils/formatters';
import { CATEGORY_COLORS } from '../constants';

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
        const duration = fig.deathYear - fig.birthYear;
        const isEvent = fig.category === 'EVENTS';
        const isShort = duration < 15;

        // For short events, Pass 1 only cares about the tiny bar
        if (!forFloatingLabel && isEvent && isShort) {
            return duration; 
        }

        // For labels, we use a rough estimate
        if (forFloatingLabel) {
             const textLen = Math.max(fig.name.length, fig.occupation.length);
             const charEstimate = textLen * 3.0; 
             return charEstimate + 30; // Extra buffer
        }

        // Standard Rendered Items (Figures or Long Events)
        // We calculate the maximum pixel width of content to ensure no overlap
        
        // 1. Name Width (22px font-black uppercase) -> ~18px/char conservative
        const nameWidthPx = fig.name.length * 18; 
        
        // 2. Occupation Width (18px bold) -> ~14px/char conservative
        const occWidthPx = fig.occupation.length * 14;

        // 3. Date Width (18px bold + padding)
        const startYStr = formatYear(fig.birthYear);
        const endYStr = fig.deathYear >= new Date().getFullYear() ? '' : formatYear(fig.deathYear);
        const dateWidthPx = ((startYStr.length + endYStr.length + 3) * 14) + 60; // Text + Padding/Icon

        // 4. Bar Width
        const barWidthPx = Math.max(duration * BASE_PIXELS_PER_YEAR, 40);

        // 5. Max Width of the container (width: max-content)
        const maxContentWidthPx = Math.max(nameWidthPx, occWidthPx, dateWidthPx, barWidthPx);

        return (maxContentWidthPx / BASE_PIXELS_PER_YEAR) + 5; 
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

    // --- PASS 2: Place Floating Labels for Short Events ---
    const placedVectors: { x1: number, y1: number, x2: number, y2: number }[] = [];
    
    tempLayout.forEach(item => {
        const { figure, level } = item;
        const duration = figure.deathYear - figure.birthYear;
        const isEvent = figure.category === 'EVENTS';
        const isShort = duration < 15;

        if (isEvent && isShort) {
            const labelWidth = getOccupiedWidth(figure, true);
            const horizontalSafetyOffset = duration + 2; // Always clear the bar
            
            // Randomize starting direction (Above/Below) based on ID hash to avoid clustering
            const idHash = figure.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const preferBelow = idHash % 2 === 0;

            // Generate candidates dynamically - REVERTED to "Stepped" Look preference
            const candidates: { dLevel: number, dYear: number }[] = [];
            
            // Helper to add a candidate pair
            const addLayer = (dist: number, xOffset: number) => {
                const below = { dLevel: dist, dYear: xOffset };
                const above = { dLevel: -dist, dYear: xOffset };
                if (preferBelow) {
                    candidates.push(below, above);
                } else {
                    candidates.push(above, below);
                }
            };

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

            let bestPlacement = { level: level, offset: horizontalSafetyOffset + 50 }; 
            let foundSafePlacement = false;

            const barVecX = figure.birthYear * 10;
            const barVecY = level * ROW_HEIGHT + 80;

            for (const cand of candidates) {
                const targetLevel = level + cand.dLevel;
                const targetStart = figure.birthYear + cand.dYear;
                const targetEnd = targetStart + labelWidth;

                // Don't go below level 0
                if (targetLevel < -0.5) continue;

                const LABEL_MARGIN = 10;
                
                // 1. Check Collision Box
                let hasOverlap = false;
                const isGap = targetLevel % 1 !== 0;

                if (isGap) {
                     // GAP COLLISION CHECK
                     const gapIndex = Math.floor(targetLevel);
                     if (gapIndex < 0) continue; 
                     
                     if (gapIndex < occupiedGaps.length) {
                         const gapIntervals = occupiedGaps[gapIndex];
                         hasOverlap = gapIntervals.some(interval => 
                            (targetStart < interval.end + LABEL_MARGIN) && (targetEnd + LABEL_MARGIN > interval.start)
                         );
                     }
                } else {
                     // ROW COLLISION CHECK
                     const rowIndex = targetLevel;
                     if (rowIndex < occupiedRows.length) {
                         const rowIntervals = occupiedRows[rowIndex];
                         hasOverlap = rowIntervals.some(interval => 
                            (targetStart < interval.end + LABEL_MARGIN) && (targetEnd + LABEL_MARGIN > interval.start)
                         );
                     }
                }

                // 2. Check Vector Crossing
                let hasVectorCrossing = false;
                if (!hasOverlap) {
                    const labelVecX = targetStart * 10;
                    
                    // Determine Visual Y for vector check
                    // Below (+0.5) -> 175px offset
                    // Above (-0.5) -> 145px offset (closer to top of gap to avoid bottom bar)
                    let visualOffset = 60;
                    if (isGap) {
                        const isBelow = cand.dLevel > 0;
                        visualOffset = isBelow ? 175 : 145;
                    }
                    
                    const visualLevelY = Math.floor(targetLevel) * ROW_HEIGHT + visualOffset;
                    
                    hasVectorCrossing = placedVectors.some(vec => 
                        linesIntersect(
                            {x: barVecX, y: barVecY}, 
                            {x: labelVecX, y: visualLevelY}, 
                            {x: vec.x1, y: vec.y1}, 
                            {x: vec.x2, y: vec.y2}
                        )
                    );
                }

                if (!hasOverlap && !hasVectorCrossing) {
                    bestPlacement = { level: targetLevel, offset: cand.dYear };
                    foundSafePlacement = true;
                    break;
                }
            }
            
            // If absolutely nothing found, put on new row
            if (!foundSafePlacement) {
                bestPlacement = { level: occupiedRows.length, offset: horizontalSafetyOffset };
            }

            item.labelLevel = bestPlacement.level;
            item.labelYearOffset = bestPlacement.offset;

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

            // Record Vector
            // Match visual offset logic from loop
            let finalVisualOffset = 60;
            if (isGap) {
                const isBelow = bestPlacement.level > level; // Rough check, relative to bar level
                 finalVisualOffset = isBelow ? 175 : 145;
            }
            const finalVisualY = Math.floor(bestPlacement.level) * ROW_HEIGHT + finalVisualOffset;

            placedVectors.push({
                x1: barVecX, 
                y1: barVecY, 
                x2: (figure.birthYear + bestPlacement.offset) * 10, 
                y2: finalVisualY
            });
        }
    });

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

          // For standard figures: calculate based on content
          // Name width: ~18px per char at font-black 22px
          const nameWidth = figure.name.length * 18;

          // Occupation width: ~14px per char at font-bold 18px
          const occupationWidth = figure.occupation.length * 14;

          // Bar width
          const barWidth = Math.max(duration * BASE_PIXELS_PER_YEAR, 10);

          // Date width: estimate based on year strings
          const startYStr = formatYear(figure.birthYear);
          const endYStr = figure.deathYear >= new Date().getFullYear() ? '' : formatYear(figure.deathYear);
          const dateWidth = ((startYStr.length + endYStr.length + 3) * 14) + 60;

          // Maximum width of content
          const maxWidth = Math.max(nameWidth, occupationWidth, barWidth, dateWidth);

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
          
          const useWhiteText = 
            figure.category === 'LEADERS & BADDIES' || 
            figure.category === 'SCIENTISTS' || 
            figure.category === 'WRITERS';
            
          let textColorClass = useWhiteText ? 'text-white' : 'text-black';
          
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
                  textColorClass = 'text-white';
                  shadowClass = "shadow-2xl z-50";
                  animationClass = "animate-pulse-limited";
                  containerOpacityClass = "opacity-100 scale-105"; 
              } else {
                  containerOpacityClass = "opacity-20 grayscale";
              }
          } else {
              if (isHighlighted && !isSearchMode) {
                   shadowClass = "shadow-md ring-2 ring-black/20";
              }

              if (discoverySourceId === figure.id) {
                  barBackgroundColor = '#4f46e5'; 
                  textColorClass = 'text-white';
                  shadowClass = "shadow-xl z-50 ring-4 ring-indigo-200";
              } else if (isTracingTarget) {
                  barBackgroundColor = '#3b82f6';
                  textColorClass = 'text-white';
                  shadowClass = "shadow-xl z-50";
              } else if (isNew) {
                  barBackgroundColor = '#fbbf24';
                  textColorClass = 'text-black';
                  shadowClass = "shadow-md z-30";
              }
          }

          // Special Rendering for Short Events (< 15 Years)
          if (isEvent && duration < 15 && !isSearchMode && !isFocused) {
              const labelLevel = item.labelLevel ?? level;
              const labelOffset = item.labelYearOffset ?? 10;
              
              const BAR_VERTICAL_OFFSET = 32;
              
              const labelLeft = (figure.birthYear + labelOffset - startYear) * BASE_PIXELS_PER_YEAR;
              
              const isBelow = labelLevel > level;
              const isGap = labelLevel % 1 !== 0;
              
              const gapVisualOffset = isBelow ? 175 : 145;
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
                        className={`absolute h-[28px] rounded-sm z-10 pointer-events-auto cursor-pointer ${shadowClass}`}
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
                        className="absolute flex flex-col items-start min-w-[200px] z-20 pointer-events-auto cursor-pointer pl-2 origin-left"
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
                         <span className="text-lg font-bold text-gray-700 leading-none mt-1">
                            {formatYear(figure.birthYear)} - {figure.deathYear >= new Date().getFullYear() ? '' : formatYear(figure.deathYear)}
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
              if (!isEvent || duration >= 15 || isSearchMode || focusedFigureId === figure.id) return null;

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
              const gapVisualOffset = isBelow ? 175 : 145;
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
                        className="opacity-40"
                    />
                    {/* Circle at start */}
                    <circle cx={sStartX} cy={sStartY} r="2" fill="black" className="opacity-40" />

                    {/* Arrow at end */}
                    <path
                        d={arrowPath}
                        fill="none"
                        stroke="black"
                        strokeWidth="1.5"
                        className="opacity-60"
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
