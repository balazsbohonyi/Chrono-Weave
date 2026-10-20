import React from 'react';
import type { WeaveMode } from '../../types';

// Thread-drawn line glyphs (64×64). Every path uses pathLength="1" so CSS can trace it in.
const PATHS: Record<WeaveMode, string[]> = {
  'time-span': [
    'M32 8a24 24 0 1 1-.01 0',
    'M32 14A18 18 0 0 1 49.3 27',
    'M32 4v6M32 54v6M4 32h6M54 32h6',
    'M32 32V19M32 32l9 6',
    'M30 32a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  era: [
    'M8 21 32 8l24 13Z',
    'M11 25h42',
    'M17 28v23M27 28v23M37 28v23M47 28v23',
    'M13 54h38M9 58h46',
  ],
  figure: [
    'M32 11a9 9 0 1 1-.01 0',
    'M14 56c0-13 8-21 18-21s18 8 18 21',
    'M19 13c-5 6-5 15 0 21M45 13c5 6 5 15 0 21',
    'M15 19l4 1M15 27l4-1M49 19l-4 1M49 27l-4-1',
  ],
  region: [
    'M32 8a24 24 0 1 1-.01 0',
    'M32 11 36 32 32 53 28 32Z',
    'M11 32 32 28 53 32 32 36Z',
    'M32 26a6 6 0 1 1-.01 0',
  ],
  theme: [
    'M32 9a23 23 0 1 1-.01 0',
    'M28 5h8M32 5v4',
    'M9 32h46',
    'M15 22c9-7 25-7 34 0M15 42c9 7 25 7 34 0',
    'M32 32 47 17M32 32a3 3 0 1 0 .01 0',
  ],
  freeform: [
    'M50 6C31 12 20 29 18 50c13-6 25-20 32-44Z',
    'M18 50 11 59',
    'M41 17 31 26M37 26 27 34M32 34 24 41',
    'M7 59c11-4 21 2 35-2',
  ],
};

const SVG_ATTRS = 'viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const Glyph: React.FC<{ mode: WeaveMode; className?: string }> = ({ mode, className = '' }) => (
  <svg className={`glyph ${className}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {PATHS[mode].map((d, i) => <path key={i} d={d} pathLength={1} style={{ '--i': i } as React.CSSProperties} />)}
  </svg>
);

/** A faint base glyph with a traced copy on top. The trace's `is-untraced` class is toggled imperatively (setTraced). */
export const GlyphStack: React.FC<{ mode: WeaveMode; traced?: boolean }> = ({ mode, traced = false }) => (
  <div className="glyph-stack">
    <Glyph mode={mode} className="glyph-base" />
    <Glyph mode={mode} className={`glyph-trace${traced ? '' : ' is-untraced'}`} />
  </div>
);

/** Markup for elements built outside React (the morph ghost). */
export function glyphStackHTML(mode: WeaveMode, traced = false): string {
  const svg = (cls: string) => `<svg class="glyph ${cls}" ${SVG_ATTRS}>${PATHS[mode].map((d, i) => `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join('')}</svg>`;
  return `<div class="glyph-stack">${svg('glyph-base')}${svg(`glyph-trace${traced ? '' : ' is-untraced'}`)}</div>`;
}

export function setTraced(el: Element | null | undefined, on: boolean) {
  el?.querySelector('.glyph-trace')?.classList.toggle('is-untraced', !on);
}
