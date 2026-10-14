import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateContact, ConnectionSession, ContactPerson } from '../src/services/connectionGraph';
import {
  buildNetworkView, closestApproachLabel, portraitSubjects, describeSide, lifespanGap, NO_FILTERS, NETWORK_FOLD_THRESHOLD,
} from '../src/services/connectionNetworkView';

const provenance = { provider: 'synthetic', model: 'synthetic', version: 2, assessedAt: 1 };
const human = (id: string, birthYear: number, deathYear: number): ContactPerson =>
  ({ id, name: id.toUpperCase(), birthYear, deathYear, occupation: 'Scholar', category: 'THINKERS', description: '', aliases: [] });
const link = (from: string, to: string, status: CandidateContact['status'] = 'accepted'): CandidateContact => ({
  from, to, status, claim: status === 'accepted' ? '' : `${from} and ${to}`,
  assessment: status === 'accepted' || status === 'unresolved' ? { pair: [from, to], verdict: status === 'accepted' ? 'accepted' : 'unresolved', interactionType: 'meeting', evidence: 'They met.', provenance } : undefined,
  blockedReason: status === 'blocked' ? 'Lifespans do not overlap' : undefined,
});
function session(people: ContactPerson[], candidates: CandidateContact[], endpoints = [people[0].id, people[1].id] as [string, string]): ConnectionSession {
  return { version: 2, key: 'k', canvasId: 'c', endpoints, people, candidates, rounds: [], attempts: {}, segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 0, updatedAt: 0, diagnostics: { tasks: 0, people: 0, pairs: 0 } };
}
const ids = (view: { nodes: Array<{ id: string }> }) => view.nodes.map(node => node.id).sort();

const A = human('a', 1600, 1650), B = human('b', 1800, 1850), X = human('x', 1620, 1700), Y = human('y', 1700, 1790), U = human('u', 1630, 1690), Z = human('z', 1640, 1700);

test('default view shows endpoints and accepted people only', () => {
  const view = buildNetworkView(session([A, B, X, U, Z], [link('a', 'x'), link('a', 'u', 'unresolved'), link('x', 'z', 'proposed'), link('z', 'b', 'blocked')]));
  assert.deepEqual(ids(view), ['a', 'b', 'x']);
  assert.deepEqual(view.edges.map(edge => edge.id).length, 1);
  assert.equal(view.edges[0].status, 'accepted');
  assert.equal(view.counts.contacts, 1); assert.equal(view.counts.unresolved, 1); assert.equal(view.counts.proposed, 1); assert.equal(view.counts.blocked, 1);
});

test('status chips reveal those edges and their people across the whole graph', () => {
  const s = session([A, B, X, U, Z], [link('a', 'x'), link('a', 'u', 'unresolved'), link('x', 'z', 'proposed'), link('z', 'b', 'blocked')]);
  assert.deepEqual(ids(buildNetworkView(s, { filters: { ...NO_FILTERS, unresolved: true } })), ['a', 'b', 'u', 'x']);
  const proposed = buildNetworkView(s, { filters: { ...NO_FILTERS, proposed: true } });
  assert.deepEqual(ids(proposed), ['a', 'b', 'x', 'z']);
  assert.ok(proposed.nodes.find(node => node.id === 'z')!.supported === false);
  assert.ok(!proposed.nodes.find(node => node.id === 'z')!.contextual);
});

test('checking pairs travel with the proposed chip and mark their people active', () => {
  const s = session([A, B, X], [link('a', 'x'), link('x', 'b', 'checking')]);
  assert.deepEqual(ids(buildNetworkView(s)), ['a', 'b', 'x']);
  assert.ok(buildNetworkView(s).nodes.find(node => node.id === 'x')!.active);
  assert.equal(buildNetworkView(s, { filters: { ...NO_FILTERS, proposed: true } }).edges.length, 2);
});

test('selecting a person reveals their unverified contacts, and they clear with the selection', () => {
  const s = session([A, B, X, U, Z], [link('a', 'x'), link('x', 'u', 'unresolved'), link('x', 'z', 'blocked'), link('a', 'b', 'proposed')]);
  const selected = buildNetworkView(s, { selection: { person: 'x' } });
  assert.deepEqual(ids(selected), ['a', 'b', 'u', 'x', 'z']);
  assert.ok(selected.edges.filter(edge => edge.contextual).length === 2);
  assert.ok(selected.nodes.filter(node => node.contextual).map(node => node.id).sort().join() === 'u,z');
  assert.deepEqual(ids(buildNetworkView(s, { selection: {} })), ['a', 'b', 'x']);
  // A chip that is on keeps them, and they are no longer merely contextual.
  const chipped = buildNetworkView(s, { selection: { person: 'x' }, filters: { ...NO_FILTERS, unresolved: true } });
  assert.ok(!chipped.nodes.find(node => node.id === 'u')!.contextual);
  assert.ok(chipped.nodes.find(node => node.id === 'z')!.contextual);
});

test('sides, distances and unattached people', () => {
  const far = human('f', 1700, 1760), near = human('n', 1710, 1770), lone1 = human('l1', 1650, 1700), lone2 = human('l2', 1660, 1710);
  const view = buildNetworkView(session([A, B, X, Y, far, near, lone1, lone2], [link('a', 'x'), link('x', 'y'), link('b', 'n'), link('n', 'f'), link('l1', 'l2')]));
  const by = Object.fromEntries(view.nodes.map(node => [node.id, node]));
  assert.equal(by.a.side, 'a'); assert.equal(by.a.distance, 0);
  assert.equal(by.x.side, 'a'); assert.equal(by.x.distance, 1);
  assert.equal(by.y.side, 'a'); assert.equal(by.y.distance, 2);
  assert.equal(by.n.side, 'b'); assert.equal(by.f.distance, 2);
  assert.equal(by.l1.side, 'none'); assert.equal(by.l1.distance, null);
  assert.equal(describeSide(by.y, ['A', 'B']), 'Reached from A · 2 links');
  assert.equal(describeSide(by.l1, ['A', 'B']), 'Not yet attached to either endpoint');
  assert.equal(describeSide(by.b, ['A', 'B']), 'Endpoint B');
});

test('closest approach: smallest gap, overlap is zero, deterministic ties, gone once connected', () => {
  assert.equal(lifespanGap(A, X), 0);
  assert.equal(lifespanGap(A, B), 150);
  const s = session([A, B, X, Y, Z], [link('a', 'x'), link('b', 'y'), link('b', 'z')]);
  const view = buildNetworkView(s);
  // a (1600-1650) overlaps z (1640-1700): gap 0 in one link, ahead of x-z or x-y which cost two.
  assert.equal(view.closest!.gap, 0);
  assert.equal(view.closest!.links, 1);
  assert.deepEqual([view.closest!.a, view.closest!.b], ['a', 'z']);
  assert.match(closestApproachLabel(view.closest!, id => id), /lifespans overlap/);
  const spread = buildNetworkView(session([A, B], [])).closest!;
  assert.equal(spread.gap, 150);
  assert.match(closestApproachLabel(spread, id => id), /150 years apart/);
  assert.equal(buildNetworkView(session([A, B, X], [link('a', 'x'), link('x', 'b')])).closest, null);
});

test('closest approach prefers fewer links, then names, when gaps tie', () => {
  const p = human('p', 1700, 1750), q = human('q', 1700, 1750);
  const view = buildNetworkView(session([A, B, X, p, q], [link('a', 'x'), link('x', 'p'), link('b', 'q')]));
  // gap(a-side, b-side): p with q overlap (0, 3 links); x with q overlap?  x 1620-1700 vs q 1700-1750 -> 0, 2 links. a with q: gap 50.
  assert.equal(view.closest!.gap, 0);
  assert.equal(view.closest!.links, 2);
  assert.deepEqual([view.closest!.a, view.closest!.b], ['x', 'q']);
});

const crowd = (leaves: number) => {
  const hub = human('hub', 1620, 1700), people = [A, B, hub];
  const candidates = [link('a', 'hub'), link('hub', 'b')];
  for (let i = 0; i < leaves; i++) { const leaf = human(`leaf${String(i).padStart(2, '0')}`, 1630, 1690); people.push(leaf); candidates.push(link('hub', leaf.id)); }
  return session(people, candidates);
};

test('folds dead-end leaves above the threshold, with exemptions', () => {
  const small = buildNetworkView(crowd(5));
  assert.equal(small.folds.length, 0);
  const s = crowd(NETWORK_FOLD_THRESHOLD + 2);
  const view = buildNetworkView(s);
  assert.equal(view.folds.length, 1);
  assert.equal(view.folds[0].hostId, 'hub');
  assert.equal(view.folds[0].ids.length, NETWORK_FOLD_THRESHOLD + 2);
  assert.deepEqual(ids(view), ['a', 'b', 'hub']);
  // Everyone stays in the readable list.
  assert.equal(view.list.people.length, NETWORK_FOLD_THRESHOLD + 3);
  // ...and so are the contacts of the folded people, and their portraits are asked for.
  assert.equal(view.list.contacts.accepted.length, NETWORK_FOLD_THRESHOLD + 4);
  assert.equal(portraitSubjects(view).length, NETWORK_FOLD_THRESHOLD + 5);
  // Selection and pins stay visible.
  assert.ok(ids(buildNetworkView(s, { selection: { person: 'leaf03' } })).includes('leaf03'));
  assert.ok(ids(buildNetworkView(s, { pinned: new Set(['leaf04']) })).includes('leaf04'));
  // Expanding the host shows its leaves again.
  const open = buildNetworkView(s, { expanded: new Set(['hub']) });
  assert.equal(open.nodes.length, NETWORK_FOLD_THRESHOLD + 5);
  assert.equal(open.folds[0].expanded, true);
});

test('the closest-approach pair is never folded', () => {
  const s = crowd(NETWORK_FOLD_THRESHOLD + 2);
  // Nobody connects both ends here except through hub, so remove b's link to get a closest approach between sides.
  s.candidates = s.candidates.filter(c => c.to !== 'b');
  const view = buildNetworkView(s);
  assert.ok(view.closest);
  assert.ok(ids(view).includes(view.closest!.a) && ids(view).includes(view.closest!.b));
});

test('leaves hanging off each other do not fold away', () => {
  const s = crowd(NETWORK_FOLD_THRESHOLD);
  const p = human('pa', 1630, 1690), q = human('pb', 1630, 1690);
  s.people.push(p, q); s.candidates.push(link('pa', 'pb'));
  const view = buildNetworkView(s);
  assert.ok(ids(view).includes('pa') && ids(view).includes('pb'));
});

test('a connected session exposes its chain and unfolds it for the success highlight', () => {
  const s = crowd(NETWORK_FOLD_THRESHOLD + 2);
  const lit = buildNetworkView(s, { highlightChain: true });
  assert.deepEqual(lit.chain!.nodeIds, ['a', 'hub', 'b']);
  assert.equal(lit.chain!.edgeIds.length, 2);
  assert.deepEqual([...lit.focus!.nodes].sort(), ['a', 'b', 'hub']);
  assert.equal(lit.closest, null);
  assert.ok(lit.nodes.some(node => node.id === 'hub'));
});

test('selection focus dims everything except the selection and its neighbours', () => {
  const s = session([A, B, X, Y], [link('a', 'x'), link('x', 'y'), link('b', 'y')]);
  const person = buildNetworkView(s, { selection: { person: 'x' } });
  assert.deepEqual([...person.focus!.nodes].sort(), ['a', 'x', 'y']);
  const edge = buildNetworkView(s, { selection: { edge: person.edges.find(e => e.from === 'x' && e.to === 'y' || e.from === 'y' && e.to === 'x')!.id } });
  assert.deepEqual([...edge.focus!.nodes].sort(), ['x', 'y']);
  assert.equal(edge.focus!.edges.size, 1);
  assert.equal(buildNetworkView(s).focus, null);
});

test('only AI-supported people are ever offered for portraits', () => {
  const s = session([A, B, X, U, Z], [link('a', 'x'), link('x', 'u', 'unresolved'), link('x', 'z', 'proposed')]);
  const everything = buildNetworkView(s, { filters: { unresolved: true, proposed: true, blocked: true }, selection: { person: 'x' } });
  assert.ok(everything.nodes.some(node => node.id === 'u') && everything.nodes.some(node => node.id === 'z'));
  assert.deepEqual(portraitSubjects(everything).map(subject => subject.id).sort(), ['a', 'b', 'x']);
});
