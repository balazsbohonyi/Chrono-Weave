import { lifespanGapYears, type CandidateContact, type ConnectionSession, type ContactPerson } from './connectionGraph';
import { pairKey } from './pathService';

// The pure view model behind the Six Degrees network: which people and contacts are drawn for a
// session, given the filters, the selection and the folded leaves. No React, no layout, no AI.

// Above this many visible people, dead-end leaves fold into "+n" badges.
export const NETWORK_FOLD_THRESHOLD = 30;

export type ContactStatus = CandidateContact['status'];
// Chips for the statuses that are not AI-supported; 'checking' pairs travel with 'proposed'.
export type UnverifiedFilter = 'unresolved' | 'proposed' | 'blocked';
export type NetworkFilters = Record<UnverifiedFilter, boolean>;
export const NO_FILTERS: NetworkFilters = { unresolved: false, proposed: false, blocked: false };
export const FILTER_ORDER: UnverifiedFilter[] = ['unresolved', 'proposed', 'blocked'];
export const filterOf = (status: ContactStatus): UnverifiedFilter | null =>
  status === 'accepted' ? null : status === 'proposed' || status === 'checking' ? 'proposed' : status;
export const STATUS_LABELS: Record<ContactStatus, string> = {
  proposed: 'Proposed', checking: 'Checking', accepted: 'AI-supported', unresolved: 'Unresolved', blocked: 'Structurally blocked',
};

export type Side = 'a' | 'b' | 'none';
export interface NetworkSelection { person?: string; edge?: string }

export interface NetworkNode {
  id: string;
  person: ContactPerson;
  endpoint: 0 | 1 | null;
  side: Side;
  // Accepted links from the endpoint on its side; null when it is reachable from neither.
  distance: number | null;
  // The contact this person was reached through on the way from that endpoint (null for endpoints and for people attached to neither).
  parent: string | null;
  // An endpoint or someone with at least one accepted contact. Everyone else is tentative.
  supported: boolean;
  // Pairs involving this person are being assessed right now.
  active: boolean;
  // Visible only because it is a contact of the selected person.
  contextual: boolean;
}
export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  status: ContactStatus;
  candidate: CandidateContact;
  contextual: boolean;
}
export interface NetworkFold { hostId: string; ids: string[]; expanded: boolean }
export interface ClosestApproach { a: string; b: string; gap: number; links: number }
export interface NetworkChain { nodeIds: string[]; edgeIds: string[] }
export interface NetworkCounts { people: number; contacts: number; unresolved: number; proposed: number; blocked: number }

export interface NetworkViewOptions {
  filters?: NetworkFilters;
  // Whether the AI-supported contacts (and the people only they bring in) are drawn; default yes. Off, the graph keeps the endpoints, the
  // people and contacts of the filters that are on, whatever is selected, and the chain when it is lit (`highlightChain` or `chain`).
  showAccepted?: boolean;
  // Whether the lit chain (see `highlightChain`, `chain`) is kept drawn when the AI-supported contacts are off; default yes.
  showChain?: boolean;
  selection?: NetworkSelection;
  // Hosts whose folded leaves are shown.
  expanded?: ReadonlySet<string>;
  pinned?: ReadonlySet<string>;
  threshold?: number;
  // The success hand-off: light the chain and keep all of its members unfolded.
  highlightChain?: boolean;
  // The people of an already known chain, in order (shared identity ids): lit instead of whichever shortest accepted route is found first,
  // as long as every step is still an accepted contact. Without it the route is the shortest accepted one between the endpoints.
  chain?: readonly string[];
}

export interface NetworkView {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  folds: NetworkFold[];
  closest: ClosestApproach | null;
  chain: NetworkChain | null;
  // What stays at full strength; everything else dims. Null when nothing is selected.
  focus: { nodes: Set<string>; edges: Set<string> } | null;
  counts: NetworkCounts;
  // How many accepted-contact people (the endpoints not counted) are nearer to each endpoint, by the same rule as `NetworkNode.side`.
  // Complete: legend filters and folded "+n" leaves do not change it.
  sides: { a: number; b: number };
  list: {
    endpoints: ContactPerson[];
    people: ContactPerson[];
    unverified: ContactPerson[];
    contacts: Record<'accepted' | UnverifiedFilter, NetworkEdge[]>;
  };
}

// The order lines are drawn in, which is also which one a click lands on where lines cross (the one drawn last is on top): the faded ones
// (outside the focus of a selection) first, then the others, and the lit chain last of each. The order inside each group is kept.
export function edgeDrawOrder<T extends { id: string }>(edges: readonly T[], focus: { edges: ReadonlySet<string> } | null, chainEdges: ReadonlySet<string> | null): T[] {
  const rank = (edge: T) => (focus && !focus.edges.has(edge.id) ? 0 : 2) + (chainEdges?.has(edge.id) ? 1 : 0);
  return edges.map((edge, index) => ({ edge, index, rank: rank(edge) })).sort((x, y) => x.rank - y.rank || x.index - y.index).map(item => item.edge);
}
export const edgeId = (contact: Pick<CandidateContact, 'from' | 'to'>) => pairKey(contact.from, contact.to);

// Years between two lifespans; overlapping lifespans are 0 apart.
export const lifespanGap = lifespanGapYears;

function distancesFrom(start: string, adjacency: Map<string, string[]>, parents?: Map<string, string>): Map<string, number> {
  const distance = new Map([[start, 0]]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of adjacency.get(id) ?? []) if (!distance.has(next)) {
      distance.set(next, distance.get(id)! + 1); parents?.set(next, id); queue.push(next);
    }
  }
  return distance;
}

export function buildNetworkView(session: ConnectionSession, options: NetworkViewOptions = {}): NetworkView {
  const { filters = NO_FILTERS, showAccepted = true, showChain = true, selection = {}, expanded = new Set<string>(), pinned = new Set<string>(),
    threshold = NETWORK_FOLD_THRESHOLD, highlightChain = false, chain: knownChain } = options;
  const byId = new Map(session.people.map(person => [person.id, person]));
  const [first, second] = session.endpoints;
  const known = session.candidates.filter(c => c.from !== c.to && byId.has(c.from) && byId.has(c.to));
  const accepted = known.filter(c => c.status === 'accepted');

  const adjacency = new Map<string, string[]>();
  for (const c of accepted) for (const [x, y] of [[c.from, c.to], [c.to, c.from]]) adjacency.set(x, [...(adjacency.get(x) ?? []), y]);
  const parents = new Map<string, string>();
  const parentsB = new Map<string, string>();
  const fromA = distancesFrom(first, adjacency, parents), fromB = distancesFrom(second, adjacency, parentsB);

  let chain: NetworkChain | null = null;
  if (byId.has(first) && byId.has(second) && first !== second && fromA.has(second)) {
    const nodeIds = [second];
    while (nodeIds[0] !== first) nodeIds.unshift(parents.get(nodeIds[0])!);
    chain = { nodeIds, edgeIds: nodeIds.slice(1).map((id, i) => pairKey(nodeIds[i], id)) };
  }
  // A chain that is already known (a finished connection reopened) wins over the shortest route, when it still holds end to end.
  if (knownChain && knownChain.length >= 2 && knownChain.every(id => byId.has(id)) && new Set(knownChain).size === knownChain.length
    && [knownChain[0], knownChain[knownChain.length - 1]].every(id => id === first || id === second) && knownChain[0] !== knownChain[knownChain.length - 1]
    && knownChain.slice(1).every((id, i) => (adjacency.get(knownChain[i]) ?? []).includes(id))) {
    const nodeIds = knownChain[0] === first ? [...knownChain] : [...knownChain].reverse();
    chain = { nodeIds, edgeIds: nodeIds.slice(1).map((id, i) => pairKey(nodeIds[i], id)) };
  }

  const supported = new Set<string>([first, second].filter(id => byId.has(id)));
  for (const c of accepted) { supported.add(c.from); supported.add(c.to); }

  // Which unverified contacts are drawn: those whose chip is on, plus the selected person's own.
  const shown = new Map<string, { candidate: CandidateContact; contextual: boolean }>();
  // With the AI-supported contacts off, only what the reader is looking at or the lit chain keeps its line.
  const litChain = showChain && chain && (highlightChain || (knownChain && knownChain.length >= 2)) ? chain : null;
  const keepsLine = (c: CandidateContact) => showAccepted || edgeId(c) === selection.edge || !!litChain?.edgeIds.includes(edgeId(c));
  for (const c of accepted) if (keepsLine(c)) shown.set(edgeId(c), { candidate: c, contextual: false });
  for (const c of known) {
    const filter = filterOf(c.status);
    if (!filter) continue;
    const touchesSelection = !!selection.person && (c.from === selection.person || c.to === selection.person);
    if (filters[filter]) shown.set(edgeId(c), { candidate: c, contextual: false });
    else if (touchesSelection) shown.set(edgeId(c), { candidate: c, contextual: true });
  }

  const visible = new Set(showAccepted ? supported : [first, second].filter(id => byId.has(id)));
  if (!showAccepted) {
    for (const id of litChain?.nodeIds ?? []) visible.add(id);
    if (selection.person && byId.has(selection.person)) visible.add(selection.person);
  }
  const chipPeople = new Set<string>();
  for (const { candidate, contextual } of shown.values()) {
    visible.add(candidate.from); visible.add(candidate.to);
    if (!contextual) { chipPeople.add(candidate.from); chipPeople.add(candidate.to); }
  }

  // Closest approach between the two sides, until a chain exists.
  let closest: ClosestApproach | null = null;
  if (!chain) {
    const sideA = [...fromA.keys()].filter(id => byId.has(id)), sideB = [...fromB.keys()].filter(id => byId.has(id));
    let best: { gap: number; links: number; names: string; a: string; b: string } | null = null;
    for (const x of sideA) for (const y of sideB) {
      if (x === y) continue;
      const gap = lifespanGap(byId.get(x)!, byId.get(y)!), links = fromA.get(x)! + fromB.get(y)!;
      const names = `${byId.get(x)!.name}\u0000${byId.get(y)!.name}`;
      if (!best || gap < best.gap || (gap === best.gap && (links < best.links || (links === best.links && names < best.names)))) best = { gap, links, names, a: x, b: y };
    }
    if (best) closest = { a: best.a, b: best.b, gap: best.gap, links: best.links };
  }

  // Fold dead-end leaves of a crowded graph into their neighbour.
  const degree = new Map<string, number>();
  for (const { candidate } of shown.values()) for (const id of [candidate.from, candidate.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const folded = new Map<string, string[]>();
  if (visible.size > threshold) {
    const exempt = new Set<string>([first, second, ...(pinned), ...(closest ? [closest.a, closest.b] : [])]);
    if (selection.person) exempt.add(selection.person);
    if (selection.edge) for (const { candidate } of shown.values()) if (edgeId(candidate) === selection.edge) { exempt.add(candidate.from); exempt.add(candidate.to); }
    if (highlightChain && chain) for (const id of chain.nodeIds) exempt.add(id);
    const leaves = new Map<string, string>();
    for (const { candidate } of shown.values()) {
      for (const [leaf, host] of [[candidate.from, candidate.to], [candidate.to, candidate.from]]) {
        if (supported.has(leaf) && degree.get(leaf) === 1 && !exempt.has(leaf)) leaves.set(leaf, host);
      }
    }
    // Two leaves hanging off each other would fold away entirely, so neither folds.
    for (const [leaf, host] of leaves) if (!leaves.has(host)) folded.set(host, [...(folded.get(host) ?? []), leaf]);
  }
  const hidden = new Set<string>();
  const folds: NetworkFold[] = [];
  for (const [hostId, ids] of folded) {
    const isExpanded = expanded.has(hostId);
    folds.push({ hostId, ids: ids.sort(), expanded: isExpanded });
    if (!isExpanded) for (const id of ids) hidden.add(id);
  }
  folds.sort((x, y) => x.hostId.localeCompare(y.hostId));

  const checking = new Set<string>();
  for (const c of known) if (c.status === 'checking') { checking.add(c.from); checking.add(c.to); }
  const sideOf = (id: string): Side => {
    const da = fromA.get(id), db = fromB.get(id);
    return da !== undefined && (db === undefined || da <= db) ? 'a' : db !== undefined ? 'b' : 'none';
  };
  const sides = { a: 0, b: 0 };
  for (const id of supported) if (id !== first && id !== second) { const side = sideOf(id); if (side !== 'none') sides[side]++; }
  const nodes: NetworkNode[] = [...visible].filter(id => !hidden.has(id)).map(id => {
    const da = fromA.get(id), db = fromB.get(id);
    const side = sideOf(id);
    return {
      id, person: byId.get(id)!, endpoint: id === first ? 0 : id === second ? 1 : null, side,
      distance: side === 'a' ? da! : side === 'b' ? db! : null,
      parent: (side === 'a' ? parents : side === 'b' ? parentsB : undefined)?.get(id) ?? null,
      supported: supported.has(id), active: checking.has(id), contextual: !supported.has(id) && !chipPeople.has(id),
    };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges: NetworkEdge[] = [...shown.values()].filter(({ candidate }) => nodeIds.has(candidate.from) && nodeIds.has(candidate.to))
    .map(({ candidate, contextual }) => ({ id: edgeId(candidate), from: candidate.from, to: candidate.to, status: candidate.status, candidate, contextual }));

  let focus: NetworkView['focus'] = null;
  if (highlightChain && chain) focus = { nodes: new Set(chain.nodeIds), edges: new Set(chain.edgeIds) };
  else if (selection.edge && edges.some(edge => edge.id === selection.edge)) {
    const edge = edges.find(item => item.id === selection.edge)!;
    focus = { nodes: new Set([edge.from, edge.to]), edges: new Set([edge.id]) };
  } else if (selection.person && nodeIds.has(selection.person)) {
    focus = { nodes: new Set([selection.person]), edges: new Set() };
    for (const edge of edges) if (edge.from === selection.person || edge.to === selection.person) {
      focus.edges.add(edge.id); focus.nodes.add(edge.from); focus.nodes.add(edge.to);
    }
  }

  const count = (filter: UnverifiedFilter) => known.filter(c => filterOf(c.status) === filter).length;
  const byName = (x: ContactPerson, y: ContactPerson) => x.name.localeCompare(y.name);
  const contacts: NetworkView['list']['contacts'] = { accepted: [], unresolved: [], proposed: [], blocked: [] };
  // The readable list is complete: contacts of people folded behind a "+n" badge are still listed.
  // (Complete whatever is drawn: the lists do not change with the AI-supported switch.)
  for (const candidate of accepted) {
    contacts.accepted.push({ id: edgeId(candidate), from: candidate.from, to: candidate.to, status: candidate.status, candidate, contextual: false });
  }
  for (const edge of edges) if (filterOf(edge.status)) contacts[filterOf(edge.status)!].push(edge);
  return {
    nodes, edges, folds, closest, chain, focus, sides,
    counts: { people: supported.size, contacts: accepted.length, unresolved: count('unresolved'), proposed: count('proposed'), blocked: count('blocked') },
    list: {
      endpoints: [first, second].flatMap(id => byId.get(id) ?? []),
      people: [...supported].filter(id => id !== first && id !== second).flatMap(id => byId.get(id) ?? []).sort(byName),
      unverified: nodes.filter(node => !node.supported).map(node => node.person).sort(byName),
      contacts,
    },
  };
}

// The people along the corridor layout's centre line, from endpoint A to endpoint B: the chain when one exists, otherwise the
// shortest known way from each endpoint to the closest approach between the two sides (the gap between them stays open), and just
// the two endpoints when neither side has reached anywhere yet. Only people who are drawn count.
export function corridorSpine(view: Pick<NetworkView, 'nodes' | 'chain' | 'closest'>): string[] {
  const drawn = new Map(view.nodes.map(node => [node.id, node]));
  const first = view.nodes.find(node => node.endpoint === 0), second = view.nodes.find(node => node.endpoint === 1);
  if (!first || !second) return [];
  if (view.chain) {
    const ids = view.chain.nodeIds.filter(id => drawn.has(id));
    if (ids[0] === first.id && ids[ids.length - 1] === second.id) return ids;
  }
  const upToEndpoint = (id: string) => {
    const path: string[] = [];
    for (let node = drawn.get(id); node && path.length < 64; node = node.parent ? drawn.get(node.parent) : undefined) path.push(node.id);
    return path;
  };
  if (view.closest && drawn.has(view.closest.a) && drawn.has(view.closest.b)) {
    const left = upToEndpoint(view.closest.a).reverse(), right = upToEndpoint(view.closest.b);
    if (left[0] === first.id && right[right.length - 1] === second.id) return [...left, ...right];
  }
  return [first.id, second.id];
}

// Who may get a portrait. AI-supported people get the one Wikipedia has under their name. An unverified person never does: a name shared with
// someone else could put the wrong face on an unverified suggestion. The exception is an unverified person whose identity Wikidata has
// confirmed (they have a `qid`): they get the picture Wikidata holds for exactly that item, so no namesake can turn up, and their `qid` in the
// subject says the lookup goes through it. Unverified people without a `qid` (Wikidata has not been asked about them yet, or had no answer)
// are not offered and keep their initials. Besides the people drawn, this covers the ones only the readable list shows (for instance
// contacts folded behind a "+n" badge) and `others`: people who are not drawn but are listed (the unverified contacts of the selected person).
export const portraitSubjects = (view: Pick<NetworkView, 'nodes'> & { list?: Pick<NetworkView['list'], 'endpoints' | 'people'> }, others: readonly ContactPerson[] = []) => {
  const subjects = new Map<string, { id: string; name: string; qid?: string }>();
  for (const node of view.nodes) if (node.supported) subjects.set(node.id, { id: node.id, name: node.person.name });
  for (const person of [...(view.list?.endpoints ?? []), ...(view.list?.people ?? [])]) subjects.set(person.id, { id: person.id, name: person.name });
  for (const person of [...view.nodes.filter(node => !node.supported).map(node => node.person), ...others]) {
    if (person.qid && !subjects.has(person.id)) subjects.set(person.id, { id: person.id, name: person.name, qid: person.qid });
  }
  return [...subjects.values()];
};

export interface PersonContact { other: ContactPerson; candidate: CandidateContact }
// Everything the session knows around one person, regardless of the filters.
export function personContacts(session: ConnectionSession, personId: string): { accepted: PersonContact[]; unverified: PersonContact[] } {
  const byId = new Map(session.people.map(person => [person.id, person]));
  const result = { accepted: [] as PersonContact[], unverified: [] as PersonContact[] };
  for (const candidate of session.candidates) {
    if (candidate.from !== personId && candidate.to !== personId) continue;
    const other = byId.get(candidate.from === personId ? candidate.to : candidate.from);
    if (other) (candidate.status === 'accepted' ? result.accepted : result.unverified).push({ other, candidate });
  }
  const byName = (x: PersonContact, y: PersonContact) => x.other.name.localeCompare(y.other.name);
  result.accepted.sort(byName); result.unverified.sort(byName);
  return result;
}

// The people the inspector shows whether or not they are drawn: the unverified contacts of the selected person, and the two people of the
// selected contact (picking a contact from a person's list drops the person, and an unverified contact is not drawn unless its chip is on).
export function inspectedPeople(session: ConnectionSession, selection: NetworkSelection): ContactPerson[] {
  const listed: ContactPerson[] = selection.person ? personContacts(session, selection.person).unverified.map(item => item.other) : [];
  const contact = selection.edge ? session.candidates.find(candidate => edgeId(candidate) === selection.edge) : undefined;
  if (contact) listed.push(...session.people.filter(person => person.id === contact.from || person.id === contact.to));
  return listed;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const years = (person: Pick<ContactPerson, 'birthYear' | 'deathYear'>) => `${person.birthYear}–${person.deathYear}`;

// "Endpoint A", "Reached from Isaac Newton · 2 links", "Not yet attached to either endpoint".
export function describeSide(node: Pick<NetworkNode, 'endpoint' | 'side' | 'distance' | 'supported'>, names: [string, string]): string {
  if (node.endpoint !== null) return `Endpoint ${node.endpoint === 0 ? 'A' : 'B'}`;
  if (!node.supported) return 'Tentative · not yet AI-supported';
  if (node.side === 'none' || node.distance === null) return 'Not yet attached to either endpoint';
  return `Reached from ${names[node.side === 'a' ? 0 : 1]} · ${plural(node.distance, 'link', 'links')}`;
}

export function closestApproachLabel(closest: ClosestApproach, nameOf: (id: string) => string): string {
  return `Closest approach: ${nameOf(closest.a)} ↔ ${nameOf(closest.b)} · ${closest.gap === 0 ? 'lifespans overlap' : `${plural(closest.gap, 'year', 'years')} apart`}`;
}

export const truncateName = (name: string, max: number) => name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
export const initials = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};
