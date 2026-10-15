import { MAX_PATH_INTERMEDIATES, PATH_CATALOG_LIMIT, PATH_CATALOG_PADDING_YEARS } from '../constants';
import type { HistoricalFigure, IAIService, NewPerson, PathCatalogEntry } from '../types';
import { canonicalName } from '../utils/names';
import { getUserErrorMessage } from '../utils/userErrors';
import { overlaps, pairKey, isNewPerson } from './pathService';
import {
  acceptedDistances, ambiguousBridge, blockedContact, canvasPerson, duplicateKeeper, figurePerson, identifyPerson, resolvableDuplicates, routeDistances, samePerson, selectFrontier,
  sessionKey, shortestContactPath, validAccepted, validPerson, mergeResolvedIdentity, emptyPairAsks, emptyRequestCounts,
  CONNECTION_REQUEST_KINDS, PAIR_ASK_REASONS,
  type AmbiguousBridge, type CandidateContact, type ContactAssessment, type ContactKnowledge, type ContactPerson, type ConnectionSession, type ConnectionRequestKind, type PairAskReason,
} from './connectionGraph';
import { formatYear } from '../utils/formatters';
import { validationRetryCount } from './jsonResponse';
import { withProvenance } from './connectionAI';
import { MemoryConnectionRepository, type ConnectionRepository } from '../utils/connectionKnowledge';
import { withAbort } from './utils';

export interface ConnectionFeasibility { feasible: boolean; gapYears: number; peopleNeeded: number; message: string | null }
// Historical distance never refuses a search; chronology is checked on every edge instead.
export function checkConnectionFeasibility(first: HistoricalFigure, second: HistoricalFigure, currentYear = new Date().getFullYear()): ConnectionFeasibility {
  const [earlier, later] = first.birthYear <= second.birthYear ? [first, second] : [second, first];
  const gapYears = Math.max(0, later.birthYear - Math.min(earlier.deathYear, currentYear));
  return { feasible: true, gapYears, peopleNeeded: Math.ceil(gapYears / 40), message: null };
}
export type ConnectionTargetStatus = { ok: true } | { ok: false; reason: 'self' | 'event' | 'identity'; message: string };
export function classifyConnectionTarget(from: HistoricalFigure, candidate: HistoricalFigure, _currentYear = new Date().getFullYear()): ConnectionTargetStatus {
  if (candidate.category === 'EVENTS' || from.category === 'EVENTS') return { ok: false, reason: 'event', message: 'Connections link people, not events.' };
  if (!validPerson(from) || !validPerson(candidate)) return { ok: false, reason: 'identity', message: 'Choose a person with defensible birth and death years.' };
  if (candidate.id === from.id || samePerson(from, candidate)) return { ok: false, reason: 'self', message: `Choose someone other than ${from.name}.` };
  if (canonicalName(from.name) === canonicalName(candidate.name)) return { ok: false, reason: 'identity', message: 'These names have conflicting identity dates. Resolve the identities first.' };
  return { ok: true };
}

// Canvas people the model may use as intermediates: those living near the span between the endpoints,
// closest first, so the cap keeps the most plausible bridges.
export function buildPathCatalog(figures: HistoricalFigure[], from: HistoricalFigure, to: HistoricalFigure,
  limit = PATH_CATALOG_LIMIT, padding = PATH_CATALOG_PADDING_YEARS): PathCatalogEntry[] {
  const [earlier, later] = from.birthYear <= to.birthYear ? [from, to] : [to, from];
  const low = Math.min(earlier.deathYear, later.birthYear), high = Math.max(earlier.deathYear, later.birthYear);
  const middle = (low + high) / 2;
  return figures
    .filter(person => person.category !== 'EVENTS' && person.id !== from.id && person.id !== to.id)
    .map(person => ({
      person,
      distance: person.deathYear < low ? low - person.deathYear : person.birthYear > high ? person.birthYear - high : 0,
      offset: Math.abs((person.birthYear + person.deathYear) / 2 - middle),
    }))
    .filter(({ distance }) => distance <= padding)
    .sort((a, b) => a.distance - b.distance || a.offset - b.offset || a.person.id.localeCompare(b.person.id))
    .slice(0, Math.max(0, limit))
    .map(({ person: { id, name, birthYear, deathYear } }) => ({ id, name, birthYear, deathYear }));
}

export function newPersonToFigure(person: NewPerson): HistoricalFigure {
  return {
    // Same scheme as generated people, so the same person always receives the same id.
    id: `w-p-${encodeURIComponent(person.name.toLowerCase())}-${person.birthYear}-${person.deathYear}`,
    name: person.name, birthYear: person.birthYear, deathYear: person.deathYear,
    occupation: person.occupation, category: person.category, shortDescription: person.description,
  };
}

export interface ConnectionLinkResult { from: HistoricalFigure; to: HistoricalFigure; evidence: string; contact?: ContactAssessment }
export interface ConnectionChain { chain: HistoricalFigure[]; links: ConnectionLinkResult[] }
export type ConnectionResult =
  | ({ status: 'connected'; degrees: number; newFigures: HistoricalFigure[]; session?: ConnectionSession } & ConnectionChain)
  | { status: 'paused' | 'explored' | 'error'; session: ConnectionSession; error?: string };
export interface ConnectionProgress { label: string }
// A pair the model failed to answer validly this many times is left alone until the next segment.
const MAX_ASSESSMENT_FAILURES = 2;
// `identityChecks`: identity requests per segment spent on names recorded with conflicting dates that stand on an accepted bridge.
export const SEARCH_LIMITS = { wallMs: 180_000, tasks: 32, people: 160, pairs: 320, discoveryPeople: 4, candidates: 6, assessmentPairs: 8, identityChecks: 4 };
// An assessment reply is one short object per pair, so a request can carry more pairs. Larger batches are enabled per provider, Ollama
// first; the others keep SEARCH_LIMITS.assessmentPairs until each is trusted at the larger size.
export const ASSESSMENT_PAIRS_BY_PROVIDER: Record<string, number> = { ollama: 16 };
export const assessmentPairsFor = (provider: string): number => ASSESSMENT_PAIRS_BY_PROVIDER[provider] ?? SEARCH_LIMITS.assessmentPairs;
export const EXPLORED_PHASE = 'This exploration did not establish a chain';
const listOf = (items: string[], word: 'and' | 'or') => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`;
// Said instead of EXPLORED_PHASE when the accepted contacts do link the two people, but only through names recorded with conflicting dates.
export const ambiguousBridgePhase = ({ identities }: AmbiguousBridge): string =>
  `No chain: accepted contacts link them only through ${listOf(identities.map(({ name, records }) =>
    `${name} (${listOf(records.map(p => `${formatYear(p.birthYear)}–${formatYear(p.deathYear)}`), 'or')})`), 'and')}, recorded with conflicting dates`;
export interface ConnectionSearchOptions {
  service: Pick<IAIService, 'fetchConnectionPath' | 'discoverPersonalContacts' | 'assessPersonalContacts' | 'resolveFigure'>;
  from: HistoricalFigure; to: HistoricalFigure; figures: HistoricalFigure[]; signal: AbortSignal;
  storage?: Storage; repository?: ConnectionRepository; canvasId?: string; session?: ConnectionSession;
  provenance?: { provider: string; model: string }; limits?: Partial<typeof SEARCH_LIMITS>;
  onSnapshot?: (session: ConnectionSession) => void; onProgress?: (progress: ConnectionProgress) => void;
}

// Bounded, bidirectional contact exploration. Candidates never enter the accepted graph by being drawn.
export async function findConnection(options: ConnectionSearchOptions): Promise<ConnectionResult> {
  options.signal.throwIfAborted();
  const provenance = options.provenance ?? { provider: 'configured', model: 'configured' };
  const limits = { ...SEARCH_LIMITS, assessmentPairs: assessmentPairsFor(provenance.provider), ...options.limits }, started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Search time budget reached.', 'TimeoutError')), limits.wallMs);
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const repo = options.repository ?? new MemoryConnectionRepository();
  let knowledge: ContactKnowledge = { people: [], contacts: [] };
  let session: ConnectionSession | undefined;
  let tasks = 0, addedPeople = 0, triedPairs = 0;
  const priorElapsed = options.session?.elapsedMs ?? 0;
  // Request accounting for this segment, replaced outright on every snapshot; `total` adds it to what
  // earlier instrumented segments saved. Counts are taken when a request is issued, so a request that fails still counts.
  const requests = emptyRequestCounts(), pairAsks = emptyPairAsks(), assessBatches: number[] = [], discoverSources: number[] = [];
  let validationRetries = 0;
  const priorTotal = options.session?.diagnostics.total;
  const prior = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
  const total = () => ({
    segments: prior(priorTotal?.segments) + 1,
    requests: Object.fromEntries(CONNECTION_REQUEST_KINDS.map(kind => [kind, prior(priorTotal?.requests?.[kind]) + requests[kind]])) as Record<ConnectionRequestKind, number>,
    pairAsks: Object.fromEntries(PAIR_ASK_REASONS.map(reason => [reason, prior(priorTotal?.pairAsks?.[reason]) + pairAsks[reason]])) as Record<PairAskReason, number>,
    elapsedMs: (Number.isFinite(priorTotal?.elapsedMs) ? priorTotal!.elapsedMs : 0) + Date.now() - started,
  });
  const emit = () => {
    if (!session) return;
    session.elapsedMs = priorElapsed + Date.now() - started;
    session.updatedAt = Date.now();
    session.diagnostics = { ...session.diagnostics, tasks, people: addedPeople, pairs: triedPairs,
      requests: { ...requests }, assessBatches: [...assessBatches], discoverSources: [...discoverSources],
      pairAsks: { ...pairAsks }, validationRetries, total: total() };
    options.onSnapshot?.(structuredClone(session));
    options.onProgress?.({ label: session.phase });
  };
  const checkpoint = async () => {
    emit();
    try { session!.persistent = await repo.checkpoint(knowledge, session!); }
    catch { session!.persistent = false; }
    emit();
  };
  // `issued` records what the request carries, and runs only once the request is actually going out.
  const task = async <T>(kind: ConnectionRequestKind, label: string, call: () => Promise<T>, issued?: () => void): Promise<T> => {
    signal.throwIfAborted();
    if (tasks >= limits.tasks) throw new DOMException('Search work budget reached.', 'QuotaExceededError');
    tasks++; requests[kind]++; issued?.(); session!.phase = label; emit();
    const retriesBefore = validationRetryCount();
    try {
      const result = await withAbort(call(), signal);
      signal.throwIfAborted();
      return result;
    } finally { validationRetries += validationRetryCount() - retriesBefore; } // Requests are serial, so the delta is this request's.
  };
  try {
    const targetStatus = classifyConnectionTarget(options.from, options.to);
    if ('reason' in targetStatus) throw new Error(targetStatus.message);
    knowledge = await withAbort(repo.loadKnowledge(), signal);
    const from = identifyPerson(knowledge.people, figurePerson(options.from));
    const to = identifyPerson(knowledge.people, figurePerson(options.to));
    if (from.id === to.id) throw new Error('The endpoints resolve to the same person. Choose someone else.');
    const key = sessionKey(options.canvasId ?? 'canvas', from.id, to.id);
    session = options.session ? structuredClone(options.session) : {
      version: 2, key, canvasId: options.canvasId ?? 'canvas', endpoints: [from.id, to.id], people: [from, to],
      candidates: [], rounds: [], attempts: {}, segment: 0, status: 'paused', phase: 'Starting contact search',
      elapsedMs: 0, updatedAt: Date.now(), persistent: repo.persistent, diagnostics: { tasks: 0, people: 0, pairs: 0 },
    };
    if (options.session) {
      // A saved session may still name a record that a later search retired into another person (a merge of duplicate dates, an alias):
      // follow it the way the merge did, so the session keeps working and takes the survivor's key.
      const survivor = (id: string) => { let p = knowledge.people.find(k => k.id === id); for (let hops = 0; p?.canonicalId && hops < 8; hops++) p = knowledge.people.find(k => k.id === p!.canonicalId); return p && !p.canonicalId ? p : undefined; };
      for (const p of [...session.people]) {
        const retired = knowledge.people.find(k => k.id === p.id && k.canonicalId), keeper = retired && survivor(retired.canonicalId!);
        if (retired && keeper) mergeResolvedIdentity(knowledge, session, keeper, { ...retired }, retired.name);
      }
      if (session.key !== key) {
        if (sessionKey(session.canvasId, session.endpoints[0], session.endpoints[1]) !== key) throw new Error('Checkpoint belongs to another canvas or pair.');
        session.retiredKeys = [...(session.retiredKeys ?? []), session.key]; session.key = key;
      }
    }
    session.endpoints = [from.id, to.id]; // Unordered checkpoint, oriented request.
    session.segment++; session.status = 'searching'; session.error = undefined;
    session.runStartedAt = started;
    session.persistent = repo.persistent;
    for (const p of session.people) if (!knowledge.people.some(k => k.id === p.id)) knowledge.people.push(p);
    for (const c of session.candidates) if (c.assessment && c.status === 'accepted' && validAccepted(c.assessment, new Map(knowledge.people.map(p => [p.id, p])))
      && !knowledge.contacts.some(existing => pairKey(...existing.pair) === pairKey(...c.assessment!.pair) && existing.verdict === 'accepted')) knowledge.contacts.push(c.assessment);
    for (const c of session.candidates) { if (c.status === 'checking') c.status = c.assessment?.verdict ?? 'proposed'; c.failures = undefined; }
    let indexedPeople = knowledge.people, indexedLength = knowledge.people.length;
    let personIndex = new Map(knowledge.people.map(p => [p.id, p]));
    const byId = () => {
      if (indexedPeople !== knowledge.people || indexedLength !== knowledge.people.length) {
        indexedPeople = knowledge.people; indexedLength = knowledge.people.length;
        personIndex = new Map(knowledge.people.map(p => [p.id, p]));
      }
      return personIndex;
    };
    const addPerson = (p: ContactPerson) => { if (!session!.people.some(item => item.id === p.id)) session!.people.push(p); };
    // Reach for every decision about whether a chain can exist (frontier, join pairs, clusters): the same graph `shortestContactPath` routes
    // over, so "reachable from both ends" always means a chain exists. `attachShared` keeps `acceptedDistances`: it only decides which
    // people are shown and saved with the session.
    const reachOf = (id: string) => routeDistances(id, knowledge.people, knowledge.contacts, [from.id, to.id]);
    const attachShared = () => {
      for (const endpoint of [from.id, to.id]) for (const id of acceptedDistances(endpoint, knowledge.people, knowledge.contacts).keys()) addPerson(byId().get(id)!);
      const ids = new Set(session!.people.map(p => p.id));
      for (const c of knowledge.contacts) if (validAccepted(c, byId()) && c.pair.every(id => ids.has(id))) {
        const key = pairKey(...c.pair), old = session!.candidates.find(e => pairKey(e.from, e.to) === key);
        if (old) { old.status = 'accepted'; old.assessment = c; }
        else session!.candidates.push({ from: c.pair[0], to: c.pair[1], claim: '', status: 'accepted', assessment: c });
      }
    };
    // An accepted chain that runs through a name stored with conflicting date records is not a route. Before the search spends anything
    // else on it, one identity request per such name on the shortest accepted bridge asks which dates are right. Only an answer naming
    // exactly one of the records (see `duplicateKeeper`) merges them: the others are retired into it, every reference follows, and the
    // chain, if that was all that was missing, exists. Any other answer leaves the records separate. A name is asked once per model and set
    // of records (kept in `attempts`), so resuming never repeats it; `identityChecks` bounds the requests of a segment.
    let identityChecks = 0;
    const resolveDuplicate = async (): Promise<boolean> => {
      for (const { name, records } of ambiguousBridge(from.id, to.id, knowledge.people, knowledge.contacts)?.identities ?? []) {
        if (identityChecks >= limits.identityChecks || !resolvableDuplicates(records, [from.id, to.id])) continue;
        const key = `duplicates:${canonicalName(name)}`, context = JSON.stringify([provenance.provider, provenance.model, records.map(p => [p.birthYear, p.deathYear])]);
        if (session!.attempts[key]?.context === context) continue;
        identityChecks++;
        const resolved = await task('identity', `Resolving which dates are right for ${name}`, () => options.service.resolveFigure(name, signal));
        session!.attempts[key] = { context, segment: session!.segment, count: 1 };
        const keeper = resolved && validPerson(resolved) ? duplicateKeeper(records, resolved) : undefined;
        if (!keeper) continue;
        for (const record of records) if (record !== keeper) mergeResolvedIdentity(knowledge, session!, keeper, record, resolved!.name);
        return true;
      }
      return false;
    };
    const outcome = async (): Promise<ConnectionResult | null> => {
      attachShared();
      let path = shortestContactPath(from.id, to.id, knowledge.people, knowledge.contacts);
      while (!path && await resolveDuplicate()) { attachShared(); path = shortestContactPath(from.id, to.id, knowledge.people, knowledge.contacts); }
      if (!path) return null;
      signal.throwIfAborted();
      // The endpoints are the figures that were asked for, whatever dates their records carry now (a duplicate may have been merged into another record).
      const chain = path.map((id, i) => i === 0 ? options.from : i === path.length - 1 ? options.to : canvasPerson(byId().get(id)!, options.figures));
      if (new Set(chain.map(p => p.id)).size !== chain.length) return null;
      const links = path.slice(1).map((id, i): ConnectionLinkResult => {
        const contact = knowledge.contacts.find(c => pairKey(...c.pair) === pairKey(path[i], id) && validAccepted(c, byId()))!;
        return { from: chain[i], to: chain[i + 1], evidence: contact.evidence, contact };
      });
      session!.status = 'connected'; session!.phase = 'Accepted chain found';
      await checkpoint(); signal.throwIfAborted();
      return { status: 'connected', chain, links, degrees: chain.length - 1,
        newFigures: chain.filter(p => !options.figures.some(f => f.id === p.id)), session: structuredClone(session!) };
    };
    const propose = (a: ContactPerson, b: ContactPerson, claim = '', seed = false) => {
      addPerson(a); addPerson(b);
      if (session!.candidates.some(c => pairKey(c.from, c.to) === pairKey(a.id, b.id))) return;
      const blockedReason = blockedContact(a, b);
      session!.candidates.push({ from: a.id, to: b.id, claim, status: blockedReason ? 'blocked' : 'proposed', blockedReason, ...(seed ? { seed: true } : {}) });
    };
    // What the assessment prompt actually sends: provider, model, both names and both alias lists. The accepted contacts of the two
    // people are not in it, so a new accepted neighbor elsewhere in the graph never makes an identical question look new.
    const segmentContexts = new Map<string, string>();
    const attemptContext = (a: ContactPerson, b: ContactPerson) => {
      const key = pairKey(a.id, b.id);
      if (!segmentContexts.has(key)) segmentContexts.set(key, JSON.stringify([provenance.provider, provenance.model, a.name, a.aliases, b.name, b.aliases]));
      return segmentContexts.get(key)!;
    };
    interface Ask { candidate: CandidateContact; focused: boolean; join: boolean }
    // The one assessment pool, in the order pairs are sent: pairs that would join the two accepted clusters (accepting one ends the
    // search), then pairs never asked or asked under another context, then the single promising re-ask a pair gets per segment.
    const pending = (fromReach = reachOf(from.id), toReach = reachOf(to.id)): Ask[] => {
      const asks: Array<Ask & { rank: number }> = [];
      for (const c of session!.candidates) {
        if (c.status === 'blocked' || c.status === 'accepted' || (c.failures ?? 0) >= MAX_ASSESSMENT_FAILURES) continue;
        const attempt = session!.attempts[pairKey(c.from, c.to)];
        const fresh = !attempt || attempt.context !== attemptContext(byId().get(c.from)!, byId().get(c.to)!);
        // One extra reassessment of a proposed promising pair, only within its original segment.
        const reask = !fresh && c.status === 'unresolved' && !!c.claim && (attempt!.segment === session!.segment || c.pendingFocused)
          && attempt!.focusedSegment !== session!.segment && attempt!.count === 1;
        if (!fresh && !reask) continue;
        const join = (fromReach.has(c.from) && toReach.has(c.to)) || (fromReach.has(c.to) && toReach.has(c.from));
        asks.push({ candidate: c, focused: reask, join, rank: join ? 0 : fresh ? 1 : 2 });
      }
      return asks.sort((a, b) => a.rank - b.rank); // stable: discovery order is kept inside each rank
    };
    // Send when a batch is full, when something in the pool could end the search (a join pair, or the model's whole seed route),
    // when waiting for a discovery is not worthwhile, or when half a batch is waiting and there is no time left to wait for more.
    const shouldSend = (pool: Ask[], worthWaiting: boolean): boolean => {
      if (pool.length >= limits.assessmentPairs || pool.some(a => a.join || a.candidate.seed) || !worthWaiting) return true;
      if (pool.length * 2 >= limits.assessmentPairs && tasks >= 2) {
        const elapsed = Date.now() - started;
        if (limits.wallMs - elapsed < 2 * (elapsed / tasks)) return true; // the next discovery and an assessment of its pairs would not fit
      }
      return false;
    };
    // `kind` names the call site: the endpoint check sends `direct`, the search loop sends `assess`.
    const assess = async (asks: Ask[], kind: 'direct' | 'assess' = 'assess'): Promise<ConnectionResult | null> => {
      const batch = asks.slice(0, Math.max(0, Math.min(limits.assessmentPairs, limits.pairs - triedPairs)));
      if (!batch.length) return null;
      const pairs = batch.map(({ candidate: c, focused }) => ({ first: byId().get(c.from)!, second: byId().get(c.to)!, focused }));
      // An earlier attempt is admitted to a pool only when its context changed or as the one focused re-ask.
      const reasons = batch.map(({ candidate: c, focused }): PairAskReason => focused ? 'focused' : session!.attempts[pairKey(c.from, c.to)] ? 'contextChange' : 'fresh');
      for (const { candidate: c, focused } of batch) { c.status = 'checking'; c.pendingFocused = focused; }
      const results = await task(kind, batch.every(a => a.focused) ? 'Reassessing promising contacts' : 'Independently assessing contacts',
        () => options.service.assessPersonalContacts(pairs, signal), () => { assessBatches.push(batch.length); for (const reason of reasons) pairAsks[reason]++; });
      for (const { candidate: c, focused } of batch) {
        const result = results.find(r => pairKey(...r.pair) === pairKey(c.from, c.to));
        const record = result && withProvenance(result, provenance);
        if (!record || (record.verdict === 'accepted' && !validAccepted(record, byId()))) {
          // Not assessed: the model gave no valid answer for this pair. That is a transport problem, not a verdict, so nothing is
          // stored and no attempt is recorded; the pair goes back to the pool and is given up on for this segment after two tries.
          c.status = c.assessment?.verdict ?? 'proposed'; c.failures = (c.failures ?? 0) + 1;
          continue;
        }
        c.status = record.verdict; c.assessment = record; c.pendingFocused = false; c.failures = undefined;
        const context = attemptContext(byId().get(c.from)!, byId().get(c.to)!);
        const prior = session!.attempts[pairKey(c.from, c.to)];
        session!.attempts[pairKey(c.from, c.to)] = { context, segment: session!.segment, count: prior?.context === context ? prior.count + 1 : 1,
          focusedSegment: focused ? session!.segment : prior?.focusedSegment };
        knowledge.contacts = knowledge.contacts.filter(r => !(pairKey(...r.pair) === pairKey(...record.pair)
          && r.verdict === record.verdict && (record.verdict === 'accepted' || (r.provenance.provider === provenance.provider && r.provenance.model === provenance.model))));
        knowledge.contacts.push(record); triedPairs++;
      }
      await checkpoint(); signal.throwIfAborted();
      return outcome();
    };
    await checkpoint(); signal.throwIfAborted();
    let result = await outcome(); if (result) return result;
    if (overlaps(from, to)) {
      propose(from, to, 'Direct endpoint contact candidate');
      result = await assess(pending().filter(a => pairKey(a.candidate.from, a.candidate.to) === pairKey(from.id, to.id)), 'direct'); if (result) return result;
    }
    const seedContext = JSON.stringify([provenance.provider, provenance.model, [from.id, to.id].sort(), options.figures.map(p => p.id).sort()]);
    if (session.seedContext !== seedContext) {
      const proposal = await task('seed', 'Proposing one seed route', () => options.service.fetchConnectionPath(options.from, options.to,
        { catalog: buildPathCatalog(options.figures, options.from, options.to), maxIntermediates: MAX_PATH_INTERMEDIATES }, signal))
        .catch(error => { signal.throwIfAborted(); if (/unusable data|invalid|path|proposal/i.test(error.message) && !/auth|HTTP|API|network|quota|rate/i.test(error.message)) return null; throw error; });
      session.seedContext = seedContext;
      if (proposal) {
        let materialized: Array<ContactPerson | undefined> = [];
        try { materialized = proposal.nodes.map(node => {
          if (!isNewPerson(node)) { const p = options.figures.find(p => p.id === node.id) ?? [options.from, options.to].find(p => p.id === node.id); return p ? identifyPerson(knowledge.people, figurePerson(p)) : undefined; }
          if (addedPeople >= limits.people) return undefined;
          const before = knowledge.people.length;
          const p = identifyPerson(knowledge.people, node); addedPeople += knowledge.people.length - before; return p;
        }); } catch { /* Structurally unusable seeds fall through to graph discovery. */ }
        if (materialized.length >= 2 && materialized.every(Boolean) && materialized.length <= 22 && new Set(materialized.map(p => p!.id)).size === materialized.length
          && materialized[0]!.id === from.id && materialized.at(-1)!.id === to.id) {
          for (let i = 0; i < materialized.length - 1; i++) propose(materialized[i]!, materialized[i + 1]!, proposal.links[i]?.claim ?? 'Seed route candidate', true);
        }
      }
      await checkpoint();
    }
    while (tasks < limits.tasks && addedPeople < limits.people && triedPairs < limits.pairs) {
      signal.throwIfAborted();
      const fromReach = reachOf(from.id), toReach = reachOf(to.id);
      // Both ends are expanded together: up to discoveryPeople sources from each, every source aimed at the opposite endpoint.
      const fromSources = selectFrontier(session, knowledge.contacts, 0, limits.discoveryPeople, knowledge.people), toSources = selectFrontier(session, knowledge.contacts, 1, limits.discoveryPeople, knowledge.people);
      const sources = [...fromSources, ...toSources];
      const pool = pending(fromReach, toReach);
      // Waiting for more pairs pays only when a discovery follows (someone to expand, room for it and for an assessment of what it finds)
      // and it reaches someone not expanded before: only accepted contacts move the frontier outward, so re-expanding the same
      // people while pairs sit unassessed adds little. Otherwise the pool is sent now.
      const worthWaiting = sources.length > 0 && tasks + 1 < limits.tasks && sources.some(p => !session!.rounds.some(r => r.personId === p.id));
      if (pool.length && shouldSend(pool, worthWaiting)) { result = await assess(pool); if (result) return result; continue; }
      if (!sources.length) {
        // Nothing is left to expand. If the accepted contacts do link the endpoints, but only through people recorded under one name with
        // conflicting dates, say which: it is not the same as having found nothing, and resuming the search cannot change it.
        const ambiguous = ambiguousBridge(from.id, to.id, knowledge.people, knowledge.contacts);
        session.status = 'explored'; session.phase = ambiguous ? ambiguousBridgePhase(ambiguous) : EXPLORED_PHASE; session.diagnostics.stopReason = 'frontier-explored'; break;
      }
      const clusterOf = (reach: Map<string, number>) => knowledge.people.filter(p => reach.has(p.id)).slice(0, 16);
      const toCluster = clusterOf(toReach), fromCluster = clusterOf(fromReach), perCluster = fromSources.length && toSources.length ? 8 : 16;
      const opposite = [...new Map([...(fromSources.length ? toCluster.slice(0, perCluster) : []), ...(toSources.length ? fromCluster.slice(0, perCluster) : [])].map(p => [p.id, p])).values()];
      const references = [...new Map([...opposite, ...session.people.slice(-32), ...options.figures.filter(validPerson).slice(0, 64).map(p => identifyPerson(knowledge.people, figurePerson(p)))].map(p => [p.id, p])).values()].slice(0, 80);
      const rounds = sources.map(p => session!.rounds.find(r => r.personId === p.id) ?? { personId: p.id, round: 0, proposed: [], emptyRounds: 0, lastExpanded: 0 });
      const goalOf = (p: ContactPerson) => fromSources.includes(p) ? to : from;
      const label = fromSources.length && toSources.length ? `Exploring contacts between ${from.name} and ${to.name}` : `Exploring contacts toward ${fromSources.length ? to.name : from.name}`;
      const discoveries = await task('discover', label, () => options.service.discoverPersonalContacts({
        sources: sources.map((p, i) => ({ person: p, round: rounds[i].round + 1, previous: rounds[i].proposed.flatMap(id => byId().get(id) ?? []), goal: goalOf(p) })),
        target: fromSources.length ? to : from, references, limit: limits.candidates,
      }, signal), () => { discoverSources.push(sources.length); });
      for (const round of rounds) {
        let added = 0;
        for (const candidate of discoveries.filter(d => d.sourceId === round.personId).slice(0, limits.candidates)) {
          const old = knowledge.people.find(p => samePerson(p, candidate.person));
          if (!old && addedPeople >= limits.people) continue;
          const before = knowledge.people.length;
          const p = identifyPerson(knowledge.people, candidate.person); addedPeople += knowledge.people.length - before;
          if (round.proposed.includes(p.id)) continue;
          round.proposed.push(p.id); added++;
          propose(byId().get(round.personId)!, p, candidate.claim);
        }
        round.round++; round.emptyRounds = added ? 0 : round.emptyRounds + 1; round.lastExpanded = session.segment;
        session.rounds = [...session.rounds.filter(r => r.personId !== round.personId), round];
      }
      // Promising alias collisions stay separate until two canonical identity resolutions agree.
      // Name-token similarity only selects a question; it is never permission to merge people.
      const aliases = session.people.flatMap(a => opposite.filter(b => a.id !== b.id && a.birthYear === b.birthYear && a.deathYear === b.deathYear
        && (canonicalName(a.name).split(' ').some(token => token.length > 2 && canonicalName(b.name).split(' ').includes(token))
          || a.proposedAliases?.some(name => canonicalName(name) === canonicalName(b.name))
          || b.proposedAliases?.some(name => canonicalName(name) === canonicalName(a.name))))
        .map(b => [a, b] as const)).slice(0, 2);
      for (const [a, b] of aliases) {
        const identityKey = `identity:${pairKey(a.id, b.id)}`, context = attemptContext(a, b);
        if (session.attempts[identityKey]?.context === context || tasks + 2 > limits.tasks) continue;
        const resolvedA = await task('identity', `Resolving identity of ${a.name}`, () => options.service.resolveFigure(a.name, signal));
        const resolvedB = await task('identity', `Resolving identity of ${b.name}`, () => options.service.resolveFigure(b.name, signal));
        session.attempts[identityKey] = { context, segment: session.segment, count: 1 };
        if (resolvedA && resolvedB && validPerson(resolvedA) && validPerson(resolvedB) && samePerson(resolvedA, resolvedB)
          && resolvedA.birthYear === a.birthYear && resolvedA.deathYear === a.deathYear) {
          mergeResolvedIdentity(knowledge, session, a, b, resolvedA.name);
          const newKey = sessionKey(session.canvasId, from.id, to.id);
          if (newKey !== session.key) session.retiredKeys = [...(session.retiredKeys ?? []), session.key];
          session.key = newKey;
          result = await outcome(); if (result) return result;
        }
      }
      // Known people remain eligible. Explicitly check promising overlaps between the frontiers.
      for (const source of sources) for (const other of (fromSources.includes(source) ? toCluster : fromCluster).slice(0, 2)) if (!blockedContact(source, other)) propose(source, other, 'Cross-frontier contact candidate');
      await checkpoint();
    }
    if (session.status === 'searching') { session.status = 'paused'; session.phase = 'Search budget reached'; session.diagnostics.stopReason = 'work-budget'; }
  } catch (error) {
    if (!session) { clearTimeout(timer); throw error; }
    const paused = signal.aborted || (error instanceof DOMException && error.name === 'QuotaExceededError');
    session.status = paused ? 'paused' : 'error';
    session.phase = deadline.signal.aborted ? 'Search time budget reached' : paused ? 'Search paused' : 'Search interrupted';
    session.diagnostics.stopReason = deadline.signal.aborted ? 'time-budget' : options.signal.aborted ? 'cancelled' : paused ? 'work-budget' : 'transport-error';
    if (!paused) session.error = getUserErrorMessage(error, 'Contact search failed. Update Settings or resume later.');
  } finally { clearTimeout(timer); }
  for (const c of session!.candidates) if (c.status === 'checking') c.status = c.assessment?.verdict ?? 'proposed';
  await checkpoint();
  return { status: session!.status as 'paused' | 'explored' | 'error', session: structuredClone(session!), error: session!.error };
}

export type ConnectionTargetResolution = { figure: HistoricalFigure } | { message: string };

// A typed name that is already on the canvas, events included so they get their own refusal.
export const findCanvasPerson = (figures: HistoricalFigure[], name: string): HistoricalFigure | undefined =>
  (() => { const matches = figures.filter(figure => canonicalName(figure.name) === canonicalName(name)); return matches.length === 1 ? matches[0] : undefined; })();

// Turns a typed name into the other end of a chain. People already on the canvas need no request;
// anyone else is identified by the model, then checked exactly like a person picked on the canvas.
// Every failure except cancellation comes back as a message for the picker.
export async function resolveConnectionTarget(
  service: Pick<IAIService, 'resolveFigure'>, name: string, from: HistoricalFigure, figures: HistoricalFigure[], signal: AbortSignal,
): Promise<ConnectionTargetResolution> {
  signal.throwIfAborted();
  const check = (figure: HistoricalFigure): ConnectionTargetResolution => {
    const status = classifyConnectionTarget(from, figure);
    return 'reason' in status ? { message: status.message } : { figure };
  };
  const typed = findCanvasPerson(figures, name);
  if (typed) return check(typed);
  let person: NewPerson | null;
  try {
    person = await service.resolveFigure(name, signal);
  } catch (error) {
    signal.throwIfAborted();
    return { message: getUserErrorMessage(error, "Couldn't identify that person. Try their full name.") };
  }
  signal.throwIfAborted();
  if (!person) return { message: "Couldn't identify that person. Try their full name." };
  // The model may answer with the canonical form of what was typed, which can already be on the canvas.
  const matches = figures.filter(figure => samePerson(figure, person));
  return check(matches.length === 1 ? matches[0] : newPersonToFigure(person));
}
