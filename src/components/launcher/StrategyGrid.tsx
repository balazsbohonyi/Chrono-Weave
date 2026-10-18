import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { WeaveMode } from '../../types';
import { GlyphStack, setTraced } from './glyphs';
import { animate, isReducedMotion, spring, tween } from './motion';
import { STRATEGIES } from './strategies';
import type { ThreadField } from './ThreadField';

export interface MorphRect { rect: DOMRect; radius: string }

/** The grid's side of the card ⇄ stage morph (the launcher owns the ghost that flies between them). */
export interface StrategyGridHandle {
  intro(): void;
  /** Hides the chosen card and sends the others away; returns where the chosen one was. */
  leave(mode: WeaveMode): MorphRect;
  /** Where a card rests (no tilt, lift, parallax or fly-away), for the return trip. */
  rectOf(mode: WeaveMode): MorphRect;
  /** Brings the other cards back; the chosen one is revealed once the ghost lands. */
  enter(mode: WeaveMode): void;
  reveal(mode: WeaveMode): void;
  focus(mode: WeaveMode): void;
  /** Glass panes dimmed one by one behind Surprise Me. */
  panes(): HTMLButtonElement[];
}

interface Props {
  field: React.RefObject<ThreadField | null>;
  disabled: boolean;
  /** True while the launcher grid is the live view (no stage, no Surprise card): gates the parallax. */
  parallax: React.RefObject<boolean>;
  onHover(mode: WeaveMode | null): void;
  onSelect(mode: WeaveMode): void;
}

const ARROW = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;

const StrategyGrid = forwardRef<StrategyGridHandle, Props>(({ field, disabled, parallax, onHover, onSelect }, ref) => {
  const cards = useRef<Partial<Record<WeaveMode, HTMLButtonElement | null>>>({});
  const all = () => STRATEGIES.map(s => cards.current[s.mode]).filter((c): c is HTMLButtonElement => !!c);
  const byMode = (mode: WeaveMode) => cards.current[mode]!;
  // motion writes inline transforms and filters (a frame after its promise resolves); drop them so the
  // CSS tilt works again and no filter cuts the glass off from the threads behind it
  const clear = (els: HTMLElement[] = all()) => requestAnimationFrame(() => els.forEach(e => { e.style.transform = ''; e.style.filter = ''; }));
  const settle = (c: HTMLElement) => {
    c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
    c.style.setProperty('--px', '0px'); c.style.setProperty('--py', '0px');
  };

  useImperativeHandle(ref, () => ({
    intro() {
      const els = all();
      animate(els, { opacity: [0, 1], y: [40, 0], filter: ['blur(10px)', 'blur(0px)'] }, tween(1, { delay: (i: number) => 0.08 * i }))
        .then(() => clear());
    },
    leave(mode) {
      const c = byMode(mode);
      const rect = c.getBoundingClientRect();
      c.style.opacity = '0';
      all().forEach(settle);
      const others = all().filter(x => x !== c);
      others.forEach((o, i) => {
        const r = o.getBoundingClientRect();
        const dx = (r.left - rect.left) * 0.25, dy = (r.top - rect.top) * 0.25 + 30;
        animate(o, { opacity: 0, x: dx, y: dy, scale: 0.86 }, tween(0.55, { delay: 0.03 * i }));
      });
      return { rect, radius: '16px' };
    },
    rectOf(mode) {
      const c = byMode(mode);
      // Measure the card where it rests: no tilt, lift or parallax, and none of the fly-away transform it got
      // in leave() when it wasn't the chosen card (the mode tabs can switch to it before coming back).
      c.style.transition = 'none'; settle(c);
      // keep motion's own values in step; it re-renders every value it holds, so it must also hold the card hidden
      // (otherwise the intro's opacity 1 brings it back under the ghost that is flying to it)
      animate(c, { x: 0, y: 0, scale: 1, opacity: 0 }, { duration: 0 });
      c.style.transform = 'none';
      const rect = c.getBoundingClientRect();
      requestAnimationFrame(() => { c.style.transition = ''; });
      return { rect, radius: '16px' };
    },
    enter(mode) {
      all().filter(x => x.dataset.mode !== mode).forEach((o, i) =>
        animate(o, { opacity: 1, x: 0, y: 0, scale: 1 }, spring({ stiffness: 160, damping: 20, delay: 0.05 * i })).then(() => clear([o])));
    },
    reveal(mode) { const c = byMode(mode); animate(c, { opacity: 1 }, { duration: 0 }); c.style.opacity = '1'; setTraced(c, false); clear([c]); },
    focus(mode) { byMode(mode).focus({ preventScroll: true }); },
    panes: all,
  }), []);

  // depth parallax: the panes drift a little against the pointer
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (isReducedMotion() || e.pointerType !== 'mouse' || !parallax.current) return;
      const nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
      all().forEach(c => { c.style.setProperty('--px', `${(-nx * 8).toFixed(2)}px`); c.style.setProperty('--py', `${(-ny * 6).toFixed(2)}px`); });
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [parallax]);

  const hoverOn = (c: HTMLButtonElement) => {
    setTraced(c, true);
    onHover(c.dataset.mode as WeaveMode);
    const r = c.getBoundingClientRect();
    field.current?.attract(r.left + r.width / 2, r.top + r.height / 2, { spread: r.height * 0.55, reach: r.width * 0.7, strength: 0.8 });
  };
  const hoverOff = (c: HTMLButtonElement) => {
    setTraced(c, false);
    onHover(null);
    c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
    field.current?.release();
  };
  const tilt = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isReducedMotion() || e.pointerType !== 'mouse') return;
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.style.setProperty('--mx', `${px * 100}%`);
    c.style.setProperty('--ry', `${(px - 0.5) * 8}deg`); c.style.setProperty('--rx', `${(0.5 - py) * 8}deg`);
  };

  return (
    <div className="lx-grid">
      {STRATEGIES.map((s, i) => (
        <button key={s.mode} type="button" className="lx-scard" data-mode={s.mode} aria-label={`${s.title}: ${s.description}`}
          ref={el => { cards.current[s.mode] = el; }}
          aria-disabled={disabled || undefined}
          onPointerEnter={e => hoverOn(e.currentTarget)} onFocus={e => hoverOn(e.currentTarget)}
          onPointerLeave={e => hoverOff(e.currentTarget)} onBlur={e => hoverOff(e.currentTarget)}
          onPointerMove={tilt}
          onClick={() => { if (!disabled) onSelect(s.mode); }}>
          <GlyphStack mode={s.mode} />
          <span className="lx-scard-idx">0{i + 1}</span>
          <span className="lx-scard-kicker">{s.badge}</span>
          <h3 className="lx-scard-title">{s.title}</h3>
          <p className="lx-scard-desc">{s.description}</p>
          <span className="lx-scard-go" aria-hidden="true">{ARROW}</span>
        </button>
      ))}
    </div>
  );
});

export default StrategyGrid;
