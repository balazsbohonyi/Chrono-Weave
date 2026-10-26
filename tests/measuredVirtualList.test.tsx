import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeasuredVirtualList from '../src/components/MeasuredVirtualList';

const key = (item: number) => `row-${item}`;
const render = (items: number[], heights = new Map<string, number>()) => renderToStaticMarkup(
  <MeasuredVirtualList items={items} itemKey={key} renderItem={item => <p>card {item}</p>}
    scrollerRef={{ current: null }} heights={{ current: heights }} estimate={134} gap={16} overscan={4} fallbackViewport={800} />);

test('a long list puts only a window of its rows in the document and spaces out the rest', () => {
  const markup = render(Array.from({ length: 500 }, (_, index) => index));
  const rows = markup.match(/data-key="/g)?.length ?? 0;
  // 800px of 150px rows is six rows, plus four of overscan below (nothing above the top).
  assert.ok(rows >= 6 && rows <= 15, `${rows} rows`);
  assert.match(markup, /card 0</);
  assert.doesNotMatch(markup, /card 499</);
  // The spacer after the window stands in for every row that is not drawn.
  const after = Number(markup.match(/height:([\d.]+)px"[^>]*><\/div><\/div>$/)?.[1]);
  assert.ok(after > 500 * 150 - rows * 150 - 1000, `${after}px`);
  assert.match(markup, /aria-setsize="500"/);
});

test('rows that were measured count for their measured height, the others for the average', () => {
  const heights = new Map([['row-0', 100], ['row-1', 300]]);
  const markup = render([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], heights);
  // 100 + 300 for the first two, 200 (their average) for each of the 19 others: 4200px in all; 14 rows are drawn, so the spacer holds the other 7.
  const rows = markup.match(/data-key="/g)?.length ?? 0;
  const expected = 100 + 300 + (rows - 2) * 200;
  const after = Number(markup.match(/height:([\d.]+)px"[^>]*><\/div><\/div>$/)?.[1]);
  assert.equal(after, 4200 - expected);
});

test('a short list draws every row and an empty one draws none', () => {
  assert.equal(render([0, 1, 2]).match(/data-key="/g)?.length, 3);
  assert.equal(render([]).match(/data-key="/g)?.length ?? 0, 0);
});
