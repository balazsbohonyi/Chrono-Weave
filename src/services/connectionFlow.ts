import { canvasPerson, figurePerson, identifyPerson, needsWikidata, reconcileIdentities, sessionKey, samePerson, validAccepted, validPerson, type ConnectionSession } from './connectionGraph';
import type { WikidataResolver } from './wikidataService';
import { pairKey } from './pathService';
import type { ConnectionRepository } from '../utils/connectionKnowledge';
import type { CanvasConfig, HistoricalFigure, IAIService } from '../types';
import { connectionPathKey, readConnectionPath, saveConnectionPath, saveWovenFigureIds, type ConnectionPathEntry } from '../utils/connectionPaths';
import { getUserErrorMessage } from '../utils/userErrors';
import { canonicalName } from '../utils/names';
import { weaveConnectionIntoCanvas, type WovenCanvas } from '../utils/weaveConnection';
import {
  classifyConnectionTarget, findCanvasPerson, findConnection, resolveConnectionTarget,
  type ConnectionLinkResult, type ConnectionProgress, type ConnectionResult,
} from './connectionPath';

// The decisions around a Six Degrees search, without React: what a request does before any search
// starts, and what a finished search does to the canvas and the cache. useConnection only wires
// these to state, so the rules that matter (nothing is woven or saved for a stale or failed search)
// can be tested with fake services and storage.

export interface ConnectionView {
  chain: HistoricalFigure[];
  links: ConnectionLinkResult[];
}

export type ConnectionTarget = { figure: HistoricalFigure } | { name: string };

export type StartDecision =
  | { kind: 'refuse'; message: string }
  | { kind: 'replay'; saved: ConnectionPathEntry }
  | { kind: 'search'; target: ConnectionTarget };

// Everything that can be decided without a request: a refusal, a saved path to replay, or the need to search.
// A typed name that is already on the canvas is treated exactly like a picked person.
export function decideConnectionStart(from: HistoricalFigure, target: ConnectionTarget, figures: HistoricalFigure[],
  storage: Storage, currentYear = new Date().getFullYear()): StartDecision {
  const figure = 'figure' in target ? target.figure : findCanvasPerson(figures, target.name);
  if (!figure) return { kind: 'search', target };
  const status = classifyConnectionTarget(from, figure, currentYear);
  if ('reason' in status) return { kind: 'refuse', message: status.message };
  const saved = readConnectionPath(storage, figures, from.id, figure.id);
  return saved ? { kind: 'replay', saved } : { kind: 'search', target: { figure } };
}

export function savedConnectionView(saved: Pick<ConnectionPathEntry, 'figures' | 'evidence' | 'contacts'>): ConnectionView {
  const chain = saved.figures;
  return {
    chain,
    links: chain.slice(1).map((person, index) => ({ from: chain[index], to: person, evidence: saved.evidence[index], contact: saved.contacts?.[index] })),
  };
}

export interface CanvasState {
  figures: HistoricalFigure[];
  config: CanvasConfig;
}

export interface ConnectionFlowEffects {
  // False once the search was cancelled or replaced; a stale search changes nothing.
  isCurrent: () => boolean;
  progress: (progress: ConnectionProgress) => void;
  exploration?: (session: ConnectionSession) => void;
  // The canvas as it is when the result arrives, not when the search started.
  canvas: () => CanvasState;
  applyWoven: (woven: WovenCanvas) => void;
  pathsChanged: () => void;
  show: (view: ConnectionView) => void;
  // Back to choosing the other end, with a message and the typed text kept.
  failPicking: (message: string) => void;
  notify: (message: string, type: 'success' | 'info' | 'error') => void;
}

// The exploration of a connection that was already made, to look it over again. It is the saved search of that pair when the shared store
// still has it and it still holds every link of the chain; otherwise a small one is rebuilt from what the saved connection itself carries
// (the people of the chain and the accepted evidence of each link). Either way it is a finished exploration: `chain` names the lit people.
export async function finishedExploration({ repository, canvasId, entry }: {
  repository: ConnectionRepository; canvasId: string; entry: ConnectionPathEntry;
}): Promise<{ session: ConnectionSession; chain: string[] } | null> {
  const savedIds = entry.identityIds, savedContacts = entry.contacts, people = entry.people;
  if (!savedIds || savedIds.length < 2 || !savedContacts || savedContacts.length !== savedIds.length - 1 || !people) return null;
  // A person of the chain may have been merged into another record since it was saved (the same person under another name or years, found by
  // Wikidata): the saved search then names the survivor, so the chain is followed onto it.
  const known = (await repository.loadKnowledge()).people;
  const survivor = (id: string) => { let person = known.find(p => p.id === id); for (let hops = 0; person?.canonicalId && hops < 8; hops++) person = known.find(p => p.id === person!.canonicalId); return person && !person.canonicalId ? person.id : id; };
  const ids = savedIds.map(survivor), contacts = savedContacts.map(contact => ({ ...contact, pair: [survivor(contact.pair[0]), survivor(contact.pair[1])] as [string, string] }));
  const endpoints: [string, string] = [ids[0], ids[ids.length - 1]];
  const key = sessionKey(canvasId, endpoints[0], endpoints[1]);
  const finished = { status: 'connected' as const, phase: 'Accepted chain found', endpoints };
  const stored = await repository.loadSession(key);
  const holdsChain = (session: ConnectionSession) => contacts.every(contact => session.candidates.some(candidate => candidate.status === 'accepted' && pairKey(candidate.from, candidate.to) === pairKey(...contact.pair)))
    && ids.every(id => session.people.some(person => person.id === id));
  if (stored && holdsChain(stored)) return { session: { ...stored, ...finished }, chain: ids };
  const chainPeople = ids.flatMap(id => known.find(person => person.id === id && !person.canonicalId) ?? people.find(person => person.id === id) ?? []);
  if (chainPeople.length !== ids.length) return null;
  return {
    session: { version: 2, key, canvasId, endpoints, people: chainPeople,
      candidates: contacts.map(contact => ({ from: contact.pair[0], to: contact.pair[1], claim: '', status: 'accepted' as const, assessment: contact })),
      rounds: [], attempts: {}, segment: 1, ...finished, elapsedMs: 0, updatedAt: entry.createdAt, persistent: repository.persistent, diagnostics: { tasks: 0, people: 0, pairs: 0 } },
    chain: ids,
  };
}

// A saved exploration opened without a search: the people in it that Wikidata has not been asked about are asked now, so the duplicates it
// holds become one person and their years are right, and what was learnt is saved (with the status the saved search has, not the one it is
// shown with). Best effort: when Wikidata cannot be reached, or has nothing to say, the exploration is returned as it was. `chain` (the lit
// people of a connection that was made) follows any person who was merged into another.
export async function reconcileSession({ repository, wikidata, session, chain, signal }: {
  repository: ConnectionRepository; wikidata: WikidataResolver; session: ConnectionSession; chain?: string[]; signal?: AbortSignal;
}): Promise<{ session: ConnectionSession; chain?: string[]; changed: boolean }> {
  const unchanged = { session, chain, changed: false };
  try {
    const knowledge = await repository.loadKnowledge(), view = structuredClone(session);
    for (const person of view.people) if (!knowledge.people.some(known => known.id === person.id)) knowledge.people.push(structuredClone(person));
    const byId = new Map(knowledge.people.map(person => [person.id, person]));
    const unasked = view.people.flatMap(person => { const record = byId.get(person.id); return record && needsWikidata(record) ? [record] : []; });
    if (!unasked.length) return unchanged;
    const outcomes = await wikidata.resolve(unasked.map(({ name, birthYear, deathYear }) => ({ name, birthYear, deathYear })), signal);
    if (!outcomes.size) return unchanged;
    reconcileIdentities(knowledge, view, outcomes, view.endpoints);
    const stored = await repository.loadSession(view.key);
    // A session that was never saved (one rebuilt from a saved connection) has nothing to save the knowledge with.
    if (stored) await repository.checkpoint(knowledge, { ...view, status: stored.status, phase: stored.phase, endpoints: stored.endpoints });
    const survivor = (id: string) => { let person = knowledge.people.find(known => known.id === id); for (let hops = 0; person?.canonicalId && hops < 8; hops++) person = knowledge.people.find(known => known.id === person!.canonicalId); return person?.id ?? id; };
    return { session: view, chain: chain && [...new Set(chain.map(survivor))], changed: true };
  } catch { return unchanged; }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const degreeLabel = (count: number) => plural(count, 'degree', 'degrees');

// What a finished search does. A stale or incomplete search changes no canvas data; a verified
// chain weaves its new people in as guests of the connection, then saves the path and the woven-in people.
export function settleConnection({ result, request, storage, effects }: {
  result: ConnectionResult; request: { from: HistoricalFigure; to: HistoricalFigure }; storage: Storage; effects: ConnectionFlowEffects;
}): void {
  if (!effects.isCurrent()) return;
  const { from, to } = request;
  if (result.status !== 'connected') {
    effects.exploration?.(result.session);
    if (result.status === 'error') effects.notify(result.error || 'Search interrupted.', 'error');
    return;
  }
  // Revalidate against the current canvas immediately before mutation. Every edge must still
  // connect the exact accepted identities, with no duplicate people or chronology contradictions.
  const people = new Map(result.session?.people.map(p => [p.id, p]) ?? []);
  if (result.chain.length < 2 || result.chain.length > 22 || result.links.length !== result.chain.length - 1
    || !result.chain.every(validPerson) || new Set(result.chain.map(p => canonicalName(p.name))).size !== result.chain.length
    || !result.links.every((link, i) => link.contact && validAccepted(link.contact, people)
      && ((samePerson(people.get(link.contact.pair[0])!, figurePerson(result.chain[i])) && samePerson(people.get(link.contact.pair[1])!, figurePerson(result.chain[i + 1])))
        || (samePerson(people.get(link.contact.pair[1])!, figurePerson(result.chain[i])) && samePerson(people.get(link.contact.pair[0])!, figurePerson(result.chain[i + 1])))))) {
    effects.notify('The accepted chain no longer matches these identities. Start a new search.', 'error'); return;
  }
  const current = effects.canvas();
  const chain = result.chain.map(p => {
    const shared = [...people.values()].find(shared => samePerson(shared, figurePerson(p)))!;
    return canvasPerson(shared, current.figures);
  });
  if (new Set(chain.map(p => p.id)).size !== chain.length || !effects.isCurrent()) return;
  const newFigures = chain.filter(p => !current.figures.some(f => f.id === p.id));
  const links = result.links.map((link, i) => ({ ...link, from: chain[i], to: chain[i + 1] }));
  const woven = weaveConnectionIntoCanvas({ ...current, chain, newFigures, pathKey: connectionPathKey(chain[0].id, chain[chain.length - 1].id) });
  effects.applyWoven(woven);
  saveConnectionPath(storage, chain, links.map(link => link.evidence), Date.now(), links.map(link => link.contact!), [...people.values()]);
  saveWovenFigureIds(storage, woven.newIds);
  effects.pathsChanged();
  effects.show({ chain, links });
  effects.notify(woven.newIds.length
    ? `Added ${plural(woven.newIds.length, 'person', 'people')} to From connections to link ${from.name} and ${to.name}: ${newFigures.map(person => person.name).join(', ')}`
    : `${from.name} and ${to.name} are ${degreeLabel(result.degrees)} apart.`, 'success');
}

// The whole search after the request was accepted: identify a typed name, look for a saved path, search,
// settle. Nothing here throws; a failure to identify the name goes back to the picker, any other to a toast.
export async function runConnectionSearch({ service, storage, figures, from, target, signal, effects, repository, canvasId, session, provenance, mode, wikidata }: {
  service: IAIService; storage: Storage; figures: HistoricalFigure[]; from: HistoricalFigure; target: ConnectionTarget;
  signal: AbortSignal; effects: ConnectionFlowEffects; repository?: ConnectionRepository; canvasId?: string; session?: ConnectionSession; provenance?: { provider: string; model: string }; mode?: 'auto' | 'resume' | 'fresh';
  wikidata?: WikidataResolver;
}): Promise<void> {
  try {
    let to: HistoricalFigure;
    if ('figure' in target) {
      to = target.figure;
      effects.progress({ label: 'Checking for a direct link…' });
    } else {
      effects.progress({ label: `Identifying ${target.name}…` });
      const resolved = await resolveConnectionTarget(service, target.name, from, figures, signal);
      if (!effects.isCurrent()) return;
      if ('message' in resolved) { effects.failPicking(resolved.message); return; }
      to = resolved.figure;
      const saved = readConnectionPath(storage, figures, from.id, to.id);
      if (saved) { effects.show(savedConnectionView(saved)); return; }
    }
    if (repository && mode !== 'fresh' && !session) {
      const knowledge = await repository.loadKnowledge();
      const first = identifyPerson(knowledge.people, figurePerson(from));
      const second = identifyPerson(knowledge.people, figurePerson(to));
      const existing = await repository.loadSession(sessionKey(canvasId ?? 'canvas', first.id, second.id));
      if (!effects.isCurrent()) return;
      if (existing && existing.status !== 'connected') { effects.exploration?.({ ...existing, endpoints: [first.id, second.id], status: 'paused', phase: 'Saved exploration: choose Resume or Start a new search' }); return; }
    }
    const result = await findConnection({
      service, from, to, figures, storage, signal, repository, canvasId, session, provenance, wikidata,
      onSnapshot: next => effects.exploration?.(next),
      onProgress: next => { if (effects.isCurrent()) effects.progress(next); },
    });
    settleConnection({ result, request: { from, to }, storage, effects });
  } catch (error) {
    if (!effects.isCurrent()) return;
    effects.notify(getUserErrorMessage(error, 'We could not connect these two people this time. Please try again.'), 'error');
  }
}
