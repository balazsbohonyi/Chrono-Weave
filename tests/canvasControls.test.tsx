import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CanvasToolbar from '../src/components/CanvasToolbar';
import { formatCanvasPrompt } from '../src/utils/formatters';
import type { CanvasConfig } from '../src/types';

const config: CanvasConfig = { start: -300, end: 800, layoutMode: 'timeline', layoutVersion: 1, layoutSelection: 'manual' };

test('the header uses the original prompt, capitalized, and actual inferred years for an empty strict query', () => {
  const context = { mode: 'freeform' as const, query: '  ancient Rome and its rulers  ', inferredStartYear: -200, inferredEndYear: 700,
    themeDescription: 'Model-inferred title', activeCategories: ['ALL' as const] };
  assert.equal(formatCanvasPrompt({ ...config, weaveContext: context }), 'Ancient Rome and its rulers');
  assert.equal(formatCanvasPrompt({ ...config, weaveContext: { ...context, mode: 'time-span', query: '' } }), '200 BC – 700');
  assert.equal(formatCanvasPrompt(config), '300 BC – 800');
});

test('zoom reset remains in the toolbar at every scale and is disabled at 100% or while busy', () => {
  for (const [scale, busy, expectedDisabled] of [[1, false, true], [0.25, false, false], [2, false, false], [2, true, true]] as const) {
    const markup = renderToStaticMarkup(<CanvasToolbar mode="gallery" scale={scale} disabled={busy} onToggleLayout={() => {}} onResetZoom={() => {}} />);
    const button = markup.match(/<button[^>]*aria-label="Reset zoom to 100%"[^>]*>/)?.[0];
    assert.ok(button);
    assert.equal(button.includes('disabled'), expectedDisabled);
    assert.ok(markup.includes('aria-label="Canvas view controls"'));
    assert.ok(!markup.includes('title='));
  }
});
