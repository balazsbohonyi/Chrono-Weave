import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionThread from '../src/components/ConnectionThread';
import { readFileSync } from 'node:fs';

const segments = ['M 0 0 L 100 0', 'M 100 0 L 100 100'];
const render = (progress: number, extent?: { x: number; y: number; width: number; height: number }) =>
  renderToStaticMarkup(<svg><ConnectionThread segments={segments} progress={progress} strokeWidth={3} extent={extent} /></svg>);

test('the thread is a dashed line revealed through a mask, with no glow layer', () => {
  const markup = render(1.5);
  assert.equal(markup.match(/<mask /g)?.length, 1, 'only the link being drawn needs a mask');
  assert.equal(markup.match(/stroke-dasharray="6 10.2"/g)?.length, 2, 'dash and gap follow the line width');
  assert.match(markup, /mask="url\(#thread[\w-]+-1\)"/);
  assert.ok(!markup.includes('glow') && !markup.includes('blur'));
});

test('a finished thread is drawn without any mask, which keeps zooming cheap', () => {
  const markup = render(2);
  assert.equal(markup.match(/<mask /g), null);
  assert.equal(markup.match(/mask=/g), null);
  assert.equal(markup.match(/connection-thread-line/g)?.length, 2);
  assert.equal(markup.match(/stroke-dasharray="6 10.2"/g)?.length, 2);
});

test('the mask of a link in progress covers the thread\'s own box instead of a huge region', () => {
  const bounded = render(0.5, { x: 0, y: -40, width: 300, height: 200 });
  assert.match(bounded, /<mask[^>]*x="-200"[^>]*y="-240"[^>]*width="700"[^>]*height="600"/);
  assert.match(render(0.5), /width="200000"/);
});

test('a link that has not started drawing is not rendered, and one in progress is partly uncovered', () => {
  assert.equal(render(0).match(/connection-thread-line/g), null);
  const partial = render(1.25);
  assert.equal(partial.match(/connection-thread-line/g)?.length, 2);
  assert.match(partial, /stroke-dashoffset="0.75"/);
});

test('the stylesheet colours the thread and outlines with the amber theme tokens and uses no glow', () => {
  const css = readFileSync('src/styles/globals.css', 'utf8');
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');
  const block = css.slice(css.indexOf('Six Degrees: connecting two people'), css.indexOf('.connection-picker'));
  assert.match(block, /stroke: rgb\(var\(--color-connection\)\)/);
  assert.match(block, /outline: 2px solid rgb\(var\(--color-connection\)\)/);
  assert.ok(!/blur\(|0 0 \d+px/.test(block), 'no glow in the connection styles');
  assert.equal(tokens.match(/--color-connection:/g)?.length, 2, 'one amber for each theme');
  assert.equal(tokens.match(/--color-connection-contrast:/g)?.length, 2);
});
