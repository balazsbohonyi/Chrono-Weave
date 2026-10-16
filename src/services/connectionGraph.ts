import type { HistoricalFigure, NewPerson } from '../types';
import { canonicalName } from '../utils/names';
import { overlaps, pairKey } from './pathService';
import { CATEGORY_LIST } from '../constants';
import type { WikidataIdentity, WikidataOutcome } from './wikidataService';

export const CONTACT_VERSION = 2;
export const MAX_CONTACT_LINKS = 21;
// A name and years a person was recorded or proposed under (see `ContactPerson.variants`).
export interface PersonVariant { name: string; birthYear: number; deathYear: number }
export interface ContactPerson extends NewPerson {
  id: string; aliases: string[]; proposedAliases?: string[]; canonicalId?: string;
  // Wikidata identity. `qid` is the person's Wikidata item; when it is set the years are Wikidata's, not the model's. `variants` are the
  // other names and years this person was recorded under (the model's wrong years before they were corrected, and what duplicates merged
  // into them carried): `samePerson` matches through them, so a canvas figure or a saved path that still has the old years finds the
  // person. `qidCheckedAt` is when Wikidata last had no answer for them, so that is not asked again for a while.
  qid?: string; variants?: PersonVariant[]; qidCheckedAt?: number;
}
export const QID_PATTERN = /^Q\d+$/;
export const MAX_VARIANTS = 6;
export const WIKIDATA_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
// Whether Wikidata is still to be asked about this person: nobody who has a QID, and nobody Wikidata had no answer for lately.
export const needsWikidata = (person: ContactPerson, now = Date.now()): boolean =>
  !person.canonicalId && !person.qid && (person.qidCheckedAt === undefined || now - person.qidCheckedAt > WIKIDATA_MISS_RETRY_MS);
// What a lookup is keyed by: the name and years as they were proposed.
export const proposalKey = (person: Pick<NewPerson, 'name' | 'birthYear' | 'deathYear'>) => `${person.name}|${person.birthYear}|${person.deathYear}`;
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
export const WIKIDATA_COUNTERS = ['lookups', 'resolved', 'merged', 'corrected', 'failed'] as const;
export type WikidataCounter = typeof WIKIDATA_COUNTERS[number];
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
  // Wikidata, this segment, only when a resolver took part: people asked about, resolved to an item, merged into somebody recorded differently,
  // given other years, and left unanswered (it could not be reached). Not model requests: none of the counters above move for them.
  wikidata?: Record<WikidataCounter, number>;
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

type Identifiable = Pick<ContactPerson, 'name' | 'birthYear' | 'deathYear'> & { aliases?: string[]; qid?: string; variants?: PersonVariant[] };
const sameNameAndYears = (a: Identifiable, b: Identifiable): boolean => {
  if (a.birthYear !== b.birthYear || a.deathYear !== b.deathYear) return false;
  const first = canonicalName(a.name), second = canonicalName(b.name);
  return first === second || (a.aliases ?? []).some(name => canonicalName(name) === second)
    || (b.aliases ?? []).some(name => canonicalName(name) === first);
};
// Exact normalized names or explicit aliases plus exact supplied dates, either as the person is recorded now or as they were recorded
// under before Wikidata corrected them (`variants`); or one Wikidata item. No partial-name guesses or date repairs. Conflicting dates
// deliberately remain separate identities.
export function samePerson(a: Identifiable, b: Identifiable): boolean {
  if (a.qid && a.qid === b.qid) return true;
  return sameNameAndYears(a, b) || (a.variants ?? []).some(variant => sameNameAndYears(variant, b)) || (b.variants ?? []).some(variant => sameNameAndYears(a, variant));
}
// Remembers a name and years the person was also recorded under, newest last, a few at most. Nothing when it is how they are recorded now.
export function rememberVariant(person: ContactPerson, variant: PersonVariant): void {
  const same = (other: PersonVariant) => other.birthYear === variant.birthYear && other.deathYear === variant.deathYear && canonicalName(other.name) === canonicalName(variant.name);
  if (same(person) || (person.variants ?? []).some(same)) return;
  person.variants = [...(person.variants ?? []), { name: variant.name, birthYear: variant.birthYear, deathYear: variant.deathYear }].slice(-MAX_VARIANTS);
}
// Gives a person the item and the years Wikidata stands for. The years they were recorded under stay matchable as a variant. True when the years changed.
export function applyWikidata(person: ContactPerson, identity: WikidataIdentity): boolean {
  const before = { name: person.name, birthYear: person.birthYear, deathYear: person.deathYear };
  const changed = before.birthYear !== identity.birthYear || before.deathYear !== identity.deathYear;
  person.qid = identity.qid; person.birthYear = identity.birthYear; person.deathYear = identity.deathYear; delete person.qidCheckedAt;
  if (changed) rememberVariant(person, before);
  return changed;
}
// The surviving person of a Wikidata item: the live record that has it, or the live person a retired record of it was merged into.
function personByQid(people: ContactPerson[], qid: string): ContactPerson | undefined {
  const live = people.find(person => person.qid === qid && !person.canonicalId);
  if (live) return live;
  let retired = people.find(person => person.qid === qid && person.canonicalId);
  for (let hops = 0; retired?.canonicalId && hops < 8; hops++) retired = people.find(person => person.id === retired!.canonicalId);
  return retired && !retired.canonicalId ? retired : undefined;
}
const proposedAliasesOf = (person: ContactPerson, input: { aliases?: string[] }) => { person.proposedAliases = [...new Set([...(person.proposedAliases ?? []), ...(input.aliases ?? [])])].slice(0, 6); return person; };
// The record already standing for this name and these years, if any.
function findPerson(people: ContactPerson[], input: NewPerson & { aliases?: string[] }): ContactPerson | undefined {
  // Discovery-supplied aliases are hypotheses. Only aliases established by canonical resolution
  // may substitute a name during identity matching or canvas weaving.
  const matches = people.filter(person => !person.canonicalId && samePerson(person, { ...input, aliases: [] }));
  if (matches.length === 1) return proposedAliasesOf(matches[0], input);
  // A record retired by a canonical resolution (its `canonicalId` names the surviving person) stays in the store, so the same name and dates
  // proposed again must land on the surviving person, never on the retired record that no contact can use.
  if (!matches.length) {
    let canonical = people.find(person => person.canonicalId && samePerson(person, { ...input, aliases: [] }));
    for (let hops = 0; canonical?.canonicalId && hops < 8; hops++) canonical = people.find(person => person.id === canonical!.canonicalId);
    if (canonical && !canonical.canonicalId) return canonical;
  }
  return undefined;
}
function createPerson(people: ContactPerson[], input: NewPerson & { aliases?: string[] }): ContactPerson {
  const id =`sd2-${encodeURIComponent(canonicalName(input.name))}-${input.birthYear}-${input.deathYear}`;
  const person: ContactPerson = { id, name: input.name, birthYear: input.birthYear, deathYear: input.deathYear,
    occupation: input.occupation, category: input.category, description: input.description, aliases: [], proposedAliases: [...new Set(input.aliases ?? [])] };
  const existing = people.find(item => item.id === id);
  if (existing) return existing;
  people.push(person);
  return person;
}
// `resolved` is what Wikidata says about this proposal (see `wikidataService`). With it, the person is found by their item first: a proposal
// with the wrong years (or another form of the name) lands on the person already known under that item, and a new person is recorded with
// Wikidata's years. Without it, exactly the name-and-years identification there always was.
export function identifyPerson(people: ContactPerson[], input: NewPerson & { aliases?: string[] }, resolved?: WikidataIdentity): ContactPerson {
  if (!validPerson(input)) throw new Error('Six Degrees requires a person with defensible dates.');
  if (resolved && QID_PATTERN.test(resolved.qid)) {
    const known = personByQid(people, resolved.qid);
    if (known) { rememberVariant(known, input); return proposedAliasesOf(known, input); }
    const corrected = { ...input, birthYear: resolved.birthYear, deathYear: resolved.deathYear };
    if (validPerson(corrected)) {
      const found = findPerson(people, input) ?? findPerson(people, corrected);
      const person = found ?? createPerson(people, corrected);
      if (!person.qid) applyWikidata(person, resolved);
      rememberVariant(person, input);
      return person;
    }
  }
  return findPerson(people, input) ?? createPerson(people, input);
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
// Merging two records can leave a contact between them (now between a person and themselves) and two contacts for one pair; neither is a
// contact. The newest assessment of a pair (and, for unverified ones, of a model) is the one kept, in the order the pairs first appeared.
function settleContacts(contacts: ContactAssessment[]): ContactAssessment[] {
  const kept = new Map<string, ContactAssessment>();
  for (const contact of contacts) {
    if (contact.pair[0] === contact.pair[1]) continue;
    const key = `${pairKey(...contact.pair)}:${contact.verdict === 'accepted' ? 'accepted' : `${contact.provenance?.provider}:${contact.provenance?.model}`}`;
    const old = kept.get(key);
    if (!old || (contact.provenance?.assessedAt ?? 0) >= (old.provenance?.assessedAt ?? 0)) kept.set(key, contact);
  }
  return kept.size === contacts.length ? contacts : [...kept.values()];
}
// `session` is the search the merge happens in; without one only the shared knowledge changes.
export function mergeResolvedIdentity(knowledge: ContactKnowledge, session: ConnectionSession | undefined, keep: ContactPerson, alias: ContactPerson, canonical: string): void {
  const oldId = alias.id;
  keep.aliases = [...new Set([...keep.aliases, alias.name, ...alias.aliases, canonical])].filter(name => canonicalName(name) !== canonicalName(keep.name));
  const map = (id: string) => id === oldId ? keep.id : id;
  for (const contact of knowledge.contacts) contact.pair = contact.pair.map(map) as [string, string];
  knowledge.contacts = settleContacts(knowledge.contacts);
  if (session) {
    session.candidates = session.candidates.filter(candidate => map(candidate.from) !== map(candidate.to));
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
  }
  knowledge.people = [...knowledge.people.filter(person => person.id !== oldId), { ...alias, id: oldId, canonicalId: keep.id }];
  if (session) {
    const inSession = session.people.some(person => person.id === oldId);
    session.people = [...new Map(session.people.filter(person => person.id !== oldId).map(person => [person.id, person])).values()];
    // The survivor joins the search only when the record retired into it was part of it.
    if (inSession && !session.people.some(person => person.id === keep.id)) session.people.push(keep);
    session.candidates = [...new Map(session.candidates.map(c => [pairKey(c.from, c.to), c])).values()];
  }
  alias.id = keep.id;
}

// The record that stays when several records are one Wikidata item: an endpoint; else one whose years already are Wikidata's; else the one
// with the most valid accepted contacts; else the one recorded first. `pending` is what each record becomes now (not yet applied).
export function chooseSurvivor(group: ContactPerson[], endpoints: readonly string[], knowledge: ContactKnowledge, pending: ReadonlyMap<string, WikidataIdentity> = new Map()): ContactPerson {
  const byId = new Map(knowledge.people.map(person => [person.id, person]));
  const accepted = (person: ContactPerson) => knowledge.contacts.filter(contact => contact.pair.includes(person.id) && validAccepted(contact, byId)).length;
  const exact = (person: ContactPerson) => { const identity = pending.get(person.id); return !identity || (person.birthYear === identity.birthYear && person.deathYear === identity.deathYear); };
  const recorded = (person: ContactPerson) => knowledge.people.indexOf(person);
  return [...group].sort((a, b) => Number(endpoints.includes(b.id)) - Number(endpoints.includes(a.id)) || Number(exact(b)) - Number(exact(a))
    || accepted(b) - accepted(a) || recorded(a) - recorded(b))[0];
}

export interface ReconcileStats { resolved: number; corrected: number; merged: number }
// Applies what Wikidata said (see `wikidataService`, keyed by `proposalKey` of each record as it stands) to the people of the shared knowledge:
// a person it resolved gets the item and its years (the years they were recorded under stay as a variant), a person it had no answer for is
// marked as asked, and every set of records of one item becomes one person (see `chooseSurvivor`), the others retired into it with every
// reference following. Two endpoints of one item are never merged. A person the outcomes do not mention is left alone. The session, when
// there is one, follows the knowledge.
export function reconcileIdentities(knowledge: ContactKnowledge, session: ConnectionSession | undefined, outcomes: ReadonlyMap<string, WikidataOutcome>,
  endpoints: readonly string[] = session?.endpoints ?? [], now = Date.now()): ReconcileStats {
  const stats: ReconcileStats = { resolved: 0, corrected: 0, merged: 0 };
  const live = () => knowledge.people.filter(person => !person.canonicalId);
  const pending = new Map<string, WikidataIdentity>();
  for (const person of live()) {
    const outcome = outcomes.get(proposalKey(person));
    if (outcome === 'miss') person.qidCheckedAt = now;
    else if (outcome && !person.qid) pending.set(person.id, outcome);
  }
  const groups = new Map<string, ContactPerson[]>();
  for (const person of live()) { const qid = pending.get(person.id)?.qid ?? person.qid; if (qid) groups.set(qid, [...(groups.get(qid) ?? []), person]); }
  for (const [qid, group] of groups) {
    const apart = group.filter(person => endpoints.includes(person.id)).length > 1;
    const keep = apart ? group[0] : chooseSurvivor(group, endpoints, knowledge, pending);
    for (const person of apart ? group : [keep]) {
      const identity = pending.get(person.id);
      if (!identity) continue;
      stats.resolved++;
      if (applyWikidata(person, identity)) stats.corrected++;
    }
    if (apart) continue;
    for (const other of group) {
      if (other === keep) continue;
      if (pending.has(other.id)) stats.resolved++;
      rememberVariant(keep, other); for (const variant of other.variants ?? []) rememberVariant(keep, variant);
      other.qid ??= qid;
      mergeResolvedIdentity(knowledge, session, keep, other, keep.name);
      stats.merged++;
    }
  }
  if (session) {
    const byId = new Map(knowledge.people.map(person => [person.id, person]));
    for (const person of session.people) {
      const record = byId.get(person.id);
      if (!record || record === person || record.canonicalId) continue;
      Object.assign(person, { birthYear: record.birthYear, deathYear: record.deathYear, aliases: [...record.aliases] });
      if (record.proposedAliases) person.proposedAliases = [...record.proposedAliases];
      if (record.qid === undefined) delete person.qid; else person.qid = record.qid;
      if (record.qidCheckedAt === undefined) delete person.qidCheckedAt; else person.qidCheckedAt = record.qidCheckedAt;
      if (record.variants === undefined) delete person.variants; else person.variants = record.variants.map(variant => ({ ...variant }));
    }
  }
  return stats;
}

// Years between two lifespans; overlapping lifespans are 0 apart.
export const lifespanGapYears = (a: Pick<ContactPerson, 'birthYear' | 'deathYear'>, b: Pick<ContactPerson, 'birthYear' | 'deathYear'>) =>
  Math.max(0, Math.max(a.birthYear, b.birthYear) - Math.min(a.deathYear, b.deathYear));

// The stretch of time the two sides of a search have not reached yet: the smallest distance, in years, between a person already linked to the
// first endpoint and one already linked to the second, whose lifespans do not overlap. Nobody found so far lived in `fromYear`..`toYear`, so
// a chain has to be built across it, and `edges` are the two people (one per side) who stand at its two ends. Null when some pair from the
// two sides overlaps in time: then the ends are not separated by a stretch of time, and what is missing is a contact, not a period.
export interface TemporalGap { years: number; fromYear: number; toYear: number; edges: [ContactPerson, ContactPerson] }
export function temporalGap(first: readonly ContactPerson[], second: readonly ContactPerson[]): TemporalGap | null {
  let best: { years: number; a: ContactPerson; b: ContactPerson } | null = null;
  for (const a of first) for (const b of second) {
    if (a.id === b.id) return null;
    const years = lifespanGapYears(a, b);
    if (years === 0) return null;
    if (!best || years < best.years || (years === best.years && (a.id < best.a.id || (a.id === best.a.id && b.id < best.b.id)))) best = { years, a, b };
  }
  return best && { years: best.years, fromYear: Math.min(best.a.deathYear, best.b.deathYear), toYear: Math.max(best.a.birthYear, best.b.birthYear), edges: [best.a, best.b] };
}
// A stretch of time shorter than this needs no pointing out to the model: one person's lifetime of contacts bridges it without being told.
export const GAP_HINT_MIN_YEARS = 40;
// Sources whose lifespan is within this many years (about a generation) of the best one's distance to the gap are expanded ahead of the rest,
// as long as they have been expanded fewer than `GAP_BAND_MAX_ROUNDS` times: the frontier rotates among the people nearest the gap.
const GAP_BAND_YEARS = 30;
const GAP_BAND_MAX_ROUNDS = 3;
const reachedPeople = (session: ConnectionSession, reach: Map<string, number>) => session.people.filter(person => reach.has(person.id));

// `people` is the population that decides which names are ambiguous: pass the whole shared store, never the session's people, because a
// twin record that no session holds still keeps a route from using the name. Sources are always taken from the session.
// `gap` is the stretch of time between the two sides (`temporalGap` of the people each endpoint reaches, first endpoint's side first), when the
// caller has already worked it out; left out, it is worked out here. With a gap, the people nearest to it come first.
export function selectFrontier(session: ConnectionSession, contacts: ContactAssessment[], side: 0 | 1, count: number, people: ContactPerson[], gap?: TemporalGap | null): ContactPerson[] {
  const distances = routeDistances(session.endpoints[side], people, contacts, session.endpoints);
  const opposite = routeDistances(session.endpoints[1 - side], people, contacts, session.endpoints);
  const target = session.people.find(person => person.id === session.endpoints[1 - side])!;
  const apart = gap === undefined
    ? (side === 0 ? temporalGap(reachedPeople(session, distances), reachedPeople(session, opposite)) : temporalGap(reachedPeople(session, opposite), reachedPeople(session, distances)))
    : gap;
  // The person at the far end of the gap, on the other side: how far a source's life is from reaching them is how far it is from crossing the gap.
  const farEdge = apart ? apart.edges[1 - side] : null;
  const candidates = session.people.filter(person => distances.has(person.id) && !opposite.has(person.id))
    .map(person => {
      const round = session.rounds.find(item => item.personId === person.id);
      const temporal = Math.abs((person.birthYear + person.deathYear - target.birthYear - target.deathYear) / 2);
      return { person, round, score: distances.get(person.id)! * 2 + temporal / 200 + (round?.round ?? 0) * 3, toGap: farEdge ? lifespanGapYears(person, farEdge) : 0 };
    }).filter(item => (item.round?.emptyRounds ?? 0) < 2 && distances.get(item.person.id)! < MAX_CONTACT_LINKS);
  const fresh = candidates.filter(item => (item.round?.round ?? 0) < GAP_BAND_MAX_ROUNDS);
  const nearest = farEdge && fresh.length ? Math.min(...fresh.map(item => item.toGap)) : Infinity;
  const inBand = (item: typeof candidates[number]) => !!farEdge && (item.round?.round ?? 0) < GAP_BAND_MAX_ROUNDS && item.toGap <= nearest + GAP_BAND_YEARS;
  // The people nearest the gap first, least-expanded and nearest first among them; everyone else rotates by least-expanded rounds first,
  // with the temporal rank as a soft preference. No monotonic constraint.
  candidates.sort((a, b) => {
    const aBand = inBand(a), bBand = inBand(b);
    if (aBand !== bBand) return aBand ? -1 : 1;
    const rounds = (a.round?.round ?? 0) - (b.round?.round ?? 0);
    if (aBand && bBand) return rounds || a.toGap - b.toGap || a.score - b.score || a.person.id.localeCompare(b.person.id);
    return rounds || a.score - b.score || a.person.id.localeCompare(b.person.id);
  });
  return candidates.slice(0, count).map(item => item.person);
}
