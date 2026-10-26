import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionSession, ContactPerson } from '../services/connectionGraph';
import { useModalFocus } from '../hooks/useModalFocus';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNetworkPortraits } from '../hooks/useNetworkPortraits';
import { useNetworkSimulation } from '../hooks/useNetworkSimulation';
import type { LayoutMode } from '../services/connectionNetworkLayout';
import { readNetworkViewPrefs, saveNetworkViewPrefs } from '../utils/networkViewPrefs';
import {
  buildNetworkView, corridorSpine, inspectedPeople, NO_FILTERS, portraitSubjects, years, type NetworkFilters, type NetworkSelection, type UnverifiedFilter,
} from '../services/connectionNetworkView';
import NetworkGraph, { type RevealRequest } from './connectionNetwork/NetworkGraph';
import NetworkInspector from './connectionNetwork/NetworkInspector';
import { pushStep, type DetailMemory, type Step } from './connectionNetwork/selectionHistory';
import NetworkLegend from './connectionNetwork/NetworkLegend';
import NetworkPortrait from './connectionNetwork/NetworkPortrait';
import ExplorerClock from './connectionNetwork/ExplorerClock';
import { GRAPH_PERF_EXTENDED_ANIMATIONS } from './connectionNetwork/performance';
import SideCount from './connectionNetwork/SideCount';
import CompactBar, { type BarSide } from './connectionNetwork/CompactBar';
import { barPhase, phaseText } from './connectionNetwork/barPhase';
import { escapeStep } from './connectionNetwork/escapeLadder';
import { createPortal } from 'react-dom';
import LayoutInfoDialog from './LayoutInfo';
import Tooltip from './Tooltip';
import { SixDegreesInfoButton } from './SixDegreesInfo';
import { FLOATING_PANEL_INSET, foldBadgeReach, NARROW_QUERY, nodeRadius, REDUCED_MOTION_QUERY } from './connectionNetwork/metrics';
import '../styles/connectionExplorer.css';

interface Props {
  session: ConnectionSession | null; phase?: string; busy: boolean; onStop: () => void; onContinue: () => void; onFresh: () => void; onClose: () => void;
  // A verified chain stays lit, and the graph stays explorable, until the user presses Reveal to play it on the canvas.
  success?: { degrees: number } | null;
  // The people of the connection when a finished one is reopened, in order: that chain is the one lit (instead of the shortest accepted route).
  chain?: readonly string[] | null;
  // Set when a connection that was already made is reopened to explore: the degrees take the arrow's place between the endpoints, the chain is lime
  // in the graph (nothing else changes), Reveal takes the place of the phase text in the header, and the search buttons are gone.
  solved?: { degrees: number } | null;
  onReveal?: () => void;
  // Opens the explanation of Six Degrees of Separation. While it is open the overlay stands back: it is inert and its Escape is the dialog's.
  onOpenInfo?: () => void;
  suspended?: boolean;
  // The extended search animations (see `GRAPH_PERF_EXTENDED_ANIMATIONS`); the switch's value unless a test says otherwise.
  extendedAnimations?: boolean;
}
const NO_SELECTION: NetworkSelection = {};
const SAVE_ISSUE_TEXT = {
  failed: 'The latest progress of this search could not be saved. Reopening it later may show an older copy, with less time and fewer people.',
  trimmed: 'This search is larger than a saved copy can hold in full. The saved copy keeps the endpoints, the accepted network, and as many of the other contacts as fit; the least useful unverified ones are left out.',
};
const midpoint = (person: { birthYear: number; deathYear: number }) => (person.birthYear + person.deathYear) / 2;
const NO_REVEAL = () => {};

// The card over the graph that says why a search stopped: a dialog-style notice with the way on (resume) and a way to put it aside.
export const SearchFailureNotice: React.FC<{ message: string; onResume: () => void; onDismiss: () => void }> = ({ message, onResume, onDismiss }) =>
  <div className="net-alert-wrap">
    <div className="net-alert" role="alert">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
      </svg>
      <div className="net-alert-text"><strong>Search interrupted</strong><p>{message}</p>
        <div className="net-alert-actions">
          <button type="button" className="connection-explorer-primary" onClick={onResume}>Resume search</button>
          <button type="button" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  </div>;

// HERO: two endpoint anchors frame the growing contact network, separate from the timeline.
const ConnectionExplorer: React.FC<Props> = ({ session, phase, busy, onStop, onContinue, onFresh, onClose, success = null, chain = null, solved = null, onReveal = NO_REVEAL, onOpenInfo, suspended = false, extendedAnimations = GRAPH_PERF_EXTENDED_ANIMATIONS }) => {
  const dialog = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [selection, setSelection] = useState<NetworkSelection>(NO_SELECTION);
  const [filters, setFilters] = useState<NetworkFilters>(NO_FILTERS);
  const [captionWidth, setCaptionWidth] = useState(0);
  const [showAccepted, setShowAccepted] = useState(true);
  // The lit chain of a found or solved connection; switching it off shows the graph as an ordinary exploration.
  const [showChain, setShowChain] = useState(true);
  const [mode, setMode] = useState<LayoutMode>(() => readNetworkViewPrefs().mode);
  useEffect(() => saveNetworkViewPrefs({ mode }), [mode]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [size, setSize] = useState({ width: 900, height: 600 });
  // Whether the drawing has reported its real size yet; the layout waits for it.
  const [measured, setMeasured] = useState(false);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Maximized is real full screen: the graph fills the viewport, the header and footer become a floating bar and the inspection panel floats over
  // the graph, shown while `panelOpen`. Narrow screens already give the graph all the room (the panel is a bottom sheet there).
  // The choice is remembered, not what shows: a narrow screen never maximizes, but must not forget the choice made on a wide one.
  const [maximizedChoice, setMaximized] = useState(() => readNetworkViewPrefs().maximized);
  useEffect(() => saveNetworkViewPrefs({ maximized: maximizedChoice }), [maximizedChoice]);
  const maximized = maximizedChoice && !narrow;
  const hasSelection = !!selection.person || !!selection.edge;
  // Whether the floating panel is shown in full screen. Selecting opens it, Esc, its × and a click on empty graph space close it; hiding it
  // leaves the selection as it is (the highlight stays), and the bar's icon brings it back, on the lists when nothing is selected.
  const [panelOpen, setPanelOpen] = useState(false);
  // The explanation of the current layout, a dialog of its own above the explorer (which is inert meanwhile, like under the Six Degrees one).
  const [layoutInfoOpen, setLayoutInfoOpen] = useState(false);
  const openLayoutInfo = useCallback(() => setLayoutInfoOpen(true), []);
  const closeLayoutInfo = useCallback(() => setLayoutInfoOpen(false), []);

  // The steps the inspector's Back returns through: what was selected before a contact was opened from a person's list. Selecting on the
  // graph (or clearing) starts over; `restored` tells the inspector that Back returned to a person, so their lists come back as left.
  const [history, setHistory] = useState<readonly Step[]>([]);
  const [restored, setRestored] = useState<{ n: number; person?: string; detail?: DetailMemory } | null>(null);
  const apply = useCallback((next: NetworkSelection) => {
    setSelection(next);
    setExpanded(previous => previous.size ? new Set() : previous);
    if (!next.person && !next.edge) setSheetOpen(false);
  }, []);
  const select = useCallback((next: NetworkSelection) => {
    setHistory(previous => previous.length ? [] : previous); setRestored(null); apply(next);
    setPanelOpen(!!next.person || !!next.edge);
  }, [apply]);
  // From the inspector: also bring the thing into view when it is off-screen, and remember where it was opened from.
  const selectFromPanel = useCallback((next: NetworkSelection, detail?: DetailMemory) => {
    if (selection.person || selection.edge) setHistory(previous => pushStep(previous, { selection, detail }));
    setRestored(null);
    apply(next);
    setPanelOpen(true);
    setReveal(previous => ({ n: (previous?.n ?? 0) + 1, ...next }));
  }, [apply, selection]);

  // A different exploration starts clean; the same one keeps its selection, filters and pins across batches.
  const resetKey = session?.key ?? '';
  useEffect(() => { setSelection(NO_SELECTION); setExpanded(new Set()); setPinned(new Set()); setReveal(null); setSheetOpen(false); setQuery(''); setHistory([]); setRestored(null); setShowChain(true); setPanelOpen(false); }, [resetKey]);

  const view = useMemo(() => session ? buildNetworkView(session, { filters, showAccepted, showChain, selection, expanded, pinned, highlightChain: !!success && showChain, chain: chain ?? undefined }) : null,
    [session, filters, showAccepted, showChain, selection, expanded, pinned, success, chain]);

  const endpoints = useMemo(() => view?.nodes.filter(node => node.endpoint !== null).map(node => node.person) ?? [], [view]);
  const bounds = useMemo<[number, number]>(() => endpoints.length
    ? [Math.min(...endpoints.map(person => person.birthYear)), Math.max(...endpoints.map(person => person.deathYear))] : [1500, 1600], [endpoints]);
  const inputs = useMemo(() => {
    const spine = new Map((view ? corridorSpine(view) : []).map((id, index) => [id, index]));
    const folded = new Set(view?.folds.map(fold => fold.hostId));
    return view?.nodes.map(node => {
      const radius = nodeRadius(node.endpoint !== null, narrow);
      return {
        id: node.id, year: midpoint(node.person), reach: (node.person.deathYear - node.person.birthYear) / 2, endpoint: node.endpoint, radius, clearance: folded.has(node.id) ? foldBadgeReach(radius) : 0,
        side: node.side, distance: node.distance, parent: node.parent, category: node.person.category, spine: spine.get(node.id) ?? null,
      };
    }) ?? [];
  }, [view, narrow]);
  const links = useMemo(() => view?.edges.map(edge => ({ a: edge.from, b: edge.to })) ?? [], [view]);
  const { layout, kick } = useNetworkSimulation({ resetKey, inputs, links, bounds, mode, size, ready: measured, reducedMotion });
  // Everyone the lists show gets a portrait, not only the people currently drawn.
  // The people the inspector shows, drawn or not, are offered too (only those with a confirmed Wikidata item get a face: see `portraitSubjects`).
  const portraits = useNetworkPortraits(useMemo(() => view && session ? portraitSubjects(view, inspectedPeople(session, selection)) : [],
    [view, session, selection.person, selection.edge]));

  const syncPins = useCallback(() => setPinned(new Set(layout.pinned)), [layout]);
  // Entering the cluster or columns layout lets go of pins that held only a height; the pin list follows.
  useEffect(() => { if (layout.pinned.size !== pinned.size) syncPins(); }, [mode, layout, pinned, syncPins]);
  const unpin = useCallback((id: string) => { layout.unpin(id); kick(); syncPins(); }, [layout, kick, syncPins]);
  const toggleFold = useCallback((hostId: string) => setExpanded(previous => { const next = new Set(previous); if (!next.delete(hostId)) next.add(hostId); return next; }), []);
  const toggleFilter = useCallback((filter: UnverifiedFilter) => setFilters(previous => ({ ...previous, [filter]: !previous[filter] })), []);
  const resize = useCallback((width: number, height: number) => {
    setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    setMeasured(true);
  }, []);

  const dismissSheet = useCallback(() => { setSheetOpen(false); select(NO_SELECTION); }, [select]);
  // From a person or contact back to the lists. Unlike clearing by tapping the graph, this keeps the sheet open on narrow screens.
  // One step back: to the person a contact was opened from (selected again, as it was left), otherwise to the main lists.
  const back = useCallback(() => {
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setExpanded(known => known.size ? new Set() : known);
    if (!previous) { setSelection(NO_SELECTION); setRestored(null); setSheetOpen(narrow); return; }
    setSelection(previous.selection);
    setRestored(known => ({ n: (known?.n ?? 0) + 1, person: previous.selection.person, detail: previous.detail }));
    setReveal(known => ({ n: (known?.n ?? 0) + 1, ...previous.selection }));
  }, [history, narrow]);
  // Hiding the floating panel keeps its selection. Focus inside it moves to the dialog first, so it is not dropped when the panel goes.
  const hidePanel = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.connection-explorer-inspection')) dialog.current?.focus({ preventScroll: true });
    setPanelOpen(false);
  }, []);
  const togglePanel = useCallback(() => setPanelOpen(on => !on), []);
  // Esc peels back one layer at a time (see `escapeStep`): in full screen the panel, then the full screen; otherwise a contact -> its person -> the lists,
  // a search -> clear, otherwise close.
  const escape = useRef<() => void>(() => {});
  escape.current = () => {
    switch (escapeStep({ maximized, panelOpen, hasSelection, sheetOpen, hasQuery: !!query })) {
      case 'hide-panel': hidePanel(); break;
      case 'restore': setMaximized(false); break;
      case 'back': back(); break;
      case 'dismiss-sheet': dismissSheet(); break;
      case 'clear-query': setQuery(''); break;
      case 'close': onClose();
    }
  };
  const toggleMaximized = useCallback(() => setMaximized(on => !on), []);
  const restore = useCallback(() => setMaximized(false), []);
  // Entering full screen carries a selection over as an open panel, so its detail stays on screen. The control that was pressed goes away
  // with the change (the bare maximize icon, the bar's Leave full screen): focus then moves to the dialog instead of being dropped on the page.
  const hasSelectionNow = useRef(hasSelection);
  hasSelectionNow.current = hasSelection;
  const wasMaximized = useRef(maximized);
  useEffect(() => {
    if (maximized) setPanelOpen(hasSelectionNow.current);
    if (wasMaximized.current !== maximized && (!document.activeElement || document.activeElement === document.body)) dialog.current?.focus({ preventScroll: true });
    wasMaximized.current = maximized;
  }, [maximized]);
  const onEscape = useCallback(() => escape.current(), []);
  // Opening straight into a remembered full screen, focus starts on the dialog itself: its first control is the bar's first portrait or clock, and
  // focus there would open its tooltip before anyone pointed at it. (Kept for the life of the overlay: the hook must not restart when full screen is toggled.)
  const initialFocus = useRef<'container' | 'first-control'>(maximized ? 'container' : 'first-control').current;
  useModalFocus(dialog, true, onEscape, undefined, initialFocus);

  // A trackpad pinch arrives as Ctrl+wheel: wherever it lands on the overlay it must not zoom the whole page.
  useEffect(() => {
    const element = dialog.current; if (!element) return;
    const keepPageZoom = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    element.addEventListener('wheel', keepPageZoom, { passive: false });
    return () => element.removeEventListener('wheel', keepPageZoom);
  }, []);

  // Names are looked up for every line of the graph, so by id rather than by searching the people.
  const peopleById = useMemo(() => new Map(session?.people.map(person => [person.id, person])), [session?.people]);
  const name = useCallback((id: string) => peopleById.get(id)?.name ?? id, [peopleById]);
  const endpointIds = session?.endpoints ?? ['', ''];
  const endpointNames = useMemo<[string, string]>(() => [name(endpointIds[0]), name(endpointIds[1])], [name, endpointIds[0], endpointIds[1]]);
  const endpointPerson = (index: 0 | 1) => peopleById.get(endpointIds[index]);
  const toggleAccepted = useCallback(() => setShowAccepted(on => !on), []);
  const toggleChain = useCallback(() => setShowChain(on => !on), []);
  const legend = useMemo(() => view && <NetworkLegend filters={filters} counts={view.counts} onToggle={toggleFilter} narrow={narrow} showAccepted={showAccepted} onToggleAccepted={toggleAccepted} solved={!!solved && showChain}
    chain={!!(success || solved) && !!view.chain} showChain={showChain} onToggleChain={toggleChain} />,
    [view, filters, toggleFilter, narrow, showAccepted, toggleAccepted, solved, success, showChain, toggleChain]);
  const statusText = phaseText(busy, session?.phase, phase);
  const stopReason = session?.diagnostics.stopReason;
  const stable = stopReason === 'work-budget' || stopReason === 'time-budget';
  // A search that stopped on its own limit invites the person to carry on, instead of leaving them to find the footer button.
  // Why the search stopped, when it failed (the AI service's limit, a lost connection): over the graph, where it cannot be missed whether
  // or not the inspector is showing, until it is dismissed or the search carries on. A dismissal belongs to one run of the search (its segment): a new run that fails the same way shows it again.
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const failureKey = session?.error ? `${session.segment}:${session.error}` : null;
  // Only a failure that happened while this overlay was open is announced: reopening a pair whose last search failed shows no banner (the
  // header says the search stopped), and it comes up when the search is resumed and fails again.
  const [ranHere, setRanHere] = useState(busy);
  useEffect(() => { if (busy) setRanHere(true); }, [busy]);
  const failure = !busy && !success && !solved && ranHere && session?.error && failureKey !== dismissedError ? session.error : null;
  const resume = useMemo(() => !busy && !success && !solved && session && stable && !session.error ? { onResume: onContinue, reason: stopReason === 'time-budget' ? 'time' as const : 'work' as const } : null,
    [busy, success, solved, !!session, stable, session?.error, onContinue, stopReason]);

  const clockBudget = useMemo(() => session ? { tasks: session.diagnostics.tasks, startedAt: session.runStartedAt } : undefined, [session?.diagnostics.tasks, session?.runStartedAt]);

  const endpoint = (index: 0 | 1) => {
    const person: ContactPerson | undefined = endpointPerson(index);
    return <div className={`ce-endpoint is-${index === 0 ? 'a' : 'b'}`}>
      <span className="ce-endpoint-portrait">
        {person ? <NetworkPortrait person={person} size={56} url={portraits.get(person.id)} /> : <span className="net-portrait ce-endpoint-empty" style={{ width: 56, height: 56 }} />}
        <b className="net-end-badge" aria-hidden="true">{index === 0 ? 'A' : 'B'}</b>
      </span>
      <span className="ce-endpoint-text"><span className="ce-endpoint-name">{endpointNames[index] || '…'}</span>
        {person && <small>{years(person)} · {person.occupation}</small>}</span>
    </div>;
  };

  // How many people each endpoint has gathered (the endpoints themselves not counted), with the endpoint's portrait: in the footer, or in the full-screen bar.
  const sides: BarSide[] = [];
  if (view) for (const index of [0, 1] as const) {
    const person = endpointPerson(index);
    if (person) sides.push({ index, person, count: index === 0 ? view.sides.a : view.sides.b, otherName: endpointNames[index === 0 ? 1 : 0], url: portraits.get(person.id) });
  }

  return <>
  <div ref={dialog} role="dialog" aria-modal="true" aria-label={session ? `Contact exploration: ${endpointNames[0]} to ${endpointNames[1]}` : 'Opening contact exploration'}
    className={maximized ? 'connection-explorer is-fullscreen' : 'connection-explorer'} tabIndex={-1} inert={suspended || layoutInfoOpen}>
    {!maximized && <button type="button" className="close-button relationship-close" aria-label="Close contact exploration" onClick={onClose}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
    </button>}
    {!maximized && <header className="connection-explorer-header">
      <div className="connection-explorer-kicker-row">
        <p className="connection-explorer-kicker">Six Degrees of Separation · Contact exploration</p>
        {onOpenInfo && <SixDegreesInfoButton onOpen={onOpenInfo} plain />}
      </div>
      <div className="ce-heading">
        <div className="connection-explorer-status" role="status" aria-live="polite">
          {solved
            ? <button type="button" className="net-reveal net-reveal-header" onClick={onReveal}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>Reveal</button>
            : success ? <strong className="sr-only">{statusText}</strong> : <strong>{statusText}</strong>}
          {!busy && !success && !solved && <span>No background search</span>}
          {session?.saveIssue && <Tooltip text={SAVE_ISSUE_TEXT[session.saveIssue]} multiline>
            <span className="ce-save-warning" role="status" tabIndex={0} aria-label={SAVE_ISSUE_TEXT[session.saveIssue]}>
              {session.saveIssue === 'failed' ? 'Latest progress not saved' : 'Saved copy is trimmed'}</span>
          </Tooltip>}
        </div>
        {session ? <div className="ce-endpoints">{endpoint(0)}{solved || success
          ? <span className="ce-degrees" aria-label={`${(solved ?? success)!.degrees} ${(solved ?? success)!.degrees === 1 ? 'degree' : 'degrees'} of separation`}><b>{(solved ?? success)!.degrees}</b> {(solved ?? success)!.degrees === 1 ? 'degree' : 'degrees'}</span>
          : <span className="ce-arrow" aria-hidden="true">→</span>}{endpoint(1)}</div>
          : <p className="ce-opening">Opening contact exploration</p>}
        <ExplorerClock busy={busy} elapsedMs={session?.elapsedMs ?? 0} budget={clockBudget} waiting={!!session?.activity?.waitUntil} />
      </div>
    </header>}
    <div className={['connection-explorer-body', maximized && 'is-maximized', maximized && panelOpen && 'has-panel'].filter(Boolean).join(' ')}>
      <section className="connection-explorer-network" aria-label="Explored contact network">
        {/* Before the graph, whose people and lines are all tab stops: the bar is the first thing Tab reaches, and where the dialog's focus starts. */}
        {maximized && <CompactBar phase={barPhase({ hasSession: !!session, busy, success: !!success, solved: !!solved })} busy={busy} elapsedMs={session?.elapsedMs ?? 0} statusText={statusText}
          sides={sides} degrees={solved?.degrees ?? success?.degrees ?? null} stable={stable} saveWarning={session?.saveIssue ? SAVE_ISSUE_TEXT[session.saveIssue] : undefined}
          clockBudget={clockBudget} waiting={!!session?.activity?.waitUntil} captionWidth={captionWidth} panelOpen={panelOpen} onStop={onStop} onContinue={onContinue} onFresh={onFresh} onReveal={onReveal} onTogglePanel={togglePanel} onRestore={restore} onClose={onClose} />}
        {view
          ? <NetworkGraph view={view} endpointNames={endpointNames} nameOf={name} layout={layout} kick={kick} pinned={pinned} mode={mode} onModeChange={setMode}
            size={size} onSize={resize} selection={selection} onSelect={select} portraits={portraits} narrow={narrow} reducedMotion={reducedMotion}
            success={success} solved={solved} showChain={showChain} onReveal={onReveal} resume={resume} reveal={reveal} onPinsChange={syncPins} onToggleFold={toggleFold} legend={legend}
            maximized={maximized} onToggleMaximize={narrow ? undefined : toggleMaximized} inset={maximized && panelOpen ? FLOATING_PANEL_INSET : 0} onOpenLayoutInfo={openLayoutInfo} extendedAnimations={extendedAnimations} onCaptionWidth={setCaptionWidth} />
          : <div className="net-graph"><p className="net-empty">Preparing the contact network…</p></div>}
        {failure && <SearchFailureNotice message={failure} onResume={onContinue} onDismiss={() => setDismissedError(failureKey)} />}
      </section>
      <NetworkInspector session={session} view={view} selection={selection} portraits={portraits} pinned={pinned} narrow={narrow}
        open={maximized ? panelOpen : sheetOpen || hasSelection} floating={maximized} onHide={hidePanel}
        onSelect={selectFromPanel} onUnpin={unpin} onDismiss={dismissSheet} onBack={back} history={history} restored={restored} query={query} onQueryChange={setQuery} />
    </div>
    {!maximized && <footer className="connection-explorer-footer">
      <div className="ce-footer-info" role="group" aria-label="People found on each side">{view && session && sides.map(side => <SideCount key={side.index} {...side} />)}</div>
      <p>{!narrow && 'Drag or two-finger scroll to pan · wheel or pinch to zoom · drag people to pin · '}Only accepted contacts can form a chain. Up to 20 intermediate people.</p>
      <div>
        {narrow && <button type="button" onClick={() => setSheetOpen(open => !open)} aria-expanded={sheetOpen}>Overview</button>}
        {success || solved ? null : busy ? <button type="button" className="connection-explorer-primary" onClick={onStop}>Stop search</button>
          : session && <><button type="button" className="connection-explorer-primary" onClick={onContinue}>{stable ? 'Continue searching' : 'Resume search'}</button><button type="button" onClick={onFresh}>Start a new search</button></>}
        <button type="button" onClick={onClose}>Back to canvas</button>
      </div>
    </footer>}
  </div>
  {layoutInfoOpen && createPortal(<LayoutInfoDialog mode={mode} onClose={closeLayoutInfo} />, document.body)}
  </>;
};
export default ConnectionExplorer;
