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
import MarkdownContent from './MarkdownContent';
import Tooltip from './Tooltip';
import { SixDegreesInfoButton, SixDegreesInfoLink } from './SixDegreesInfo';
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
  // Forgets a connection, and the people it brought in that no other connection needs.
  onDelete?: (entry: ConnectionPathEntry) => void;
  onFocusPerson: (figure: HistoricalFigure) => void;
  onExplain: (from: HistoricalFigure, to: HistoricalFigure, contact?: ContactAssessment) => void;
  checkpoints?: ConnectionSession[];
  onOpenCheckpoint?: (session: ConnectionSession) => void;
  // Reopens the exploration graph of a connection that was already made (its chain lit, with Reveal to play it).
  onOpenExploration?: (entry: ConnectionPathEntry) => void;
  // Opens the explanation of Six Degrees of Separation.
  onOpenInfo?: () => void;
  // The same hover actions as every other card in the sidebar.
  renderActions: (figure: HistoricalFigure) => React.ReactNode;
}

// A bare icon, no chrome: the same on a paused exploration (where the whole card opens it too) and on a finished connection (where only the icon does).
const OpenExplorationButton: React.FC<{ onOpen: () => void; disabled?: boolean }> = ({ onOpen, disabled }) =>
  <Tooltip text="Open exploration">
    <button type="button" className="connection-open-exploration" aria-label="Open exploration" disabled={disabled} onClick={onOpen}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" />
        <path d="M7.2 7l3.6 9M16.8 7l-3.6 9M7.6 6h8.8" />
      </svg>
    </button>
  </Tooltip>;

const DeleteConnectionButton: React.FC<{ onDelete: () => void; disabled?: boolean }> = ({ onDelete, disabled }) =>
  <Tooltip text="Delete connection">
    <button type="button" className="connection-open-exploration" aria-label="Delete connection" disabled={disabled} onClick={onDelete}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
      </svg>
    </button>
  </Tooltip>;

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
        <MarkdownContent className="connection-link-evidence">{link.evidence}</MarkdownContent>
        <button type="button" className="connection-link-why" onClick={() => onExplain(link.from, link.to, link.contact)}
          aria-label={`Why were ${link.from.name} and ${link.to.name} connected?`}>Why?</button>
      </div>
    </div>
  );
};

// The ends of the connection on show, in the same style as a row of recent connections: the two portraits overlapping,
// who is connected, how many degrees, and a way to dismiss it. The sidebar keeps it above the scrolling list.
export const ConnectionHeader: React.FC<{ connection: ActiveConnection; onClose: () => void; onOpenInfo?: () => void }> = ({ connection, onClose, onOpenInfo }) => {
  const first = connection.chain[0], last = connection.chain[connection.chain.length - 1], degrees = connection.chain.length - 1;
  const portraits = useNetworkPortraits(useMemo(() => [first, last].filter(person => !person.imageUrl).map(person => ({ id: person.id, name: person.name })), [first, last]));
  return (
    <div className="connection-header" data-connection-header>
      <span className="net-pair connection-header-pair">
        {[first, last].map(person => <NetworkPortrait key={person.id} person={person} size={46} url={person.imageUrl ?? portraits.get(person.id)} />)}
      </span>
      <h3 className="connection-headline" aria-live="polite" aria-label={connectionHeadline(connection)}>{first.name} → {last.name}</h3>
      <span className="connection-recent-degrees"><b>{degrees}</b> {degrees === 1 ? 'degree' : 'degrees'}</span>
      {onOpenInfo && <SixDegreesInfoButton onOpen={onOpenInfo} plain />}
      <button type="button" className="connection-close" onClick={onClose} aria-label="Hide this connection">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" /></svg>
      </button>
    </div>
  );
};

// The Connection tab: the chain from one person to the other with the verified evidence for every
// link, and the connections already made on this canvas.
const ConnectionPanel: React.FC<ConnectionPanelProps> = ({ connection, currentIndex, recent, canvasIds, isBusy, onClose,
  onReplay, onDelete, onFocusPerson, onExplain, renderActions, checkpoints = [], onOpenCheckpoint, onOpenExploration, onOpenInfo }) => {
  const [details, setDetails] = useState<Map<string, FigureDetail>>(new Map());
  // The connection whose deletion waits for a second click.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const chainRef = useRef<HTMLOListElement>(null);
  const known = connection?.chain ?? [];
  const chainKey = known.map(person => person.id).join('|');

  useEffect(() => {
    if (!known.length) return;
    let current = true;
    const show = (result: Map<string, FigureDetail>) => { if (current) setDetails(previous => new Map([...previous, ...result])); };
    fetchBatchFigureDetails(known, show).then(show).catch(error => console.warn('Could not load connection portraits', error));
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
          {onOpenInfo && <> <SixDegreesInfoLink onOpen={onOpenInfo} /></>}
        </p>
      )}

      {checkpoints.length > 0 && <section className="connection-recent" aria-label="Paused contact explorations"><h4>Paused explorations</h4><ul>{checkpoints.map(session => <li key={session.key}>
        {/* The whole card opens the exploration (the main button's overlay), and so does the icon. */}
        <div className={`connection-recent-entry ${isBusy ? 'is-busy' : ''}`}>
          <button type="button" className="connection-recent-main" disabled={isBusy} onClick={() => onOpenCheckpoint?.(session)}>
            {pair(ends(session))}
            <span className="connection-recent-names">{ends(session).map(person => person.name).join(' → ')}</span>
          </button>
          <OpenExplorationButton disabled={isBusy} onOpen={() => onOpenCheckpoint?.(session)} />
        </div></li>)}</ul></section>}
      {recent.length > 0 && (
        <section className="connection-recent" aria-label="Recent connections">
          <h4>Recent connections</h4>
          <ul>
            {/* `recent` is newest first and the sort is stable, so connections of the same degree stay in recency order. Which ones are kept is still decided by recency. */}
            {[...recent].sort((a, b) => b.figures.length - a.figures.length).map(entry => {
              const first = entry.figures[0], last = entry.figures[entry.figures.length - 1];
              const isCurrent = [first.id, last.id].sort().join('|') === activeEnds;
              return (
                <li key={entry.key}>
                  {/* The card plays the connection; the icon opens the exploration it came from. */}
                  <div className={`connection-recent-entry ${isCurrent ? 'is-current' : ''} ${isBusy ? 'is-busy' : ''}`}>
                    <button type="button" className="connection-recent-main" aria-current={isCurrent || undefined} disabled={isBusy} onClick={() => onReplay(entry)}>
                      {pair([first, last])}
                      <span className="connection-recent-names">{first.name} → {last.name}</span>
                    </button>
                    {onOpenExploration && <OpenExplorationButton disabled={isBusy} onOpen={() => onOpenExploration(entry)} />}
                    {onDelete && <DeleteConnectionButton disabled={isBusy} onDelete={() => setConfirmingDelete(entry.key)} />}
                    <span className="connection-recent-degrees"><b>{entry.figures.length - 1}</b> {entry.figures.length - 1 === 1 ? 'degree' : 'degrees'}</span>
                  </div>
                  {onDelete && confirmingDelete === entry.key && (
                    <div className="connection-delete-confirm" role="group" aria-label={`Delete ${first.name} → ${last.name}`}>
                      <span>Delete this connection? People only it added leave the canvas.</span>
                      <button type="button" className="connection-delete-yes" disabled={isBusy} onClick={() => { setConfirmingDelete(null); onDelete(entry); }}>Delete</button>
                      <button type="button" className="connection-delete-no" onClick={() => setConfirmingDelete(null)}>Cancel</button>
                    </div>
                  )}
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
