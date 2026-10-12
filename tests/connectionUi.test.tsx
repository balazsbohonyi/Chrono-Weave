import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionPanel, { isProposedPerson, type ConnectionPanelProps } from '../src/components/ConnectionPanel';
import ConnectionPicker from '../src/components/ConnectionPicker';
import ConnectionProgress from '../src/components/ConnectionProgress';
import { classifyConnectionTarget } from '../src/services/connectionPath';
import type { ActiveConnection } from '../src/hooks/useConnection';
import type { HistoricalFigure } from '../src/types';

const person = (id: string, name: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const [a, m, b] = [person('a', 'Anna Alpha', 1500, 1560), person('m', 'Marco Middle', 1520, 1590), person('b', 'Bruno Beta', 1580, 1650)];
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const connected: ActiveConnection = {
  id: 1, status: 'connected', chain: [a, m, b], request: { from: a, to: b },
  links: [
    { from: a, to: m, status: 'verified', evidence: 'Anna and Marco shared a workshop.' },
    { from: m, to: b, status: 'verified', evidence: 'Marco taught Bruno.' },
  ],
};
const panel = (overrides: Partial<ConnectionPanelProps> = {}) => renderToStaticMarkup(
  <ConnectionPanel connection={connected} currentIndex={null} recent={[]} canvasIds={new Set(['a', 'm', 'b'])} isBusy={false}
    onClose={() => {}} onRetry={() => {}} onReplay={() => {}} onFocusPerson={() => {}} onExplain={() => {}}
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
  const direct: ActiveConnection = { ...connected, chain: [a, m], links: [connected.links[0]], request: { from: a, to: m } };
  assert.match(text(panel({ connection: direct })), /are 1 degree apart\./);
});

test('the current person is highlighted while the camera is on them', () => {
  const [, second] = panel({ currentIndex: 1 }).split('connection-chain-item').slice(1, 3);
  assert.match(second, /ring-accent-marker/);
  assert.doesNotMatch(panel({ currentIndex: null }), /ring-accent-marker/);
});

test('a failed search lists the pieces, marks the gap, and offers Try again without actions on people who are not on the canvas', () => {
  const failed: ActiveConnection = {
    id: 2, status: 'failed', reason: 'unverified', chain: [a, m, b], request: { from: a, to: b },
    links: [{ from: a, to: m, status: 'verified', evidence: 'Anna and Marco shared a workshop.' }, { from: m, to: b, status: 'unverified' }],
  };
  const markup = panel({ connection: failed, canvasIds: new Set(['a', 'm']) });
  const words = text(markup);
  assert.match(words, /No verified chain of personal contacts connects Anna Alpha and Bruno Beta yet\./);
  assert.match(words, /Couldn't find a verified link between Marco Middle and Bruno Beta/);
  assert.match(words, /Nothing was added to your canvas/);
  assert.match(markup, />Try again</);
  assert.equal(markup.match(/>Why\?</g)?.length, 1);
  assert.equal(markup.match(/data-actions="/g)?.length, 2);
  assert.doesNotMatch(markup, /Fly to Bruno Beta/);
  // Bruno was only proposed: a compact marked row, with no description, dates, portrait, or actions.
  assert.equal(markup.match(/connection-proposed"/g)?.length, 1);
  assert.match(words, /Bruno Beta Proposed, not verified/);
  assert.doesNotMatch(markup, /1580|1650/);
  assert.equal(markup.match(/Painter/g)?.length, 2, 'only the two people on the canvas show their occupation');
  assert.equal(isProposedPerson(failed, new Set(['a', 'm']), b), true);
  assert.equal(isProposedPerson(failed, new Set(['a', 'm']), m), false);
  assert.equal(isProposedPerson(connected, new Set(), b), false, 'a verified chain is shown in full');
  assert.doesNotMatch(panel({ connection: connected }), /Proposed, not verified/);
  assert.match(text(panel({ connection: { ...failed, reason: 'no-path', links: [{ from: a, to: b, status: 'unverified' }], chain: [a, b] } })), /No chain of documented personal contacts was found/);
  assert.match(panel({ connection: failed, isBusy: true }), /connection-retry"[^>]*disabled/);
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

test('the progress card shows the phase, the links being checked with their verdicts, and Cancel', () => {
  const markup = renderToStaticMarkup(<ConnectionProgress onCancel={() => {}} progress={{
    label: 'Verifying each link…',
    links: [
      { id: '1', from: 'Anna Alpha', to: 'Marco Middle', status: 'verified' },
      { id: '2', from: 'Marco Middle', to: 'Bruno Beta', status: 'rejected' },
      { id: '3', from: 'Bruno Beta', to: 'Cara Gamma', status: 'checking' },
    ],
  }} />);
  const words = text(markup);
  assert.match(words, /Verifying each link…/);
  assert.match(words, /Checking proposed links…/);
  assert.match(markup, /connection-progress-verified[\s\S]*✓/);
  assert.match(markup, /connection-progress-rejected[\s\S]*✗/);
  assert.match(markup, /connection-progress-checking[\s\S]*connection-progress-spinner/);
  assert.match(words, /Anna Alpha → Marco Middle/);
  assert.match(markup, />Cancel</);
  // The card must not block panning and zooming behind it.
  assert.match(markup, /pointer-events-none/);
  const bare = renderToStaticMarkup(<ConnectionProgress onCancel={() => {}} progress={{ label: 'Identifying Henry VIII…', links: [] }} />);
  assert.match(text(bare), /Identifying Henry VIII…/);
  assert.doesNotMatch(bare, /Checking proposed links/);
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
