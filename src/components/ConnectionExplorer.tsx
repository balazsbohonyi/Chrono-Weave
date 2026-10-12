import React, { useEffect, useRef, useState } from 'react';
import type { ConnectionSession, ContactPerson, CandidateContact } from '../services/connectionGraph';
import { useModalFocus } from '../hooks/useModalFocus';
import { pairKey } from '../services/pathService';
import '../styles/connectionExplorer.css';

interface Props { session: ConnectionSession | null; phase?: string; busy: boolean; onStop: () => void; onContinue: () => void; onFresh: () => void; onClose: () => void }
interface Point { x: number; y: number }
export function networkPosition(id: string, index: number): Point {
  // Stable bounded lattice; layout does not constrain the graph or remove cross-links/cycles.
  let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { x: 210 + (index % 5) * 165, y: 90 + Math.floor(index / 5) * 100 + (hash % 3) * 12 };
}
const labels = { proposed: 'Proposed', checking: 'Checking', accepted: 'AI-supported', unresolved: 'Unresolved', blocked: 'Structurally blocked' };

// HERO: two endpoint anchors frame the growing contact network, separate from the timeline.
const ConnectionExplorer: React.FC<Props> = ({ session, phase, busy, onStop, onContinue, onFresh, onClose }) => {
  const dialog = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  useModalFocus(dialog, true, onClose);
  const positions = useRef(new Map<string, Point>());
  const key = useRef('');
  const [selected, setSelected] = useState<{ person?: string; edge?: string }>({});
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [elapsed, setElapsed] = useState(session?.elapsedMs ?? 0);
  const drag = useRef<{ origin: Point; camera: typeof camera; moved: boolean } | null>(null);
  if (session && key.current !== session.key) {
    positions.current.clear(); key.current = session.key;
  }
  if (session) {
    const [first, second] = session.endpoints;
    if (!positions.current.has(first)) positions.current.set(first, { x: 80, y: 360 });
    if (!positions.current.has(second)) positions.current.set(second, { x: 1020, y: 360 });
    for (const person of session.people) if (!positions.current.has(person.id)) positions.current.set(person.id, networkPosition(person.id, positions.current.size - 2));
  }
  useEffect(() => {
    setCamera({ x: 0, y: 0, scale: 1 }); setSelected({});
  }, [session?.key]);
  useEffect(() => {
    setElapsed(session?.elapsedMs ?? 0);
    if (!busy) return;
    const start = Date.now(), previous = session?.elapsedMs ?? 0;
    const timer = setInterval(() => setElapsed(previous + Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [busy, session?.elapsedMs]);
  const zoom = (factor: number, anchor = { x: 550, y: 360 }) => setCamera(c => {
    const scale = Math.max(0.12, Math.min(4, c.scale * factor)), ratio = scale / c.scale;
    return { x: anchor.x - (anchor.x - c.x) * ratio, y: anchor.y - (anchor.y - c.y) * ratio, scale };
  });
  const svgPoint = (event: { clientX: number; clientY: number }): Point => {
    const box = svg.current!.getBoundingClientRect();
    // preserveAspectRatio=none keeps this mapping exact at every responsive size.
    return { x: (event.clientX - box.left) * 1100 / box.width, y: (event.clientY - box.top) * 720 / box.height };
  };
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(-event.deltaY * 0.001), svgPoint(event)); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const fit = () => {
    const points = [...positions.current.values()]; if (!points.length) return;
    const left = Math.min(...points.map(p => p.x)) - 90, right = Math.max(...points.map(p => p.x)) + 90;
    const top = Math.min(...points.map(p => p.y)) - 50, bottom = Math.max(...points.map(p => p.y)) + 50;
    const scale = Math.max(0.12, Math.min(1.4, 1100 / (right - left), 720 / (bottom - top)));
    setCamera({ x: 550 - (left + right) / 2 * scale, y: 360 - (top + bottom) / 2 * scale, scale });
  };
  const person = session?.people.find(p => p.id === selected.person);
  const edge = session?.candidates.find(e => pairKey(e.from, e.to) === selected.edge);
  const name = (id: string) => session?.people.find(p => p.id === id)?.name ?? id;
  const inspectNode = (p: ContactPerson) => <button type="button" onClick={() => setSelected({ person: p.id })}>{p.name}</button>;
  const inspectEdge = (e: CandidateContact) => <button type="button" onClick={() => setSelected({ edge: pairKey(e.from, e.to) })}>{name(e.from)} ↔ {name(e.to)} · {labels[e.status]}</button>;
  return <div className="connection-explorer-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="connection-explorer-title" className="connection-explorer" tabIndex={-1}>
      <header className="connection-explorer-header">
        <div><p className="connection-explorer-kicker">SIX DEGREES · CONTACT EXPLORATION</p><h2 id="connection-explorer-title">{session ? `${name(session.endpoints[0])} → ${name(session.endpoints[1])}` : 'Opening contact exploration'}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close contact exploration">×</button>
      </header>
      <div className="connection-explorer-status" role="status" aria-live="polite">
        <strong>{busy ? session?.phase ?? phase ?? 'Identifying endpoint' : session?.phase ?? 'Paused'}</strong>
        <span>{Math.floor(elapsed / 60000)}m {Math.floor(elapsed / 1000) % 60}s explored{!busy && ' · no background search'}</span>
      </div>
      <div className="connection-explorer-body">
        <section className="connection-explorer-network" aria-label="Explored contact network">
          <div className="connection-explorer-tools"><button type="button" onClick={() => zoom(1.25)} aria-label="Zoom network in">+</button><button type="button" onClick={() => zoom(0.8)} aria-label="Zoom network out">−</button><button type="button" onClick={fit}>Fit network</button><span>Drag to pan · scroll to zoom</span></div>
          <svg ref={svg} viewBox="0 0 1100 720" preserveAspectRatio="none" aria-label="Live contact graph"
            onPointerDown={event => {
              if ((event.target as Element).closest('[role="button"]')) return;
              drag.current = { origin: svgPoint(event), camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={event => {
              if (!drag.current) return; const point = svgPoint(event), d = drag.current; d.moved = true;
              setCamera({ ...d.camera, x: d.camera.x + point.x - d.origin.x, y: d.camera.y + point.y - d.origin.y });
            }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
              {session?.candidates.map(e => {
                const a = positions.current.get(e.from), b = positions.current.get(e.to); if (!a || !b) return null;
                const id = pairKey(e.from, e.to), title = `${name(e.from)} to ${name(e.to)}: ${labels[e.status]}`;
                return <g key={id} role="button" tabIndex={0} aria-label={title} className={`connection-network-edge is-${e.status} ${selected.edge === id ? 'is-selected' : ''}`}
                  onClick={() => setSelected({ edge: id })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ edge: id }); } }}>
                  <title>{title}</title><path className="connection-edge-hit" d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} /><path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 7}>{labels[e.status]}</text>
                </g>;
              })}
              {session?.people.map(p => {
                const point = positions.current.get(p.id)!; const endpoint = session.endpoints.indexOf(p.id);
                const supported = endpoint >= 0 || session.candidates.some(e => e.status === 'accepted' && [e.from, e.to].includes(p.id));
                return <g key={p.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`Inspect ${p.name}${endpoint >= 0 ? `, endpoint ${endpoint === 0 ? 'A' : 'B'}` : supported ? ', AI-supported' : ', proposed'}`}
                  className={`connection-network-node ${endpoint >= 0 ? 'is-endpoint' : ''} ${supported ? 'is-supported' : 'is-proposed'} ${selected.person === p.id ? 'is-selected' : ''}`}
                  onClick={() => setSelected({ person: p.id })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ person: p.id }); } }}>
                  <title>{p.name}</title><circle r={endpoint >= 0 ? 24 : 12} />{endpoint >= 0 && <text className="connection-anchor" textAnchor="middle" y="6">{endpoint === 0 ? 'A' : 'B'}</text>}
                  <text textAnchor="middle" y={endpoint >= 0 ? 48 : 32}>{p.name.length > 24 ? `${p.name.slice(0, 22)}…` : p.name}</text>
                </g>;
              })}
            </g>
          </svg>
          <div className="connection-explorer-key">{Object.entries(labels).map(([status, label]) => <span key={status} className={`is-${status}`}>{label}</span>)}</div>
        </section>
        <aside className="connection-explorer-inspection" aria-label="Network inspection">
          <h3>Inspect the exploration</h3>
          {person ? <><h4>{person.name}</h4>{session!.endpoints.includes(person.id) || session!.candidates.some(e => e.status === 'accepted' && [e.from, e.to].includes(person.id)) ? <><p>{person.birthYear}–{person.deathYear} · {person.occupation}</p><p>Identity used in this AI-supported contact network.</p></> : <p>Proposed person · identity details are tentative.</p>}{person.aliases.length > 0 && <p>Explicit aliases: {person.aliases.join(', ')}</p>}</> : edge ? <><h4>{name(edge.from)} ↔ {name(edge.to)}</h4><p className={`connection-inspection-verdict is-${edge.status}`}>{labels[edge.status]}</p><p>{edge.assessment?.evidence || edge.assessment?.uncertainty || edge.blockedReason || `Unverified proposal: ${edge.claim || 'awaiting assessment'}`}</p>{edge.assessment?.episode && <p>Episode: {edge.assessment.episode}</p>}{edge.assessment && <small>AI assessment · {edge.assessment.provenance.provider} / {edge.assessment.provenance.model} · {new Date(edge.assessment.provenance.assessedAt).toLocaleDateString()}</small>}</> : <p>Select a person or contact to read the stored evidence. Inspection does not make additional AI requests.</p>}
          {session?.error && <p role="alert">{session.error}</p>}
          {session && !session.persistent && <p className="connection-explorer-storage">This exploration is available in this session. Saving across reloads is unavailable.</p>}
          <details className="connection-explorer-list"><summary>People and contacts · readable list</summary><h4>People</h4><ul>{session?.people.map(p => <li key={p.id}>{inspectNode(p)}</li>)}</ul><h4>Contacts</h4><ul>{session?.candidates.map(e => <li key={pairKey(e.from, e.to)}>{inspectEdge(e)}</li>)}</ul></details>
        </aside>
      </div>
      <footer className="connection-explorer-footer"><p>Only accepted contacts can form a chain. Up to 20 intermediate people.</p><div>{busy ? <button type="button" className="connection-explorer-primary" onClick={onStop}>Stop search</button> : session && <><button type="button" className="connection-explorer-primary" onClick={onContinue}>{session.diagnostics.stopReason === 'work-budget' || session.diagnostics.stopReason === 'time-budget' ? 'Continue searching' : 'Resume search'}</button><button type="button" onClick={onFresh}>Start a new search</button></>}<button type="button" onClick={onClose}>Back to canvas</button></div></footer>
    </div>
  </div>;
};
export default ConnectionExplorer;
