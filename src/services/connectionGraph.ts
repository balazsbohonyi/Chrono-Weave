import type { HistoricalFigure, NewPerson } from '../types';
import { canonicalName } from '../utils/names';
import { overlaps, pairKey } from './pathService';
import { CATEGORY_LIST } from '../constants';

export const CONTACT_VERSION = 2;
export const MAX_CONTACT_LINKS = 21;
export interface ContactPerson extends NewPerson { id: string; aliases: string[]; proposedAliases?: string[]; canonicalId?: string }
export interface ContactProvenance { provider: string; model: string; version: number; assessedAt: number }
export type InteractionType = 'meeting' | 'correspondence' | 'collaboration' | 'family-interaction' | 'service' | 'teaching' | 'wartime-opposition' | 'other';
export interface ContactAssessment {
  pair: [string, string]; verdict: 'accepted' | 'unresolved'; interactionType?: InteractionType;
  evidence: string; episode?: string; year?: number; uncertainty?: string; provenance: ContactProvenance;
}
export interface CandidateContact {
  from: string; to: string; claim: string; status: 'proposed' | 'checking' | 'accepted' | 'unresolved' | 'blocked';
  assessment?: ContactAssessment; blockedReason?: string;
  pendingFocused?: boolean;
  // Times the model did not answer this pair validly in the current segment. Not evidence either way: it never becomes a verdict,
  // an attempt or a stored contact, and it is cleared when the next segment starts.
  failures?: number;
  // Proposed as a link of the model's seed route: a whole candidate chain, so it is tested at once instead of waiting for a full batch.
  seed?: boolean;
}
export interface ContactKnowledge { people: ContactPerson[]; contacts: ContactAssessment[] }
export interface DiscoveryRound { personId: string; round: number; proposed: string[]; emptyRounds: number; lastExpanded: number }

// Request accounting. A "request" is one model task of a search (one `task()` call), not one HTTP call:
// validation retries and rate-limit retries happen below it. `direct` is the assessment request sent by the
// endpoint check; every other assessment request is `assess`, so assessment requests = direct + assess.
export const CONNECTION_REQUEST_KINDS = ['seed', 'direct', 'assess', 'discover', 'identity'] as const;
export type ConnectionRequestKind = typeof CONNECTION_REQUEST_KINDS[number];
// Why a pair was put in an assessment request: never asked (fresh), the one promising re-ask of its segment
// (focused), or asked before under a different context and not a focused re-ask (contextChange).
export const PAIR_ASK_REASONS = ['fresh', 'focused', 'contextChange'] as const;
export type PairAskReason = typeof PAIR_ASK_REASONS[number];
export const emptyRequestCounts = (): Record<ConnectionRequestKind, number> => ({ seed: 0, direct: 0, assess: 0, discover: 0, identity: 0 });
export const emptyPairAsks = (): Record<PairAskReason, number> => ({ fresh: 0, focused: 0, contextChange: 0 });
// Every field after `stopReason` is optional: sessions saved before instrumentation lack them and readers treat them as absent.
export interface ConnectionDiagnostics {
  // Last segment only, like the rest of this block except `total`.
  tasks: number; people: number; pairs: number; stopReason?: string;
  requests?: Partial<Record<ConnectionRequestKind, number>>;
  assessBatches?: number[];       // pairs per assessment request (direct and assess), in order
  discoverSources?: number[];     // sources per discovery request, in order
  pairAsks?: Record<PairAskReason, number>;
  validationRetries?: number;     // best-effort correction rounds around this segment's requests
  // Whole session, instrumented segments only (an older session continued today starts counting here).
  total?: { segments: number; requests: Record<ConnectionRequestKind, number>; pairAsks: Record<PairAskReason, number>; elapsedMs: number };
}
export interface ConnectionSession {
  version: 2; key: string; canvasId: string; endpoints: [string, string]; people: ContactPerson[];
  candidates: CandidateContact[]; rounds: DiscoveryRound[];
  attempts: Record<string, { context: string; segment: number; count: number; focusedSegment?: number }>;
  segment: number; seedContext?: string; status: 'searching' | 'paused' | 'explored' | 'error' | 'connected';
  phase: string; elapsedMs: number; updatedAt: number; error?: string;
  selected?: string; expanded?: string[];
  diagnostics: ConnectionDiagnostics;
  persistent?: boolean;
  retiredKeys?: string[];
  runStartedAt?: number;
  // Set by a running search (never saved): 'trimmed' when the saved copy had to leave out the least useful unverified contacts to fit,
  // 'failed' when the latest progress could not be saved although saving worked before.
  saveIssue?: 'trimmed' | 'failed';
}

export function validPerson(person: Pick<HistoricalFigure, 'name' | 'birthYear' | 'deathYear' | 'category'>): boolean {
  return typeof person.name === 'string' && !!person.name.trim() && person.category !== 'EVENTS' && CATEGORY_LIST.includes(person.category) && Number.isSafeInteger(person.birthYear)
    && Number.isSafeInteger(person.deathYear) && person.birthYear !== 0 && person.deathYear !== 0
    && person.birthYear <= person.deathYear && person.deathYear <= new Date().getFullYear();
}

// Exact normalized names or explicit aliases plus exact supplied dates. No partial-name guesses
// or date repairs. Conflicting dates deliberately remain separate identities.
export function samePerson(a: Pick<ContactPerson, 'name' | 'birthYear' | 'deathYear'> & { aliases?: string[] },
  b: Pick<ContactPerson, 'name' | 'birthYear' | 'deathYear'> & { aliases?: string[] }): boolean {
  if (a.birthYear !== b.birthYear || a.deathYear !== b.deathYear) return false;
  const first = canonicalName(a.name), second = canonicalName(b.name);
  return first === second || (a.aliases ?? []).some(name => canonicalName(name) === second)
    || (b.aliases ?? []).some(name => canonicalName(name) === first);
}
export function identifyPerson(people: ContactPerson[], input: NewPerson & { aliases?: string[] }): ContactPerson {
  if (!validPerson(input)) throw new Error('Six Degrees requires a person with defensible dates.');
  // Discovery-supplied aliases are hypotheses. Only aliases established by canonical resolution
  // may substitute a name during identity matching or canvas weaving.
  const matches = people.filter(person => !person.canonicalId && samePerson(person, { ...input, aliases: [] }));
  if (matches.length === 1) {
    matches[0].proposedAliases = [...new Set([...(matches[0].proposedAliases ?? []), ...(input.aliases ?? [])])].slice(0, 6);
    return matches[0];
  }
  // A record retired by a canonical resolution (its `canonicalId` names the surviving person) stays in the store, so the same name and dates
  // proposed again must land on the surviving person, never on the retired record that no contact can use.
  if (!matches.length) {
    let canonical = people.find(person => person.canonicalId && samePerson(person, { ...input, aliases: [] }));
    for (let hops = 0; canonical?.canonicalId && hops < 8; hops++) canonical = people.find(person => person.id === canonical!.canonicalId);
    if (canonical && !canonical.canonicalId) return canonical;
  }
  const id =`sd2-${encodeURIComponent(canonicalName(input.name))}-${input.birthYear}-${input.deathYear}`;
  const person: ContactPerson = { id, name: input.name, birthYear: input.birthYear, deathYear: input.deathYear,
    occupation: input.occupation, category: input.category, description: input.description, aliases: [], proposedAliases: [...new Set(input.aliases ?? [])] };
  const existing = people.find(item => item.id === id);
  if (existing) return existing;
  people.push(person);
  return person;
}
export const figurePerson = (figure: HistoricalFigure): NewPerson => ({ name: figure.name, birthYear: figure.birthYear, deathYear: figure.deathYear,
  occupation: figure.occupation, category: figure.category, description: figure.shortDescription ?? figure.occupation });
export function canvasPerson(person: ContactPerson, figures: HistoricalFigure[]): HistoricalFigure {
  const matches = figures.filter(figure => figure.category !== 'EVENTS' && samePerson(figure, person));
  const exact = matches.filter(figure => canonicalName(figure.name) === canonicalName(person.name));
  if (exact.length === 1) return exact[0];
  if (matches.length === 1) return matches[0];
  return { id: `w-p-${encodeURIComponent(person.name.toLowerCase())}-${person.birthYear}-${person.deathYear}`,
    name: person.name, birthYear: person.birthYear, deathYear: person.deathYear, occupation: person.occupation,
    category: person.category, shortDescription: person.description };
}
export function blockedContact(a: ContactPerson, b: ContactPerson): string | undefined {
  if (!validPerson(a) || !validPerson(b)) return 'Invalid person or dates';
  if (a.id === b.id || samePerson(a, b)) return 'Same person';
  if (canonicalName(a.name) === canonicalName(b.name)) return 'Conflicting identity';
  if (!overlaps(a, b)) return 'Lifespans do not overlap';
}
export function validAccepted(contact: ContactAssessment, people: Map<string, ContactPerson>): boolean {
  const [a, b] = contact.pair.map(id => people.get(id));
  return !!a && !!b && !a.canonicalId && !b.canonicalId && !blockedContact(a, b) && contact.verdict === 'accepted' && !!contact.evidence?.trim()
    && ['meeting', 'correspondence', 'collaboration', 'family-interaction', 'service', 'teaching', 'wartime-opposition', 'other'].includes(contact.interactionType)
    && contact.provenance?.version === CONTACT_VERSION && (contact.interactionType !== 'wartime-opposition' || !!contact.episode?.trim())
    && (contact.year === undefined || (Number.isSafeInteger(contact.year) && contact.year >= Math.max(a.birthYear, b.birthYear)
      && contact.year <= Math.min(a.deathYear, b.deathYear)));
}
// Valid accepted contacts as an undirected graph. People in `excluded` have no edges at all.
function acceptedAdjacency(people: ContactPerson[], contacts: ContactAssessment[], excluded?: ReadonlySet<string>): Map<string, Set<string>> {
  const byId = new Map(people.map(person => [person.id, person]));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of contacts) if (!edge.pair.some(id => excluded?.has(id)) && validAccepted(edge, byId)) for (const [a, b] of [edge.pair, [...edge.pair].reverse()]) {
    if (!adjacency.has(a)) adjacency.set(a, new Set()); adjacency.get(a)!.add(b);
  }
  return adjacency;
}
function reachFrom(start: string, adjacency: Map<string, Set<string>>, maxLinks: number): Map<string, number> {
  const distance = new Map([[start, 0]]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], depth = distance.get(id)!;
    if (depth >= maxLinks) continue;
    for (const next of adjacency.get(id) ?? []) if (!distance.has(next)) { distance.set(next, depth + 1); queue.push(next); }
  }
  return distance;
}
function routeBetween(from: string, to: string, adjacency: Map<string, Set<string>>, maxLinks: number): string[] | null {
  const queue = [from], parent = new Map<string, string>(), distance = new Map([[from, 0]]);
  for (let i = 0; i < queue.length; i++) {
    const last = queue[i];
    if (last === to) {
      const route = [to]; while (parent.has(route[0])) route.unshift(parent.get(route[0])!);
      return route.length > 1 ? route : null;
    }
    if (distance.get(last)! >= maxLinks) continue;
    for (const next of adjacency.get(last) ?? []) if (!distance.has(next)) {
      parent.set(next, last); distance.set(next, distance.get(last)! + 1); queue.push(next);
    }
  }
  return null;
}
// Every accepted contact, ambiguous identities included. What the network view shows and what is saved with a session follow this;
// anything that decides whether a chain can exist uses `routeDistances` instead.
export function acceptedDistances(start: string, people: ContactPerson[], contacts: ContactAssessment[], maxLinks = MAX_CONTACT_LINKS): Map<string, number> {
  return reachFrom(start, acceptedAdjacency(people, contacts), maxLinks);
}
// Exact names that exist as several records (conflicting dates stay separate identities, see `samePerson`). Records resolved into another
// identity do not count.
export function ambiguousNames(people: ContactPerson[]): ContactPerson[][] {
  const names = new Map<string, ContactPerson[]>();
  for (const p of people) if (!p.canonicalId) { const name = canonicalName(p.name); names.set(name, [...(names.get(name) ?? []), p]); }
  return [...names.values()].filter(records => records.length > 1);
}
// Incompatible date records for one exact name remain separate, but must not masquerade as two people in a route. A requested endpoint
// keeps its identity; every other record of the name is left out. When both endpoints share a name only the first stays and the
// other can never be reached, so nothing is routed. The same rule decides routes (`shortestContactPath`) and reach (`routeDistances`);
// it must be read from the whole shared store, because a record that sits in no session still makes the name ambiguous.
export function routeExclusions(people: ContactPerson[], endpoints: readonly string[]): Set<string> {
  const excluded = new Set<string>();
  for (const records of ambiguousNames(people)) {
    const requested = records.find(p => endpoints.includes(p.id));
    for (const p of records) if (p !== requested) excluded.add(p.id);
  }
  return excluded;
}
// Distances from `start` over the contacts a route may use: the same graph as `shortestContactPath(…)` for these endpoints.
export function routeDistances(start: string, people: ContactPerson[], contacts: ContactAssessment[], endpoints: readonly [string, string], maxLinks = MAX_CONTACT_LINKS): Map<string, number> {
  return reachFrom(start, acceptedAdjacency(people, contacts, routeExclusions(people, endpoints)), maxLinks);
}
export function shortestContactPath(from: string, to: string, people: ContactPerson[], contacts: ContactAssessment[], maxLinks = MAX_CONTACT_LINKS): string[] | null {
  if (ambiguousNames(people).some(records => records.some(p => p.id === from) && records.some(p => p.id === to))) return null;
  return routeBetween(from, to, acceptedAdjacency(people, contacts, routeExclusions(people, [from, to])), maxLinks);
}
// An accepted chain that exists only through people recorded under one name with conflicting dates: the shortest such chain, and each
// ambiguous person on it with every record of the name. Null when a real route exists or no accepted chain links the endpoints at all.
export interface AmbiguousBridge { route: string[]; identities: Array<{ name: string; records: ContactPerson[] }> }
export function ambiguousBridge(from: string, to: string, people: ContactPerson[], contacts: ContactAssessment[], maxLinks = MAX_CONTACT_LINKS): AmbiguousBridge | null {
  if (shortestContactPath(from, to, people, contacts, maxLinks)) return null;
  const route = routeBetween(from, to, acceptedAdjacency(people, contacts), maxLinks);
  if (!route) return null;
  const groups = ambiguousNames(people), excluded = routeExclusions(people, [from, to]);
  const between = route.slice(1, -1);
  const identities = groups.filter(records => records.some(p => between.includes(p.id) && excluded.has(p.id)))
    .map(records => ({ name: records[0].name, records: records.slice().sort((a, b) => a.birthYear - b.birthYear || a.deathYear - b.deathYear) }));
  return identities.length ? { route, identities } : null;
}
// Records of one name that may be the same person recorded with wrong dates, and so are worth one identity request. Every birth year and
// every death year must lie within this many years of the others: namesakes of one family or one era (a father and a son) stay separate,
// and no endpoint is ever merged. Only records the resolver then names exactly are merged, so this never repairs a date.
export const DUPLICATE_DATE_TOLERANCE_YEARS = 10;
export function resolvableDuplicates(records: ContactPerson[], endpoints: readonly string[]): boolean {
  const span = (years: number[]) => Math.max(...years) - Math.min(...years);
  return records.length > 1 && !records.some(p => endpoints.includes(p.id))
    && span(records.map(p => p.birthYear)) <= DUPLICATE_DATE_TOLERANCE_YEARS && span(records.map(p => p.deathYear)) <= DUPLICATE_DATE_TOLERANCE_YEARS;
}
// The record a resolver's answer names: the only one with exactly the dates it gave, under a name the answer contains or is contained in.
// Anything else (dates matching no record or several, a different person) settles nothing and the records stay separate.
export function duplicateKeeper(records: ContactPerson[], resolved: Pick<NewPerson, 'name' | 'birthYear' | 'deathYear'>): ContactPerson | undefined {
  const tokens = (name: string) => canonicalName(name).split(' ').filter(Boolean), answer = tokens(resolved.name);
  const matches = records.filter(p => p.birthYear === resolved.birthYear && p.deathYear === resolved.deathYear
    && (tokens(p.name).every(token => answer.includes(token)) || answer.every(token => tokens(p.name).includes(token))));
  return matches.length === 1 ? matches[0] : undefined;
}
export const sessionKey = (canvasId: string, from: string, to: string) => `${canvasId}:${pairKey(from, to)}`;

// An attempt's context is what the assessment prompt actually sends: provider, model, both names and both alias lists.
// Older sessions also stored the accepted contacts of both people as a seventh element, which the prompt never carried, so
// every stored context is cut back to its first six elements. Idempotent; anything that is not such an array is left alone.
export const ATTEMPT_CONTEXT_ELEMENTS = 6;
export function migrateAttemptContext(context: string): string {
  try {
    const parsed = JSON.parse(context);
    return Array.isArray(parsed) && parsed.length > ATTEMPT_CONTEXT_ELEMENTS ? JSON.stringify(parsed.slice(0, ATTEMPT_CONTEXT_ELEMENTS)) : context;
  } catch { return context; }
}

// Use only after an explicit, compatible canonical resolution. All graph references change
// together; stable canonical identity and existing canvas IDs remain separate.
export function mergeResolvedIdentity(knowledge: ContactKnowledge, session: ConnectionSession, keep: ContactPerson, alias: ContactPerson, canonical: string): void {
  const oldId = alias.id;
  keep.aliases = [...new Set([...keep.aliases, alias.name, ...alias.aliases, canonical])].filter(name => canonicalName(name) !== canonicalName(keep.name));
  const map = (id: string) => id === oldId ? keep.id : id;
  for (const contact of knowledge.contacts) contact.pair = contact.pair.map(map) as [string, string];
  for (const candidate of session.candidates) { candidate.from = map(candidate.from); candidate.to = map(candidate.to); if (candidate.assessment) candidate.assessment.pair = candidate.assessment.pair.map(map) as [string, string]; }
  for (const round of session.rounds) { round.personId = map(round.personId); round.proposed = [...new Set(round.proposed.map(map))]; }
  const attempts: ConnectionSession['attempts'] = {};
  for (const [key, attempt] of Object.entries(session.attempts)) {
    const prefix = key.startsWith('identity:') ? 'identity:' : '';
    const ids = key.slice(prefix.length).split('\u0000');
    const mapped = ids.length === 2 ? `${prefix}${pairKey(map(ids[0]), map(ids[1]))}` : key;
    const previous = attempts[mapped];
    attempts[mapped] = { ...attempt, count: Math.max(attempt.count, previous?.count ?? 0),
      focusedSegment: Math.max(attempt.focusedSegment ?? 0, previous?.focusedSegment ?? 0) || undefined };
  }
  session.attempts = attempts;
  session.endpoints = session.endpoints.map(map) as [string, string];
  knowledge.people = [...knowledge.people.filter(person => person.id !== oldId), { ...alias, id: oldId, canonicalId: keep.id }];
  session.people = [...new Map(session.people.filter(person => person.id !== oldId).map(person => [person.id, person])).values()];
  if (!session.people.some(person => person.id === keep.id)) session.people.push(keep);
  session.candidates = [...new Map(session.candidates.map(c => [pairKey(c.from, c.to), c])).values()];
  alias.id = keep.id;
}

// `people` is the population that decides which names are ambiguous: pass the whole shared store, never the session's people, because a
// twin record that no session holds still keeps a route from using the name. Sources are always taken from the session.
export function selectFrontier(session: ConnectionSession, contacts: ContactAssessment[], side: 0 | 1, count: number, people: ContactPerson[]): ContactPerson[] {
  const distances = routeDistances(session.endpoints[side], people, contacts, session.endpoints);
  const opposite = routeDistances(session.endpoints[1 - side], people, contacts, session.endpoints);
  const target = session.people.find(person => person.id === session.endpoints[1 - side])!;
  const candidates = session.people.filter(person => distances.has(person.id) && !opposite.has(person.id))
    .map(person => {
      const round = session.rounds.find(item => item.personId === person.id);
      const temporal = Math.abs((person.birthYear + person.deathYear - target.birthYear - target.deathYear) / 2);
      return { person, round, score: distances.get(person.id)! * 2 + temporal / 200 + (round?.round ?? 0) * 3 };
    }).filter(item => (item.round?.emptyRounds ?? 0) < 2 && distances.get(item.person.id)! < MAX_CONTACT_LINKS);
  // Rotate by least-expanded rounds first; temporal rank remains a soft preference. No monotonic constraint.
  candidates.sort((a, b) => (a.round?.round ?? 0) - (b.round?.round ?? 0) || a.score - b.score || a.person.id.localeCompare(b.person.id));
  return candidates.slice(0, count).map(item => item.person);
}
