import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { WeaveMode } from '../../types';
import { isReducedMotion } from './motion';
import { ROTATOR_WORDS } from './strategies';

export interface HeroHandle {
  root: HTMLDivElement | null;
  /** The title's words, the targets of the intro's word-by-word entrance. */
  words(): HTMLElement[];
  /** Shows a mode's word and keeps it until release(). */
  hold(mode: WeaveMode): void;
  release(): void;
}

const MODES = Object.keys(ROTATOR_WORDS) as WeaveMode[];
const Words: React.FC<{ text: string }> = ({ text }) => <>
  {text.split(/(\s+)/).filter(Boolean).map((part, i) => (/^\s+$/.test(part) ? part : <span key={i} className="w">{part}</span>))}
</>;

/** "Weave history around <rotating word>": the word cycles through the strategies every 2.3s. */
const LauncherHero = forwardRef<HeroHandle>((_, ref) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rotRef = useRef<HTMLSpanElement>(null);
  const rotator = useRef({ index: 0, held: false, show: (_k: number) => {} });

  useImperativeHandle(ref, () => ({
    get root() { return rootRef.current; },
    words: () => [...(titleRef.current?.querySelectorAll<HTMLElement>('.w') ?? [])],
    hold(mode) { rotator.current.held = true; rotator.current.show(MODES.indexOf(mode)); },
    release() { rotator.current.held = false; },
  }), []);

  // The rotator runs on the DOM directly: its words cross-fade by class, and the box eases to each word's width.
  useEffect(() => {
    const el = rotRef.current;
    if (!el) return;
    const spans = [...el.children] as HTMLElement[];
    const state = rotator.current;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const fit = () => { el.style.width = `${spans[state.index].offsetWidth}px`; };
    state.show = (k: number) => {
      if (k === state.index || k < 0) return;
      const prev = spans[state.index];
      prev.classList.remove('in'); prev.classList.add('out');
      const timer = setTimeout(() => { prev.classList.remove('out'); timers.delete(timer); }, 600);
      timers.add(timer);
      state.index = k; spans[k].classList.add('in'); fit();
    };
    spans[state.index].classList.add('in');
    fit();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) fit(); });
    window.addEventListener('resize', fit);
    const interval = setInterval(() => {
      if (!state.held && !isReducedMotion() && !document.hidden) state.show((state.index + 1) % spans.length);
    }, 2300);
    return () => {
      alive = false;
      clearInterval(interval);
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', fit);
      state.show = () => {};
    };
  }, []);

  return (
    <div className="lx-hero" ref={rootRef}>
      <span className="lx-eyebrow">Explore history</span>
      <h1 className="lx-title" ref={titleRef}>
        <Words text="Weave history " /><br className="lx-br" />
        <Words text="around " />
        <span className="lx-rot w" ref={rotRef} aria-hidden="true">
          {MODES.map(mode => <span key={mode}>{ROTATOR_WORDS[mode]}</span>)}
        </span>
        <span className="sr-only">a period, place, person or idea</span>
      </h1>
      <p className="lx-sub">Name a year, a place, a life or an idea, and we’ll weave its story into a timeline.</p>
    </div>
  );
});

export default LauncherHero;
