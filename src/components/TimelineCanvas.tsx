
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ViewState } from '../types';
import { CATEGORY_COLORS, CATEGORY_BAR_TEXT_COLORS } from '../constants';
import { formatYear } from '../utils/formatters';
import ActionBar from './ActionBar';
import CanvasZoomReset from './CanvasZoomReset';
import { centerCameraOnBounds } from '../utils/canvasCamera';
import { listenForCanvasWheel } from '../utils/canvasWheel';
import { BASE_PIXELS_PER_YEAR, ROW_HEIGHT, calculateTextWidth, calculateTimelineLayout } from '../utils/timelineLayout';
import type { CanvasProps } from './CanvasProps';

// Config
const AXIS_INTERVAL = 50; 
const SIDEBAR_WIDTH = 544; // Sidebar's 34rem width at the application's base size.
const MOUSE_WHEEL_IMPULSE_THRESHOLD_PX = 40;
const TRACKPAD_STICKY_MS = 300;
const IS_MAC_PLATFORM = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

const TimelineCanvas: React.FC<CanvasProps> = ({
  figures, 
  startYear, 
  endYear,
  onHoverYear,
  onYearClick,
  onEmptyClick,
  selectedYear,
  clusters,
  clusterPlacements,
  onPlacementsResolved,
  initialLayout,
  initialCamera,
  onCameraChange,
  modalActive,
  relationshipSourceId,
  highlightedFigureIds,
  focusedFigureId,
  isSearchFocusActive = false,
  newlyDiscoveredIds = new Set<string>(),
  onDiscover,
  onTrace,
  onInspect,
  onRelationship,
  isFollowingFigure = false,
  seedFigureId,
  isDiscovering = false,
  onCanvasInteraction,
  isBusy = false,
  selectedCategories,
  isLegendCollapsed,
  isSidebarOpen = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const warnedCategoriesRef = useRef<Set<string>>(new Set());

  const [viewState, setViewState] = useState<ViewState>({
    scale: initialCamera?.scale ?? 1,
    translateX: initialCamera?.x ?? 0,
    translateY: initialCamera?.y ?? 0,
  });
  useLayoutEffect(() => {
    onCameraChange?.({ x: viewState.translateX, y: viewState.translateY, scale: viewState.scale });
  }, [viewState, onCameraChange]);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const wasSearchFocusedOnDown = useRef(false);

  // Multi-pointer tracking for touchscreen pinch-to-zoom
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const lastPinchDistanceRef = useRef<number | null>(null);
  const pinchedRef = useRef(false);

  // Wheel events do not expose their source device. Large vertical-only pixel
  // impulses are treated as mouse-wheel notches; finer or horizontal events
  // are kept in trackpad mode for the duration of the gesture.
  const isTrackpadModeRef = useRef<boolean>(false);
  const trackpadModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [hoverYearVal, setHoverYearVal] = useState<number | null>(null);

  // Figure actions stay open until Escape or an explicit click away.
  const [actionFigureId, setActionFigureId] = useState<string | null>(null);
  const [actionBarCoords, setActionBarCoords] = useState<{top: number, left: number} | null>(null);

  useEffect(() => {
    if (!actionFigureId) return;
    const dismiss = () => {
      setActionFigureId(null);
      setActionBarCoords(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalActive) dismiss();
    };
    const handleClickAway = (event: PointerEvent) => {
      if (modalActive) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (containerRef.current?.contains(target)) {
        if (target.closest('[data-figure-actions]')) return;
        if (target.closest('[data-figure-id]') && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) return;
      }
      dismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handleClickAway, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handleClickAway, true);
    };
  }, [actionFigureId, modalActive]);

  const { layoutData, totalRows } = useMemo(
    () => initialLayout?.figures === figures && !clusters.length
      ? initialLayout.result : calculateTimelineLayout(figures, clusters, clusterPlacements),
    [figures, clusters, clusterPlacements, initialLayout]
  );

  useEffect(() => {
    if (relationshipSourceId) {
      setActionFigureId(null);
      setActionBarCoords(null);
    }
  }, [relationshipSourceId]);

  useEffect(() => {
      onPlacementsResolved(layoutData);
  }, [layoutData, onPlacementsResolved]);

  // 2. Auto-Zoom logic
  useEffect(() => {
    if (focusedFigureId && containerRef.current && !isDiscovering && !modalActive && isSearchFocusActive) {
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
  }, [layoutData, focusedFigureId, isDiscovering, isSearchFocusActive, modalActive]);

  const contentWidth = (endYear - startYear) * BASE_PIXELS_PER_YEAR;

  // 3. Interaction Handlers

  // Native wheel listener (non-passive) for trackpad/mouse gesture differentiation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (modalActive) return;
      // Keep wheel scrolling and browser zoom contained within the timeline.
      e.preventDefault();

      if (highlightedFigureIds.length > 0 && onCanvasInteraction) {
        onCanvasInteraction();
      }

      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Determine if this is a zoom or pan gesture
      const isCtrl = e.ctrlKey || e.metaKey; // ctrlKey = trackpad pinch gesture
      const isShift = e.shiftKey;
      const isLineOrPageMode = e.deltaMode !== 0; // line/page mode = physical mouse wheel
      const hasDeltaX = Math.abs(e.deltaX) > 0;

      // The target mouse reports approximately 90.91px per notch, while the
      // Precision Touchpad reports fine-grained values around 0.91-3.64px.
      // Line/page deltas are always physical wheel input.
      const isMouseWheelImpulse = isLineOrPageMode || (
        !hasDeltaX && Math.abs(e.deltaY) >= MOUSE_WHEEL_IMPULSE_THRESHOLD_PX
      );
      const hasTrackpadSignature = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && (
        hasDeltaX || (e.deltaY !== 0 && !isMouseWheelImpulse)
      );

      // Keep trackpad classification sticky so acceleration within one gesture
      // cannot cause a mid-gesture switch from panning to zooming.
      if (hasTrackpadSignature) {
        isTrackpadModeRef.current = true;
        if (trackpadModeTimerRef.current) clearTimeout(trackpadModeTimerRef.current);
        trackpadModeTimerRef.current = setTimeout(() => {
          isTrackpadModeRef.current = false;
        }, TRACKPAD_STICKY_MS);
      }

      const looksLikeTrackpad = isTrackpadModeRef.current || hasTrackpadSignature;

      const shouldZoom = isCtrl || isShift || isLineOrPageMode || !looksLikeTrackpad;

      if (shouldZoom) {
        // Fine Ctrl/Cmd wheel input is a trackpad pinch. A physical wheel keeps
        // ordinary wheel sensitivity even when Ctrl/Cmd is held.
        const scaleSensitivity = isCtrl && !isMouseWheelImpulse ? 0.01 : 0.001;
        setViewState(prev => {
          let newScale = prev.scale * (1 - e.deltaY * scaleSensitivity);
          newScale = Math.max(0.1, Math.min(5, newScale));
          const scaleRatio = newScale / prev.scale;
          const newTranslateX = mouseX - (mouseX - prev.translateX) * scaleRatio;
          const newTranslateY = mouseY - (mouseY - prev.translateY) * scaleRatio;
          return { scale: newScale, translateX: newTranslateX, translateY: newTranslateY };
        });
      } else {
        // Pan: two-finger trackpad scroll
        setViewState(prev => {
          let nextX = prev.translateX - e.deltaX;
          const nextY = prev.translateY - e.deltaY;

          // Clamp X panning
          const viewportWidth = rect.width;
          const totalTimelineWidth = contentWidth * prev.scale;
          const buffer = viewportWidth * 0.8;
          const maxTranslateX = buffer;
          const minTranslateX = viewportWidth - totalTimelineWidth - buffer;
          nextX = Math.min(maxTranslateX, Math.max(minTranslateX, nextX));

          return { ...prev, translateX: nextX, translateY: nextY };
        });
      }
    };

    return listenForCanvasWheel(el, handleWheel, modalActive);
  }, [highlightedFigureIds, onCanvasInteraction, contentWidth, modalActive]);

  // Cleanup trackpad detection timer
  useEffect(() => {
    return () => {
      if (trackpadModeTimerRef.current) clearTimeout(trackpadModeTimerRef.current);
    };
  }, []);

  // Let the compatibility mousedown event suppress Chrome's middle-click
  // autoscroll UI while Pointer Events continue to own the drag itself.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const suppressMiddleClickDefault = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    el.addEventListener('mousedown', suppressMiddleClickDefault);
    el.addEventListener('auxclick', suppressMiddleClickDefault);
    return () => {
      el.removeEventListener('mousedown', suppressMiddleClickDefault);
      el.removeEventListener('auxclick', suppressMiddleClickDefault);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Check if clicking on the close button - allow it to propagate normally
    const target = e.target as HTMLElement;
    if (target.closest('button[data-close-selection]')) {
      return;
    }

    // Middle-button default is suppressed by the native mousedown listener so
    // the compatibility mouse event remains available in Chrome.
    if (e.button !== 1) e.preventDefault();

    // Track all active pointers for multi-touch
    if (activePointersRef.current.size === 0) pinchedRef.current = false;
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (containerRef.current) {
      containerRef.current.setPointerCapture(e.pointerId);
    }

    if (activePointersRef.current.size === 2) {
      pinchedRef.current = true;
      // Two pointers: start pinch mode, cancel any drag
      setIsDragging(false);
      const pointers = [...activePointersRef.current.values()] as { clientX: number; clientY: number }[];
      lastPinchDistanceRef.current = Math.hypot(
        pointers[1].clientX - pointers[0].clientX,
        pointers[1].clientY - pointers[0].clientY
      );
      return;
    }

    wasSearchFocusedOnDown.current = isSearchFocusActive && highlightedFigureIds.length > 0;

    if (highlightedFigureIds.length > 0 && onCanvasInteraction) {
        onCanvasInteraction();
    }

    if (e.button === 0 || e.button === 1) {
        setIsDragging(true);
        const pos = { x: e.clientX, y: e.clientY };
        setLastMousePos(pos);
        dragStartPos.current = pos;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const wasPinching = activePointersRef.current.size === 2;
    activePointersRef.current.delete(e.pointerId);

    if (containerRef.current) {
        try {
            containerRef.current.releasePointerCapture(e.pointerId);
        } catch (_) {
            // Pointer capture may not have been set (e.g., on close button click)
        }
    }

    // Transition from pinch (2 pointers) to single-pointer drag
    if (wasPinching && activePointersRef.current.size === 1) {
      lastPinchDistanceRef.current = null;
      const remaining = ([...activePointersRef.current.values()] as { clientX: number; clientY: number }[])[0];
      setLastMousePos({ x: remaining.clientX, y: remaining.clientY });
      setIsDragging(true);
      return;
    }

    setIsDragging(false);
    lastPinchDistanceRef.current = null;

    const dist = Math.hypot(e.clientX - dragStartPos.current.x, e.clientY - dragStartPos.current.y);

    if (dist < 5 && e.button === 0 && !pinchedRef.current) {
        // Check if we clicked on the close button
        const hitElement = document.elementFromPoint(e.clientX, e.clientY);
        if (hitElement?.closest('button[data-close-selection]')) {
            return;
        }

        if (isBusy) return;

        const shouldConsumeForSearch = wasSearchFocusedOnDown.current;
        wasSearchFocusedOnDown.current = false;

        const isMousePointer = e.pointerType === 'mouse';
        const hasAnyModifier = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
        const hasExactSelectionModifier = isMousePointer
          && !e.altKey
          && !e.shiftKey
          && (IS_MAC_PLATFORM
            ? e.metaKey && !e.ctrlKey
            : e.ctrlKey && !e.metaKey);

        // Alt takes priority over every other modifier. It only resets state
        // when a selected-year line is currently visible.
        if (isMousePointer && e.altKey) {
            if (selectedYear !== null) {
                onEmptyClick();
            }
            return;
        }

        // The platform-specific modifier selects a year. Search focus was
        // already dismissed on pointer down, so the shortcut works immediately.
        if (hasExactSelectionModifier) {
            if (hoverYearVal === null) {
                return;
            }

            const clickedYear = hoverYearVal;
            const activeItems = layoutData.filter(({ figure }) =>
                clickedYear >= figure.birthYear && clickedYear <= figure.deathYear
            );
            activeItems.sort((a, b) => a.level - b.level);
            const sortedFigures = activeItems.map(item => item.figure);
            onYearClick(clickedYear, sortedFigures);
            return;
        }

        // Leave unsupported or mixed modifier chords available for future
        // interactions instead of treating them as ordinary clicks.
        if (hasAnyModifier) {
            return;
        }

        // HIT TEST FOR FIGURE
        // Because of pointer capture on container, the e.target will likely be the container.
        // We use elementFromPoint to find what is visually under the cursor.
        const figureId = hitElement?.closest('[data-figure-id]')?.getAttribute('data-figure-id');

        if (shouldConsumeForSearch && !figureId) return;
        
        if (figureId) {
             const figure = figures.find(f => f.id === figureId);
             if (figure && onDiscover && onTrace && onInspect && !isDiscovering) {
                 const rect = containerRef.current!.getBoundingClientRect();
                 setActionFigureId(figureId);
                 setActionBarCoords({
                     left: Math.max(0, Math.min(e.clientX - rect.left, rect.width - 240)),
                     top: Math.max(0, Math.min(e.clientY - rect.top, rect.height - 140))
                 });
                 return;
             }
        }

        setActionFigureId(null);
        setActionBarCoords(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault();

    // Update stored pointer position
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    }

    // Two-pointer pinch-to-zoom
    if (activePointersRef.current.size === 2 && lastPinchDistanceRef.current !== null) {
      const pointers = [...activePointersRef.current.values()] as { clientX: number; clientY: number }[];
      const newDist = Math.hypot(
        pointers[1].clientX - pointers[0].clientX,
        pointers[1].clientY - pointers[0].clientY
      );
      const ratio = newDist / lastPinchDistanceRef.current;
      lastPinchDistanceRef.current = newDist;

      // Zoom centered on midpoint between fingers
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const midX = (pointers[0].clientX + pointers[1].clientX) / 2 - rect.left;
        const midY = (pointers[0].clientY + pointers[1].clientY) / 2 - rect.top;

        setViewState(prev => {
          let newScale = prev.scale * ratio;
          newScale = Math.max(0.1, Math.min(5, newScale));
          const scaleRatio = newScale / prev.scale;
          const newTranslateX = midX - (midX - prev.translateX) * scaleRatio;
          const newTranslateY = midY - (midY - prev.translateY) * scaleRatio;
          return { scale: newScale, translateX: newTranslateX, translateY: newTranslateY };
        });
      }
      return;
    }

    if (isDragging) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;

      setViewState(prev => {
          let nextX = prev.translateX + dx;
          if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const viewportWidth = rect.width;
              const totalTimelineWidth = contentWidth * prev.scale;
              const buffer = viewportWidth * 0.8;
              const maxTranslateX = buffer;
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

    if (activePointersRef.current.size <= 1 && containerRef.current) {
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

  const handlePointerCancel = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    lastPinchDistanceRef.current = null;
    if (activePointersRef.current.size === 0) {
      setIsDragging(false);
    }
  };

  
  const contentHeight = (totalRows + 1) * ROW_HEIGHT + 100;
  
  const tickStart = Math.floor((startYear - 500) / AXIS_INTERVAL) * AXIS_INTERVAL;
  const tickEnd = Math.ceil((endYear + 500) / AXIS_INTERVAL) * AXIS_INTERVAL;
  const ticks = [];
  for (let y = tickStart; y <= tickEnd; y += AXIS_INTERVAL) {
      ticks.push(y);
  }

  const actionLayoutItem = actionFigureId ? layoutData.find(l => l.figure.id === actionFigureId) : null;
  const isSearchMode = highlightedFigureIds.length > 0 && !isDiscovering && isSearchFocusActive;
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-default';

  // Calculate screen position for red selected year line
  const selectedYearScreenX = selectedYear !== null
    ? ((selectedYear - startYear) * BASE_PIXELS_PER_YEAR * viewState.scale) + viewState.translateX
    : null;

  // Determine top offset for axes based on filters
  const axisTopOffset = isLegendCollapsed ? '52px' : '114px';
  const resetZoom = () => {
    const container = containerRef.current;
    if (!container) return;
    onCanvasInteraction?.();
    setActionFigureId(null);
    setActionBarCoords(null);
    const rectangles = [...container.querySelectorAll<HTMLElement>('[data-figure-id]')].map(element => element.getBoundingClientRect());
    if (!rectangles.length) {
      setViewState({ scale: 1, translateX: 0, translateY: 0 });
      return;
    }
    const origin = container.getBoundingClientRect();
    const left = Math.min(...rectangles.map(rect => rect.left)), top = Math.min(...rectangles.map(rect => rect.top));
    const right = Math.max(...rectangles.map(rect => rect.right)), bottom = Math.max(...rectangles.map(rect => rect.bottom));
    const camera = centerCameraOnBounds({
      left: (left - origin.left - viewState.translateX) / viewState.scale,
      top: (top - origin.top - viewState.translateY) / viewState.scale,
      width: (right - left) / viewState.scale, height: (bottom - top) / viewState.scale,
    }, { x: Math.max(1, container.clientWidth - (isSidebarOpen ? SIDEBAR_WIDTH : 0)) / 2,
      y: (container.clientHeight + (isLegendCollapsed ? 52 : 114)) / 2 });
    setViewState({ scale: camera.scale, translateX: camera.x, translateY: camera.y });
  };

  return (
    <>
    <div 
      ref={containerRef}
      data-layout-mode="timeline"
      className={`relative w-full h-full overflow-hidden select-none bg-canvas touch-none ${cursorClass}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
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
                 <div key={year} className="absolute top-0 bottom-0 border-l border-timeline-grid/20" style={{ left: (year - startYear) * BASE_PIXELS_PER_YEAR }} />
            ))}
        </div>

      {/* LAYER 1: Red Ghost Line (Behind Everything) */}
      {selectedYearScreenX !== null && (
          <div
              className="absolute top-0 bottom-0 w-[2px] bg-danger-marker z-0 pointer-events-none"
              style={{ left: selectedYearScreenX }}
          />
      )}

      {/* Red Label - Above Selection Rectangles */}
      {selectedYearScreenX !== null && (
          <div
              className="absolute bg-danger-solid text-on-accent text-xs font-mono py-1 rounded shadow-lg z-[50] flex items-center"
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
                className="p-0.5 hover:bg-danger-solid-hover/50 rounded transition-colors cursor-pointer flex-shrink-0"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                className="absolute bg-surface/95 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-ring/5 pointer-events-none"
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
          const measurement = calculateTextWidth(figure);
          const barWidth = Math.max(duration * BASE_PIXELS_PER_YEAR, 10);
          const maxWidth = Math.max(measurement.totalWidthPx, barWidth);

          // Add horizontal and vertical padding
          const hPadding = 15;
          const vPadding = 8;

          return (
            <div
              key={`sel-rect-${figure.id}`}
              className="absolute bg-surface/95 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-ring/5 pointer-events-none"
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
          
          let barTextColor = CATEGORY_BAR_TEXT_COLORS[figure.category] || CATEGORY_BAR_TEXT_COLORS['LEADERS & BADDIES'];
          
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
                  barBackgroundColor = 'rgb(var(--color-timeline-search))';
                  barTextColor = 'rgb(var(--color-timeline-search-text))';
                  shadowClass = "shadow-2xl z-50";
                  animationClass = "animate-pulse-limited";
                  containerOpacityClass = "opacity-100";
              } else {
                  containerOpacityClass = "opacity-20 grayscale";
              }
          } else {
              if (isHighlighted && !isSearchMode) {
                   shadowClass = "shadow-md ring-2 ring-ring/20";
              }

              if (relationshipSourceId === figure.id) {
                  shadowClass = "shadow-xl z-50 ring-4 ring-accent-border";

              } else if (isNew) {
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
                     >
                         <span className="text-[22px] font-black text-timeline-label leading-none uppercase drop-shadow-sm filter-none whitespace-nowrap">
                             {figure.name}
                         </span>
                         <span className="text-lg font-bold text-content-body leading-none mt-1 whitespace-nowrap">
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
            >
              <div className="text-[22px] font-black text-timeline-label leading-tight mb-1 uppercase w-full text-left drop-shadow-sm whitespace-nowrap">
                  {figure.name}
              </div>

              <div className="relative w-full flex items-center">
                  <div 
                    className={`h-[28px] flex items-center pl-4 pr-2 rounded-md transition-all duration-300 ${shadowClass}`}
                    style={{ 
                        width: `${Math.max(width, 10)}px`,
                        backgroundColor: barBackgroundColor 
                    }}
                  >
                    <span className="text-lg font-bold whitespace-nowrap" style={{ color: barTextColor }}>
                        {formatYear(figure.birthYear)} - {figure.deathYear >= new Date().getFullYear() ? '' : formatYear(figure.deathYear)}
                    </span>
                  </div>
              </div>

              <div className="text-[18px] font-bold text-timeline-label mt-1 whitespace-nowrap w-auto text-left leading-tight opacity-90 group-hover:opacity-100 capitalize">
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
                        stroke="rgb(var(--color-timeline-connector))"
                        strokeWidth="1.5"
                        className="opacity-80"
                    />
                    {/* Arrow at end */}
                    <path
                        d={arrowPath}
                        fill="none"
                        stroke="rgb(var(--color-timeline-connector))"
                        strokeWidth="1.5"
                        className="opacity-80"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                  </g>
              );
          })}
      </svg>

      {/* LAYER 3: Labels (Bottom) - Glossy */}
      <div
            className="absolute bottom-0 left-0 h-6 bg-timeline-axis/75 backdrop-blur-2xl pointer-events-none z-[70]"
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
                        <div className="absolute top-0 w-[2px] h-[6px] bg-timeline-axis-label" style={{ left: '-1px', transform: `scaleX(${1/viewState.scale})`, transformOrigin: 'center' }} />
                        <span
                             className="absolute top-[5px] text-[12px] font-sans-serif text-timeline-axis-label font-bold whitespace-nowrap"
                             style={{ left: '0', transform: `scaleX(${1/viewState.scale}) translateX(-50%)`, transformOrigin: 'left center' }}
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
            className="absolute left-0 h-6 bg-timeline-axis/70 backdrop-blur-2xl pointer-events-none z-[60] transition-[top] duration-300 ease-in-out"
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
                        <div className="absolute bottom-0 w-[2px] h-[6px] bg-timeline-axis-label" style={{ left: '-1px', transform: `scaleX(${1/viewState.scale})`, transformOrigin: 'center' }} />
                        <span
                             className="absolute top-[3px] text-[12px] font-sans-serif text-timeline-axis-label font-bold whitespace-nowrap"
                             style={{ left: '0', transform: `scaleX(${1/viewState.scale}) translateX(-50%)`, transformOrigin: 'left center' }}
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
            className="absolute top-0 bottom-0 w-px bg-accent-marker/70 z-30 pointer-events-none"
            style={{ left: cursorX }}
        >
            <div
                className="absolute left-2 bg-accent-solid text-on-accent text-xs font-mono px-2 py-1 rounded shadow-lg transition-all duration-300 z-[100]"
                style={{ bottom: '35px' }}
            >
                {formatYear(Math.floor(hoverYearVal || 0))}
            </div>
        </div>
      )}

      {/* LAYER 5: Figure Actions */}
      {actionLayoutItem && actionBarCoords && onDiscover && onTrace && onInspect && !isDiscovering && !isBusy && (
          <ActionBar 
              figure={actionLayoutItem.figure}
              onDiscover={onDiscover}
              onTrace={onTrace}
              onInspect={onInspect}
              isDiscovering={!!isDiscovering}
              isFollowingFigure={isFollowingFigure}
              focusFigureId={seedFigureId}
              onRelationship={onRelationship}
              style={actionBarCoords}
          />
      )}
    </div>
    <CanvasZoomReset scale={viewState.scale} onReset={resetZoom} disabled={modalActive} />
    </>
  );
};

export default TimelineCanvas;
