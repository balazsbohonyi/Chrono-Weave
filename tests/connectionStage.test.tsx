import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ConnectionStage from '../src/components/ConnectionStage';
import type { HistoricalFigure } from '../src/types';

const person = (id: string, name: string): HistoricalFigure => ({ id, name, birthYear: 1500, deathYear: 1560, occupation: 'Painter', category: 'ARTISTS' });
const [a, m, b] = [person('a', 'Anna Alpha'), person('m', 'Marco Middle'), person('b', 'Bruno Beta')];
const links = [{ from: a, to: m, evidence: 'Anna and Marco shared a workshop in Florence.' }, { from: m, to: b, evidence: 'Marco taught Bruno to paint.' }];
const render = (animate: boolean, hidden = false) => renderToStaticMarkup(<ConnectionStage connection={{ nodeIds: ['a', 'm', 'b'], playId: 1, animate }} chain={[a, m, b]} links={links}
  currentIndex={null} focus={null} inset={{ top: 52, right: 544 }} canExit hidden={hidden} onStep={() => {}} onEnd={() => {}} onExit={() => {}} onReplay={() => {}} onExplain={() => {}} onInspect={() => {}} />);

test('a finished connection shows everyone, the whole thread, every caption with its Why button, and the degrees', () => {
  const markup = render(false);
  assert.equal(markup.match(/stage-card/g)?.length, 3);
  assert.doesNotMatch(markup, /is-ghost/);
  for (const number of [1, 2, 3]) assert.ok(markup.includes(`Number ${number} in the chain`), `badge ${number}`);
  // Both links are drawn all the way: a mask and a line for each.
  assert.equal(markup.match(/<mask /g)?.length, 2);
  assert.equal(markup.match(/connection-thread-line/g)?.length, 2);
  assert.equal(markup.match(/stage-caption is-shown/g)?.length, 2);
  assert.match(markup, /Anna and Marco shared a workshop in Florence\./);
  assert.match(markup, /aria-label="Why were Anna Alpha and Marco Middle connected\?"/);
  assert.match(markup, /aria-label="Why were Marco Middle and Bruno Beta connected\?"/);
  assert.match(markup, /2 degrees apart/);
  assert.match(markup, /stage-degrees is-final/);
  assert.match(markup, /aria-label="Close the connection"/);
  // The header offers a replay next to the close button.
  assert.match(markup, /aria-label="Replay the connection"/);
  // There is no row of progress dots: the sidebar's chain list is how to jump to a person.
  assert.doesNotMatch(markup, /stage-dot|People in the chain/);
  assert.ok(markup.indexOf('Replay the connection') < markup.indexOf('Close the connection'));
});

test('the number badge on a card corner is not clipped: the stage cards let it overflow', () => {
  const css = readFileSync('src/styles/connectionStage.css', 'utf8');
  // The base card rule is `overflow: hidden`, loaded later than this file, so the override needs more specificity than one class.
  assert.match(css, /\.relationship-card\.stage-card\s*\{\s*overflow:\s*visible/);
  assert.match(readFileSync('src/styles/globals.css', 'utf8'), /\.relationship-card \{[^}]*overflow: hidden/);
});

test('a reveal that has just begun shows only the first person; the rest wait as hidden ghosts and nothing is announced early', () => {
  const markup = render(true);
  assert.equal(markup.match(/is-ghost/g)?.length, 2);
  assert.equal(markup.match(/stage-caption is-shown/g), null);
  assert.ok(markup.includes('Number 1 in the chain') && !markup.includes('Number 2 in the chain'));
  // Hidden cards and captions are out of the tab order and the accessibility tree until they appear.
  assert.equal(markup.match(/aria-hidden="true"[^>]*tabindex="-1"|tabindex="-1"[^>]*aria-hidden="true"/g)?.length, 2);
  assert.doesNotMatch(markup, /stage-degrees is-final/);
});

test('the stage is a labelled region, not a dialog, so the sidebar next to it keeps working', () => {
  const markup = render(false);
  assert.match(markup, /<section[^>]*aria-label="The connection between Anna Alpha and Bruno Beta"/);
  assert.doesNotMatch(markup, /role="dialog"|aria-modal/);
  // Its controls must not be mistaken for the canvas's own (the canvas listens for wheel events over those).
  assert.doesNotMatch(markup, /canvas-floating-button|data-canvas-controls/);
  // It sits clear of the header and the sidebar.
  assert.match(markup, /style="top:52px;right:544px"/);
});

test('the stage can step aside while the canvas is needed (choosing the other end), and stays mounted', () => {
  assert.doesNotMatch(render(false), /<section[^>]*\shidden/);
  assert.match(render(false, true), /<section[^>]*\shidden=""/);
  // The stylesheet really hides it: `hidden` alone loses to the stage's own display rules otherwise.
  assert.match(readFileSync('src/styles/connectionStage.css', 'utf8'), /\.connection-stage\[hidden\]\s*\{\s*display:\s*none/);
});
