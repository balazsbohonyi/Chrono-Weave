import React, { useEffect, useRef, useState } from 'react';
import type { HistoricalFigure } from '../types';
import type { ActiveConnection } from '../hooks/useConnection';
import { connectionHeadline } from '../hooks/useConnection';
import type { ConnectionLinkResult } from '../services/connectionPath';
import type { ConnectionPathEntry } from '../utils/connectionPaths';
import { fetchBatchFigureDetails } from '../services/wikiService';
import { prefersReducedMotion } from '../utils/canvasCamera';
import SidebarFigureCard, { type FigureDetail } from './SidebarFigureCard';

export interface ConnectionPanelProps {
  connection: ActiveConnection | null;
  currentIndex: number | null;
  recent: ConnectionPathEntry[];
  canvasIds: ReadonlySet<string>;
  isBusy: boolean;
  onClose: () => void;
  onRetry: () => void;
  onReplay: (entry: ConnectionPathEntry) => void;
  onFocusPerson: (figure: HistoricalFigure) => void;
  onExplain: (from: HistoricalFigure, to: HistoricalFigure) => void;
  // The same hover actions as every other card in the sidebar.
  renderActions: (figure: HistoricalFigure) => React.ReactNode;
}

// A failed search lists proposals: people who are not on the canvas are only ever names, so nothing is
// fetched or shown as fact about them.
export const isProposedPerson = (connection: ActiveConnection | null, canvasIds: ReadonlySet<string>, person: HistoricalFigure) =>
  connection?.status === 'failed' && !canvasIds.has(person.id);

const degrees = (count: number) => `${count} ${count === 1 ? 'degree' : 'degrees'}`;

const LinkConnector: React.FC<{ link: ConnectionLinkResult; onExplain: ConnectionPanelProps['onExplain'] }> = ({ link, onExplain }) => {
  const verified = link.status === 'verified' && !!link.evidence;
  return (
    <div className={`connection-link ${verified ? 'is-verified' : 'is-gap'}`}>
      <span className="connection-link-thread" aria-hidden="true" />
      <div className="connection-link-body">
        {verified ? (
          <>
            <p className="connection-link-evidence">{link.evidence}</p>
            <button type="button" className="connection-link-why" onClick={() => onExplain(link.from, link.to)}
              aria-label={`Why were ${link.from.name} and ${link.to.name} connected?`}>Why?</button>
          </>
        ) : (
          <p className="connection-link-gap">Couldn't find a verified link between {link.from.name} and {link.to.name}</p>
        )}
      </div>
    </div>
  );
};

// A person a failed search proposed who is not on the canvas. Only the name is shown, as a proposal: no
// description, dates, portrait, or actions, because nothing about them has been checked.
const ProposedPerson: React.FC<{ name: string }> = ({ name }) => (
  <div className="connection-proposed">
    <span className="connection-proposed-name">{name}</span>
    <span className="connection-proposed-tag">Proposed, not verified</span>
  </div>
);

// The Connection tab: the chain from one person to the other with the verified evidence for every
// link, and the connections already made on this canvas.
const ConnectionPanel: React.FC<ConnectionPanelProps> = ({ connection, currentIndex, recent, canvasIds, isBusy, onClose, onRetry,
  onReplay, onFocusPerson, onExplain, renderActions }) => {
  const [details, setDetails] = useState<Map<string, FigureDetail>>(new Map());
  const chainRef = useRef<HTMLOListElement>(null);
  const isProposed = (person: HistoricalFigure) => isProposedPerson(connection, canvasIds, person);
  const known = connection?.chain.filter(person => !isProposed(person)) ?? [];
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

  const activeEnds = connection ? [connection.chain[0].id, connection.chain[connection.chain.length - 1].id].sort().join('|') : '';
  return (
    <div className="connection-panel" data-connection-panel>
      {connection ? (
        <>
          <div className="connection-header">
            <h3 className="connection-headline" aria-live="polite">{connectionHeadline(connection)}</h3>
            <button type="button" className="connection-close" onClick={onClose} aria-label="Hide this connection">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" /></svg>
            </button>
          </div>
          {connection.status === 'failed' && (
            <div className="connection-failed">
              <p>
                {connection.reason === 'no-path'
                  ? 'No chain of documented personal contacts was found. Nothing was added to your canvas.'
                  : 'Some proposed links could not be verified, so they are marked below. Nothing was added to your canvas.'}
              </p>
              <button type="button" className="connection-retry" onClick={onRetry} disabled={isBusy}>Try again</button>
            </div>
          )}
          <ol ref={chainRef} className="connection-chain" aria-label="Chain of personal contacts">
            {connection.chain.map((person, index) => {
              const onCanvas = canvasIds.has(person.id);
              const link = connection.links[index];
              return (
                <li key={person.id} className="connection-chain-item">
                  {isProposed(person) ? <ProposedPerson name={person.name} /> : (
                    <SidebarFigureCard figure={person} detail={details.get(person.id)} isActive={currentIndex === index}
                      onSelect={onCanvas ? () => onFocusPerson(person) : undefined}
                      selectLabel={`Fly to ${person.name} on the canvas`}>
                      {onCanvas && renderActions(person)}
                    </SidebarFigureCard>
                  )}
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
                    <span className="connection-recent-names">{first.name} → {last.name}</span>
                    <span className="connection-recent-degrees">{degrees(entry.figures.length - 1)}</span>
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
