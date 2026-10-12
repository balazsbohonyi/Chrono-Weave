import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CanvasConfig, ClusterPlacement, DiscoveryClusterState, FigureCategory, HistoricalFigure, IAIService,
} from '../types';
import { classifyConnectionTarget, type ConnectionProgress, type ConnectionTargetStatus } from '../services/connectionPath';
import {
  decideConnectionStart, degreeLabel, retryRequest, runConnectionSearch, savedConnectionView,
  type ConnectionTarget, type ConnectionView,
} from '../services/connectionFlow';
import { listConnectionPaths, type ConnectionPathEntry } from '../utils/connectionPaths';
import type { WovenCanvas } from '../utils/weaveConnection';
import type { ConnectionFocusRequest, ConnectionReveal } from './useConnectionReveal';

export interface ActiveConnection extends ConnectionView {
  id: number;
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

export const connectionHeadline = (connection: ActiveConnection) => {
  const first = connection.chain[0].name, last = connection.chain[connection.chain.length - 1].name;
  return connection.status === 'connected'
    ? `${first} and ${last} are ${degreeLabel(connection.chain.length - 1)} apart.`
    : `No verified chain of personal contacts connects ${first} and ${last} yet.`;
};

// Six Degrees' React state, apart from drawing it. The rules (what a request does, what a finished
// search does to the canvas and the cache) live in services/connectionFlow and are tested there.
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

  const show = useCallback((connection: ConnectionView) => {
    setActive({ ...connection, id: ++nextId.current });
    setReveal(previous => ({ playId: previous.playId + 1, animate: connection.status === 'connected' }));
    setCurrentIndex(null);
    setFocusRequest(null);
    setTabRequest(previous => previous + 1);
    latest.current.openSidebar();
  }, []);

  const start = useCallback(async (from: HistoricalFigure, requested: ConnectionTarget, avoidPairs?: ActiveConnection['avoidPairs']) => {
    const { storage: canvasStorage, service, figures: canvasFigures } = latest.current;
    const typedName = 'name' in requested ? requested.name : '';
    const failPicking = (message: string) => setPicking({ from, error: message, draft: typedName });

    // Refusals and saved paths need no search, so they must not stop anything else that is running.
    const decision = decideConnectionStart(from, requested, canvasFigures, canvasStorage);
    if (decision.kind === 'refuse') { failPicking(decision.message); return; }
    if (decision.kind === 'replay') { setPicking(null); show(savedConnectionView(decision.saved)); return; }
    const target = decision.target;

    latest.current.onSearchStart();
    const action = latest.current.begin();
    const own = new AbortController();
    search.current?.abort();
    search.current = own;
    const signal = AbortSignal.any([action.signal, own.signal]);
    const isCurrent = () => action.isCurrent() && !own.signal.aborted;
    setPicking(null);
    setIsConnecting(true);
    setProgress({ label: 'name' in target ? `Identifying ${target.name}…` : 'Checking for a direct link…', links: [] });
    try {
      await runConnectionSearch({
        service, storage: canvasStorage, figures: canvasFigures, from, target, avoidPairs, signal,
        effects: {
          isCurrent,
          progress: setProgress,
          canvas: () => {
            const { figures, config, clusters, selectedCategories, getPlacements } = latest.current;
            return { figures, config, clusters, selectedCategories, placements: getPlacements() };
          },
          applyWoven: woven => latest.current.applyWoven(woven),
          pathsChanged: () => setPathRevision(previous => previous + 1),
          show,
          failPicking,
          notify: (message, type) => latest.current.notify(message, type),
        },
      });
    } finally {
      if (isCurrent()) {
        search.current = null;
        setIsConnecting(false);
        setProgress(null);
      }
    }
  }, [show]);

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
    const request = retryRequest(active);
    if (request) void start(request.from, request.target, request.avoidPairs);
  }, [active, start]);

  const replay = useCallback((entry: ConnectionPathEntry) => show(savedConnectionView(entry)), [show]);

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
