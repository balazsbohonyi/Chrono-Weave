import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HistoricalFigure } from '../types';
import type { CanvasProps } from './CanvasProps';
import { calculateGalleryLayout, galleryCardBounds, GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH } from '../utils/galleryLayout';
import { galleryThread } from '../utils/connectionThread';
import { useFigurePortraits } from '../hooks/useFigurePortraits';
import { isRevealedAt, useConnectionReveal } from '../hooks/useConnectionReveal';
import FigureCard from './FigureCard';
import ActionBar from './ActionBar';
import ConnectionThread from './ConnectionThread';
import CanvasToolbar from './CanvasToolbar';
import { centerCameraOnBounds, pinchCamera, zoomCameraAt, type CanvasCamera, type Point } from '../utils/canvasCamera';
import { listenForCanvasWheel } from '../utils/canvasWheel';

type Drag = { pointerId: number; start: Point; moved: boolean };
const SIDEBAR_WIDTH = 544; // Sidebar's w-[34rem] at the application's 16px base size.

const GalleryCanvas: React.FC<CanvasProps> = ({ figures, modalActive, highlightedFigureIds, focusedFigureId,
  isSearchFocusActive = false, newlyDiscoveredIds, onDiscover, onTrace, onInspect, onRelationship,
  isFollowingFigure = false,
  isDiscovering = false, onCanvasInteraction, isBusy = false, selectedCategories,
  isLegendCollapsed, seedFigureId, isSidebarOpen = false, relationshipSourceId, initialCamera, onCameraChange, onToggleLayout,
  onConnect, pickingSource = null, isPickable, onPick, connection, connectionCurrentId, connectionFocus, onConnectionStep, onConnectionRevealEnd, onConnectionExit }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<CanvasCamera>(initialCamera ?? { x: 0, y: 0, scale: 1 });
  useLayoutEffect(() => { onCameraChange?.(camera); }, [camera, onCameraChange]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [actions, setActions] = useState<{ id: string; top: number; left: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const hadMultiplePointers = useRef(false);
  const trackpadUntil = useRef(0);
  const previousLayout = useRef<ReturnType<typeof calculateGalleryLayout> | null>(null);
  const layout = useMemo(() => calculateGalleryLayout(figures), [figures]);
  const headerHeight = isLegendCollapsed ? 52 : 114;
  const usableWidth = Math.max(1, viewport.width - (isSidebarOpen ? SIDEBAR_WIDTH : 0));
  const searchActive = isSearchFocusActive && highlightedFigureIds.length > 0;

  // Six Degrees: the shared reveal frames the chain, flies card to card, and draws the thread.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const reveal = useConnectionReveal({
    connection, focus: connectionFocus, onStep: onConnectionStep, onEnd: onConnectionRevealEnd,
    onExit: onConnectionExit, canExit: !modalActive && !pickingSource,
    getBounds: id => {
      const item = layout.placements.find(placement => placement.figure.id === id);
      return item ? galleryCardBounds(item) : null;
    },
    getCamera: () => cameraRef.current,
    setCamera,
    getArea: () => viewport.width ? { left: 0, top: headerHeight, width: usableWidth, height: Math.max(1, viewport.height - headerHeight) } : null,
  });
  const revealWasActive = useRef(false);
  const chainOrder = useMemo(() => new Map((connection?.nodeIds ?? []).map((id, index) => [id, index])), [connection]);
  const threadSegments = useMemo(() => {
    const byId = new Map(layout.placements.map(placement => [placement.figure.id, placement]));
    const chain = (connection?.nodeIds ?? []).map(id => byId.get(id));
    return chain.length > 1 && chain.every(Boolean) ? galleryThread(chain as typeof layout.placements) : [];
  }, [connection, layout]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!viewport.width || !layout.placements.length) return;
    const previous = previousLayout.current;
    previousLayout.current = layout;
    if (!previous) {
      if (initialCamera) return;
      setCamera(previous => ({ ...previous,
        x: layout.bounds.width * previous.scale <= usableWidth ? (usableWidth - layout.bounds.width * previous.scale) / 2 : 40,
        y: headerHeight + Math.max(32, (viewport.height - headerHeight - layout.bounds.height * previous.scale) / 2),
      }));
    } else if (previous !== layout) {
      // Repacking an expanded board keeps the nearest existing card in place.
      setCamera(position => {
        const center = { x: (usableWidth / 2 - position.x) / position.scale,
          y: ((viewport.height + headerHeight) / 2 - position.y) / position.scale };
        const anchor = previous.placements.reduce((nearest, item) =>
          Math.hypot(item.x + GALLERY_CARD_WIDTH / 2 - center.x, item.y + GALLERY_CARD_HEIGHT / 2 - center.y)
            < Math.hypot(nearest.x + GALLERY_CARD_WIDTH / 2 - center.x, nearest.y + GALLERY_CARD_HEIGHT / 2 - center.y)
            ? item : nearest);
        const next = layout.placements.find(item => item.figure.id === anchor.figure.id);
        return next ? { ...position, x: position.x + (anchor.x - next.x) * position.scale,
          y: position.y + (anchor.y - next.y) * position.scale } : position;
      });
    }
  }, [layout, viewport, usableWidth, headerHeight]);

  useLayoutEffect(() => {
    // Native keyboard focus can scroll an overflow-hidden ancestor. The camera
    // owns movement, so discard that extra scroll before painting the new frame.
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, [camera]);

  useEffect(() => {
    if (relationshipSourceId) setActions(null);
  }, [relationshipSourceId]);

  useEffect(() => {
    if (!searchActive || !focusedFigureId || isDiscovering || modalActive || !viewport.width) return;
    const item = layout.placements.find(item => item.figure.id === focusedFigureId);
    if (!item) return;
    setCamera(previous => ({ ...previous,
      x: usableWidth / 2 - (item.x + GALLERY_CARD_WIDTH / 2) * previous.scale,
      y: (viewport.height + headerHeight) / 2 - (item.y + GALLERY_CARD_HEIGHT / 2) * previous.scale,
    }));
  }, [searchActive, focusedFigureId, isDiscovering, modalActive, viewport, usableWidth, headerHeight, layout]);

  const visibleFigures = useMemo(() => {
    const left = -camera.x / camera.scale, right = (viewport.width - camera.x) / camera.scale;
    const top = -camera.y / camera.scale, bottom = (viewport.height - camera.y) / camera.scale;
    return layout.placements.filter(item => item.x + GALLERY_CARD_WIDTH >= left - GALLERY_CARD_WIDTH
      && item.x <= right + GALLERY_CARD_WIDTH && item.y + GALLERY_CARD_HEIGHT >= top - GALLERY_CARD_HEIGHT
      && item.y <= bottom + GALLERY_CARD_HEIGHT).map(item => item.figure);
  }, [layout, camera, viewport]);
  const portraits = useFigurePortraits(visibleFigures);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => {
      if (modalActive) return;
      event.preventDefault();
      reveal.interrupt();
      onCanvasInteraction?.();
      setActions(null);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      const modifiedZoom = event.ctrlKey || event.metaKey;
      const physicalWheel = event.deltaMode !== 0 || (!event.deltaX && Math.abs(event.deltaY) >= 40);
      const trackpadSignature = event.deltaMode === 0 && (!!event.deltaX || (event.deltaY !== 0 && !physicalWheel));
      const now = performance.now();
      if (trackpadSignature) trackpadUntil.current = now + 300;
      // Fine trackpad scrolling pans, physical wheel impulses zoom. Keep that
      // distinction stable during trackpad acceleration; Shift still pans sideways.
      if (modifiedZoom || (!event.shiftKey && physicalWheel && now >= trackpadUntil.current)) {
        const bounds = container.getBoundingClientRect();
        const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        const sensitivity = modifiedZoom && !physicalWheel ? 0.01 : 0.001;
        const factor = Math.exp(-event.deltaY * unit * sensitivity);
        setCamera(previous => zoomCameraAt(previous, previous.scale * factor, anchor));
        return;
      }
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
      setCamera(previous => ({ ...previous, x: previous.x - dx * unit, y: previous.y - dy * unit }));
    };
    const suppressMiddleClick = (event: MouseEvent) => { if (event.button === 1) event.preventDefault(); };
    const stopWheel = listenForCanvasWheel(container, wheel, modalActive);
    container.addEventListener('mousedown', suppressMiddleClick);
    container.addEventListener('auxclick', suppressMiddleClick);
    return () => {
      stopWheel();
      container.removeEventListener('mousedown', suppressMiddleClick);
      container.removeEventListener('auxclick', suppressMiddleClick);
    };
  }, [modalActive, onCanvasInteraction, reveal.interrupt]);

  useEffect(() => {
    if (pickingSource) setActions(null);
  }, [pickingSource]);

  useEffect(() => {
    if (!actions) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalActive) setActions(null);
    };
    const clickAway = (event: PointerEvent) => {
      if (modalActive || !(event.target instanceof Element)) return;
      if (containerRef.current?.contains(event.target)
        && event.target.closest('[data-figure-id], [data-figure-actions]')) return;
      setActions(null);
    };
    window.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', clickAway, true);
    return () => {
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', clickAway, true);
    };
  }, [actions, modalActive]);

  const activateFigure = (figure: HistoricalFigure, point: Point) => {
    // A click on a ghosted person leaves the connection view, then acts as an ordinary click.
    if (connection && !pickingSource && !chainOrder.has(figure.id)) onConnectionExit?.();
    // Choosing the other end of a Six Degrees chain: a card picks, and never opens actions.
    if (pickingSource) {
      // Dimmed cards are forwarded too: the search refuses them with the reason, in the banner.
      if (!modalActive && figure.id !== pickingSource.id) onPick?.(figure);
      return;
    }
    if (isBusy || isDiscovering || modalActive) return;
    if (!onDiscover || !onTrace || !onInspect) return;
    const bounds = containerRef.current!.getBoundingClientRect();
    setActions({ id: figure.id,
      left: Math.max(0, Math.min(point.x - bounds.left, bounds.width - 240)),
      top: Math.max(0, Math.min(point.y - bounds.top, bounds.height - 140)),
    });
  };

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (modalActive || (event.button !== 0 && event.button !== 1)) return;
    if (event.button !== 1) event.preventDefault();
    // Touching the canvas takes the camera back from a running reveal; a plain click also skips to its end.
    revealWasActive.current = reveal.interrupt();
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) hadMultiplePointers.current = false;
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 1) {
      drag.current = { pointerId: event.pointerId, start: point, moved: false };
      if (event.target instanceof Element) event.target.closest<HTMLButtonElement>('[data-figure-id]')?.focus({ preventScroll: true });
    } else {
      hadMultiplePointers.current = true;
      drag.current = null;
    }
    setIsDragging(true);
    onCanvasInteraction?.();
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before || modalActive) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    const previousPair = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point);
    setActions(null);
    if (pointers.current.size === 2) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const local = (position: Point) => ({ x: position.x - bounds.left, y: position.y - bounds.top });
      const nextPair = [...pointers.current.values()];
      setCamera(previous => pinchCamera(previous,
        [local(previousPair[0]), local(previousPair[1])], [local(nextPair[0]), local(nextPair[1])]));
    } else {
      const divisor = pointers.current.size;
      setCamera(previous => ({ ...previous, x: previous.x + (point.x - before.x) / divisor,
        y: previous.y + (point.y - before.y) / divisor }));
    }
    if (drag.current) {
      if (Math.hypot(point.x - drag.current.start.x, point.y - drag.current.start.y) >= 5) drag.current.moved = true;
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && !hadMultiplePointers.current && current?.pointerId === event.pointerId && !current.moved && event.button === 0
        && revealWasActive.current) {
      revealWasActive.current = false;
      reveal.settle();
    } else if (!cancelled && !hadMultiplePointers.current && current?.pointerId === event.pointerId && !current.moved && event.button === 0) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const id = target?.closest('[data-figure-id]')?.getAttribute('data-figure-id');
      const figure = figures.find(figure => figure.id === id);
      if (figure && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        activateFigure(figure, { x: event.clientX, y: event.clientY });
      } else if (!id) setActions(null);
    }
    const remaining = [...pointers.current.entries()][0];
    drag.current = pointers.current.size === 1 && remaining ? { pointerId: remaining[0], start: remaining[1], moved: true } : null;
    setIsDragging(pointers.current.size > 0);
  };

  const actionFigure = actions ? figures.find(figure => figure.id === actions.id) : undefined;
  const actionImage = actionFigure && (actionFigure.imageUrl || portraits.get(actionFigure.id));
  const resetZoom = () => {
    // The toolbar sits outside the canvas, so it must take the camera back from a running reveal itself.
    reveal.interrupt();
    onCanvasInteraction?.();
    setActions(null);
    setCamera(centerCameraOnBounds(layout.bounds,
      { x: usableWidth / 2, y: (viewport.height + headerHeight) / 2 }));
  };

  return (
    <>
    <div ref={containerRef} data-layout-mode="gallery" role="region" aria-label="Historical figure card board"
      className={`relative w-full h-full overflow-hidden select-none bg-canvas touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)}>
      <div data-gallery-board className="absolute top-0 left-0 will-change-transform"
        style={{ width: layout.bounds.width, height: layout.bounds.height, transformOrigin: 'top left',
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        {layout.placements.map(({ figure, x, y }) => {
          const isFocused = searchActive && focusedFigureId === figure.id;
          const isPickingSource = pickingSource?.id === figure.id;
          const chainIndex = pickingSource ? undefined : chainOrder.get(figure.id);
          const isChained = chainIndex !== undefined;
          // While a connection is shown only its people are lit, each once the thread has reached it (and
          // whatever the category filter says); everyone else is ghosted.
          const isGhosted = !!connection && !pickingSource && !searchActive && (!isChained || !isRevealedAt(reveal.progress, chainIndex));
          const isDimmed = pickingSource ? !isPickingSource && !isPickable?.(figure)
            : searchActive ? !isFocused : isGhosted || (!connection && selectedCategories.size > 0 && !selectedCategories.has(figure.category));
          return <FigureCard key={figure.id} figure={figure} imageUrl={figure.imageUrl || portraits.get(figure.id)}
            isSource={figure.id === seedFigureId || isPickingSource} data-figure-id={figure.id}
            aria-label={pickingSource ? `Connect ${pickingSource.name} to ${figure.name}` : `Actions for ${figure.name}`}
            aria-disabled={pickingSource ? isDimmed || isPickingSource : undefined}
            className={`gallery-card ${isFocused ? 'gallery-focused' : ''} ${newlyDiscoveredIds?.has(figure.id) ? 'gallery-new' : ''} ${isChained ? 'gallery-connected' : ''} ${isChained && connectionCurrentId === figure.id ? 'gallery-current' : ''}`}
            style={{ left: x, top: y, width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT,
              opacity: isGhosted ? 0.07 : isDimmed ? 0.15 : 1, filter: isDimmed ? 'grayscale(1)' : undefined }}
            badge={isChained && connection ? { number: chainIndex + 1, scale: Math.min(2.5, Math.max(1, 1 / camera.scale)) } : undefined}
            onFocus={() => {
              // Keyboard navigation reveals off-screen cards at the current zoom.
              // Pointer focus must keep the card under the pointer until release.
              if (pointers.current.size) return;
              if (!containerRef.current?.matches(':focus-within')) return;
              const element = document.activeElement as HTMLElement;
              if (!element?.matches(':focus-visible')) return;
              onCanvasInteraction?.();
              setCamera(previous => ({ ...previous, x: usableWidth / 2 - (x + GALLERY_CARD_WIDTH / 2) * previous.scale,
                y: (viewport.height + headerHeight) / 2 - (y + GALLERY_CARD_HEIGHT / 2) * previous.scale }));
            }}
            onClick={event => {
              if (event.detail !== 0) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              activateFigure(figure, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
            }} />;
        })}
        {threadSegments.length > 0 && (
          <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" style={{ zIndex: 5 }}
            width={layout.bounds.width} height={layout.bounds.height} aria-hidden="true">
            <ConnectionThread segments={threadSegments} progress={reveal.progress} strokeWidth={3 / camera.scale} />
          </svg>
        )}
      </div>
      {actionFigure && actions && onDiscover && onTrace && onInspect && !isDiscovering && !isBusy && !pickingSource && (
        <ActionBar figure={actionImage ? { ...actionFigure, imageUrl: actionImage } : actionFigure}
          onDiscover={onDiscover} onTrace={onTrace} onInspect={onInspect} onConnect={onConnect} isDiscovering={isDiscovering}
          onDismiss={() => setActions(null)}
          isFollowingFigure={isFollowingFigure} focusFigureId={seedFigureId} onRelationship={onRelationship}
          style={{ top: actions.top, left: actions.left }} />
      )}
    </div>
    <CanvasToolbar mode="gallery" scale={camera.scale} onResetZoom={resetZoom} onToggleLayout={onToggleLayout && (() => { reveal.interrupt(); onToggleLayout(); })}
      disabled={modalActive || isBusy || !figures.length} />
    </>
  );
};

export default GalleryCanvas;
