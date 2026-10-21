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

test('the graph offers a bare maximize icon, and starts un-maximized with its header and footer', () => {
  const markup = render(build(() => [], true));
  assert.match(markup, /class="net-maximize"[^>]*>(?:(?!<\/div>).)*aria-label="Maximize the graph"/);
  assert.match(markup, /class="connection-explorer-body"/);
  assert.doesNotMatch(markup, /is-maximized|is-fullscreen|ce-bar|is-floating/);
  assert.match(markup, /connection-explorer-header/); assert.match(markup, /<footer/); assert.match(markup, /relationship-close/);
  // Maximizing is real full screen: the shell drops its padding and width cap, and the inspection panel floats over the graph instead of leaving
  // its column (it stays mounted, hidden when closed, so its tab, search and scroll survive).
  const css = readFileSync('src/styles/connectionExplorer.css', 'utf8');
  assert.match(css, /\.connection-explorer-body\.is-maximized\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.connection-explorer\.is-fullscreen\s*\{\s*padding:\s*0;\s*gap:\s*0;/);
  assert.match(css, /\.connection-explorer\.is-fullscreen\s*>\s*:not\(\.close-button\)\s*\{\s*max-width:\s*none/);
  assert.match(css, /\.connection-explorer-inspection\.is-floating\s*\{\s*position:\s*absolute;/);
  assert.doesNotMatch(css, /\.is-maximized\s*>\s*\.connection-explorer-inspection\s*\{\s*display:\s*none/);
});

// The view prefs are read once per mount, so a stub with `maximized` stored is what a remembered full screen looks like.
const inFullscreen = <T,>(run: () => T): T => {
  const stored = JSON.stringify({ mode: 'time', showLines: true, maximized: true });
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => key === 'chrono_sd2_network_view' ? stored : null, setItem: () => {} };
  try { return run(); } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
};
// The bar is the markup from its container up to the graph, which follows it in the section.
const barOf = (markup: string) => { const start = markup.indexOf('class="canvas-view-toolbar ce-bar"'); return markup.slice(start, markup.indexOf('<div class="net-graph', start)); };
const accepted = (people: ContactPerson[], from: number, to: number) => ({ from: people[from].id, to: people[to].id, status: 'accepted' as const, claim: '',
  assessment: { pair: [people[from].id, people[to].id] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const, evidence: 'They met.', provenance } });

test('full screen replaces the header, footer and top-right X with one floating bar, before the graph, and keeps the panel mounted but hidden', () => {
  const markup = inFullscreen(() => render(build(() => [], true)));
  assert.match(markup, /class="connection-explorer is-fullscreen"/);
  assert.doesNotMatch(markup, /connection-explorer-header|<footer|relationship-close|net-maximize|ce-endpoint/);
  assert.match(markup, /class="connection-explorer-body is-maximized"/);
  // The bar comes first in the section: every person and line of the graph is a tab stop, so a bar after it would be unreachable in practice.
  assert.ok(markup.indexOf('ce-bar') > markup.indexOf('aria-label="Explored contact network"') && markup.indexOf('ce-bar') < markup.indexOf('<div class="net-graph'));
  // The panel is the floating one, closed until a selection or the bar's icon opens it.
  assert.match(markup, /<aside class="connection-explorer-inspection[^"]*is-floating" aria-label="Network inspection" hidden=""/);
  assert.match(markup, /aria-label="Hide the side panel"/);
  assert.doesNotMatch(markup, /has-panel/);
});

test('the bar of a paused search: the two portraits with their counts, the still clock, Continue and Start a new search, then the panel icon, Leave full screen and Close', () => {
  const session = build(people => [accepted(people, 0, 2), { from: people[1].id, to: people[3].id, status: 'unresolved', claim: 'maybe',
    assessment: { pair: [people[1].id, people[3].id], verdict: 'unresolved', evidence: '', uncertainty: 'Unclear.', provenance } }], true);
  const bar = barOf(inFullscreen(() => render(session)));
  // The footer's counts, here with the person's identity ahead of the sentence (the hover text and the accessible name).
  assert.match(bar, /class="ce-side is-a" role="img" tabindex="0" aria-label="Alpha · 1500–1560 · Scholar — 1 person closer to Alpha than to Beta, through accepted contacts\. The two endpoints are not counted\."/);
  assert.match(bar, /class="ce-side is-b" role="img" tabindex="0" aria-label="Beta · 1700–1760 · Scholar — 0 people closer to Beta than to Alpha/);
  assert.match(bar, /class="ce-clock is-compact"/); assert.match(bar, /role="timer"[^>]*aria-label="0 minutes 12 seconds explored"/);
  assert.doesNotMatch(bar, /ce-working is-working|ce-timer is-running/);
  // The search stopped on its own limit, so the first button continues it.
  assert.match(bar, /aria-label="Continue searching"/); assert.match(bar, /aria-label="Start a new search"/);
  assert.doesNotMatch(bar, /Stop search|aria-label="Reveal"|ce-degrees|ce-bar-warning/);
  const labels = [...bar.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Continue searching', 'Start a new search', 'People and contacts', 'Leave full screen', 'Close contact exploration']);
  assert.match(bar, /aria-label="People and contacts" aria-pressed="false"/);
  // The progress messages are not displayed: the phase is only in the hidden live region (and the clock's hover text, which is not rendered until hovered).
  assert.equal(bar.match(/Search budget reached/g)?.length, 1);
  assert.match(bar, /<span class="sr-only" role="status" aria-live="polite">Search budget reached<\/span>/);
});

test('the bar of a running search shows the working sign and Stop; a failed save adds a warning icon', () => {
  const session = build(() => [], true);
  const running = barOf(inFullscreen(() => render(session, { busy: true })));
  assert.match(running, /class="ce-working is-working"/); assert.match(running, /ce-timer is-running/);
  assert.match(running, /aria-label="Stop search"/);
  assert.doesNotMatch(running, /Continue searching|Resume search|Start a new search|aria-label="Reveal"/);
  assert.doesNotMatch(running, /ce-bar-warning/);
  const warned = barOf(inFullscreen(() => render({ ...session, saveIssue: 'trimmed' }, { busy: true })));
  assert.match(warned, /class="ce-bar-warning" role="img" tabindex="0" aria-label="This search is larger than a saved copy can hold/);
  // A search that stopped for another reason than a limit is resumed rather than continued.
  const stopped = barOf(inFullscreen(() => render({ ...session, diagnostics: { ...session.diagnostics, stopReason: undefined } })));
  assert.match(stopped, /aria-label="Resume search"/);
});

test('the bar of a found or solved connection shows the degrees and Reveal in place of the search buttons, and the centred cards stay', () => {
  const session = build(people => [accepted(people, 0, 2), accepted(people, 2, 1)], true);
  const chain = [session.people[0].id, session.people[2].id, session.people[1].id];
  const foundMarkup = inFullscreen(() => render(session, { success: { degrees: 2 }, onReveal: () => {} }));
  const found = barOf(foundMarkup);
  assert.match(found, /class="ce-degrees" aria-label="2 degrees of separation"><b>2<\/b> degrees/);
  assert.match(found, /aria-label="Reveal"/); assert.doesNotMatch(found, /Stop search|Continue searching|Resume search|Start a new search/);
  assert.match(foundMarkup, /net-success-wrap/);
  const solved = barOf(inFullscreen(() => render(session, { solved: { degrees: 1 }, chain, onReveal: () => {} })));
  assert.match(solved, /class="ce-degrees" aria-label="1 degree of separation"><b>1<\/b> degree/);
  assert.match(solved, /aria-label="Reveal"/); assert.doesNotMatch(solved, /Stop search|Continue searching|Resume search|Start a new search/);
  // Reveal sits with the phase actions, before the divider that sets the panel icon and the way out apart.
  assert.ok(solved.indexOf('aria-label="Reveal"') < solved.indexOf('aria-label="People and contacts"'));
});

test('the bar exists before the first session: only Leave full screen and Close, so a remembered full screen can always be left', () => {
  const markup = inFullscreen(() => renderToStaticMarkup(<ConnectionExplorer session={null} busy onStop={() => {}} onContinue={() => {}} onFresh={() => {}} onClose={() => {}} />));
  const bar = barOf(markup);
  assert.ok(bar.length > 0);
  assert.match(bar, /ce-working is-working/);
  assert.deepEqual([...bar.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(match => match[1]), ['Leave full screen', 'Close contact exploration']);
  assert.doesNotMatch(bar, /ce-side|ce-degrees|People and contacts/);
  assert.match(markup, /Preparing the contact network/);
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
