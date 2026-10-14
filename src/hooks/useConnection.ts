import { canvasPerson, type ConnectionSession } from '../services/connectionGraph';
import { connectionRepository, type ConnectionRepository } from '../utils/connectionKnowledge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CanvasConfig, ClusterPlacement, DiscoveryClusterState, FigureCategory, HistoricalFigure, IAIService,
} from '../types';
import { classifyConnectionTarget, type ConnectionProgress, type ConnectionTargetStatus } from '../services/connectionPath';
import {
  decideConnectionStart, degreeLabel, runConnectionSearch, savedConnectionView,
  type ConnectionTarget, type ConnectionView,
} from '../services/connectionFlow';
import { listConnectionPaths, type ConnectionPathEntry } from '../utils/connectionPaths';
import type { WovenCanvas } from '../utils/weaveConnection';
import type { ConnectionFocusRequest, ConnectionReveal } from './useConnectionReveal';
import { createSuccessHold } from '../services/connectionSuccessHold';

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
  canvasId: string;
  repository?: ConnectionRepository;
  provenance: { provider: string; model: string };
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
  // Slides the sidebar away (a no-op when it is already closed).
  hideSidebar: () => void;
  notify: (message: string, type: 'success' | 'info' | 'error') => void;
  // Stops anything else that is running, and closes dialogs the search would sit behind.
  onSearchStart: () => void;
}

// How long the first person is on the stage before the sidebar slides away: the stage has faded in and the camera
// is resting on them (the opening dwell lasts a couple of seconds), so the sidebar leaves while nothing else moves.
const SIDEBAR_HIDE_DELAY_MS = 900;

export const connectionHeadline =(connection: ActiveConnection) => {
  const first = connection.chain[0].name, last = connection.chain[connection.chain.length - 1].name;
  return `${first} and ${last} are ${degreeLabel(connection.chain.length - 1)} apart.`;
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
  const generation = useRef(0);
  const [exploration, setExploration] = useState<ConnectionSession | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<ConnectionSession[]>([]);
  const [checkpointRevision, setCheckpointRevision] = useState(0);
  const explorerInvoker = useRef<HTMLElement | null>(null);
  // A verified chain stays lit in the explorer until the user presses Reveal.
  const hold = useRef(createSuccessHold());
  const [success, setSuccess] = useState<{ degrees: number } | null>(null);
  const repository = dependencies.repository ?? connectionRepository();
  useEffect(() => {
    let current = true;
    repository.listSessions(dependencies.canvasId).then(sessions => { if (current) setCheckpoints(sessions); });
    return () => { current = false; };
  }, [repository, dependencies.canvasId, checkpointRevision]);

  const { figures, storage } = dependencies;
  const recent = useMemo(() => listConnectionPaths(storage, figures), [storage, figures, pathRevision]);

  const exitPicking = useCallback(() => setPicking(null), []);

  // Stops a running search. Completed assessments stay cached; nothing is woven or saved.
  const cancelSearch = useCallback(() => {
    hold.current.abandon();
    setSuccess(null);
    search.current?.abort(new DOMException('Connection search cancelled.', 'AbortError'));
    search.current = null;
    setIsConnecting(false);
    setProgress(null);
    setExplorerOpen(false);
    requestAnimationFrame(() => {
      const invoker = explorerInvoker.current;
      if (!document.querySelector('[aria-modal="true"]') && invoker?.isConnected && !invoker.closest('[inert]')) invoker.focus({ preventScroll: true });
    });
  }, []);

  // The stage and the sidebar say the same thing, so the sidebar does not stay open while the connection plays: it
  // loads the cards, and slides away once the first person has been on the stage for a moment.
  const sidebarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSidebarHide = useCallback(() => { if (sidebarTimer.current) clearTimeout(sidebarTimer.current); sidebarTimer.current = null; }, []);

  const reset = useCallback(() => {
    generation.current++;
    cancelSearch();
    cancelSidebarHide();
    setExploration(null);
    setPicking(null);
    setActive(null);
    setCurrentIndex(null);
    setFocusRequest(null);
  }, [cancelSearch, cancelSidebarHide]);

  const show = useCallback((connection: ConnectionView) => {
    setActive({ ...connection, id: ++nextId.current });
    setReveal(previous => ({ playId: previous.playId + 1, animate: true }));
    setCurrentIndex(null);
    setFocusRequest(null);
    setTabRequest(previous => previous + 1);
    cancelSidebarHide();
    sidebarTimer.current = setTimeout(() => { sidebarTimer.current = null; latest.current.hideSidebar(); }, SIDEBAR_HIDE_DELAY_MS);
  }, [cancelSidebarHide]);

  const start = useCallback(async (from: HistoricalFigure, requested: ConnectionTarget, session?: ConnectionSession, mode: 'auto' | 'resume' | 'fresh' = 'auto') => {
    const { storage: canvasStorage, service, figures: canvasFigures } = latest.current;
    const typedName = 'name' in requested ? requested.name : '';
    const failPicking = (message: string) => { setExplorerOpen(false); setPicking({ from, error: message, draft: typedName }); };

    // Refusals and saved paths need no search, so they must not stop anything else that is running.
    const decision = decideConnectionStart(from, requested, canvasFigures, canvasStorage);
    if (decision.kind === 'refuse') { failPicking(decision.message); return; }
    if (decision.kind === 'replay') { setPicking(null); show(savedConnectionView(decision.saved)); return; }
    const target = decision.target;
    const requestGeneration = ++generation.current;
    const canvasId = latest.current.canvasId;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!invoker?.closest('.connection-explorer, [data-connection-picker]')) explorerInvoker.current = invoker;

    latest.current.onSearchStart();
    hold.current.abandon();
    setSuccess(null);
    const action = latest.current.begin();
    const own = new AbortController();
    search.current?.abort();
    search.current = own;
    const signal = AbortSignal.any([action.signal, own.signal]);
    const isCurrent = () => action.isCurrent() && !own.signal.aborted;
    let hasSession = false;
    setPicking(null);
    setIsConnecting(true);
    setExplorerOpen(true);
    if (!session) setExploration(null);
    setProgress({ label: 'name' in target ? `Identifying ${target.name}…` : 'Checking for a direct link…' });
    try {
      await runConnectionSearch({
        service, storage: canvasStorage, figures: canvasFigures, from, target, signal, repository, canvasId, session, mode, provenance: latest.current.provenance,
        effects: {
          isCurrent,
          progress: setProgress,
          exploration: next => {
            hasSession = true;
            if (generation.current === requestGeneration && latest.current.canvasId === canvasId) setExploration(next);
          },
          canvas: () => {
            const { figures, config, clusters, selectedCategories, getPlacements } = latest.current;
            return { figures, config, clusters, selectedCategories, placements: getPlacements() };
          },
          applyWoven: woven => latest.current.applyWoven(woven),
          pathsChanged: () => setPathRevision(previous => previous + 1),
          show: view => {
            // Settlement has already run. With a live exploration on screen, only the hand-over waits, until the user reveals it.
            if (!hasSession) { setExplorerOpen(false); show(view); return; }
            setSuccess({ degrees: view.chain.length - 1 });
            hold.current.begin(() => { setSuccess(null); setExplorerOpen(false); show(view); });
          },
          failPicking,
          notify: (message, type) => latest.current.notify(message, type),
        },
      });
    } finally {
      if (generation.current === requestGeneration) {
        search.current = null;
        setIsConnecting(false);
        setProgress(null);
        setCheckpointRevision(previous => previous + 1);
        if (!hasSession && own.signal.reason?.message === 'Search stopped.') {
          setExplorerOpen(false); setPicking({ from, error: null, draft: typedName });
        }
      }
    }
  }, [show, repository]);

  // Provider/canvas changes and reload never issue model requests automatically.
  useEffect(() => { cancelSearch(); }, [dependencies.canvasId, dependencies.service, cancelSearch]);
  useEffect(() => {
    const stop = () => search.current?.abort(new DOMException('Page closed.', 'AbortError'));
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); hold.current.abandon(); cancelSidebarHide(); };
  }, [cancelSidebarHide]);
  const stop = useCallback(() => { search.current?.abort(new DOMException('Search stopped.', 'AbortError')); }, []);
  const continueSearch = useCallback((fresh = false) => {
    if (!exploration || search.current) return;
    const [from, to] = exploration.endpoints.map(id => canvasPerson(exploration.people.find(p => p.id === id)!, latest.current.figures));
    void start(from, { figure: to }, fresh ? undefined : exploration, fresh ? 'fresh' : 'resume');
  }, [exploration, start]);
  // Plays a lit chain on the canvas. Closing the explorer instead leaves without playing it: the connection is
  // already saved and stays in the Connection tab to replay.
  const revealConnection = useCallback(() => { hold.current.reveal(); }, []);
  const openCheckpoint = useCallback((session: ConnectionSession) => {
    explorerInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelSearch(); setExploration(session); setExplorerOpen(true);
  }, [cancelSearch]);

  const beginPicking = useCallback((from: HistoricalFigure) => {
    explorerInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelSearch();
    setPicking({ from, error: null, draft: '' });
  }, [cancelSearch]);

  const pickFigure = useCallback((figure: HistoricalFigure) => {
    if (pickingRef.current) void start(pickingRef.current.from, { figure });
  }, [start]);
  const submitName = useCallback((name: string) => {
    if (pickingRef.current) void start(pickingRef.current.from, { name });
  }, [start]);

  const replay = useCallback((entry: ConnectionPathEntry) => show(savedConnectionView(entry)), [show]);
  // Plays the connection on show again from the start, as a fresh show: the stage opens anew on the first person.
  const replayActive = useCallback(() => { if (active) show({ chain: active.chain, links: active.links }); }, [active, show]);

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

  const canvasConnection: ConnectionReveal | null = useMemo(() => active
    ? { nodeIds: active.chain.map(person => person.id), playId: reveal.playId, animate: reveal.animate } : null,
  [active, reveal]);
  const endReveal = useCallback(() => setReveal(previous => previous.animate ? { ...previous, animate: false } : previous), []);

  return {
    picking, isConnecting, progress, active, recent, currentIndex, tabRequest, exploration, explorerOpen, success, revealConnection, checkpoints, stop, continueSearch, openCheckpoint,
    focusRequest, canvasConnection, isTabVisible: !!active || recent.length > 0 || checkpoints.length > 0,
    isPickable, statusFor,
    beginPicking, exitPicking, pickFigure, submitName, cancelSearch, reset, replay, replayActive, close, focusPerson,
    endReveal, setCurrentIndex,
  };
}
