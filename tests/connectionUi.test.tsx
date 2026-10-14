import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionPanel, { ConnectionHeader, type ConnectionPanelProps } from '../src/components/ConnectionPanel';
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
  // The connection on show is not in the list (the sidebar pins it above): see the header test below.
  assert.doesNotMatch(markup, /connection-header/);
  const chain = markup.slice(markup.indexOf('connection-chain'));
  assert.ok(chain.indexOf('Anna Alpha') < chain.indexOf('Marco Middle') && chain.indexOf('Marco Middle') < chain.indexOf('Bruno Beta'));
  assert.match(text(markup), /Anna and Marco shared a workshop\./);
  assert.match(text(markup), /Marco taught Bruno\./);
  assert.equal(markup.match(/>Why\?</g)?.length, 2);
  assert.equal(markup.match(/data-actions="/g)?.length, 3);
  assert.match(markup, /aria-label="Fly to Marco Middle on the canvas"/);
  assert.doesNotMatch(markup, /Try again/);
});

test('the sidebar renders Markdown in the evidence next to the Why button instead of showing its symbols', () => {
  const markup = panel({ connection: { ...connected, links: [
    { from: a, to: m, evidence: 'In 1657 Anna sent Marco *De Ratiociniis* and a **long** letter.' }, connected.links[1]] } });
  assert.match(markup, /<em>De Ratiociniis<\/em>/);
  assert.match(markup, /<strong>long<\/strong>/);
  assert.doesNotMatch(markup, /\*De Ratiociniis\*|\*\*long\*\*/);
});

const header = (connection: ActiveConnection) => renderToStaticMarkup(<ConnectionHeader connection={connection} onClose={() => {}} />);

test('the connection on show is a row like a recent connection: two portraits, who is joined, the degrees, and a way to dismiss it', () => {
  const markup = header(connected);
  assert.match(text(markup), /Anna Alpha → Bruno Beta 2 degrees/);
  assert.equal(markup.match(/net-portrait(?![\w-])/g)?.length, 2, 'both ends have a portrait');
  assert.match(markup, /connection-header-pair/);
  assert.match(markup, /aria-label="Hide this connection"/);
  // Screen readers still get the whole sentence.
  assert.match(markup, /aria-label="Anna Alpha and Bruno Beta are 2 degrees apart\."/);
  assert.match(markup, /connection-recent-degrees/);
});

test('one degree is singular', () => {
  const direct: ActiveConnection = { ...connected, chain: [a, m], links: [connected.links[0]] };
  assert.match(text(header(direct)), /Anna Alpha → Marco Middle 1 degree/);
  assert.match(header(direct), /are 1 degree apart\./);
});

test('the current person is highlighted while the camera is on them', () => {
  const [, second] = panel({ currentIndex: 1 }).split('connection-chain-item').slice(1, 3);
  // The current person carries the thread's amber, not the blue ring of the other lists.
  assert.match(second, /connection-card-active/);
  assert.doesNotMatch(second, /ring-accent-marker/);
  assert.doesNotMatch(panel({ currentIndex: null }), /connection-card-active/);
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
