import React from 'react';
import type { ConnectionPathEntry } from '../utils/connectionPaths';
import NetworkPortrait from './connectionNetwork/NetworkPortrait';
import Tooltip from './Tooltip';

export const connectionEnds = (entry: ConnectionPathEntry) => [entry.figures[0], entry.figures[entry.figures.length - 1]];
export const connectionLabel = (entry: ConnectionPathEntry) => connectionEnds(entry).map(person => person.name).join(' → ');
const connectionCount = (count: number) => `From ${count} ${count === 1 ? 'connection' : 'connections'}`;

interface Props {
  entries: ConnectionPathEntry[];
  portraits?: ReadonlyMap<string, string>;
  size: number;
  className?: string;
  // On a canvas: a chip that opens the menu of these connections (the canvas finds it by `data-connection-chip`), with a tooltip.
  chip?: boolean;
}

// The two ends of a connection as overlapping portraits, as on the Connection tab's cards: on the card of anyone on a saved
// connection, the newest one, with a "+N" badge after it for the others.
const ConnectionPair: React.FC<Props> = ({ entries, portraits, size, className = '', chip = false }) => {
  if (!entries.length) return null;
  const pair = (
    <span className={`connection-pair ${chip ? 'is-chip' : className}`} aria-label={chip ? connectionCount(entries.length) : undefined}>
      <span className="net-pair">
        {connectionEnds(entries[0]).map(person => <NetworkPortrait key={person.id} person={person} size={size} url={person.imageUrl ?? portraits?.get(person.id)} />)}
      </span>
      {entries.length > 1 && <span className="connection-pair-more">+{entries.length - 1}</span>}
    </span>
  );
  // The tooltip's trigger is an inline wrapper, so a chip is placed by an outer element that carries the class.
  return chip ? <span className={className} data-connection-chip><Tooltip text={connectionCount(entries.length)}>{pair}</Tooltip></span> : pair;
};

export default ConnectionPair;
