import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ThreadField } from './ThreadField';
import { AXIS_YEARS, clamp, ERAS, formatLauncherYear, MAX_YEAR, MIN_YEAR, posToYear, yearToPos } from './strategies';

export interface Span { s: number; e: number }

interface Props {
  span: Span;
  disabled: boolean;
  field: React.RefObject<ThreadField | null>;
  onChange(span: Span): void;
  /** Changes when the band may have moved on screen (the stage settled), so the thread highlight follows it. */
  sync: number;
}

const snap = (y: number) => Math.round(y / 10) * 10;
const keyStep = (key: string) => ({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 } as Record<string, number>)[key];

/** The era band: drag either edge, drag the window to pan it, or click an era to move the window there.
 *  The scale compresses deep antiquity and widens recent centuries. */
const EraBand: React.FC<Props> = ({ span, disabled, field, onChange, sync }) => {
  const band = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tight, setTight] = useState<boolean[]>([]);
  const latest = useRef(span);
  latest.current = span;

  useLayoutEffect(() => {
    const el = band.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const lo = Math.min(span.s, span.e), hi = Math.max(span.s, span.e);
  const W = width;
  const a = yearToPos(lo) * W, b = yearToPos(hi) * W;

  // labels that no longer fit their era hide
  useLayoutEffect(() => {
    setTight(segRefs.current.map(g => !!g && (g.firstElementChild as HTMLElement).scrollWidth + 8 > g.clientWidth));
  }, [W, lo, hi]);

  // the threads brighten over the chosen window
  useEffect(() => {
    const r = band.current?.getBoundingClientRect();
    if (r?.width) field.current?.setHighlight(r.left + a, r.left + b, r.top + r.height / 2, 170);
  }, [a, b, field, sync]);
  useEffect(() => () => field.current?.setHighlight(null), [field]);

  const setEdge = (k: 's' | 'e', y: number) => {
    const cur = latest.current;
    y = clamp(Math.round(y), MIN_YEAR, MAX_YEAR);
    onChange(k === 's' ? { s: Math.min(y, cur.e - 1), e: cur.e } : { s: cur.s, e: Math.max(y, cur.s + 1) });
  };
  const pan = (from: number) => {
    const cur = latest.current;
    const len = cur.e - cur.s;
    const s0 = clamp(Math.round(from), MIN_YEAR, MAX_YEAR - len);
    onChange({ s: s0, e: s0 + len });
  };

  // clicking an era (also through the window lying over it) sets the span to that era's years
  const chooseEraAt = (clientX: number) => {
    const r = band.current!.getBoundingClientRect();
    const y = posToYear((clientX - r.left) / r.width);
    const era = ERAS.find(([, , , to]) => y < to) ?? ERAS[ERAS.length - 1];
    onChange({ s: era[2], e: era[3] });
  };

  const drag = (onMove: (ev: PointerEvent, r: DOMRect, st: { x: number; pos0: number }) => void, onTap?: (ev: PointerEvent) => void) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true }); setDragging(true);
    const r = band.current!.getBoundingClientRect();
    const st = { x: e.clientX, pos0: yearToPos(latest.current.s) };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - st.x) < 4) return;
      moved = true;
      onMove(ev, r, st);
    };
    const up = (ev: PointerEvent) => {
      if (!moved && ev.type === 'pointerup') onTap?.(ev);
      setDragging(false);
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const edgeDrag = (k: 's' | 'e') => drag((ev, r) => setEdge(k, snap(posToYear((ev.clientX - r.left) / r.width))));
  // pan in screen space so the window glides under the pointer even across the scale's knots
  const winDrag = drag((ev, r, st) => pan(snap(posToYear(st.pos0 + (ev.clientX - st.x) / r.width))), ev => chooseEraAt(ev.clientX));

  const edgeKeys = (k: 's' | 'e') => (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Home') { e.preventDefault(); setEdge(k, MIN_YEAR); return; }
    if (e.key === 'End') { e.preventDefault(); setEdge(k, MAX_YEAR); return; }
    const d = keyStep(e.key); if (d == null) return;
    e.preventDefault(); setEdge(k, latest.current[k] + d * (e.shiftKey ? 100 : 10));
  };
  const winKeys = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Home') { e.preventDefault(); pan(MIN_YEAR); return; }
    if (e.key === 'End') { e.preventDefault(); pan(MAX_YEAR); return; }
    const d = keyStep(e.key); if (d == null) return;
    e.preventDefault(); pan(latest.current.s + d * (e.shiftKey ? 100 : 10));
  };

  const handle = (k: 's' | 'e', label: string) => (
    <div className="lx-h" data-k={k} role="slider" tabIndex={0} aria-label={label} aria-valuemin={MIN_YEAR} aria-valuemax={MAX_YEAR}
      aria-valuenow={span[k]} aria-valuetext={formatLauncherYear(span[k])} aria-disabled={disabled || undefined}
      style={{ transform: `translateX(${(yearToPos(span[k]) * W).toFixed(1)}px)` }}
      onPointerDown={edgeDrag(k)} onKeyDown={edgeKeys(k)}><i /></div>
  );

  return <>
    <div className={`lx-band${dragging ? ' is-drag' : ''}`} ref={band}
      onPointerDown={e => {
        if (disabled || e.button > 0 || (e.target as Element).closest('.lx-h, .lx-win')) return;
        chooseEraAt(e.clientX);
      }}>
      <div className="lx-segs" aria-hidden="true">
        {ERAS.map(([name, short, from, to], k) => (
          <span key={name} ref={el => { segRefs.current[k] = el; }}
            className={`lx-seg${from < hi && to > lo ? ' on' : ''}${tight[k] ? ' tight' : ''}`}
            style={{ left: `${(yearToPos(from) * 100).toFixed(3)}%`, width: `${((yearToPos(to) - yearToPos(from)) * 100).toFixed(3)}%` }}
            title={name}><em>{short}</em></span>
        ))}
      </div>
      <div className="lx-win" role="slider" tabIndex={0} aria-label="Time window (drag to move it)" aria-valuemin={MIN_YEAR} aria-valuemax={MAX_YEAR}
        aria-valuenow={lo} aria-valuetext={`${formatLauncherYear(lo)} to ${formatLauncherYear(hi)}`} aria-disabled={disabled || undefined}
        style={{ transform: `translateX(${a.toFixed(1)}px) scaleX(${Math.max(0.002, (b - a) / Math.max(1, W)).toFixed(5)})` }}
        onPointerDown={winDrag} onKeyDown={winKeys} />
      <div className="lx-wlab" aria-hidden="true" style={{ transform: `translateX(${clamp((a + b) / 2, 46, W - 46).toFixed(1)}px)` }}>
        <span>{formatLauncherYear(lo)} – {formatLauncherYear(hi)}</span>
      </div>
      {handle('s', 'Start year handle')}
      {handle('e', 'End year handle')}
    </div>
    <div className={`lx-axis${W < 640 ? ' is-narrow' : ''}`} aria-hidden="true">
      {AXIS_YEARS.map(y => <span key={y} style={{ left: `${(yearToPos(y) * 100).toFixed(3)}%` }}>{y < 0 ? `${-y} BCE` : y === 0 ? '1 CE' : y}</span>)}
    </div>
  </>;
};

export default EraBand;
