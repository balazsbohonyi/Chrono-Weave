import React, { useState } from 'react';
import { FILTER_ORDER, type NetworkCounts, type NetworkFilters, type UnverifiedFilter } from '../../services/connectionNetworkView';

const LABELS: Record<UnverifiedFilter, string> = { unresolved: 'Unresolved', proposed: 'Proposed / checking', blocked: 'Blocked' };
interface Props { filters: NetworkFilters; counts: NetworkCounts; onToggle: (filter: UnverifiedFilter) => void; narrow: boolean }

// The legend is the filter: AI-supported contacts are always drawn, the other statuses are opt-in.
const NetworkLegend: React.FC<Props> = ({ filters, counts, onToggle, narrow }) => {
  const [open, setOpen] = useState(false);
  const active = FILTER_ORDER.filter(filter => filters[filter]).length;
  const chips = <div className="net-legend" role="group" aria-label="Contact filters">
    <span className="net-chip is-fixed is-accepted"><i aria-hidden="true" />AI-supported <b>{counts.contacts}</b></span>
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
