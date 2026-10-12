import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionThread from '../src/components/ConnectionThread';
import { readFileSync } from 'node:fs';

const segments = ['M 0 0 L 100 0', 'M 100 0 L 100 100'];
const render = (progress: number) => renderToStaticMarkup(<svg><ConnectionThread segments={segments} progress={progress} strokeWidth={3} /></svg>);

test('the thread is a dashed line revealed through a mask, with no glow layer', () => {
  const markup = render(2);
  assert.equal(markup.match(/<mask /g)?.length, 2);
  assert.equal(markup.match(/stroke-dasharray="6 10.2"/g)?.length, 2, 'dash and gap follow the line width');
  assert.match(markup, /mask="url\(#thread[\w-]+-0\)"/);
  assert.ok(!markup.includes('glow') && !markup.includes('blur'));
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
