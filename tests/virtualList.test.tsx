import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import VirtualList, { firstVisibleRow, rowOffsets, visibleRange } from '../src/components/connectionNetwork/VirtualList';
import { buildDetailRows, buildListRows, DETAIL_ROW_HEIGHT, detailHeight, detailTabFor, ROW_HEIGHT, rowHeight, type DetailRow, type DetailTab, type ListRow } from '../src/components/connectionNetwork/inspectorRows';
import ConnectionExplorer from '../src/components/ConnectionExplorer';
import { figurePerson, identifyPerson, sessionKey, type ConnectionSession, type ContactPerson } from '../src/services/connectionGraph';
import type { NetworkEdge, NetworkView } from '../src/services/connectionNetworkView';
import { person } from './connectionFixtures';

test('offsets are the running sum of the row heights, with the total at the end', () => {
  assert.deepEqual(rowOffsets([]), [0]);
  assert.deepEqual(rowOffsets([10, 20, 5]), [0, 10, 30, 35]);
});

test('the visible range is the rows that touch the viewport, widened by the overscan and clamped to the list', () => {
  const offsets = rowOffsets(new Array(100).fill(50));   // rows of 50px: row i covers [50i, 50i + 50)
  assert.deepEqual(visibleRange(offsets, 0, 200, 0), [0, 4]);
  // A row that ends exactly at the top, or starts exactly at the bottom, is not visible.
  assert.deepEqual(visibleRange(offsets, 100, 100, 0), [2, 4]);
  // Partly visible rows count; the overscan adds rows on both sides.
  assert.deepEqual(visibleRange(offsets, 120, 100, 0), [2, 5]);
  assert.deepEqual(visibleRange(offsets, 120, 100, 3), [0, 8]);
  // The end of the list, and a scroll position beyond it, keep the last rows.
  assert.deepEqual(visibleRange(offsets, 4800, 200, 2), [94, 100]);
  assert.deepEqual(visibleRange(offsets, 99999, 200, 0), [99, 100]);
  // Nothing to show; a zero-height viewport still names the row at the top.
  assert.deepEqual(visibleRange(rowOffsets([]), 0, 500, 5), [0, 0]);
  assert.deepEqual(visibleRange(offsets, 0, 0, 0), [0, 1]);
});

test('rows of different heights are found by position', () => {
  const offsets = rowOffsets([54, 44, 68, 52]);
  assert.equal(firstVisibleRow(offsets, 0), 0);
  assert.equal(firstVisibleRow(offsets, 53), 0);
  assert.equal(firstVisibleRow(offsets, 54), 1);
  assert.equal(firstVisibleRow(offsets, 98), 2);
  assert.equal(firstVisibleRow(offsets, 10_000), 3);
  assert.deepEqual(visibleRange(offsets, 60, 60, 0), [1, 3]);
});

test('a windowed list puts only the rows near the top in the document, inside a spacer as tall as the whole list', () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}` }));
  const markup = renderToStaticMarkup(<VirtualList items={items} itemKey={item => item.id} itemHeight={() => 50} renderItem={item => <button type="button">{item.id}</button>}
    className="scroller" listClassName="rows" fallbackViewport={300} overscan={2} />);
  // 300px is six rows, plus two of overscan below (nothing above the top).
  assert.equal(markup.match(/<li /g)?.length, 8);
  assert.match(markup, /<ul class="rows" style="height:50000px">/);
  assert.match(markup, /<li aria-setsize="1000" aria-posinset="1" style="top:0;height:50px"><button type="button">row-0<\/button><\/li>/);
  assert.match(markup, /aria-posinset="8"/); assert.doesNotMatch(markup, /aria-posinset="9"|row-8</);
  // An empty list is an empty spacer.
  assert.doesNotMatch(renderToStaticMarkup(<VirtualList items={[]} itemKey={() => ''} itemHeight={() => 1} renderItem={() => null} />), /<li/);
});

// --- The inspector's rows ---
const provenance = { provider: 'synthetic', model: 'synthetic', version: 2, assessedAt: 1 };
function bigSession(count: number): ConnectionSession {
  const people: ContactPerson[] = [];
  const add = (name: string) => identifyPerson(people, figurePerson(person(name)));
  const [a, b] = [add('Alpha'), add('Beta')];
  const candidates: ConnectionSession['candidates'] = [];
  for (let i = 0; i < count; i++) {
    const other = add(`Person ${String(i).padStart(4, '0')}`);
    candidates.push({ from: (i % 2 ? a : b).id, to: other.id, status: 'accepted', claim: '',
      assessment: { pair: [(i % 2 ? a : b).id, other.id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met.', provenance } });
  }
  return { version: 2, key: sessionKey('one', a.id, b.id), canvasId: 'one', endpoints: [a.id, b.id], people, candidates, rounds: [], attempts: {}, segment: 1,
    status: 'paused', phase: 'Search budget reached', elapsedMs: 0, updatedAt: 1, persistent: true, diagnostics: { tasks: 0, people: 0, pairs: 0, stopReason: 'work-budget' } };
}

test('with hundreds of people the inspector draws a screenful of rows and still tells the whole list, its size and its place', () => {
  const markup = renderToStaticMarkup(<ConnectionExplorer session={bigSession(500)} busy={false} onStop={() => {}} onContinue={() => {}} onFresh={() => {}} onClose={() => {}} />);
  const panel = markup.slice(markup.indexOf('id="net-tabpanel"'));
  const drawn = panel.match(/<button type="button" class="net-row"/g)?.length ?? 0;
  assert.ok(drawn > 5 && drawn < 40, `${drawn} person rows drawn`);
  assert.match(panel, /<li class="net-vitem is-person" aria-setsize="500" aria-posinset="1"/);
  assert.match(panel, new RegExp(`<ul class="net-contact-rows net-vlist" style="height:${500 * ROW_HEIGHT.person}px">`));
  assert.match(panel, /role="tabpanel"/);
  // The rows are the people in name order; the badge counts everybody, endpoints included.
  assert.match(panel, /Person 0000<\/strong>/); assert.doesNotMatch(panel, /Person 0499/);
  assert.match(markup, /aria-label="AI-supported people, 502"/);
});

// --- The rows of one tab, from the lists of a view ---
const people = ['Ada', 'Bob', 'Cy', 'Di', 'Eve', 'Fay'].map(name => identifyPerson([], figurePerson(person(name))));
const byId = new Map(people.map(p => [p.id, p]));
const edge = (from: ContactPerson, to: ContactPerson, status: NetworkEdge['status']): NetworkEdge => ({ id: `${from.id}~${to.id}`, from: from.id, to: to.id, status,
  candidate: { from: from.id, to: to.id, claim: '', status }, contextual: false }) as NetworkEdge;
const [ada, bob, cy, di, eve, fay] = people;
const list: NetworkView['list'] = {
  endpoints: [ada, bob], people: [cy, di], unverified: [eve, fay],
  contacts: { accepted: [edge(di, cy, 'accepted'), edge(cy, bob, 'accepted')], unresolved: [edge(fay, eve, 'unresolved'), edge(eve, ada, 'unresolved')], proposed: [edge(fay, ada, 'proposed')], blocked: [] },
};
const rowsOf = (tab: 'people' | 'contacts', query = '', open: string[] = []) => buildListRows({ list, tab, query, people: byId, open: new Set(open) });
const summary = (rows: ListRow[]) => rows.map(row => row.kind === 'group' ? `${row.label} (${row.count})${row.open ? ' open' : ''}` : row.kind === 'person' ? row.person.name
  : row.kind === 'contact' ? `${byId.get(row.edge.from)!.name} ↔ ${byId.get(row.edge.to)!.name}` : row.text);

test('the folded groups of unverified people and contacts are single rows; opening one lists its members, sorted by contact label', () => {
  assert.deepEqual(summary(rowsOf('people')), ['Cy', 'Di', 'Unverified people (2)']);
  assert.deepEqual(summary(rowsOf('people', '', ['people-unverified'])), ['Cy', 'Di', 'Unverified people (2) open', 'Eve', 'Fay']);
  // Contacts are ordered by "A ↔ B"; empty groups are not listed.
  assert.deepEqual(summary(rowsOf('contacts')), ['Cy ↔ Bob', 'Di ↔ Cy', 'Unresolved contacts (2)', 'Proposed / checking contacts (1)']);
  assert.deepEqual(summary(rowsOf('contacts', '', ['contacts-unresolved'])).slice(2, 5), ['Unresolved contacts (2) open', 'Eve ↔ Ada', 'Fay ↔ Eve']);
});

test('a search filters every group and its count, matching names without accents or case; no match gives one message row', () => {
  assert.deepEqual(summary(rowsOf('people', 'FAY')), ['No AI-supported people match “FAY”.', 'Unverified people (1)']);
  assert.deepEqual(summary(rowsOf('contacts', 'eve')), ['No AI-supported contacts match “eve”.', 'Unresolved contacts (2)']);
  assert.deepEqual(summary(rowsOf('contacts', 'cy bob')), ['Cy ↔ Bob']);
  assert.deepEqual(summary(rowsOf('people', 'zzz')), ['No AI-supported people match “zzz”.']);
  const none = buildListRows({ list: { ...list, people: [], unverified: [] }, tab: 'people', query: '', people: byId, open: new Set() });
  assert.deepEqual(summary(none), ['No AI-supported people yet.']);
});

test('every row has a key of its own and a fixed height of its kind', () => {
  for (const rows of [rowsOf('people', '', ['people-unverified']), rowsOf('contacts', '', ['contacts-unresolved', 'contacts-proposed', 'contacts-blocked'])]) {
    assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
    assert.ok(rows.every(row => rowHeight(row) === ROW_HEIGHT[row.kind]));
  }
});

// --- The detail view of a person: one list per tab ---
const link = (other: ContactPerson, status: NetworkEdge['status']) => ({ other, candidate: { from: ada.id, to: other.id, claim: '', status } });
const detail = (tab: DetailTab, accepted = [link(cy, 'accepted'), link(di, 'accepted')], unverified = [link(eve, 'unresolved'), link(fay, 'blocked')]) =>
  buildDetailRows({ contacts: { accepted, unverified }, tab });
const detailSummary = (rows: DetailRow[]) => rows.map(row => row.kind === 'contact' ? row.contact.other.name + (row.unverified ? ' ?' : '') : row.text);

test('the AI-supported and the unverified contacts of a person are two lists, one per tab', () => {
  assert.deepEqual(detailSummary(detail('accepted')), ['Cy', 'Di']);
  assert.deepEqual(detailSummary(detail('unverified')), ['Eve ?', 'Fay ?']);
});

test('an empty tab says so', () => {
  assert.deepEqual(detailSummary(detail('accepted', [])), ['No accepted contacts yet.']);
  assert.deepEqual(detailSummary(detail('unverified', undefined, [])), ['No unverified contacts.']);
});

test('somebody who is not AI-supported has only the unverified tab', () => {
  assert.equal(detailTabFor('accepted', false), 'unverified');
  assert.equal(detailTabFor('accepted', true), 'accepted');
  assert.equal(detailTabFor('unverified', true), 'unverified');
});

test('detail rows have keys of their own and the fixed heights of their kind', () => {
  for (const rows of [detail('accepted'), detail('unverified'), detail('accepted', [])]) {
    assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
    assert.ok(rows.every(row => detailHeight(row) === DETAIL_ROW_HEIGHT[row.kind]));
  }
});

test('the detail view of a person with hundreds of contacts draws only a screenful of them', () => {
  const accepted = Array.from({ length: 300 }, (_, i) => link(identifyPerson([], figurePerson(person(`Contact ${i}`))), 'accepted'));
  const rows = detail('accepted', accepted, []);
  const markup = renderToStaticMarkup(<VirtualList items={rows} itemKey={row => row.key} itemHeight={detailHeight} renderItem={row => <i>{row.key}</i>} />);
  const drawn = markup.match(/<li /g)?.length ?? 0;
  assert.ok(drawn > 5 && drawn < 25, `${drawn} rows drawn`);
  assert.match(markup, new RegExp(`height:${300 * DETAIL_ROW_HEIGHT.contact}px`));
});
