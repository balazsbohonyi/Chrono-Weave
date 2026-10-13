import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionSession, ContactPerson } from '../services/connectionGraph';
import { useModalFocus } from '../hooks/useModalFocus';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNetworkPortraits } from '../hooks/useNetworkPortraits';
import { useNetworkSimulation } from '../hooks/useNetworkSimulation';
import type { LayoutMode } from '../services/connectionNetworkLayout';
import {
  buildNetworkView, NO_FILTERS, portraitSubjects, years, type NetworkFilters, type NetworkSelection, type UnverifiedFilter,
} from '../services/connectionNetworkView';
import NetworkGraph, { type RevealRequest } from './connectionNetwork/NetworkGraph';
import NetworkInspector from './connectionNetwork/NetworkInspector';
import NetworkLegend from './connectionNetwork/NetworkLegend';
import NetworkPortrait from './connectionNetwork/NetworkPortrait';
import { NARROW_QUERY, nodeRadius, REDUCED_MOTION_QUERY } from './connectionNetwork/metrics';
import '../styles/connectionExplorer.css';

interface Props {
  session: ConnectionSession | null; phase?: string; busy: boolean; onStop: () => void; onContinue: () => void; onFresh: () => void; onClose: () => void;
  // A verified chain is lit for a moment before the overlay hands over to the canvas reveal.
  success?: { degrees: number } | null;
}
const NO_SELECTION: NetworkSelection = {};
const midpoint = (person: { birthYear: number; deathYear: number }) => (person.birthYear + person.deathYear) / 2;

// HERO: two endpoint anchors frame the growing contact network, separate from the timeline.
const ConnectionExplorer: React.FC<Props> = ({ session, phase, busy, onStop, onContinue, onFresh, onClose, success = null }) => {
  const dialog = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [selection, setSelection] = useState<NetworkSelection>(NO_SELECTION);
  const [filters, setFilters] = useState<NetworkFilters>(NO_FILTERS);
  const [mode, setMode] = useState<LayoutMode>('time');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [elapsed, setElapsed] = useState(session?.elapsedMs ?? 0);
  const hasSelection = !!selection.person || !!selection.edge;

  const select = useCallback((next: NetworkSelection) => {
    setSelection(next);
    setExpanded(previous => previous.size ? new Set() : previous);
    if (!next.person && !next.edge) setSheetOpen(false);
  }, []);
  // From the inspector: also bring the thing into view when it is off-screen.
  const selectFromPanel = useCallback((next: NetworkSelection) => {
    select(next);
    setReveal(previous => ({ n: (previous?.n ?? 0) + 1, ...next }));
  }, [select]);

  // A different exploration starts clean; the same one keeps its selection, filters and pins across batches.
  const resetKey = session?.key ?? '';
  useEffect(() => { setSelection(NO_SELECTION); setExpanded(new Set()); setPinned(new Set()); setReveal(null); setSheetOpen(false); setQuery(''); }, [resetKey]);

  const view = useMemo(() => session ? buildNetworkView(session, { filters, selection, expanded, pinned, highlightChain: !!success }) : null,
    [session, filters, selection, expanded, pinned, success]);

  const endpoints = useMemo(() => view?.nodes.filter(node => node.endpoint !== null).map(node => node.person) ?? [], [view]);
  const bounds = useMemo<[number, number]>(() => endpoints.length
    ? [Math.min(...endpoints.map(person => person.birthYear)), Math.max(...endpoints.map(person => person.deathYear))] : [1500, 1600], [endpoints]);
  const inputs = useMemo(() => view?.nodes.map(node => ({ id: node.id, year: midpoint(node.person), endpoint: node.endpoint, radius: nodeRadius(node.endpoint !== null, narrow) })) ?? [], [view, narrow]);
  const links = useMemo(() => view?.edges.map(edge => ({ a: edge.from, b: edge.to })) ?? [], [view]);
  const { layout, kick } = useNetworkSimulation({ resetKey, inputs, links, bounds, mode, size, reducedMotion });
  // Everyone the lists show gets a portrait, not only the people currently drawn.
  const portraits = useNetworkPortraits(useMemo(() => view ? portraitSubjects(view) : [], [view]));

  const syncPins = useCallback(() => setPinned(new Set(layout.pinned)), [layout]);
  const unpin = useCallback((id: string) => { layout.unpin(id); kick(); syncPins(); }, [layout, kick, syncPins]);
  const toggleFold = useCallback((hostId: string) => setExpanded(previous => { const next = new Set(previous); if (!next.delete(hostId)) next.add(hostId); return next; }), []);
  const toggleFilter = useCallback((filter: UnverifiedFilter) => setFilters(previous => ({ ...previous, [filter]: !previous[filter] })), []);
  const resize = useCallback((width: number, height: number) => setSize(previous => previous.width === width && previous.height === height ? previous : { width, height }), []);

  const dismissSheet = useCallback(() => { setSheetOpen(false); select(NO_SELECTION); }, [select]);
  // From a person or contact back to the lists. Unlike clearing by tapping the graph, this keeps the sheet open on narrow screens.
  const backToList = useCallback(() => { setSelection(NO_SELECTION); setExpanded(previous => previous.size ? new Set() : previous); setSheetOpen(narrow); }, [narrow]);
  // Esc peels back one layer at a time: lit chain -> skip, selection -> clear, a search -> clear, otherwise close.
  const escape = useRef<() => void>(() => {});
  escape.current = () => {
    if (!success && (hasSelection || sheetOpen)) dismissSheet(); else if (!success && query) setQuery(''); else onClose();
  };
  const onEscape = useCallback(() => escape.current(), []);
  useModalFocus(dialog, true, onEscape);

  // A trackpad pinch arrives as Ctrl+wheel: wherever it lands on the overlay it must not zoom the whole page.
  useEffect(() => {
    const element = dialog.current; if (!element) return;
    const keepPageZoom = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    element.addEventListener('wheel', keepPageZoom, { passive: false });
    return () => element.removeEventListener('wheel', keepPageZoom);
  }, []);

  useEffect(() => {
    setElapsed(session?.elapsedMs ?? 0);
    if (!busy) return;
    const start = Date.now(), previous = session?.elapsedMs ?? 0;
    const timer = setInterval(() => setElapsed(previous + Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [busy, session?.elapsedMs]);

  const name = (id: string) => session?.people.find(p => p.id === id)?.name ?? id;
  const endpointNames: [string, string] = [name(session?.endpoints[0] ?? ''), name(session?.endpoints[1] ?? '')];
  const endpointPerson = (index: 0 | 1) => session?.people.find(p => p.id === session.endpoints[index]);
  const legend = view && <NetworkLegend filters={filters} counts={view.counts} onToggle={toggleFilter} narrow={narrow} />;
  const stable = session?.diagnostics.stopReason === 'work-budget' || session?.diagnostics.stopReason === 'time-budget';
  const minutes = Math.floor(elapsed / 60000), seconds = Math.floor(elapsed / 1000) % 60;

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

  return <div ref={dialog} role="dialog" aria-modal="true" aria-label={session ? `Contact exploration: ${endpointNames[0]} to ${endpointNames[1]}` : 'Opening contact exploration'}
    className="connection-explorer" tabIndex={-1} onClick={success ? onClose : undefined}>
    <button type="button" className="close-button relationship-close" aria-label="Close contact exploration" onClick={onClose}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
    </button>
    <header className="connection-explorer-header">
      <p className="connection-explorer-kicker">Six Degrees · Contact exploration</p>
      <div className="ce-heading">
        <div className="connection-explorer-status" role="status" aria-live="polite">
          <strong>{busy ? session?.phase ?? phase ?? 'Identifying endpoint' : session?.phase ?? 'Paused'}</strong>
          {!busy && !success && <span>No background search</span>}
        </div>
        {session ? <div className="ce-endpoints">{endpoint(0)}<span className="ce-arrow" aria-hidden="true">→</span>{endpoint(1)}</div>
          : <p className="ce-opening">Opening contact exploration</p>}
        <div className={`ce-timer ${busy ? 'is-running' : ''}`} role="timer" aria-label={`${minutes} minutes ${seconds} seconds explored`}>
          <span className="ce-timer-value" aria-hidden="true">{minutes}:{String(seconds).padStart(2, '0')}</span>
          <span className="ce-timer-caption" aria-hidden="true">explored</span>
        </div>
      </div>
    </header>
    <div className="connection-explorer-body">
      <section className="connection-explorer-network" aria-label="Explored contact network">
        {view
          ? <NetworkGraph view={view} endpointNames={endpointNames} nameOf={name} layout={layout} kick={kick} mode={mode} onModeChange={setMode}
            size={size} onSize={resize} selection={selection} onSelect={select} portraits={portraits} narrow={narrow} reducedMotion={reducedMotion}
            success={success} reveal={reveal} onPinsChange={syncPins} onToggleFold={toggleFold} legend={legend} />
          : <div className="net-graph"><p className="net-empty">Preparing the contact network…</p></div>}
      </section>
      <NetworkInspector session={session} view={view} selection={selection} portraits={portraits} pinned={pinned} narrow={narrow}
        open={sheetOpen || hasSelection} onSelect={selectFromPanel} onUnpin={unpin} onDismiss={dismissSheet} onBackToList={backToList} query={query} onQueryChange={setQuery} />
    </div>
    <footer className="connection-explorer-footer">
      <p>{success ? 'Opening the connection on the canvas…' : <>{!narrow && 'Drag or two-finger scroll to pan · wheel or pinch to zoom · drag people to pin · '}Only accepted contacts can form a chain. Up to 20 intermediate people.</>}</p>
      <div>
        {narrow && !success && <button type="button" onClick={() => setSheetOpen(open => !open)} aria-expanded={sheetOpen}>Overview</button>}
        {success ? null : busy ? <button type="button" className="connection-explorer-primary" onClick={onStop}>Stop search</button>
          : session && <><button type="button" className="connection-explorer-primary" onClick={onContinue}>{stable ? 'Continue searching' : 'Resume search'}</button><button type="button" onClick={onFresh}>Start a new search</button></>}
        <button type="button" onClick={onClose}>Back to canvas</button>
      </div>
    </footer>
  </div>;
};
export default ConnectionExplorer;
