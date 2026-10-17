import React, { useState } from 'react';
import { FILTER_ORDER, type NetworkCounts, type NetworkFilters, type UnverifiedFilter } from '../../services/connectionNetworkView';

const LABELS: Record<UnverifiedFilter, string> = { unresolved: 'Unresolved', proposed: 'Proposed / checking', blocked: 'Blocked' };
interface Props {
  filters: NetworkFilters; counts: NetworkCounts; onToggle: (filter: UnverifiedFilter) => void; narrow: boolean;
  // Whether the AI-supported contacts are drawn, so that the others can be looked at alone.
  showAccepted: boolean; onToggleAccepted: () => void;
  // A solved connection: its chain is lime and the other AI-supported contacts are faded neutral, which is what the legend then shows.
  solved: boolean;
  // A lit chain (just found, or a solved connection) can be switched off here.
  chain: boolean; showChain: boolean; onToggleChain: () => void;
}

// The legend is the filter: AI-supported contacts are drawn unless switched off, the other statuses are opt-in.
const NetworkLegend: React.FC<Props> = ({ filters, counts, onToggle, narrow, showAccepted, onToggleAccepted, solved, chain, showChain, onToggleChain }) => {
  const [open, setOpen] = useState(false);
  const active = FILTER_ORDER.filter(filter => filters[filter]).length;
  const chips = <div className="net-legend" role="group" aria-label="Contact filters">
    <button type="button" aria-pressed={showAccepted} className={`net-chip is-accepted ${solved ? 'is-neutral' : ''} ${showAccepted ? 'is-on' : ''}`} onClick={onToggleAccepted}>
      <i aria-hidden="true" />AI-supported <b>{counts.contacts}</b>
    </button>
    {chain && <button type="button" aria-pressed={showChain} className={`net-chip is-chain ${showChain ? 'is-on' : ''}`} onClick={onToggleChain}><i aria-hidden="true" />Connection</button>}
    {FILTER_ORDER.map(filter => <button key={filter} type="button" aria-pressed={filters[filter]} className={`net-chip is-${filter} ${filters[filter] ? 'is-on' : ''}`} onClick={() => onToggle(filter)}>
      <i aria-hidden="true" />{LABELS[filter]} <b>{counts[filter]}</b>
    </button>)}
  </div>;
  if (!narrow) return chips;
  return <div className="net-filters">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Filters{active > 0 ? ` (${active})` : ''}</button>
    {open && <div className="net-filters-popover">{chips}</div>}
  </div>;
};
export default NetworkLegend;
