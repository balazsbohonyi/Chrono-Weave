import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasSnapshot } from '../types';
import { canvasHistoryDetails } from '../utils/canvasHistory';
import { formatYear } from '../utils/formatters';

interface Props {
  canvases: CanvasSnapshot[];
  onSelect: (canvas: CanvasSnapshot) => void;
  orientation?: 'vertical' | 'horizontal';
}

const CanvasHistory: React.FC<Props> = ({ canvases, onSelect, orientation = 'vertical' }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({});
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tooltip = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const summaries = useMemo(() => canvases.map(canvasHistoryDetails), [canvases]);
  const index = canvases.findIndex(canvas => canvas.id === activeId);
  const active = canvases[index];
  const details = summaries[index];

  const show = (canvas: CanvasSnapshot, immediate = false) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActiveId(canvas.id);
    if (immediate) setVisible(true);
    else if (!visible && !openTimer.current) openTimer.current = setTimeout(() => {
      setVisible(true);
      openTimer.current = null;
    }, 120);
  };
  const hide = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setVisible(false), 100);
  };

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (activeId && !canvases.some(canvas => canvas.id === activeId)) {
      setActiveId(null);
      setVisible(false);
    }
  }, [activeId, canvases]);

  useLayoutEffect(() => {
    const measure = () => {
      const marker = buttons.current[index];
      const popup = tooltip.current;
      if (!marker || !popup) return;
      const rect = marker.getBoundingClientRect();
      const top = orientation === 'horizontal' ? rect.bottom + 8 : rect.top + rect.height / 2 - popup.offsetHeight / 2;
      const left = orientation === 'horizontal' ? rect.left + rect.width / 2 - popup.offsetWidth : rect.right + 10;
      setPosition({ top: Math.max(12, Math.min(top, window.innerHeight - popup.offsetHeight - 12)),
        left: Math.max(12, Math.min(left, window.innerWidth - popup.offsetWidth - 12)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [index, active, orientation]);

  if (!canvases.length) return null;

  return <>
    <nav className={`canvas-history canvas-history--${orientation}`} aria-label="Canvas history" data-canvas-history
      onPointerLeave={hide} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) hide(); }}>
      {canvases.map((canvas, markerIndex) => {
        const item = summaries[markerIndex];
        const distance = visible ? Math.abs(markerIndex - index) : Infinity;
        const scale = distance === 0 ? 1.8 : distance === 1 ? 1.4 : distance === 2 ? 1.15 : 1;
        return <button key={canvas.id} type="button" className="canvas-history-marker"
          ref={element => { buttons.current[markerIndex] = element; }}
          aria-label={`Open ${item.title}: ${item.prompt}`}
          aria-describedby={visible && markerIndex === index ? tooltipId : undefined}
          tabIndex={markerIndex === (index < 0 ? 0 : index) ? 0 : -1}
          data-active={visible && markerIndex === index ? 'true' : undefined}
          onPointerEnter={() => show(canvas)} onFocus={() => show(canvas, true)}
          onClick={() => {
            if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
            if (closeTimer.current) clearTimeout(closeTimer.current);
            setVisible(false);
            onSelect(canvas);
          }}
          onKeyDown={event => {
            const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
            const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
            if ([next, previous, 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? canvases.length - 1
                : (markerIndex + (event.key === next ? 1 : -1) + canvases.length) % canvases.length;
              buttons.current[target]?.focus();
            } else if (event.key === 'Escape' && visible) {
              event.stopPropagation();
              setVisible(false);
            }
          }}>
          <span aria-hidden="true" style={{ transform: `${orientation === 'vertical' ? 'scaleX' : 'scaleY'}(${scale})`,
            opacity: distance === 0 ? 1 : distance === 1 ? 0.75 : 0.5 }} />
        </button>;
      })}
    </nav>
    {details && createPortal(<div ref={tooltip} id={tooltipId} role="tooltip" aria-hidden={!visible}
      className={`canvas-history-popover canvas-history-popover--${orientation} font-sans`}
      data-visible={visible ? 'true' : undefined} style={position}>
      <p className="canvas-history-title">{details.prompt.charAt(0).toLocaleUpperCase() + details.prompt.slice(1)}</p>
      <p className="canvas-history-type">{details.title}</p>
      <div className="canvas-history-meta">
        <span className="canvas-history-period">
          {details.end - details.start} {details.end - details.start === 1 ? 'year' : 'years'}
          <span aria-hidden="true"> · </span>
          {formatYear(details.start)} – {formatYear(details.end)}
        </span>
        {(details.figures > 0 || details.events > 0) && <span>
          {details.figures > 0 && <>{details.figures} {details.figures === 1 ? 'figure' : 'figures'}</>}
          {details.figures > 0 && details.events > 0 && <span aria-hidden="true"> · </span>}
          {details.events > 0 && <>{details.events} {details.events === 1 ? 'event' : 'events'}</>}
        </span>}
      </div>
      <div className="canvas-history-secondary">
        <span>Created {new Date(active.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <span>{details.verifiedConnections} verified {details.verifiedConnections === 1 ? 'connection' : 'connections'}</span>
      </div>
    </div>, document.body)}
  </>;
};

export default CanvasHistory;
