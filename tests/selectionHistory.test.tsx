import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NetworkInspector from '../src/components/connectionNetwork/NetworkInspector';
import ConnectionExplorer from '../src/components/ConnectionExplorer';
import { backLabel, pushStep, type Step } from '../src/components/connectionNetwork/selectionHistory';
import { buildNetworkView, edgeId, type NetworkSelection } from '../src/services/connectionNetworkView';
import { figurePerson, identifyPerson, sessionKey, type ConnectionSession, type ContactPerson } from '../src/services/connectionGraph';
import { A, B, M, N } from './connectionFixtures';

const names: Record<string, string> = { a: 'Alpha', b: 'Beta' };
const nameOf = (id: string) => names[id] ?? id;

test('Back names where it goes: the person a contact was opened from, otherwise the list the inspector was on', () => {
  assert.equal(backLabel([], 'people', nameOf), '← People');
  assert.equal(backLabel([], 'contacts', nameOf), '← Contacts');
  assert.equal(backLabel([{ selection: { person: 'a' } }], 'contacts', nameOf), '← Alpha');
  assert.equal(backLabel([{ selection: { person: 'a' } }, { selection: { edge: 'x' } }], 'people', nameOf), '← Contact');
});

test('the history keeps the steps in order, with what the reader had done, and stays bounded', () => {
  const first: Step = { selection: { person: 'a' }, detail: { tab: 'unverified', top: 420 } };
  assert.deepEqual(pushStep([], first), [first]);
  assert.deepEqual(pushStep([first], { selection: { person: 'b' } }).map(step => step.selection.person), ['a', 'b']);
  let history: Step[] = [];
  for (let i = 0; i < 40; i++) history = pushStep(history, { selection: { person: String(i) } });
  assert.equal(history.length, 16);
  assert.equal(history[history.length - 1].selection.person, '39');
});

const provenance = { provider: 'synthetic', model: 'synthetic', version: 2, assessedAt: 1 };
function build(): ConnectionSession {
  const people: ContactPerson[] = []; for (const p of [A, B, M, N]) identifyPerson(people, figurePerson(p));
  const accepted = (from: number, to: number) => ({ from: people[from].id, to: people[to].id, status: 'accepted' as const, claim: '',
    assessment: { pair: [people[from].id, people[to].id] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const, evidence: 'They met.', provenance } });
  return { version: 2, key: sessionKey('one', people[0].id, people[1].id), canvasId: 'one', endpoints: [people[0].id, people[1].id], people, candidates: [accepted(0, 2), accepted(2, 1)],
    rounds: [], attempts: {}, segment: 1, status: 'paused', phase: '', elapsedMs: 0, updatedAt: 1, persistent: true, diagnostics: { tasks: 0, people: 0, pairs: 0, stopReason: 'work-budget' } };
}
const inspector = (selection: NetworkSelection, history: Step[] = [], restored: React.ComponentProps<typeof NetworkInspector>['restored'] = null) => {
  const session = build();
  return renderToStaticMarkup(<NetworkInspector session={session} view={buildNetworkView(session, { selection })} selection={selection} portraits={new Map()} pinned={new Set()}
    narrow={false} open onSelect={() => {}} onUnpin={() => {}} onDismiss={() => {}} onBack={() => {}} history={history} restored={restored} query="" onQueryChange={() => {}} />);
};

test('the lists start under a compact top: the hint is the tooltip of a "?", the endpoints are two chips, and there is no Back button', () => {
  const markup = renderToStaticMarkup(<ConnectionExplorer session={build()} busy={false} onStop={() => {}} onContinue={() => {}} onFresh={() => {}} onClose={() => {}} />);
  const top = markup.slice(markup.indexOf('Inspect the exploration'), markup.indexOf('role="tablist" aria-label="AI-supported people and contacts"'));
  assert.match(top, /class="net-help" aria-label="Select a person or contact to read the stored evidence\. Inspection does not make additional AI requests\."/);
  assert.doesNotMatch(top, /net-hint-line|<h5/);
  assert.equal(top.match(/net-endpoint-chip/g)?.length, 2);
  assert.match(top, /net-end-badge is-a/); assert.match(top, /net-end-badge is-b/);
  assert.doesNotMatch(markup, /net-back/);
});

test('a person opened from a list says Back goes to that list; a contact opened from the person says Back goes to the person', () => {
  const session = build(), alpha = session.people[0], middle = session.people[2];
  assert.match(inspector({ person: alpha.id }), /class="net-back"[^>]*title="← People"[^>]*aria-label="Back to People">← People</);
  const edge = edgeId(session.candidates[0]);
  const fromPerson = inspector({ edge }, [{ selection: { person: alpha.id } }]);
  assert.match(fromPerson, /class="net-back"[^>]*title="← Alpha"[^>]*aria-label="Back to Alpha">← Alpha</);
  assert.doesNotMatch(inspector({ edge }), /← Alpha/);
  assert.doesNotMatch(fromPerson, /Back to list/);
  assert.ok(middle);
});

test('a person Back returns to opens on the list they were on', () => {
  const session = build(), alpha = session.people[0];
  // Alpha's only contact is accepted, so the tab that was left on shows it; the unverified tab is the restored one here and is empty.
  const restored = { n: 1, person: alpha.id, detail: { tab: 'unverified' as const, top: 0 } };
  assert.match(inspector({ person: alpha.id }, [], restored), /aria-selected="true"[^>]*aria-label="Unverified contacts, 0"/);
  assert.match(inspector({ person: alpha.id }), /aria-selected="true"[^>]*aria-label="AI-supported contacts, 1"/);
  // A restore that was meant for somebody else is ignored.
  assert.match(inspector({ person: alpha.id }, [], { ...restored, person: 'someone-else' }), /aria-selected="true"[^>]*aria-label="AI-supported contacts, 1"/);
});
