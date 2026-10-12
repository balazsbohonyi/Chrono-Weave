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
}
export interface ContactKnowledge { people: ContactPerson[]; contacts: ContactAssessment[] }
export interface DiscoveryRound { personId: string; round: number; proposed: string[]; emptyRounds: number; lastExpanded: number }
export interface ConnectionSession {
  version: 2; key: string; canvasId: string; endpoints: [string, string]; people: ContactPerson[];
  candidates: CandidateContact[]; rounds: DiscoveryRound[];
  attempts: Record<string, { context: string; segment: number; count: number; focusedSegment?: number }>;
  segment: number; seedContext?: string; status: 'searching' | 'paused' | 'explored' | 'error' | 'connected';
  phase: string; elapsedMs: number; updatedAt: number; error?: string;
  selected?: string; expanded?: string[];
  diagnostics: { tasks: number; people: number; pairs: number; stopReason?: string };
  persistent?: boolean;
  retiredKeys?: string[];
  runStartedAt?: number;
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
  const id = `sd2-${encodeURIComponent(canonicalName(input.name))}-${input.birthYear}-${input.deathYear}`;
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
export function acceptedDistances(start: string, people: ContactPerson[], contacts: ContactAssessment[], maxLinks = MAX_CONTACT_LINKS): Map<string, number> {
  const byId = new Map(people.map(person => [person.id, person]));
  const adjacency = new Map<string, string[]>();
  for (const edge of contacts) if (validAccepted(edge, byId)) for (const [a, b] of [edge.pair, [...edge.pair].reverse()]) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
  }
  const distance = new Map([[start, 0]]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], depth = distance.get(id)!;
    if (depth >= maxLinks) continue;
    for (const next of adjacency.get(id) ?? []) if (!distance.has(next)) { distance.set(next, depth + 1); queue.push(next); }
  }
  return distance;
}
export function shortestContactPath(from: string, to: string, people: ContactPerson[], contacts: ContactAssessment[], maxLinks = MAX_CONTACT_LINKS): string[] | null {
  const byId = new Map(people.map(person => [person.id, person]));
  const names = new Map<string, string[]>(), ambiguous = new Set<string>();
  for (const p of people) if (!p.canonicalId) { const name = canonicalName(p.name); names.set(name, [...(names.get(name) ?? []), p.id]); }
  // Incompatible date records for one exact name remain separate, but must not masquerade
  // as two people in a route. Keep a requested identity; exclude unresolved shadow identities.
  for (const ids of names.values()) if (ids.length > 1) {
    if (ids.includes(from) && ids.includes(to)) return null;
    const requested = ids.includes(from) ? from : ids.includes(to) ? to : undefined;
    for (const id of ids) if (id !== requested) ambiguous.add(id);
  }
  const adjacency = new Map<string, Set<string>>();
  for (const edge of contacts) if (!edge.pair.some(id => ambiguous.has(id)) && validAccepted(edge, byId)) for (const [a, b] of [edge.pair, [...edge.pair].reverse()]) {
    if (!adjacency.has(a)) adjacency.set(a, new Set()); adjacency.get(a)!.add(b);
  }
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
export const sessionKey = (canvasId: string, from: string, to: string) => `${canvasId}:${pairKey(from, to)}`;

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

export function selectFrontier(session: ConnectionSession, contacts: ContactAssessment[], side: 0 | 1, count: number): ContactPerson[] {
  const distances = acceptedDistances(session.endpoints[side], session.people, contacts);
  const opposite = acceptedDistances(session.endpoints[1 - side], session.people, contacts);
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
