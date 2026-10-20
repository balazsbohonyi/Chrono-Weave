import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GalleryCanvas from '../src/components/GalleryCanvas';
import TimelineCanvas from '../src/components/TimelineCanvas';
import type { CanvasProps } from '../src/components/CanvasProps';
import { readFileSync } from 'node:fs';
import type { FigureCategory, HistoricalFigure } from '../src/types';

const person = (id: string, name: string, category: FigureCategory): HistoricalFigure =>
  ({ id, name, birthYear: 1500, deathYear: 1560, occupation: 'Painter', category });
const [a, m, b, other] = [person('a', 'Anna Alpha', 'ARTISTS'), person('m', 'Marco Middle', 'SCIENTISTS'), person('b', 'Bruno Beta', 'ARTISTS'), person('o', 'Olga Other', 'SCIENTISTS')];

const props = (overrides: Partial<CanvasProps> = {}): CanvasProps => ({
  figures: [a, m, b, other], startYear: 1400, endYear: 1700, onHoverYear: () => {}, onYearClick: () => {}, onEmptyClick: () => {},
  selectedYear: null, clusters: [], clusterPlacements: {}, onPlacementsResolved: () => {}, modalActive: false, highlightedFigureIds: [],
  selectedCategories: new Set<FigureCategory>(['ARTISTS']), isLegendCollapsed: true, ...overrides,
});
const card = (markup: string, name: string) => markup.match(new RegExp(`<[^>]*aria-label="[^"]*${name}[^"]*"[^>]*>`))?.[0] ?? '';

const chain = (animate: boolean) => ({ nodeIds: ['a', 'm', 'b'], playId: 1, animate });

test('a shown connection lights its people, whatever the category filter says, and ghosts everyone else', () => {
  const plain = renderToStaticMarkup(<GalleryCanvas {...props()} />);
  assert.match(card(plain, 'Marco Middle'), /opacity:0\.15/);
  assert.match(card(plain, 'Anna Alpha'), /opacity:1/);
  assert.ok(!plain.includes('connection-badge'));
  const chained = renderToStaticMarkup(<GalleryCanvas {...props({ connection: chain(false) })} />);
  assert.match(card(chained, 'Marco Middle'), /opacity:1/, 'a chain member hidden by the filter stays lit under the thread');
  assert.match(card(chained, 'Olga Other'), /opacity:0\.07/, 'everyone else is ghosted');
  assert.match(card(chained, 'Olga Other'), /grayscale/);
  assert.match(card(chained, 'Marco Middle'), /gallery-connected/);
  for (const number of [1, 2, 3]) assert.ok(chained.includes(`Number ${number} in the chain`), `badge ${number}`);
  // Only people on the chain are numbered.
  assert.equal(chained.match(/connection-badge(?![\w-])/g)?.length, 3);
  // While choosing the other end, the usual picking rules apply instead.
  const picking = renderToStaticMarkup(<GalleryCanvas {...props({ connection: chain(false), pickingSource: a, isPickable: figure => figure.id !== 'o' })} />);
  assert.match(card(picking, 'Olga Other'), /opacity:0\.15/);
  assert.match(card(picking, 'Marco Middle'), /opacity:1/);
  assert.ok(!picking.includes('connection-badge'));
});

test('while the thread is still being drawn, people it has not reached yet are ghosted too', () => {
  const start = renderToStaticMarkup(<GalleryCanvas {...props({ connection: chain(true) })} />);
  assert.match(card(start, 'Anna Alpha'), /opacity:1/, 'the first person is there from the start');
  assert.match(card(start, 'Marco Middle'), /opacity:0\.07/);
  assert.match(card(start, 'Bruno Beta'), /opacity:0\.07/);
});

test('the gallery draws the thread above the cards', () => {
  const markup = renderToStaticMarkup(<GalleryCanvas {...props({ connection: chain(false) })} />);
  assert.ok(markup.lastIndexOf('data-connection-thread') > markup.lastIndexOf('data-figure-id'), 'the thread comes after the last card');
});

test('the timeline ghosts and numbers in the same way', () => {
  const classes = (markup: string, id: string) => markup.match(new RegExp(`data-figure-id="${id}" class="([^"]*)"`))?.[1] ?? '';
  const plain = renderToStaticMarkup(<TimelineCanvas {...props()} />);
  assert.match(classes(plain, 'm'), /opacity-10 /);
  assert.ok(!plain.includes('connection-badge'));
  const chained = renderToStaticMarkup(<TimelineCanvas {...props({ connection: chain(false) })} />);
  assert.match(classes(chained, 'm'), /opacity-100/);
  assert.match(classes(chained, 'o'), /opacity-\[0\.07\]/);
  assert.equal(chained.match(/connection-badge(?![\w-])/g)?.length, 3);
  assert.ok(chained.includes('connection-node'));
  const start = renderToStaticMarkup(<TimelineCanvas {...props({ connection: chain(true) })} />);
  assert.match(classes(start, 'a'), /opacity-100/);
  assert.match(classes(start, 'm'), /opacity-\[0\.07\]/);
});

test('the connector lines of short events are ghosted with their labels, and the name is centred with its number', () => {
  const event: HistoricalFigure = { id: 'e', name: 'Brief Event', birthYear: 1520, deathYear: 1525, occupation: 'Treaty', category: 'EVENTS' };
  const figures = [a, m, b, event];
  const connector = (markup: string) => markup.match(/<g class="transition-opacity duration-500"[^>]*>/)?.[0] ?? '';
  const plain = renderToStaticMarkup(<TimelineCanvas {...props({ figures, selectedCategories: new Set<FigureCategory>() })} />);
  assert.ok(connector(plain) && !/opacity:/.test(connector(plain)), 'the connector is normal without a connection');
  const chained = renderToStaticMarkup(<TimelineCanvas {...props({ figures, selectedCategories: new Set<FigureCategory>(), connection: chain(false) })} />);
  assert.match(connector(chained), /opacity:0\.07/);
  // The badge and the name share one centred row.
  assert.match(chained, /flex items-center"><span class="connection-badge connection-badge-inline">1<\/span>Anna Alpha/);
});

test('connected gallery cards get a 3px amber outline over their own border, and the corner follows the rounding', () => {
  const css = readFileSync('src/styles/globals.css', 'utf8');
  assert.match(css, /\.gallery-connected:not\(\.gallery-focused\):not\(\.relationship-source\) \{ outline: 3px solid rgb\(var\(--color-connection\)\); outline-offset: -1px; \}/);
  assert.match(css, /\.gallery-connected \.figure-card-corner \{ border-top-right-radius: 11px; \}/);
});
