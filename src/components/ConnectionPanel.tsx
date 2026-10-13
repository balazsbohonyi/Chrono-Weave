import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoricalFigure } from '../types';
import type { ActiveConnection } from '../hooks/useConnection';
import { connectionHeadline } from '../hooks/useConnection';
import type { ConnectionLinkResult } from '../services/connectionPath';
import type { ConnectionPathEntry } from '../utils/connectionPaths';
import { fetchBatchFigureDetails } from '../services/wikiService';
import { prefersReducedMotion } from '../utils/canvasCamera';
import SidebarFigureCard, { type FigureDetail } from './SidebarFigureCard';
import NetworkPortrait from './connectionNetwork/NetworkPortrait';
import { useNetworkPortraits } from '../hooks/useNetworkPortraits';
import type { ContactAssessment, ConnectionSession } from '../services/connectionGraph';

export interface ConnectionPanelProps {
  connection: ActiveConnection | null;
  currentIndex: number | null;
  recent: ConnectionPathEntry[];
  canvasIds: ReadonlySet<string>;
  isBusy: boolean;
  onClose: () => void;
  onReplay: (entry: ConnectionPathEntry) => void;
  onFocusPerson: (figure: HistoricalFigure) => void;
  onExplain: (from: HistoricalFigure, to: HistoricalFigure, contact?: ContactAssessment) => void;
  checkpoints?: ConnectionSession[];
  onOpenCheckpoint?: (session: ConnectionSession) => void;
  // The same hover actions as every other card in the sidebar.
  renderActions: (figure: HistoricalFigure) => React.ReactNode;
}

// Line width of the sidebar thread, as on the canvas at 100% zoom; dashes are proportional, as there.
const THREAD_WIDTH = 3;

const LinkConnector: React.FC<{ link: ConnectionLinkResult; onExplain: ConnectionPanelProps['onExplain'] }> = ({ link, onExplain }) => {
  return (
    <div className="connection-link">
      {/* The same dashed amber thread that joins the cards on the canvas (see ConnectionThread). */}
      <span className="connection-link-thread" aria-hidden="true">
        <svg width={THREAD_WIDTH} height="100%">
          <line className="connection-thread-line" x1={THREAD_WIDTH / 2} x2={THREAD_WIDTH / 2} y1="0" y2="100%"
            strokeWidth={THREAD_WIDTH} strokeDasharray={`${THREAD_WIDTH * 2} ${THREAD_WIDTH * 3.4}`} />
        </svg>
      </span>
      <div className="connection-link-body">
        <p className="connection-link-evidence">{link.evidence}</p>
        <button type="button" className="connection-link-why" onClick={() => onExplain(link.from, link.to, link.contact)}
          aria-label={`Why were ${link.from.name} and ${link.to.name} connected?`}>Why?</button>
      </div>
    </div>
  );
};

// The ends of the connection on show, in the same style as a row of recent connections: the two portraits overlapping,
// who is connected, how many degrees, and a way to dismiss it. The sidebar keeps it above the scrolling list.
export const ConnectionHeader: React.FC<{ connection: ActiveConnection; onClose: () => void }> = ({ connection, onClose }) => {
  const first = connection.chain[0], last = connection.chain[connection.chain.length - 1], degrees = connection.chain.length - 1;
  const portraits = useNetworkPortraits(useMemo(() => [first, last].filter(person => !person.imageUrl).map(person => ({ id: person.id, name: person.name })), [first, last]));
  return (
    <div className="connection-header" data-connection-header>
      <span className="net-pair connection-header-pair">
        {[first, last].map(person => <NetworkPortrait key={person.id} person={person} size={46} url={person.imageUrl ?? portraits.get(person.id)} />)}
      </span>
      <h3 className="connection-headline" aria-live="polite" aria-label={connectionHeadline(connection)}>{first.name} → {last.name}</h3>
      <span className="connection-recent-degrees"><b>{degrees}</b> {degrees === 1 ? 'degree' : 'degrees'}</span>
      <button type="button" className="connection-close" onClick={onClose} aria-label="Hide this connection">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" /></svg>
      </button>
    </div>
  );
};

// The Connection tab: the chain from one person to the other with the verified evidence for every
// link, and the connections already made on this canvas.
const ConnectionPanel: React.FC<ConnectionPanelProps> = ({ connection, currentIndex, recent, canvasIds, isBusy, onClose,
  onReplay, onFocusPerson, onExplain, renderActions, checkpoints = [], onOpenCheckpoint }) => {
  const [details, setDetails] = useState<Map<string, FigureDetail>>(new Map());
  const chainRef = useRef<HTMLOListElement>(null);
  const known = connection?.chain ?? [];
  const chainKey = known.map(person => person.id).join('|');

  useEffect(() => {
    if (!known.length) return;
    let current = true;
    fetchBatchFigureDetails(known).then(result => {
      if (current) setDetails(previous => new Map([...previous, ...result]));
    }).catch(error => console.warn('Could not load connection portraits', error));
    return () => { current = false; };
  }, [chainKey]);

  // Long chains outgrow the sidebar: keep the card the camera is on in view.
  useEffect(() => {
    if (currentIndex === null) return;
    chainRef.current?.children[currentIndex]?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [currentIndex]);

  // Faces for the two ends of every paused exploration and recent connection, by name, once.
  const ends = (session: ConnectionSession) => session.endpoints.flatMap(id => session.people.find(person => person.id === id) ?? []);
  const portraits = useNetworkPortraits(useMemo(() => {
    const subjects = new Map<string, { id: string; name: string }>();
    for (const session of checkpoints) for (const person of ends(session)) subjects.set(person.id, { id: person.id, name: person.name });
    for (const entry of recent) for (const figure of [entry.figures[0], entry.figures[entry.figures.length - 1]]) if (figure && !figure.imageUrl) subjects.set(figure.id, { id: figure.id, name: figure.name });
    return [...subjects.values()];
  }, [checkpoints, recent]));
  const pair = (people: Array<{ id: string; name: string; category: HistoricalFigure['category']; imageUrl?: string }>) =>
    <span className="net-pair">{people.map(person => <NetworkPortrait key={person.id} person={person} size={36} url={person.imageUrl ?? portraits.get(person.id)} />)}</span>;
  const activeEnds = connection ? [connection.chain[0].id, connection.chain[connection.chain.length - 1].id].sort().join('|') : '';
  return (
    <div className="connection-panel" data-connection-panel>
      {connection ? (
        <>
          <ol ref={chainRef} className="connection-chain" aria-label="Chain of personal contacts">
            {connection.chain.map((person, index) => {
              const onCanvas = canvasIds.has(person.id);
              const link = connection.links[index];
              return (
                <li key={person.id} className="connection-chain-item">
                  <SidebarFigureCard figure={person} detail={details.get(person.id)} isActive={currentIndex === index} activeClassName="connection-card-active"
                    onSelect={onCanvas ? () => onFocusPerson(person) : undefined}
                    selectLabel={`Fly to ${person.name} on the canvas`}>
                    {onCanvas && renderActions(person)}
                  </SidebarFigureCard>
                  {link && <LinkConnector link={link} onExplain={onExplain} />}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="connection-empty">
          Choose <strong>Connect to…</strong> on a person to link them to anyone else through documented personal contacts.
        </p>
      )}

      {checkpoints.length > 0 && <section className="connection-recent" aria-label="Paused contact explorations"><h4>Paused explorations</h4><ul>{checkpoints.map(session => <li key={session.key}>
        <button type="button" className="connection-recent-entry" disabled={isBusy} onClick={() => onOpenCheckpoint?.(session)}>
          {pair(ends(session))}
          <span className="connection-recent-names">{ends(session).map(person => person.name).join(' → ')}</span>
          <span className="connection-recent-open">Open exploration</span>
        </button></li>)}</ul></section>}
      {recent.length > 0 && (
        <section className="connection-recent" aria-label="Recent connections">
          <h4>Recent connections</h4>
          <ul>
            {recent.map(entry => {
              const first = entry.figures[0], last = entry.figures[entry.figures.length - 1];
              const isCurrent = [first.id, last.id].sort().join('|') === activeEnds;
              return (
                <li key={entry.key}>
                  <button type="button" className={`connection-recent-entry ${isCurrent ? 'is-current' : ''}`}
                    aria-current={isCurrent || undefined} disabled={isBusy} onClick={() => onReplay(entry)}>
                    {pair([first, last])}
                    <span className="connection-recent-names">{first.name} → {last.name}</span>
                    <span className="connection-recent-degrees"><b>{entry.figures.length - 1}</b> {entry.figures.length - 1 === 1 ? 'degree' : 'degrees'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};

export default ConnectionPanel;
