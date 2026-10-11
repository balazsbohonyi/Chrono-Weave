import React, { useEffect, useRef, useState } from 'react';

interface LauncherExampleScrollerProps {
  examples: string[];
  disabled: boolean;
  onSelect: (example: string) => void;
}

const LauncherExampleScroller: React.FC<LauncherExampleScrollerProps> = ({ examples, disabled, onSelect }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  const getLoopWidth = (viewport: HTMLDivElement) => {
    const groups = viewport.querySelectorAll<HTMLElement>('.launcher-examples-group');
    return groups.length === 2 ? groups[1].offsetLeft - groups[0].offsetLeft : 0;
  };

  const scrollTo = (viewport: HTMLDivElement, position: number) => {
    const loopWidth = getLoopWidth(viewport);
    if (loopWidth > 0) viewport.scrollLeft = ((position % loopWidth) + loopWidth) % loopWidth;
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || disabled || isHovered || isFocused || isDragging || reducedMotion) return;
    let frameId: number;
    let lastTime: number | null = null;
    const advance = (time: number) => {
      if (lastTime !== null) scrollTo(viewport, viewport.scrollLeft + Math.min(time - lastTime, 64) * 0.04);
      lastTime = time;
      frameId = requestAnimationFrame(advance);
    };
    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [disabled, examples, isHovered, isFocused, isDragging, reducedMotion]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: event.currentTarget.scrollLeft,
      moved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    scrollTo(event.currentTarget, drag.startScroll - delta);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={viewportRef}
      className={`launcher-examples-viewport${isDragging ? ' launcher-examples-viewport--dragging' : ''}`}
      aria-label="Example queries"
      aria-busy={disabled}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsFocused(false);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onClickCapture={(event) => {
        if (suppressClickRef.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
    >
      <div className="launcher-examples-track">
        {[false, true].map(isDuplicate => (
          <div className="launcher-examples-group" key={String(isDuplicate)} aria-hidden={isDuplicate || undefined}>
            {examples.map(example => (
              <button
                key={example}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(example)}
                disabled={disabled}
                tabIndex={isDuplicate ? -1 : undefined}
                className="launcher-example-chip"
              >
                {example}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LauncherExampleScroller;
