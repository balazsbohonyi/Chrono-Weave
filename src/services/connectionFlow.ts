import type {
  CanvasConfig, ClusterPlacement, DiscoveryClusterState, FigureCategory, HistoricalFigure, IAIService, PathPersonRef,
} from '../types';
import { readConnectionPath, saveConnectionPath, saveWovenFigureIds, type ConnectionPathEntry } from '../utils/connectionPaths';
import { getUserErrorMessage } from '../utils/userErrors';
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
  status: 'connected' | 'failed';
  reason?: 'no-path' | 'unverified';
  // The chain from the requested start to the requested end. A failed search lists what was proposed.
  chain: HistoricalFigure[];
  links: ConnectionLinkResult[];
  request: { from: HistoricalFigure; to: HistoricalFigure };
  // Pairs a failed search found unverifiable, so "Try again" starts from them.
  avoidPairs?: Array<[PathPersonRef, PathPersonRef]>;
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

export function savedConnectionView(saved: Pick<ConnectionPathEntry, 'figures' | 'evidence'>): ConnectionView {
  const chain = saved.figures;
  return {
    status: 'connected', chain, request: { from: chain[0], to: chain[chain.length - 1] },
    links: chain.slice(1).map((person, index) => ({ from: chain[index], to: person, status: 'verified' as const, evidence: saved.evidence[index] })),
  };
}

// "Try again" is a fresh search for the same pair that starts from the pairs already found unverifiable.
export function retryRequest(view: ConnectionView | null): { from: HistoricalFigure; target: ConnectionTarget; avoidPairs: Array<[PathPersonRef, PathPersonRef]> } | null {
  if (!view || view.status !== 'failed') return null;
  return { from: view.request.from, target: { figure: view.request.to }, avoidPairs: view.avoidPairs ?? [] };
}

export interface CanvasState {
  figures: HistoricalFigure[];
  config: CanvasConfig;
  clusters: DiscoveryClusterState;
  placements: Record<string, ClusterPlacement>;
  selectedCategories: Set<FigureCategory>;
}

export interface ConnectionFlowEffects {
  // False once the search was cancelled or replaced; a stale search changes nothing.
  isCurrent: () => boolean;
  progress: (progress: ConnectionProgress) => void;
  // The canvas as it is when the result arrives, not when the search started.
  canvas: () => CanvasState;
  applyWoven: (woven: WovenCanvas) => void;
  pathsChanged: () => void;
  show: (view: ConnectionView) => void;
  // Back to choosing the other end, with a message and the typed text kept.
  failPicking: (message: string) => void;
  notify: (message: string, type: 'success' | 'info' | 'error') => void;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const degreeLabel = (count: number) => plural(count, 'degree', 'degrees');

// What a finished search does. A stale search does nothing; a failed one only shows what was found;
// a verified one weaves its new people in, then saves the path and the woven-in people.
export function settleConnection({ result, request, storage, effects }: {
  result: ConnectionResult; request: ConnectionView['request']; storage: Storage; effects: ConnectionFlowEffects;
}): void {
  if (!effects.isCurrent()) return;
  const { from, to } = request;
  if (result.status === 'failed') {
    effects.show({ status: 'failed', reason: result.reason, chain: result.chain, links: result.links, request, avoidPairs: result.avoidPairs });
    effects.notify(`We couldn't verify a chain of personal contacts between ${from.name} and ${to.name}.`, 'info');
    return;
  }
  const woven = weaveConnectionIntoCanvas({ ...effects.canvas(), chain: result.chain, newFigures: result.newFigures });
  effects.applyWoven(woven);
  saveConnectionPath(storage, result.chain, result.links.map(link => link.evidence ?? ''));
  saveWovenFigureIds(storage, woven.newIds);
  effects.pathsChanged();
  effects.show({ status: 'connected', chain: result.chain, links: result.links, request });
  effects.notify(woven.newIds.length
    ? `Wove in ${plural(woven.newIds.length, 'person', 'people')} to connect ${from.name} and ${to.name}: ${result.newFigures.map(person => person.name).join(', ')}`
    : `${from.name} and ${to.name} are ${degreeLabel(result.degrees)} apart.`, 'success');
}

// The whole search after the request was accepted: identify a typed name, look for a saved path, search,
// settle. Nothing here throws; a failure to identify the name goes back to the picker, any other to a toast.
export async function runConnectionSearch({ service, storage, figures, from, target, avoidPairs, signal, effects }: {
  service: IAIService; storage: Storage; figures: HistoricalFigure[]; from: HistoricalFigure; target: ConnectionTarget;
  avoidPairs?: Array<[PathPersonRef, PathPersonRef]>; signal: AbortSignal; effects: ConnectionFlowEffects;
}): Promise<void> {
  try {
    let to: HistoricalFigure;
    if ('figure' in target) {
      to = target.figure;
      effects.progress({ label: 'Checking for a direct link…', links: [] });
    } else {
      effects.progress({ label: `Identifying ${target.name}…`, links: [] });
      const resolved = await resolveConnectionTarget(service, target.name, from, figures, signal);
      if (!effects.isCurrent()) return;
      if ('message' in resolved) { effects.failPicking(resolved.message); return; }
      to = resolved.figure;
      const saved = readConnectionPath(storage, figures, from.id, to.id);
      if (saved) { effects.show(savedConnectionView(saved)); return; }
    }
    const result = await findConnection({
      service, from, to, figures, storage, signal, avoidPairs,
      onProgress: next => { if (effects.isCurrent()) effects.progress(next); },
    });
    settleConnection({ result, request: { from, to }, storage, effects });
  } catch (error) {
    if (!effects.isCurrent()) return;
    effects.notify(getUserErrorMessage(error, 'We could not connect these two people this time. Please try again.'), 'error');
  }
}
