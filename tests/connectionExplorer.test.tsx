import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionExplorer from '../src/components/ConnectionExplorer';
import { figurePerson, identifyPerson, sessionKey, type ContactPerson, type ConnectionSession } from '../src/services/connectionGraph';
import { A, B, M, N } from './connectionFixtures';

const provenance = { provider: 'synthetic', model: 'synthetic', version: 2, assessedAt: 1 };
function build(candidates: (people: ContactPerson[]) => ConnectionSession['candidates'], persistent?: boolean): ConnectionSession {
  const people: ContactPerson[] = []; for (const p of [A, B, M, N]) identifyPerson(people, figurePerson({ ...p, shortDescription: 'Unchecked biography must not appear.' }));
  return { version: 2, key: sessionKey('one', people[0].id, people[1].id), canvasId: 'one', endpoints: [people[0].id, people[1].id], people, candidates: candidates(people),
    rounds: [], attempts: {}, segment: 1, status: 'paused', phase: 'Search budget reached', elapsedMs: 12000, updatedAt: Date.now(), persistent,
    diagnostics: { tasks: 2, people: 1, pairs: 1, stopReason: 'work-budget' } };
}
const render = (session: ConnectionSession, extra: Partial<React.ComponentProps<typeof ConnectionExplorer>> = {}) => renderToStaticMarkup(
  <ConnectionExplorer session={session} busy={false} onStop={() => {}} onContinue={() => {}} onFresh={() => {}} onClose={() => {}} {...extra} />);

test('explorer labels hypotheses, accessible selection, stopped states and storage fallback without showing unchecked biographies', () => {
  const session = build(people => [{ from: people[0].id, to: people[2].id, status: 'unresolved', claim: 'A proposed contact',
    assessment: { pair: [people[0].id, people[2].id], verdict: 'unresolved', evidence: '', uncertainty: 'Uncertain meeting.', provenance } }]);
  const markup = render(session);
  assert.match(markup, /aria-modal="true"/); assert.match(markup, /Continue searching/); assert.match(markup, /Unresolved/);
  assert.match(markup, /role="button" tabindex="0"/); assert.match(markup, /role="tablist"/); assert.match(markup, /Search AI-supported people/); assert.match(markup, /Saving across reloads is unavailable/);
  assert.doesNotMatch(markup, /Unchecked biography must not appear/); assert.doesNotMatch(markup, /completion percentage|request count/);
});

test('the overlay names both endpoints with their details, and shows the clock without announcing it', () => {
  const markup = render(build(() => [], true), { busy: true });
  assert.match(markup, /class="connection-explorer"/); assert.match(markup, /relationship-close/);
  assert.match(markup, /Contact exploration: Alpha to Beta/);
  assert.match(markup, /ce-endpoint is-a/); assert.match(markup, /ce-endpoint is-b/);
  assert.match(markup, /role="timer"[^>]*aria-label="0 minutes 12 seconds explored"/); assert.match(markup, /ce-timer is-running/);
  // Every character has a cell of its own, so a changing digit cannot move the clock.
  assert.match(markup, /<span class="ce-digit">0<\/span><span class="ce-colon">:<\/span><span class="ce-digit">1<\/span><span class="ce-digit">2<\/span>/);
  // The working sign is shown while the search runs, and only then.
  assert.match(markup, /class="ce-working is-working"/);
  assert.doesNotMatch(render(build(() => [], true), { busy: false }), /ce-working is-working/);
  assert.match(markup, /Six Degrees of Separation · Contact exploration/);
  assert.doesNotMatch(markup, /role="status"[^>]*>(?:(?!<\/div>).)*0:12/);
});

test('the lists pin the endpoints above People and Contacts tabs, each with a search', () => {
  const session = build(people => [{ from: people[0].id, to: people[2].id, status: 'accepted', claim: '', assessment: { pair: [people[0].id, people[2].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met in Paris.', provenance } }], true);
  const markup = render(session);
  assert.match(markup, /aria-label="Endpoints"/);
  assert.match(markup, /id="net-tab-people"[^>]*aria-selected="true"[^>]*aria-label="AI-supported people, 3"/);
  assert.match(markup, /id="net-tab-contacts"[^>]*aria-selected="false"[^>]*aria-label="AI-supported contacts, 1"/);
  assert.match(markup, /type="search"/);
  // People rows carry the same detail line as the cards; the endpoints keep their A/B badges.
  assert.match(markup, /Middle<\/strong><small>/); assert.match(markup, /net-end-badge is-a/);
});

test('the default graph draws accepted people only, with the legend as the filter', () => {
  const session = build(people => [
    { from: people[0].id, to: people[2].id, status: 'accepted', claim: '', assessment: { pair: [people[0].id, people[2].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met in Paris.', provenance } },
    { from: people[2].id, to: people[3].id, status: 'unresolved', claim: 'maybe', assessment: { pair: [people[2].id, people[3].id], verdict: 'unresolved', evidence: '', uncertainty: 'Unclear.', provenance } },
  ], true);
  const markup = render(session);
  const graphStart = markup.indexOf('aria-label="Live contact graph"');
  const graph = markup.slice(graphStart, markup.indexOf('</svg>', graphStart));
  assert.match(graph, /Middle, Reached from Alpha · 1 link/);
  assert.match(graph, /Alpha, Endpoint A/);
  assert.doesNotMatch(graph, /aria-label="Next/);
  assert.match(markup, /aria-pressed="false"[^>]*>.*?Unresolved/);
  assert.match(markup, /AI-supported/);
  assert.match(markup, /Closest approach/);
  // The graph has no edge text labels and no lattice.
  assert.doesNotMatch(graph, /<text[^>]*>AI-supported<\/text>/);
  assert.doesNotMatch(markup, /Saving across reloads is unavailable/);
});

test('a verified chain is announced in the graph and waits for the Reveal button', () => {
  const session = build(people => [
    { from: people[0].id, to: people[2].id, status: 'accepted', claim: '', assessment: { pair: [people[0].id, people[2].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'x', provenance } },
    { from: people[2].id, to: people[1].id, status: 'accepted', claim: '', assessment: { pair: [people[2].id, people[1].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'y', provenance } },
  ]);
  session.status = 'connected';
  const markup = render(session, { success: { degrees: 2 } });
  assert.match(markup, /Connected · 2 degrees/);
  assert.match(markup, /<button[^>]*class="net-reveal"[^>]*>Reveal<\/button>/);
  assert.doesNotMatch(markup, /Opening the connection|click or press Esc to skip/);
  assert.match(markup, /is-chain/);
  assert.doesNotMatch(markup, /Resume search|Continue searching/);
  assert.doesNotMatch(markup, /Closest approach/);
  // Without a lit chain there is nothing to reveal.
  assert.doesNotMatch(render(session), /net-reveal/);
});
