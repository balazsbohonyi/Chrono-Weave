import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CanvasConfig, ClusterPlacement, DiscoveryClusterState, FigureCategory, HistoricalFigure, IAIService, PathPersonRef,
} from '../types';
import {
  classifyConnectionTarget, findConnection, resolveConnectionTarget,
  type ConnectionLinkResult, type ConnectionProgress, type ConnectionTargetStatus,
} from '../services/connectionPath';
import { listConnectionPaths, readConnectionPath, saveConnectionPath, type ConnectionPathEntry } from '../utils/connectionPaths';
import { weaveConnectionIntoCanvas, type WovenCanvas } from '../utils/weaveConnection';
import { getUserErrorMessage } from '../utils/userErrors';
import type { ConnectionFocusRequest, ConnectionReveal } from './useConnectionReveal';

export interface ActiveConnection {
  id: number;
  status: 'connected' | 'failed';
  reason?: 'no-path' | 'unverified';
  // The chain from the requested start to the requested end. A failed search lists what was proposed.
  chain: HistoricalFigure[];
  links: ConnectionLinkResult[];
  request: { from: HistoricalFigure; to: HistoricalFigure };
  // Pairs a failed search found unverifiable, so "Try again" starts from them.
  avoidPairs?: Array<[PathPersonRef, PathPersonRef]>;
}

export interface PickingState {
  from: HistoricalFigure;
  error: string | null;
  // Text typed before a name that could not be identified.
  draft: string;
}

interface Dependencies {
  figures: HistoricalFigure[];
  config: CanvasConfig;
  clusters: DiscoveryClusterState;
  selectedCategories: Set<FigureCategory>;
  // The cache of the canvas that is open now; each search keeps hold of the one it started with.
  storage: Storage;
  service: IAIService;
  getPlacements: () => Record<string, ClusterPlacement>;
  // Joins the busy/abort rules of mapping and expanding: starting one stops the other.
  begin: () => { signal: AbortSignal; isCurrent: () => boolean };
  applyWoven: (woven: WovenCanvas) => void;
  openSidebar: () => void;
  notify: (message: string, type: 'success' | 'info' | 'error') => void;
  // Stops anything else that is running, and closes dialogs the search would sit behind.
  onSearchStart: () => void;
}

type Target = { figure: HistoricalFigure } | { name: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const degreeLabel = (count: number) => plural(count, 'degree', 'degrees');

export const connectionHeadline = (connection: ActiveConnection) => {
  const first = connection.chain[0].name, last = connection.chain[connection.chain.length - 1].name;
  return connection.status === 'connected'
    ? `${first} and ${last} are ${degreeLabel(connection.chain.length - 1)} apart.`
    : `No verified chain of personal contacts connects ${first} and ${last} yet.`;
};

// All of Six Degrees' state and flow, apart from drawing it: choosing the other end, searching,
// weaving a verified chain into the canvas, and replaying saved ones.
export function useConnection(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const [picking, setPicking] = useState<PickingState | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [progress, setProgress] = useState<ConnectionProgress | null>(null);
  const [active, setActive] = useState<ActiveConnection | null>(null);
  const [reveal, setReveal] = useState({ playId: 0, animate: false });
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<ConnectionFocusRequest | null>(null);
  const [tabRequest, setTabRequest] = useState(0);
  const [pathRevision, setPathRevision] = useState(0);
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const search = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  const { figures, storage } = dependencies;
  const recent = useMemo(() => listConnectionPaths(storage, figures), [storage, figures, pathRevision]);

  const exitPicking = useCallback(() => setPicking(null), []);

  // Stops a running search. Completed assessments stay cached; nothing is woven or saved.
  const cancelSearch = useCallback(() => {
    search.current?.abort(new DOMException('Connection search cancelled.', 'AbortError'));
    search.current = null;
    setIsConnecting(false);
    setProgress(null);
  }, []);

  const reset = useCallback(() => {
    cancelSearch();
    setPicking(null);
    setActive(null);
    setCurrentIndex(null);
    setFocusRequest(null);
  }, [cancelSearch]);

  const show = useCallback((connection: Omit<ActiveConnection, 'id'>) => {
    setActive({ ...connection, id: ++nextId.current });
    setReveal(previous => ({ playId: previous.playId + 1, animate: connection.status === 'connected' }));
    setCurrentIndex(null);
    setFocusRequest(null);
    setTabRequest(previous => previous + 1);
    latest.current.openSidebar();
  }, []);

  const showSaved = useCallback((chain: HistoricalFigure[], evidence: string[]) => {
    show({
      status: 'connected', chain, request: { from: chain[0], to: chain[chain.length - 1] },
      links: chain.slice(1).map((person, index) => ({ from: chain[index], to: person, status: 'verified' as const, evidence: evidence[index] })),
    });
  }, [show]);

  const start = useCallback(async (from: HistoricalFigure, target: Target, avoidPairs?: ActiveConnection['avoidPairs']) => {
    const { storage: canvasStorage, service, figures: canvasFigures } = latest.current;
    const typedName = 'name' in target ? target.name : '';
    const failPicking = (message: string) => setPicking({ from, error: message, draft: typedName });

    if ('figure' in target) {
      const status = classifyConnectionTarget(from, target.figure);
      if ('reason' in status) { failPicking(status.message); return; }
      const saved = readConnectionPath(canvasStorage, canvasFigures, from.id, target.figure.id);
      if (saved) { setPicking(null); showSaved(saved.figures, saved.evidence); return; }
    }

    latest.current.onSearchStart();
    const action = latest.current.begin();
    const own = new AbortController();
    search.current?.abort();
    search.current = own;
    const signal = AbortSignal.any([action.signal, own.signal]);
    const isCurrent = () => action.isCurrent() && !own.signal.aborted;
    setPicking(null);
    setIsConnecting(true);
    setProgress({ label: typedName ? `Identifying ${typedName}…` : 'Checking for a direct link…', links: [] });
    try {
      let to: HistoricalFigure;
      if ('figure' in target) to = target.figure;
      else {
        const resolved = await resolveConnectionTarget(service, typedName, from, canvasFigures, signal);
        if (!isCurrent()) return;
        if ('message' in resolved) { failPicking(resolved.message); return; }
        to = resolved.figure;
        const saved = readConnectionPath(canvasStorage, canvasFigures, from.id, to.id);
        if (saved) { showSaved(saved.figures, saved.evidence); return; }
      }
      const result = await findConnection({
        service, from, to, figures: canvasFigures, storage: canvasStorage, signal, avoidPairs,
        onProgress: next => { if (isCurrent()) setProgress(next); },
      });
      if (!isCurrent()) return;
      const request = { from, to };
      if (result.status === 'failed') {
        show({ status: 'failed', reason: result.reason, chain: result.chain, links: result.links, request, avoidPairs: result.avoidPairs });
        latest.current.notify(`We couldn't verify a chain of personal contacts between ${from.name} and ${to.name}.`, 'info');
        return;
      }
      const now = latest.current;
      const woven = weaveConnectionIntoCanvas({
        figures: now.figures, config: now.config, clusters: now.clusters, placements: now.getPlacements(),
        selectedCategories: now.selectedCategories, chain: result.chain, newFigures: result.newFigures,
      });
      saveConnectionPath(canvasStorage, result.chain, result.links.map(link => link.evidence ?? ''));
      setPathRevision(previous => previous + 1);
      now.applyWoven(woven);
      show({ status: 'connected', chain: result.chain, links: result.links, request });
      now.notify(woven.newIds.length
        ? `Wove in ${plural(woven.newIds.length, 'person', 'people')} to connect ${from.name} and ${to.name}: ${result.newFigures.map(person => person.name).join(', ')}`
        : `${from.name} and ${to.name} are ${degreeLabel(result.degrees)} apart.`, 'success');
    } catch (error) {
      if (!isCurrent()) return;
      latest.current.notify(getUserErrorMessage(error, 'We could not connect these two people this time. Please try again.'), 'error');
    } finally {
      if (isCurrent()) {
        search.current = null;
        setIsConnecting(false);
        setProgress(null);
      }
    }
  }, [show, showSaved]);

  const beginPicking = useCallback((from: HistoricalFigure) => {
    cancelSearch();
    setPicking({ from, error: null, draft: '' });
  }, [cancelSearch]);

  const pickFigure = useCallback((figure: HistoricalFigure) => {
    if (pickingRef.current) void start(pickingRef.current.from, { figure });
  }, [start]);
  const submitName = useCallback((name: string) => {
    if (pickingRef.current) void start(pickingRef.current.from, { name });
  }, [start]);

  const retry = useCallback(() => {
    if (!active || active.status !== 'failed') return;
    void start(active.request.from, { figure: active.request.to }, active.avoidPairs);
  }, [active, start]);

  const replay = useCallback((entry: ConnectionPathEntry) => showSaved(entry.figures, entry.evidence), [showSaved]);

  // The ✕ in the Connection tab hides the thread; saved connections stay listed.
  const close = useCallback(() => {
    setActive(null);
    setCurrentIndex(null);
    setFocusRequest(null);
  }, []);

  const focusPerson = useCallback((figure: HistoricalFigure) => {
    setFocusRequest(previous => ({ requestId: (previous?.requestId ?? 0) + 1, figureId: figure.id }));
  }, []);

  const statusFor = useCallback((figure: HistoricalFigure): ConnectionTargetStatus =>
    picking ? classifyConnectionTarget(picking.from, figure) : { ok: true }, [picking]);
  const isPickable = useCallback((figure: HistoricalFigure) => !('reason' in statusFor(figure)), [statusFor]);

  const canvasConnection: ConnectionReveal | null = useMemo(() => active?.status === 'connected'
    ? { nodeIds: active.chain.map(person => person.id), playId: reveal.playId, animate: reveal.animate } : null,
  [active, reveal]);
  const endReveal = useCallback(() => setReveal(previous => previous.animate ? { ...previous, animate: false } : previous), []);

  return {
    picking, isConnecting, progress, active, recent, currentIndex, tabRequest,
    focusRequest, canvasConnection, isTabVisible: !!active || recent.length > 0,
    isPickable, statusFor,
    beginPicking, exitPicking, pickFigure, submitName, cancelSearch, reset, retry, replay, close, focusPerson,
    endReveal, setCurrentIndex,
  };
}
