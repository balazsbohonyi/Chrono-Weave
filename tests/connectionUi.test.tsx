import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('a recent connection plays on the card and reopens its exploration from a bare icon before the degrees badge', () => {
  const recent = [{ key: 'one', figures: [a, m, b], evidence: ['x', 'y'], createdAt: 2 }];
  const markup = panel({ recent, onOpenExploration: () => {} });
  const entry = markup.slice(markup.indexOf('Recent connections'));
  // The card (its main button) is what plays the connection; the icon is a separate button, not nested in it.
  assert.match(entry, /<button type="button" class="connection-recent-main"[^>]*>(?:(?!<\/button>).)*Anna Alpha → Bruno Beta<\/span><\/button>/);
  assert.match(entry, /<button type="button" class="connection-open-exploration" aria-label="Open exploration">/);
  assert.ok(entry.indexOf('connection-recent-main') < entry.indexOf('connection-open-exploration') && entry.indexOf('connection-open-exploration') < entry.indexOf('connection-recent-degrees'));
  assert.doesNotMatch(entry, /<button[^>]*>(?:(?!<\/button>).)*<button/);
  // Without a way to open it, the icon is not drawn.
  assert.doesNotMatch(panel({ recent }), /connection-open-exploration/);
});

test('the icons of a recent connection and of a paused exploration show only on hover or keyboard focus, keep their space, and stay on touch screens', () => {
  const recent = [{ key: 'one', figures: [a, m, b], evidence: ['x', 'y'], createdAt: 2 }];
  const markup = panel({ recent, onOpenExploration: () => {}, onDelete: () => {} });
  const entry = markup.slice(markup.indexOf('Recent connections'));
  assert.match(entry, /<div class="connection-recent-entry has-hover-actions\s/);
  assert.equal(entry.match(/class="connection-open-exploration"/g)?.length, 2);
  // Line endings differ between checkouts (CRLF on Windows).
  const css = readFileSync('src/styles/globals.css', 'utf8').replace(/\r\n/g, '\n');
  const hover = css.slice(css.indexOf('@media (hover: hover) {\n  .connection-recent-entry.has-hover-actions'));
  // Hidden by opacity (so their space stays and nothing shifts) and out of the way of clicks, only where there is a hover.
  assert.match(hover, /\.has-hover-actions \.connection-open-exploration \{ opacity: 0; pointer-events: none; \}/);
  assert.match(hover, /\.has-hover-actions:hover \.connection-open-exploration \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(hover, /\.has-hover-actions:has\(:focus-visible\) \.connection-open-exploration \{ opacity: 1; pointer-events: auto; \}/);
  assert.doesNotMatch(css.replace(/@media \(hover: hover\) \{[^@]*?\n\}\n/, ''), /has-hover-actions/);
  // A paused exploration's card is marked the same way: its icons show on hover too (the whole card opens it regardless).
  const session = { version: 2, key: 'k', canvasId: 'c', endpoints: ['a', 'b'], candidates: [], rounds: [], attempts: {}, segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 0, updatedAt: 1,
    diagnostics: { tasks: 0, people: 0, pairs: 0 }, people: [a, b].map(f => ({ ...f, description: '', aliases: [] })) } as unknown as NonNullable<ConnectionPanelProps['checkpoints']>[number];
  const paused = panel({ connection: null, checkpoints: [session], onOpenCheckpoint: () => {}, onDeleteCheckpoint: () => {} });
  assert.match(paused.slice(paused.indexOf('Paused explorations')), /<div class="connection-recent-entry has-hover-actions\s/);
});

test('a paused exploration shows the same icon instead of the words Open exploration, and the whole card still opens it', () => {
  const session = { version: 2, key: 'k', canvasId: 'c', endpoints: ['a', 'b'], candidates: [], rounds: [], attempts: {}, segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 0, updatedAt: 1,
    diagnostics: { tasks: 0, people: 0, pairs: 0 }, people: [a, b].map(f => ({ ...f, description: '', aliases: [] })) } as unknown as NonNullable<ConnectionPanelProps['checkpoints']>[number];
  const markup = panel({ connection: null, checkpoints: [session], onOpenCheckpoint: () => {} });
  const section = markup.slice(markup.indexOf('Paused explorations'));
  assert.doesNotMatch(text(section), /Open exploration/);
  assert.match(section, /class="connection-recent-main"/);
  assert.match(section, /class="connection-open-exploration" aria-label="Open exploration"/);
  assert.doesNotMatch(section, /connection-recent-degrees/);
});

test('a paused exploration can be deleted, with a delete icon only when the panel can do it', () => {
  const session = { version: 2, key: 'k', canvasId: 'c', endpoints: ['a', 'b'], candidates: [], rounds: [], attempts: {}, segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 0, updatedAt: 1,
    diagnostics: { tasks: 0, people: 0, pairs: 0 }, people: [a, b].map(f => ({ ...f, description: '', aliases: [] })) } as unknown as NonNullable<ConnectionPanelProps['checkpoints']>[number];
  assert.doesNotMatch(panel({ connection: null, checkpoints: [session], onOpenCheckpoint: () => {} }), /Delete exploration/);
  const markup = panel({ connection: null, checkpoints: [session], onOpenCheckpoint: () => {}, onDeleteCheckpoint: () => {} });
  const section = markup.slice(markup.indexOf('Paused explorations'));
  assert.match(section, /<button type="button" class="connection-open-exploration" aria-label="Delete exploration">/);
  // The icon is a separate button, not nested in the card's main button, and the confirmation only shows once it was clicked.
  assert.doesNotMatch(section, /<button[^>]*>(?:(?!<\/button>).)*<button/);
  assert.doesNotMatch(text(section), /Delete this paused exploration/);
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
