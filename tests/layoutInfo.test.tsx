import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LayoutInfoDialog, { LAYOUT_INFO, layoutInfoLabel } from '../src/components/LayoutInfo';
import { LAYOUT_OPTIONS } from '../src/components/connectionNetwork/layoutOptions';

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const dialog = (mode: (typeof LAYOUT_OPTIONS)[number]['mode']) => renderToStaticMarkup(<LayoutInfoDialog mode={mode} onClose={() => {}} />);

test('every layout of the menu has its own explanation, shown as a labelled dialog with a picture, its name and a way to close it', () => {
  assert.deepEqual(Object.keys(LAYOUT_INFO).sort(), LAYOUT_OPTIONS.map(option => option.mode).sort());
  for (const option of LAYOUT_OPTIONS) {
    const markup = dialog(option.mode), words = text(markup);
    assert.match(markup, /role="dialog"/); assert.match(markup, /aria-modal="true"/); assert.match(markup, /aria-labelledby=/);
    assert.match(markup, /aria-label="Close"/);
    assert.ok(words.includes(option.label), option.label);
    assert.match(markup, /class="sdi-diagrams ldi-diagram"[^>]*><figure><svg/, `${option.label} has a picture`);
    // Each one says how people are moved and what the layout is good for.
    assert.match(words, /Moving people/, option.label);
    assert.match(words, /What it is good for/, option.label);
    assert.match(words, /pin/i, option.label);
  }
  assert.equal(new Set(LAYOUT_OPTIONS.map(option => dialog(option.mode))).size, LAYOUT_OPTIONS.length);
});

test('the timeline explanation covers the coloured strips, the places by lifetime, vertical-only moves and what the layout reveals', () => {
  const words = text(dialog('time'));
  for (const heading of ['The coloured strips', 'Where people stand', 'Moving people', 'What it is good for']) assert.ok(words.includes(heading), heading);
  // The strips: one per end of the connection, born to died, blended where both were alive.
  assert.match(words, /lifetime of one end of the connection/); assert.match(words, /born .* died/);
  assert.match(words, /marked A/); assert.match(words, /marked B/);
  assert.match(words, /colours blend/); assert.match(words, /both of them were alive/);
  for (const sample of ['Only A was alive', 'Both were alive', 'Only B was alive']) assert.ok(words.includes(sample), sample);
  // Positions are the middle of a life; the endpoints slide only up and down.
  assert.match(words, /middle of their life/); assert.match(words, /only slide up and down/);
  assert.match(words, /What it is good for.*generations/);
});

test('the rings, columns, categories, corridor and free layouts each say what is particular to them', () => {
  assert.match(text(dialog('cluster')), /dashed rings/); assert.match(text(dialog('cluster')), /1 link/);
  assert.match(text(dialog('columns')), /mirror image/); assert.match(text(dialog('columns')), /degree of separation/);
  assert.match(text(dialog('category')), /Leaders & Baddies/); assert.match(text(dialog('category')), /boxes do not move/); assert.match(text(dialog('category')), /fill edge to edge/);
  assert.match(text(dialog('corridor')), /best known way/); assert.match(text(dialog('corridor')), /hangs? above or below|hang above or below/);
  assert.match(text(dialog('free')), /magnets/); assert.match(text(dialog('free')), /bridge people/);
});

test('the button label names the current layout', () => {
  assert.equal(layoutInfoLabel('time'), 'About the Timeline layout');
  assert.equal(layoutInfoLabel('corridor'), 'About the Corridor layout');
});
