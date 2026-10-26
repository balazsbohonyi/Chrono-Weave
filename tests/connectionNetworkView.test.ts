import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateContact, ConnectionSession, ContactPerson } from '../src/services/connectionGraph';
import {
  buildNetworkView, closestApproachLabel, corridorSpine, edgeDrawOrder, edgeId, inspectedPeople, portraitSubjects, describeSide, lifespanGap, NO_FILTERS, NETWORK_FOLD_THRESHOLD,
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
  // Each person remembers the contact they were reached through on their own side; endpoints and unattached people have none.
  assert.deepEqual(['a', 'x', 'y', 'b', 'n', 'f', 'l1'].map(id => by[id].parent), [null, 'a', 'x', null, 'b', 'n', null]);
  assert.equal(describeSide(by.y, ['A', 'B']), 'Reached from A · 2 links');
  assert.equal(describeSide(by.l1, ['A', 'B']), 'Not yet attached to either endpoint');
  assert.equal(describeSide(by.b, ['A', 'B']), 'Endpoint B');
});

test('side counts: accepted people by the nearer endpoint, endpoints and unattached people left out, filters and folds ignored', () => {
  const far = human('f', 1700, 1760), near = human('n', 1710, 1770), lone1 = human('l1', 1650, 1700), lone2 = human('l2', 1660, 1710);
  const people = [A, B, X, Y, far, near, lone1, lone2], accepted = [link('a', 'x'), link('x', 'y'), link('b', 'n'), link('n', 'f'), link('l1', 'l2')];
  assert.deepEqual(buildNetworkView(session(people, accepted)).sides, { a: 2, b: 2 });
  // Unverified contacts do not count, wherever the chips are.
  const withDoubt = session([...people, U, Z], [...accepted, link('a', 'u', 'unresolved'), link('b', 'z', 'proposed')]);
  assert.deepEqual(buildNetworkView(withDoubt, { filters: { ...NO_FILTERS, unresolved: true, proposed: true } }).sides, { a: 2, b: 2 });
  // Equally near both endpoints: the same rule as the node colours (A).
  const bridged = buildNetworkView(session([A, B, X], [link('a', 'x'), link('x', 'b')]));
  assert.deepEqual(bridged.sides, { a: 1, b: 0 });
  assert.equal(bridged.nodes.find(node => node.id === 'x')!.side, 'a');
  // A crowd folds its dead ends behind "+n" badges, yet every one of them is counted.
  const leaves = Array.from({ length: NETWORK_FOLD_THRESHOLD + 10 }, (_, index) => human(`leaf${index}`, 1620, 1700));
  const crowded = buildNetworkView(session([A, B, X, ...leaves], [link('a', 'x'), ...leaves.map(leaf => link('x', leaf.id))]));
  assert.ok(crowded.folds.length > 0 && crowded.nodes.length < leaves.length);
  assert.deepEqual(crowded.sides, { a: leaves.length + 1, b: 0 });
});

test('a known chain is the one that is lit, in the endpoints order, as long as every step is still an accepted contact', () => {
  const s = session([A, B, X, Y], [link('a', 'x'), link('x', 'b'), link('a', 'y'), link('y', 'b')]);
  const route = (chain?: string[]) => buildNetworkView(s, { chain, highlightChain: true }).chain!.nodeIds;
  // Two routes of the same length: the shortest-route search settles on one of them, but the connection that was made names its own.
  const first = route();
  assert.equal(first.length, 3);
  assert.deepEqual(route(['a', 'x', 'b']), ['a', 'x', 'b']);
  assert.deepEqual(route(['a', 'y', 'b']), ['a', 'y', 'b']);
  assert.deepEqual(route(['b', 'y', 'a']), ['a', 'y', 'b']);
  assert.equal(buildNetworkView(s, { chain: ['a', 'y', 'b'] }).chain!.edgeIds.length, 2);
  // A chain that no longer holds (a step that is not accepted, or not from one endpoint to the other) falls back to the shortest route.
  const broken = session([A, B, X, Y], [link('a', 'x'), link('x', 'b'), link('a', 'y'), link('y', 'b', 'unresolved')]);
  assert.deepEqual(buildNetworkView(broken, { chain: ['a', 'y', 'b'] }).chain!.nodeIds, ['a', 'x', 'b']);
  assert.deepEqual(buildNetworkView(s, { chain: ['x', 'a'] }).chain!.nodeIds, first);
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

test('only AI-supported people are offered for a portrait by name; unverified people only when Wikidata has confirmed who they are', () => {
  const s = session([A, B, X, U, Z], [link('a', 'x'), link('x', 'u', 'unresolved'), link('x', 'z', 'proposed')]);
  const everything = buildNetworkView(s, { filters: { unresolved: true, proposed: true, blocked: true }, selection: { person: 'x' } });
  assert.ok(everything.nodes.some(node => node.id === 'u') && everything.nodes.some(node => node.id === 'z'));
  assert.deepEqual(portraitSubjects(everything).map(subject => subject.id).sort(), ['a', 'b', 'x'], 'no item known for the unverified ones: initials');
  assert.ok(portraitSubjects(everything).every(subject => subject.qid === undefined));
});

test('the inspector\'s people are offered for portraits even when not drawn: a selected person\'s unverified contacts, and both people of a selected contact', () => {
  const withItem = (person: typeof U, qid: string) => ({ ...person, qid });
  const s = session([A, B, X, withItem(U, 'Q12'), Z], [link('a', 'x'), link('x', 'u', 'unresolved'), link('x', 'z', 'proposed')]);
  const subjectsFor = (selection: { person?: string; edge?: string }) => {
    const view = buildNetworkView(s, { selection });
    return portraitSubjects(view, inspectedPeople(s, selection)).map(subject => [subject.id, subject.qid]).sort();
  };
  const edge = s.candidates.find(candidate => candidate.to === 'u')!;
  // Picking the contact from the person's list drops the person; the unverified contact is not drawn (its chip is off), but its people are shown.
  const picked = buildNetworkView(s, { selection: { edge: edgeId(edge) } });
  assert.ok(!picked.nodes.some(node => node.id === 'u'), 'u is not drawn once only the contact is selected');
  assert.deepEqual(subjectsFor({ edge: edgeId(edge) }), [['a', undefined], ['b', undefined], ['u', 'Q12'], ['x', undefined]]);
  assert.deepEqual(subjectsFor({ person: 'x' }), [['a', undefined], ['b', undefined], ['u', 'Q12'], ['x', undefined]]);
  assert.deepEqual(subjectsFor({}), [['a', undefined], ['b', undefined], ['x', undefined]]);
  assert.deepEqual(inspectedPeople(s, {}), []);
});

test('an unverified person whose Wikidata item is known is offered through the item, never by name; a supported one keeps the name', () => {
  const withItem = (person: typeof U, qid: string) => ({ ...person, qid });
  const s = session([withItem(A, 'Q10'), B, withItem(X, 'Q11'), withItem(U, 'Q12'), Z], [link('a', 'x'), link('x', 'u', 'unresolved'), link('x', 'z', 'proposed')]);
  const everything = buildNetworkView(s, { filters: { unresolved: true, proposed: true, blocked: true } });
  const subjects = portraitSubjects(everything);
  assert.deepEqual(subjects.map(subject => [subject.id, subject.qid]).sort(), [['a', undefined], ['b', undefined], ['u', 'Q12'], ['x', undefined]],
    'a and x are supported (by name, though they have an item); u is unverified with one; z has none and keeps its initials');
  assert.equal(subjects.find(subject => subject.id === 'u')?.name, U.name);
  // With the chips off the unverified person is not drawn, so nobody asks for them... unless the inspector lists them (`others`).
  const quiet = buildNetworkView(s, { selection: { person: 'x' } });
  assert.ok(quiet.nodes.some(node => node.id === 'u'), 'the selected person\'s own unverified contacts are drawn as context');
  const hidden = buildNetworkView(s);
  assert.deepEqual(portraitSubjects(hidden).map(subject => subject.id).sort(), ['a', 'b', 'x']);
  assert.deepEqual(portraitSubjects(hidden, [withItem(U, 'Q12'), Z]).map(subject => [subject.id, subject.qid]).sort(), [['a', undefined], ['b', undefined], ['u', 'Q12'], ['x', undefined]]);
  // A person who is in `others` but already offered by name is not offered twice.
  assert.equal(portraitSubjects(hidden, [withItem(X, 'Q11')]).filter(subject => subject.id === 'x').length, 1);
});

test('the corridor spine runs from A to B: the chain when there is one, else each endpoint to the closest approach, else just the two', () => {
  // Nothing known yet: only the two endpoints.
  assert.deepEqual(corridorSpine(buildNetworkView(session([A, B], []))), ['a', 'b']);
  // Two sides that have not met: a - x - y on one, b - n on the other. The spine is the way from a to the closest pair, then on to b.
  const n = human('n', 1760, 1830), far = human('f', 1700, 1760);
  const apart = buildNetworkView(session([A, B, X, Y, n, far], [link('a', 'x'), link('x', 'y'), link('b', 'n'), link('n', 'f')]));
  const spine = corridorSpine(apart);
  assert.ok(apart.closest && !apart.chain);
  assert.equal(spine[0], 'a'); assert.equal(spine[spine.length - 1], 'b');
  assert.equal(spine.indexOf(apart.closest!.b), spine.indexOf(apart.closest!.a) + 1, 'the gap is between the closest pair');
  assert.equal(new Set(spine).size, spine.length, 'nobody twice');
  // Connected: the chain itself.
  const joined = buildNetworkView(session([A, B, X, Y], [link('a', 'x'), link('x', 'y'), link('y', 'b')]));
  assert.deepEqual(corridorSpine(joined), joined.chain!.nodeIds);
  assert.deepEqual(corridorSpine(joined), ['a', 'x', 'y', 'b']);
});

test('with the AI-supported contacts off, the others can be looked at alone: endpoints, the chips that are on, whatever is selected, and the lit chain', () => {
  const s = session([A, B, X, Y, U, Z], [link('a', 'x'), link('x', 'y'), link('y', 'b'), link('a', 'u', 'unresolved'), link('x', 'z', 'proposed')]);
  // Nothing but the endpoints (the chain exists but is not lit in an ordinary exploration).
  const plain = buildNetworkView(s, { showAccepted: false });
  assert.deepEqual(ids(plain), ['a', 'b']); assert.equal(plain.edges.length, 0);
  // An unresolved chip adds only its contact: x stays hidden although it is an AI-supported person.
  const unresolved = buildNetworkView(s, { showAccepted: false, filters: { ...NO_FILTERS, unresolved: true } });
  assert.deepEqual(ids(unresolved), ['a', 'b', 'u']); assert.deepEqual(unresolved.edges.map(edge => edge.status), ['unresolved']);
  // A proposed contact between two AI-supported people brings both of them back, with just that line.
  const proposed = buildNetworkView(s, { showAccepted: false, filters: { ...NO_FILTERS, proposed: true } });
  assert.deepEqual(ids(proposed), ['a', 'b', 'x', 'z']); assert.deepEqual(proposed.edges.map(edge => edge.status), ['proposed']);
  // The lit chain (a search that just succeeded, or a solved connection) stays, with its people and its lines.
  for (const lit of [{ highlightChain: true }, { chain: ['a', 'x', 'y', 'b'] }]) {
    const view = buildNetworkView(s, { showAccepted: false, ...lit });
    assert.deepEqual(ids(view), ['a', 'b', 'x', 'y']); assert.equal(view.edges.length, 3);
    assert.deepEqual(view.chain?.nodeIds, ['a', 'x', 'y', 'b']);
  }
  // What is selected is drawn: an AI-supported person, or a contact with both of its people.
  assert.deepEqual(ids(buildNetworkView(s, { showAccepted: false, selection: { person: 'x' } })), ['a', 'b', 'x', 'z']);
  const edge = buildNetworkView(s, { showAccepted: false, selection: { edge: edgeId(link('x', 'y')) } });
  assert.deepEqual(ids(edge), ['a', 'b', 'x', 'y']); assert.equal(edge.edges.length, 1);
});

test('the lists and counts do not depend on what is drawn: switching the AI-supported contacts off changes neither', () => {
  const s = session([A, B, X, U], [link('a', 'x'), link('x', 'b'), link('a', 'u', 'unresolved')]);
  const on = buildNetworkView(s), off = buildNetworkView(s, { showAccepted: false });
  assert.deepEqual(off.counts, on.counts);
  assert.deepEqual(off.list.contacts.accepted.map(edge => edge.id), on.list.contacts.accepted.map(edge => edge.id));
  assert.deepEqual(off.list.people.map(person => person.id), on.list.people.map(person => person.id));
  assert.deepEqual(off.sides, on.sides);
});

test('the lit chain can be switched off too: with the AI-supported contacts off nothing of it stays, and a just-found chain stops dimming the rest', () => {
  const s = session([A, B, X, Y], [link('a', 'x'), link('x', 'y'), link('y', 'b')]);
  for (const lit of [{ highlightChain: true }, { chain: ['a', 'x', 'y', 'b'] }]) {
    const view = buildNetworkView(s, { showAccepted: false, showChain: false, ...lit });
    assert.deepEqual(ids(view), ['a', 'b']); assert.equal(view.edges.length, 0);
  }
  // With the AI-supported contacts on, everything is drawn either way; only the dimming of the others goes.
  const on = buildNetworkView(s, { showChain: true, highlightChain: true }), off = buildNetworkView(s, { showChain: false });
  assert.ok(on.focus); assert.equal(off.focus, null); assert.equal(off.nodes.length, on.nodes.length);
});

test('a reopened connection dims everyone off its chain until something is selected, and the chain chip turns that off', () => {
  const s = session([A, B, X, Y, Z], [link('a', 'x'), link('x', 'y'), link('y', 'b'), link('x', 'z')]);
  const chain = ['a', 'x', 'y', 'b'];
  const solved = buildNetworkView(s, { chain });
  assert.deepEqual([...solved.focus!.nodes].sort(), chain.slice().sort()); assert.equal(solved.focus!.edges.size, 3);
  assert.ok(buildNetworkView(s, { chain, selection: { person: 'z' } }).focus!.nodes.has('z'));
  assert.equal(buildNetworkView(s, { chain, showChain: false }).focus, null);
});

test('the request in flight reaches the view: the people asked about are marked, and who is drawn never changes with it', () => {
  const s = session([A, B, X, U, Z], [link('a', 'x'), link('u', 'z', 'checking')]);
  assert.equal(buildNetworkView(s).activity, null); assert.deepEqual(ids(buildNetworkView(s)), ['a', 'b', 'x']);
  // Pairs being checked are drawn only when the Proposed / checking chip is on, as before: the request adds nobody and removes nobody.
  s.activity = { kind: 'assess', people: [], pairs: [['u', 'z']] };
  assert.deepEqual(ids(buildNetworkView(s)), ['a', 'b', 'x']);
  const chip = buildNetworkView(s, { filters: { ...NO_FILTERS, proposed: true } });
  assert.deepEqual(ids(chip), ['a', 'b', 'u', 'x', 'z']); assert.ok(chip.nodes.find(node => node.id === 'u')!.active);
  assert.deepEqual(ids(buildNetworkView({ ...s, activity: undefined }, { filters: { ...NO_FILTERS, proposed: true } })), ids(chip));
  s.activity = { kind: 'discover', people: [{ id: 'x', side: 'a' }, { id: 'b', side: 'b' }] };
  const asking = buildNetworkView(s);
  assert.deepEqual(asking.nodes.filter(node => node.working).map(node => [node.id, node.working]), [['b', { kind: 'asked', side: 'b' }], ['x', { kind: 'asked', side: 'a' }]]);
  s.activity = { kind: 'identity', people: [{ id: 'x' }] };
  assert.deepEqual(buildNetworkView(s).nodes.find(node => node.id === 'x')!.working, { kind: 'identity' });
});

test('lines are drawn faded first, then the rest, the lit chain last of each: a click where lines cross lands on the one the reader is looking at', () => {
  const edges = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map(id => ({ id }));
  const focus = { edges: new Set(['e2', 'e5']) }, chain = new Set(['e3', 'e5']);
  // Outside the focus: e1, e3 (chain), e4, e6; inside: e2, e5 (chain).
  assert.deepEqual(edgeDrawOrder(edges, focus, chain).map(edge => edge.id), ['e1', 'e4', 'e6', 'e3', 'e2', 'e5']);
  // Nothing selected: the order is kept, except that the chain goes last.
  assert.deepEqual(edgeDrawOrder(edges, null, chain).map(edge => edge.id), ['e1', 'e2', 'e4', 'e6', 'e3', 'e5']);
  assert.deepEqual(edgeDrawOrder(edges, null, null).map(edge => edge.id), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
});
