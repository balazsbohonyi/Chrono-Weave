import { MAX_PATH_INTERMEDIATES, PATH_CATALOG_LIMIT, PATH_CATALOG_PADDING_YEARS } from '../constants';
import type { HistoricalFigure, IAIService, NewPerson, PathCatalogEntry } from '../types';
import { canonicalName } from '../utils/names';
import { getUserErrorMessage } from '../utils/userErrors';
import { overlaps, pairKey, isNewPerson } from './pathService';
import {
  acceptedDistances, blockedContact, canvasPerson, figurePerson, identifyPerson, samePerson, selectFrontier,
  sessionKey, shortestContactPath, validAccepted, validPerson, mergeResolvedIdentity,
  type ContactAssessment, type ContactKnowledge, type ContactPerson, type ConnectionSession,
} from './connectionGraph';
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
export const SEARCH_LIMITS = { wallMs: 180_000, tasks: 32, people: 160, pairs: 320, discoveryPeople: 4, candidates: 6, assessmentPairs: 8 };
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
  const limits = { ...SEARCH_LIMITS, ...options.limits }, started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Search time budget reached.', 'TimeoutError')), limits.wallMs);
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const repo = options.repository ?? new MemoryConnectionRepository();
  const provenance = options.provenance ?? { provider: 'configured', model: 'configured' };
  let knowledge: ContactKnowledge = { people: [], contacts: [] };
  let session: ConnectionSession | undefined;
  let tasks = 0, addedPeople = 0, triedPairs = 0;
  const priorElapsed = options.session?.elapsedMs ?? 0;
  const emit = () => {
    if (!session) return;
    session.elapsedMs = priorElapsed + Date.now() - started;
    session.updatedAt = Date.now();
    session.diagnostics = { ...session.diagnostics, tasks, people: addedPeople, pairs: triedPairs };
    options.onSnapshot?.(structuredClone(session));
    options.onProgress?.({ label: session.phase });
  };
  const checkpoint = async () => {
    emit();
    try { session!.persistent = await repo.checkpoint(knowledge, session!); }
    catch { session!.persistent = false; }
    emit();
  };
  const task = async <T>(label: string, call: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    if (tasks >= limits.tasks) throw new DOMException('Search work budget reached.', 'QuotaExceededError');
    tasks++; session!.phase = label; emit();
    const result = await withAbort(call(), signal);
    signal.throwIfAborted();
    return result;
  };
  try {
    const targetStatus = classifyConnectionTarget(options.from, options.to);
    if ('reason' in targetStatus) throw new Error(targetStatus.message);
    knowledge = await withAbort(repo.loadKnowledge(), signal);
    const from = identifyPerson(knowledge.people, figurePerson(options.from));
    const to = identifyPerson(knowledge.people, figurePerson(options.to));
    if (from.id === to.id) throw new Error('The endpoints resolve to the same person. Choose someone else.');
    const key = sessionKey(options.canvasId ?? 'canvas', from.id, to.id);
    if (options.session && options.session.key !== key) throw new Error('Checkpoint belongs to another canvas or pair.');
    session = options.session ? structuredClone(options.session) : {
      version: 2, key, canvasId: options.canvasId ?? 'canvas', endpoints: [from.id, to.id], people: [from, to],
      candidates: [], rounds: [], attempts: {}, segment: 0, status: 'paused', phase: 'Starting contact search',
      elapsedMs: 0, updatedAt: Date.now(), persistent: repo.persistent, diagnostics: { tasks: 0, people: 0, pairs: 0 },
    };
    session.endpoints = [from.id, to.id]; // Unordered checkpoint, oriented request.
    session.segment++; session.status = 'searching'; session.error = undefined;
    session.runStartedAt = started;
    session.persistent = repo.persistent;
    for (const p of session.people) if (!knowledge.people.some(k => k.id === p.id)) knowledge.people.push(p);
    for (const c of session.candidates) if (c.assessment && c.status === 'accepted' && validAccepted(c.assessment, new Map(knowledge.people.map(p => [p.id, p])))
      && !knowledge.contacts.some(existing => pairKey(...existing.pair) === pairKey(...c.assessment!.pair) && existing.verdict === 'accepted')) knowledge.contacts.push(c.assessment);
    for (const c of session.candidates) if (c.status === 'checking') c.status = c.assessment?.verdict ?? 'proposed';
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
    const attachShared = () => {
      for (const endpoint of [from.id, to.id]) for (const id of acceptedDistances(endpoint, knowledge.people, knowledge.contacts).keys()) addPerson(byId().get(id)!);
      const ids = new Set(session!.people.map(p => p.id));
      for (const c of knowledge.contacts) if (validAccepted(c, byId()) && c.pair.every(id => ids.has(id))) {
        const key = pairKey(...c.pair), old = session!.candidates.find(e => pairKey(e.from, e.to) === key);
        if (old) { old.status = 'accepted'; old.assessment = c; }
        else session!.candidates.push({ from: c.pair[0], to: c.pair[1], claim: '', status: 'accepted', assessment: c });
      }
    };
    const outcome = async (): Promise<ConnectionResult | null> => {
      attachShared();
      const path = shortestContactPath(from.id, to.id, knowledge.people, knowledge.contacts);
      if (!path) return null;
      signal.throwIfAborted();
      const chain = path.map(id => canvasPerson(byId().get(id)!, options.figures));
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
    const propose = (a: ContactPerson, b: ContactPerson, claim = '') => {
      addPerson(a); addPerson(b);
      if (session!.candidates.some(c => pairKey(c.from, c.to) === pairKey(a.id, b.id))) return;
      const blockedReason = blockedContact(a, b);
      session!.candidates.push({ from: a.id, to: b.id, claim, status: blockedReason ? 'blocked' : 'proposed', blockedReason });
    };
    const segmentContexts = new Map<string, string>();
    const attemptContext = (a: ContactPerson, b: ContactPerson) => {
      const key = pairKey(a.id, b.id);
      if (!segmentContexts.has(key)) segmentContexts.set(key, JSON.stringify([provenance.provider, provenance.model, a.name, a.aliases, b.name, b.aliases,
        knowledge.contacts.filter(c => validAccepted(c, byId()) && c.pair.some(id => id === a.id || id === b.id)).map(c => pairKey(...c.pair)).sort()]));
      return segmentContexts.get(key)!;
    };
    const assess = async (focused = false): Promise<ConnectionResult | null> => {
      const batch = session!.candidates.filter(c => {
        if (c.status === 'blocked' || c.status === 'accepted') return false;
        const attempt = session!.attempts[pairKey(c.from, c.to)];
        const context = attemptContext(byId().get(c.from)!, byId().get(c.to)!);
        if (!attempt || attempt.context !== context) return !focused;
        // One extra reassessment of a proposed promising pair, only within its original segment.
        return focused && c.status === 'unresolved' && !!c.claim && (attempt.segment === session!.segment || c.pendingFocused)
          && attempt.focusedSegment !== session!.segment && attempt.count === 1;
      }).slice(0, Math.min(limits.assessmentPairs, limits.pairs - triedPairs));
      if (!batch.length) return null;
      const pairs = batch.map(c => ({ first: byId().get(c.from)!, second: byId().get(c.to)!, focused }));
      for (const c of batch) { c.status = 'checking'; c.pendingFocused = focused; }
      const results = await task(focused ? 'Reassessing promising contacts' : 'Independently assessing contacts', () => options.service.assessPersonalContacts(pairs, signal));
      if (results.length !== batch.length) throw new Error('Incomplete contact assessment batch.');
      for (const c of batch) {
        const result = results.find(r => pairKey(...r.pair) === pairKey(c.from, c.to));
        if (!result) throw new Error('Assessment returned an unknown pair.');
        const record = withProvenance(result, provenance);
        if (record.verdict === 'accepted' && !validAccepted(record, byId())) throw new Error('Contact assessment contradicts person identities or dates.');
        c.status = record.verdict; c.assessment = record; c.pendingFocused = false;
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
      result = await assess(); if (result) return result;
    }
    const seedContext = JSON.stringify([provenance.provider, provenance.model, [from.id, to.id].sort(), options.figures.map(p => p.id).sort()]);
    if (session.seedContext !== seedContext) {
      const proposal = await task('Proposing one seed route', () => options.service.fetchConnectionPath(options.from, options.to,
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
          for (let i = 0; i < materialized.length - 1; i++) propose(materialized[i]!, materialized[i + 1]!, proposal.links[i]?.claim ?? 'Seed route candidate');
        }
      }
      await checkpoint();
    }
    let side: 0 | 1 = session.segment % 2 === 0 ? 1 : 0;
    while (tasks < limits.tasks && addedPeople < limits.people && triedPairs < limits.pairs) {
      signal.throwIfAborted();
      const before = triedPairs;
      result = await assess(); if (result) return result;
      if (triedPairs !== before) continue;
      result = await assess(true); if (result) return result;
      const sources = selectFrontier(session, knowledge.contacts, side, limits.discoveryPeople);
      const target = side === 0 ? to : from;
      const oppositeIds = acceptedDistances(target.id, knowledge.people, knowledge.contacts);
      const opposite = knowledge.people.filter(p => oppositeIds.has(p.id)).slice(0, 16);
      side = side === 0 ? 1 : 0;
      if (!sources.length) {
        if (selectFrontier(session, knowledge.contacts, side, limits.discoveryPeople).length) continue;
        session.status = 'explored'; session.phase = 'This exploration did not establish a chain'; session.diagnostics.stopReason = 'frontier-explored'; break;
      }
      const references = [...new Map([...opposite, ...session.people.slice(-32), ...options.figures.filter(validPerson).slice(0, 64).map(p => identifyPerson(knowledge.people, figurePerson(p)))].map(p => [p.id, p])).values()].slice(0, 80);
      const rounds = sources.map(p => session!.rounds.find(r => r.personId === p.id) ?? { personId: p.id, round: 0, proposed: [], emptyRounds: 0, lastExpanded: 0 });
      const discoveries = await task(`Exploring contacts toward ${target.name}`, () => options.service.discoverPersonalContacts({
        sources: sources.map((p, i) => ({ person: p, round: rounds[i].round + 1, previous: rounds[i].proposed.flatMap(id => byId().get(id) ?? []) })),
        target, references, limit: limits.candidates,
      }, signal));
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
        const resolvedA = await task(`Resolving identity of ${a.name}`, () => options.service.resolveFigure(a.name, signal));
        const resolvedB = await task(`Resolving identity of ${b.name}`, () => options.service.resolveFigure(b.name, signal));
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
      for (const source of sources) for (const other of opposite.slice(0, 2)) if (!blockedContact(source, other)) propose(source, other, 'Cross-frontier contact candidate');
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
