import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ConnectionExplorer, { SearchFailureNotice } from '../src/components/ConnectionExplorer';
import { LAYOUT_OPTIONS, LayoutIcon } from '../src/components/connectionNetwork/layoutOptions';
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

test('the footer counts the people on each endpoint\'s side with the endpoint portraits, explains them in the shared tooltip, and keeps the hint in the middle', () => {
  const session = build(people => [
    { from: people[0].id, to: people[2].id, status: 'accepted', claim: '', assessment: { pair: [people[0].id, people[2].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met.', provenance } },
    { from: people[1].id, to: people[3].id, status: 'unresolved', claim: 'maybe', assessment: { pair: [people[1].id, people[3].id], verdict: 'unresolved', evidence: '', uncertainty: 'Unclear.', provenance } },
  ], true);
  const markup = render(session);
  const footer = markup.slice(markup.indexOf('<footer'), markup.indexOf('</footer>'));
  assert.match(footer, /class="ce-footer-info" role="group" aria-label="People found on each side"/);
  // One accepted contact on A's side; the unresolved contact on B's side is not counted. Each count explains itself on hover (and to screen readers).
  const tip = (count: string, name: string, other: string) => `${count} closer to ${name} than to ${other}, through accepted contacts. The two endpoints are not counted.`;
  assert.match(footer, new RegExp(`class="ce-side is-a" role="img" tabindex="0" aria-label="${tip('1 person', 'Alpha', 'Beta')}"`));
  assert.match(footer, new RegExp(`class="ce-side is-b" role="img" tabindex="0" aria-label="${tip('0 people', 'Beta', 'Alpha')}"`));
  assert.match(footer, /<strong class="ce-side-count" aria-hidden="true">1<\/strong>/);
  assert.match(footer, /<strong class="ce-side-count" aria-hidden="true">0<\/strong>/);
  // No caption under the counts; the hint is the middle column, between the counts and the buttons.
  assert.doesNotMatch(footer, /counted by the nearer endpoint|ce-sides-caption/);
  assert.ok(footer.indexOf('ce-footer-info') < footer.indexOf('Drag or two-finger scroll to pan') && footer.indexOf('Only accepted contacts can form a chain') < footer.indexOf('Continue searching'));
});

test('the status area warns when the latest progress was not saved or the saved copy had to be trimmed, and says nothing otherwise', () => {
  const session = build(() => [], true);
  assert.doesNotMatch(render(session), /ce-save-warning/);
  const failed = render({ ...session, saveIssue: 'failed' });
  assert.match(failed, /class="ce-save-warning" role="status"[^>]*aria-label="The latest progress of this search could not be saved[^"]*"[^>]*>Latest progress not saved</);
  const trimmed = render({ ...session, saveIssue: 'trimmed' });
  assert.match(trimmed, /class="ce-save-warning" role="status"[^>]*aria-label="This search is larger than a saved copy can hold in full[^"]*"[^>]*>Saved copy is trimmed</);
});

test('a solved connection reopens as a plain exploration: degrees between the endpoints, Reveal in the graph, no search buttons, the chain lime and nothing dimmed', () => {
  const accepted = (people: ContactPerson[], from: number, to: number) => ({ from: people[from].id, to: people[to].id, status: 'accepted' as const, claim: '',
    assessment: { pair: [people[from].id, people[to].id] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const, evidence: 'They met.', provenance } });
  const session = build(people => [accepted(people, 0, 2), accepted(people, 2, 1), accepted(people, 0, 3)], true);
  const chain = [session.people[0].id, session.people[2].id, session.people[1].id];
  const markup = render(session, { solved: { degrees: 2 }, chain, onReveal: () => {} });
  // The degrees stand where the arrow was, as a badge.
  assert.match(markup, /<span class="ce-degrees" aria-label="2 degrees of separation"><b>2<\/b> degrees<\/span>/);
  assert.doesNotMatch(markup, /ce-arrow/);
  // Reveal is a prominent button in the header, in place of the phase text; the old centred banner is not shown, and nothing is lit or dimmed as in the just-found state.
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  assert.match(header, /<button type="button" class="net-reveal net-reveal-header"[^>]*>.*?Reveal<\/button>/);
  assert.doesNotMatch(header, /Accepted chain found|Search budget reached|Paused/);
  assert.equal(markup.match(/net-reveal/g)?.length, 2, 'one Reveal button (its class appears twice), none inside the graph');
  assert.doesNotMatch(markup, /net-success|is-success|Connected ·|is-dim/);
  // The other lines step back through the stylesheet while the lines are shown.
  assert.match(markup, /class="net-graph  ?is-solved"/);
  // No way to search from here, and no invitation to resume.
  assert.doesNotMatch(markup, /Continue searching|Resume search|Start a new search|Stop search|net-resume/);
  assert.match(markup, /Back to canvas/);
  // The two edges of the chain are lime (the third accepted contact is not), the whole network is still drawn.
  assert.equal(markup.match(/class="net-edge[^"]*is-chain/g)?.length, 2);
  assert.equal(markup.match(/class="net-edge /g)?.length, 3);
  assert.equal(markup.match(/class="net-node[^"]*is-chain/g)?.length, 3);
  // An ordinary exploration, and a search that has just found its chain, are unchanged.
  const plain = render(session);
  assert.match(plain, /ce-arrow/); assert.doesNotMatch(plain, /ce-degrees|net-reveal-header|is-chain|is-solved/);
  assert.match(render(session, { success: { degrees: 2 }, onReveal: () => {} }), /net-success-wrap/);
});

test('with the lines hidden, a solved connection still shows its lime chain between the endpoints and nothing else', () => {
  const accepted = (people: ContactPerson[], from: number, to: number) => ({ from: people[from].id, to: people[to].id, status: 'accepted' as const, claim: '',
    assessment: { pair: [people[from].id, people[to].id] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const, evidence: 'They met.', provenance } });
  const session = build(people => [accepted(people, 0, 2), accepted(people, 2, 1), accepted(people, 0, 3)], true);
  const chain = [session.people[0].id, session.people[2].id, session.people[1].id];
  const stored = new Map([['chrono_sd2_network_view', JSON.stringify({ mode: 'time', showLines: false, maximized: false })]]);
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: () => {} };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  try {
    const solved = render(session, { solved: { degrees: 2 }, chain, onReveal: () => {} });
    // Only the two lines of the chain are drawn, lime; the other accepted contact is hidden with the rest.
    assert.equal(solved.match(/class="net-edge /g)?.length, 2);
    assert.equal(solved.match(/class="net-edge[^"]*is-chain/g)?.length, 2);
    assert.equal(solved.match(/class="net-node[^"]*is-chain/g)?.length, 3);
    assert.doesNotMatch(solved, /is-solved/);
    // An ordinary exploration draws no line at all with the lines hidden.
    assert.equal(render(session).match(/class="net-edge /g)?.length ?? 0, 0);
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
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

test('a failure is announced in a card over the graph with a way to resume, and not in the inspector that a maximized graph hides', () => {
  const message = 'The AI service has reached its usage limit. Please try again later or choose another provider in Settings.';
  const card = renderToStaticMarkup(<SearchFailureNotice message={message} onResume={() => {}} onDismiss={() => {}} />);
  assert.match(card, /role="alert"/); assert.match(card, /Search interrupted/); assert.match(card, /usage limit/);
  assert.match(card, /class="connection-explorer-primary"[^>]*>Resume search</); assert.match(card, />Dismiss</);
  // The inspector no longer repeats it.
  const session = build(() => []); session.error = message;
  assert.doesNotMatch(render(session), /usage limit/);
});

test('reopening a pair whose last search failed shows no banner: only a failure while the overlay is open is announced', () => {
  const session = build(() => []);
  session.error = 'The AI service has reached its usage limit.';
  delete session.diagnostics.stopReason;
  assert.doesNotMatch(render(session), /net-alert|usage limit/);
  // The paused banner stays out of the way of a failed search too.
  assert.doesNotMatch(render(session), /Search paused/);
});

test('every layout hangs under one button of the view controls: the menu lists them all with an icon, and starts closed on the current one', () => {
  const markup = render(build(() => [], true));
  assert.match(markup, /aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-label="Layout: Timeline"|aria-label="Layout: Timeline"[^>]*aria-haspopup="menu"/);
  assert.doesNotMatch(markup, /role="menu"/);
  assert.doesNotMatch(markup, /Group contacts around the endpoints|Line contacts up in columns|Switch to free layout|Switch to year-based timeline/);
  // The toolbar keeps unpin, hide-lines and the zoom controls beside it.
  for (const label of ['Unpin all people', 'Hide connection lines', 'Zoom network in', 'Zoom network out', 'Fit network']) assert.match(markup, new RegExp(`aria-label="${label}"`));
  // The menu itself: one option per layout, each with an icon of its own.
  assert.deepEqual(LAYOUT_OPTIONS.map(option => option.mode), ['time', 'free', 'cluster', 'columns', 'category', 'corridor']);
  assert.equal(new Set(LAYOUT_OPTIONS.map(option => option.label)).size, LAYOUT_OPTIONS.length);
  for (const option of LAYOUT_OPTIONS) assert.match(renderToStaticMarkup(<LayoutIcon>{option.icon}</LayoutIcon>), /<svg[^>]*aria-hidden="true"><(path|circle|rect)/, `${option.label} has an icon`);
});

test('the last button of the view controls explains the current layout: a bare question mark, with no circle around it', () => {
  const markup = render(build(() => [], true));
  const toolbar = markup.slice(markup.indexOf('Network view controls'), markup.indexOf('aria-label="Contact filters"'));
  const labels = [...toolbar.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]);
  assert.equal(labels.at(-1), 'About the Timeline layout');
  assert.equal(labels.at(-2), 'Fit network');
  const button = toolbar.match(/<button[^>]*aria-label="About the Timeline layout"[^>]*>.*?<\/button>/)?.[0] ?? '';
  assert.match(button, /aria-haspopup="dialog"/);
  assert.doesNotMatch(button, /<circle/);
  assert.doesNotMatch(markup, /Graph layout<\/p>/);
});

test('the graph offers a bare maximize icon that hides the side panel, and starts un-maximized', () => {
  const markup = render(build(() => [], true));
  assert.match(markup, /class="net-maximize"[^>]*>(?:(?!<\/div>).)*aria-label="Maximize the graph"/);
  assert.match(markup, /class="connection-explorer-body "/);
  assert.doesNotMatch(markup, /is-maximized/);
  // Maximizing is a class on the body: the panel is hidden (not unmounted, so its tab and search survive) and the graph takes its column.
  const css = readFileSync('src/styles/connectionExplorer.css', 'utf8');
  assert.match(css, /\.connection-explorer-body\.is-maximized\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.connection-explorer-body\.is-maximized\s*>\s*\.connection-explorer-inspection\s*\{\s*display:\s*none/);
});

test('the AI-supported legend chip is a switch like the others; a solved connection shows it neutral, with a lime chip for the chain', () => {
  const session = build(people => [{ from: people[0].id, to: people[2].id, status: 'accepted', claim: '', assessment: { pair: [people[0].id, people[2].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met.', provenance } },
    { from: people[2].id, to: people[1].id, status: 'accepted', claim: '', assessment: { pair: [people[2].id, people[1].id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met.', provenance } }], true);
  const legend = (markup: string) => markup.slice(markup.indexOf('aria-label="Contact filters"'), markup.indexOf('</div>', markup.indexOf('aria-label="Contact filters"')));
  const plain = legend(render(session));
  assert.match(plain, /<button type="button" aria-pressed="true" class="net-chip is-accepted  is-on">/);
  assert.doesNotMatch(plain, /is-neutral|is-chain/);
  const solved = legend(render(session, { solved: { degrees: 2 }, chain: [session.people[0].id, session.people[2].id, session.people[1].id], onReveal: () => {} }));
  assert.match(solved, /class="net-chip is-accepted is-neutral is-on"/);
  assert.match(solved, /<button type="button" aria-pressed="true" class="net-chip is-chain is-on"><i aria-hidden="true"><\/i>Connection<\/button>/);
});
