import {
  MAX_PATH_INTERMEDIATES, MAX_PATH_REPAIRS, PATH_CATALOG_LIMIT, PATH_CATALOG_PADDING_YEARS, YEARS_PER_DEGREE,
} from '../constants';
import type {
  ConnectionPathProposal, HistoricalFigure, IAIService, NewPerson, PathCatalogEntry, PathPersonRef, RelationshipExplanation,
} from '../types';
import { canonicalName } from '../utils/names';
import { assessRelationships, readPairAssessment, RelationshipAssessmentError } from './relationshipAssessment';
import { isNewPerson } from './pathService';

// Orchestration for Six Degrees. Everything here is pure over a fake service and storage, so the
// search can be tested without a browser: direct check, proposal, verification, local repair.

export interface ConnectionFeasibility {
  feasible: boolean;
  gapYears: number;
  peopleNeeded: number;
  message: string | null;
}

const MAX_GAP_YEARS = MAX_PATH_INTERMEDIATES * YEARS_PER_DEGREE;
const pairKey = (first: Pick<HistoricalFigure, 'id'>, second: Pick<HistoricalFigure, 'id'>) => [first.id, second.id].sort().join('\u0000');
const personRef = ({ id, name }: Pick<HistoricalFigure, 'id' | 'name'>): PathPersonRef => ({ id, name });
const overlaps = (first: Pick<HistoricalFigure, 'birthYear' | 'deathYear'>, second: Pick<HistoricalFigure, 'birthYear' | 'deathYear'>) =>
  first.birthYear <= second.deathYear && second.birthYear <= first.deathYear;

// Living people use the current year as their death year, so they never stretch the gap.
export function checkConnectionFeasibility(first: HistoricalFigure, second: HistoricalFigure,
  currentYear = new Date().getFullYear()): ConnectionFeasibility {
  const [earlier, later] = first.birthYear <= second.birthYear ? [first, second] : [second, first];
  const gapYears = Math.max(0, later.birthYear - Math.min(earlier.deathYear, currentYear));
  const peopleNeeded = Math.ceil(gapYears / YEARS_PER_DEGREE);
  if (gapYears <= MAX_GAP_YEARS) return { feasible: true, gapYears, peopleNeeded, message: null };
  const rounded = gapYears >= 1000 ? Math.round(gapYears / 100) * 100 : Math.round(gapYears / 10) * 10;
  return { feasible: false, gapYears, peopleNeeded,
    message: `${earlier.name} and ${later.name} lived about ${rounded.toLocaleString('en-US')} years apart. A chain of personal contacts would need about ${peopleNeeded} people, more than the limit of ${MAX_PATH_INTERMEDIATES}.` };
}

export type ConnectionTargetStatus = { ok: true } | { ok: false; reason: 'self' | 'event' | 'too-far'; message: string };

// Decides, without any AI call, whether `candidate` can be the other end of a chain from `from`.
export function classifyConnectionTarget(from: HistoricalFigure, candidate: HistoricalFigure,
  currentYear = new Date().getFullYear()): ConnectionTargetStatus {
  if (candidate.id === from.id || canonicalName(candidate.name) === canonicalName(from.name)) {
    return { ok: false, reason: 'self', message: `Choose someone other than ${from.name}.` };
  }
  if (candidate.category === 'EVENTS') return { ok: false, reason: 'event', message: 'Connections link people, not events.' };
  const feasibility = checkConnectionFeasibility(from, candidate, currentYear);
  return feasibility.feasible ? { ok: true } : { ok: false, reason: 'too-far', message: feasibility.message! };
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

export interface ConnectionLinkResult {
  from: HistoricalFigure;
  to: HistoricalFigure;
  status: 'verified' | 'unverified';
  // Verified links only, taken from the relationship verification and never from the model's claim.
  evidence?: string;
}

export interface ConnectionChain {
  chain: HistoricalFigure[];
  links: ConnectionLinkResult[];
}

export type ConnectionResult =
  | ({ status: 'connected'; degrees: number; newFigures: HistoricalFigure[] } & ConnectionChain)
  | ({ status: 'failed'; reason: 'no-path' | 'unverified'; avoidPairs: Array<[PathPersonRef, PathPersonRef]> } & ConnectionChain);

export type ProgressLinkStatus = 'checking' | 'verified' | 'rejected';
export interface ProgressLink { id: string; from: string; to: string; status: ProgressLinkStatus }
export interface ConnectionProgress { label: string; links: ProgressLink[] }

export interface ConnectionSearchOptions {
  service: Pick<IAIService, 'fetchConnectionPath' | 'fetchRelationshipExplanation'>;
  from: HistoricalFigure;
  // May be a person who is not on the canvas yet (a resolved name).
  to: HistoricalFigure;
  figures: HistoricalFigure[];
  storage: Storage;
  signal: AbortSignal;
  // Pairs rejected by an earlier attempt; "Try again" keeps them.
  avoidPairs?: Array<[PathPersonRef, PathPersonRef]>;
  onProgress?: (progress: ConnectionProgress) => void;
}

// Searches for a verified chain of personal contacts. The service only proposes; a link counts
// when, and only when, the existing relationship verification confirms it with evidence.
export async function findConnection(options: ConnectionSearchOptions): Promise<ConnectionResult> {
  const { service, from, to, figures, storage, signal } = options;
  signal.throwIfAborted();

  const canvasIds = new Set(figures.map(figure => figure.id));
  const byId = new Map(figures.map(figure => [figure.id, figure]));
  byId.set(from.id, from);
  byId.set(to.id, to);
  const byName = new Map<string, HistoricalFigure>();
  for (const figure of figures) if (figure.category !== 'EVENTS') byName.set(canonicalName(figure.name), figure);
  byName.set(canonicalName(from.name), from);
  byName.set(canonicalName(to.name), to);

  const avoid = new Map<string, [PathPersonRef, PathPersonRef]>();
  const rejected = new Set<string>();
  for (const [first, second] of options.avoidPairs ?? []) {
    const key = pairKey(first, second);
    avoid.set(key, [first, second]);
    rejected.add(key);
  }
  const evidence = new Map<string, string>();

  const progressLinks: ProgressLink[] = [];
  let label = '';
  const emit = () => options.onProgress?.({ label, links: progressLinks.map(link => ({ ...link })) });
  const setLabel = (text: string) => { label = text; emit(); };

  const verifyLink = async (first: HistoricalFigure, second: HistoricalFigure): Promise<RelationshipExplanation | null> => {
    if (!overlaps(first, second)) return null;
    const cached = readPairAssessment(first, second, storage);
    if (cached) return cached.isRelevant ? cached : null;
    try {
      return (await assessRelationships(service, first, [second], storage, signal)).get(second.id) ?? null;
    } catch (error) {
      signal.throwIfAborted();
      // A model that cannot produce a usable verdict has not verified the link.
      if (error instanceof RelationshipAssessmentError) return null;
      throw error;
    }
  };

  const verify = async (first: HistoricalFigure, second: HistoricalFigure): Promise<boolean> => {
    signal.throwIfAborted();
    const key = pairKey(first, second);
    if (evidence.has(key)) return true;
    if (rejected.has(key)) return false;
    const entry: ProgressLink = { id: key, from: first.name, to: second.name, status: 'checking' };
    progressLinks.push(entry);
    emit();
    const explanation = await verifyLink(first, second);
    signal.throwIfAborted();
    if (explanation?.evidence) {
      evidence.set(key, explanation.evidence);
      entry.status = 'verified';
    } else {
      rejected.add(key);
      avoid.set(key, [personRef(first), personRef(second)]);
      entry.status = 'rejected';
    }
    emit();
    return entry.status === 'verified';
  };

  // Turns a proposal into people. A new name that matches a canvas person becomes that person.
  const materialize = (proposal: ConnectionPathProposal, start: HistoricalFigure, end: HistoricalFigure): HistoricalFigure[] | null => {
    const chain: HistoricalFigure[] = [];
    for (const node of proposal.nodes) {
      let person: HistoricalFigure | undefined;
      if (isNewPerson(node)) {
        person = byName.get(canonicalName(node.name));
        if (!person) {
          person = newPersonToFigure(node);
          byId.set(person.id, person);
          byName.set(canonicalName(person.name), person);
        }
      } else person = byId.get(node.id);
      if (!person || chain.some(existing => existing.id === person!.id)) return null;
      chain.push(person);
    }
    return chain.length >= 2 && chain[0].id === start.id && chain[chain.length - 1].id === end.id ? chain : null;
  };

  const describe = (chain: HistoricalFigure[]): ConnectionLinkResult[] => chain.slice(1).map((person, index) => {
    const proof = evidence.get(pairKey(chain[index], person));
    return { from: chain[index], to: person, status: proof ? 'verified' : 'unverified', ...(proof ? { evidence: proof } : {}) };
  });
  const connected = (chain: HistoricalFigure[]): ConnectionResult => ({
    status: 'connected', chain, links: describe(chain), degrees: chain.length - 1,
    newFigures: chain.filter(person => !canvasIds.has(person.id)),
  });
  const failed = (reason: 'no-path' | 'unverified', chain: HistoricalFigure[]): ConnectionResult => ({
    status: 'failed', reason, chain, links: describe(chain), avoidPairs: [...avoid.values()],
  });

  // People who never lived at the same time cannot have met, so there is nothing to check.
  if (overlaps(from, to)) {
    setLabel('Checking for a direct link…');
    if (await verify(from, to)) return connected([from, to]);
  }

  setLabel('Proposing a path…');
  const proposal = await service.fetchConnectionPath(from, to, {
    catalog: buildPathCatalog(figures, from, to), avoidPairs: [...avoid.values()], maxIntermediates: MAX_PATH_INTERMEDIATES,
  }, signal);
  signal.throwIfAborted();
  let chain = proposal ? materialize(proposal, from, to) : null;
  if (!chain) return failed('no-path', [from, to]);

  setLabel('Verifying each link…');
  for (let index = 0; index < chain.length - 1; index++) await verify(chain[index], chain[index + 1]);

  // Repair one failed link at a time. Verified links stay; each bridge is verified before the next repair.
  const unrepairable = new Set<string>();
  const firstGap = () => chain!.findIndex((person, index) => index < chain!.length - 1
    && !evidence.has(pairKey(person, chain![index + 1])) && !unrepairable.has(pairKey(person, chain![index + 1])));
  let repairs = 0;
  while (repairs < MAX_PATH_REPAIRS) {
    const gap = firstGap();
    if (gap < 0) break;
    const [start, end] = [chain[gap], chain[gap + 1]];
    const budget = MAX_PATH_INTERMEDIATES - (chain.length - 2);
    if (budget < 1) { unrepairable.add(pairKey(start, end)); continue; }
    repairs++;
    setLabel(`Repairing ${start.name} → ${end.name}…`);
    const inChain = new Set(chain.map(person => person.id));
    const bridgeProposal = await service.fetchConnectionPath(start, end, {
      catalog: buildPathCatalog(figures.filter(person => !inChain.has(person.id)), start, end),
      avoidPairs: [...avoid.values()], maxIntermediates: budget,
      exclude: chain.filter(person => person.id !== start.id && person.id !== end.id).map(personRef),
    }, signal);
    signal.throwIfAborted();
    const bridge = bridgeProposal ? materialize(bridgeProposal, start, end) : null;
    if (!bridge || bridge.length < 3 || bridge.slice(1, -1).some(person => inChain.has(person.id))) {
      unrepairable.add(pairKey(start, end));
      continue;
    }
    chain = [...chain.slice(0, gap), ...bridge, ...chain.slice(gap + 2)];
    for (let index = gap; index < gap + bridge.length - 1; index++) await verify(chain[index], chain[index + 1]);
  }

  return chain.every((person, index) => index === chain!.length - 1 || evidence.has(pairKey(person, chain![index + 1])))
    ? connected(chain) : failed('unverified', chain);
}

export type ConnectionTargetResolution = { figure: HistoricalFigure } | { message: string };

// Turns a typed name into the other end of a chain. People already on the canvas need no request;
// anyone else is identified by the model, then checked exactly like a person picked on the canvas.
export async function resolveConnectionTarget(
  service: Pick<IAIService, 'resolveFigure'>, name: string, from: HistoricalFigure, figures: HistoricalFigure[], signal: AbortSignal,
): Promise<ConnectionTargetResolution> {
  signal.throwIfAborted();
  const onCanvas = (candidate: string) => figures.find(figure => canonicalName(figure.name) === canonicalName(candidate));
  const check = (figure: HistoricalFigure): ConnectionTargetResolution => {
    const status = classifyConnectionTarget(from, figure);
    return 'reason' in status ? { message: status.message } : { figure };
  };
  const typed = onCanvas(name);
  if (typed) return check(typed);
  const person = await service.resolveFigure(name, signal);
  signal.throwIfAborted();
  if (!person) return { message: "Couldn't identify that person. Try their full name." };
  // The model may answer with the canonical form of what was typed, which can already be on the canvas.
  return check(onCanvas(person.name) ?? newPersonToFigure(person));
}
