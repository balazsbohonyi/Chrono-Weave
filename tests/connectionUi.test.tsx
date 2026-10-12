import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionPanel, { type ConnectionPanelProps } from '../src/components/ConnectionPanel';
import ConnectionPicker from '../src/components/ConnectionPicker';
import { classifyConnectionTarget } from '../src/services/connectionPath';
import type { ActiveConnection } from '../src/hooks/useConnection';
import type { HistoricalFigure } from '../src/types';

const person = (id: string, name: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const [a, m, b] = [person('a', 'Anna Alpha', 1500, 1560), person('m', 'Marco Middle', 1520, 1590), person('b', 'Bruno Beta', 1580, 1650)];
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const connected: ActiveConnection = {
  id: 1, chain: [a, m, b],
  links: [
    { from: a, to: m, evidence: 'Anna and Marco shared a workshop.' },
    { from: m, to: b, evidence: 'Marco taught Bruno.' },
  ],
};
const panel = (overrides: Partial<ConnectionPanelProps> = {}) => renderToStaticMarkup(
  <ConnectionPanel connection={connected} currentIndex={null} recent={[]} canvasIds={new Set(['a', 'm', 'b'])} isBusy={false}
    onClose={() => {}} onReplay={() => {}} onFocusPerson={() => {}} onExplain={() => {}}
    renderActions={figure => <i data-actions={figure.id} />} {...overrides} />);

test('a connected chain reads as a headline, cards from A to B, and the verified evidence for every link', () => {
  const markup = panel();
  assert.match(text(markup), /Anna Alpha and Bruno Beta are 2 degrees apart\./);
  const chain = markup.slice(markup.indexOf('connection-chain'));
  assert.ok(chain.indexOf('Anna Alpha') < chain.indexOf('Marco Middle') && chain.indexOf('Marco Middle') < chain.indexOf('Bruno Beta'));
  assert.match(text(markup), /Anna and Marco shared a workshop\./);
  assert.match(text(markup), /Marco taught Bruno\./);
  assert.equal(markup.match(/>Why\?</g)?.length, 2);
  assert.equal(markup.match(/data-actions="/g)?.length, 3);
  assert.match(markup, /aria-label="Fly to Marco Middle on the canvas"/);
  assert.match(markup, /aria-label="Hide this connection"/);
  assert.doesNotMatch(markup, /Try again/);
});

test('one degree is singular', () => {
  const direct: ActiveConnection = { ...connected, chain: [a, m], links: [connected.links[0]] };
  assert.match(text(panel({ connection: direct })), /are 1 degree apart\./);
});

test('the current person is highlighted while the camera is on them', () => {
  const [, second] = panel({ currentIndex: 1 }).split('connection-chain-item').slice(1, 3);
  assert.match(second, /ring-accent-marker/);
  assert.doesNotMatch(panel({ currentIndex: null }), /ring-accent-marker/);
});

test('recent connections list names and degrees, and mark the one on show', () => {
  const recent = [
    { key: 'one', figures: [a, m, b], evidence: ['x', 'y'], createdAt: 2 },
    { key: 'two', figures: [m, a], evidence: ['z'], createdAt: 1 },
  ];
  const markup = panel({ recent });
  assert.match(text(markup), /Recent connections/);
  assert.match(text(markup), /Anna Alpha → Bruno Beta 2 degrees/);
  assert.match(text(markup), /Marco Middle → Anna Alpha 1 degree/);
  assert.equal(markup.match(/aria-current="true"/g)?.length, 1);
  // Without an active connection the tab explains how to start one, but still lists saved connections.
  const idle = text(panel({ connection: null, recent }));
  assert.match(idle, /Choose Connect to… on a person/);
  assert.match(idle, /Anna Alpha → Bruno Beta/);
  assert.doesNotMatch(panel({ connection: null, recent }), /connection-chain/);
});

test('the picker names the source, explains both ways to choose, and shows why a typed person cannot be chosen', () => {
  const source = person('s', 'Leonardo da Vinci', 1452, 1519);
  const near = person('n', 'Niccolo Near', 1500, 1560);
  const far = person('f', 'Nina Far', 2200, 2250);
  const event = { ...near, id: 'e', name: 'Nile Event', category: 'EVENTS' as const };
  const markup = renderToStaticMarkup(
    <ConnectionPicker source={source} figures={[source, near, far, event]} error="Couldn't identify that person. Try their full name."
      initialDraft="ni" topOffset={64} statusFor={figure => classifyConnectionTarget(source, figure)} onPick={() => {}} onSubmitName={() => {}} onCancel={() => {}} />);
  const words = text(markup);
  assert.match(words, /Connecting from Leonardo da Vinci ?: pick a person on the canvas or type a name\. Esc to cancel\./);
  assert.match(words, /Couldn't identify that person\. Try their full name\./);
  assert.match(markup, /role="alert"/);
  assert.match(words, /Niccolo Near/);
  assert.match(markup, /Nina Far[\s\S]*is-unavailable|is-unavailable[\s\S]*Nina Far/);
  assert.doesNotMatch(words, /Nile Event/);
  assert.doesNotMatch(words, /Leonardo da Vinci 1452/);
  assert.match(markup, /aria-invalid="true"/);
});
