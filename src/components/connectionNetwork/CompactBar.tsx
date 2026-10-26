import React from 'react';
import type { ContactPerson } from '../../services/connectionGraph';
import { years } from '../../services/connectionNetworkView';
import Tooltip from '../Tooltip';
import ExplorerClock from './ExplorerClock';
import SideCount from './SideCount';
import ToolButton from './ToolButton';
import type { BarPhase } from './barPhase';

export interface BarSide { index: 0 | 1; person: ContactPerson; count: number; otherName: string; url?: string }

interface Props {
  phase: BarPhase;
  busy: boolean;
  elapsedMs: number;
  // The header's phase text: not displayed, only the clock's hover text and the hidden live region.
  statusText: string;
  // Each endpoint with the people gathered on its side; empty until there is a session and a view.
  sides: readonly BarSide[];
  degrees: number | null;
  // The search stopped on its own limit (its button says Continue, otherwise Resume).
  stable: boolean;
  // Why the saved copy of the search is incomplete (shown as a warning icon only when there is one).
  saveWarning?: string;
  clockBudget?: { tasks: number; startedAt?: number };
  waiting?: boolean;
  // The activity caption under the bar: when it is wider than the bar, the bar grows to just past it.
  captionWidth?: number;
  panelOpen: boolean;
  onStop: () => void; onContinue: () => void; onFresh: () => void; onReveal: () => void;
  onTogglePanel: () => void; onRestore: () => void; onClose: () => void;
}

// The full-screen explorer's header and footer in one floating bar: who is being connected and how many people each has gathered, the
// degrees once connected, the clock, the buttons of the footer as icons (or Reveal), and the way out. The glass is the view controls'.
// How much wider than the caption the bar becomes.
const CAPTION_MARGIN = 28;
const CompactBar: React.FC<Props> = ({ phase, busy, elapsedMs, statusText, sides, degrees, stable, saveWarning, clockBudget, waiting, captionWidth = 0, panelOpen, onStop, onContinue, onFresh, onReveal, onTogglePanel, onRestore, onClose }) => {
  const hasSession = phase !== 'opening';
  const clockTip = phase === 'paused' ? `${statusText} · No background search` : waiting ? `${statusText} · Waiting for the rate limit` : statusText;
  return <div className="canvas-view-toolbar ce-bar" role="toolbar" aria-label="Contact exploration controls" style={captionWidth ? { minWidth: captionWidth + CAPTION_MARGIN } as React.CSSProperties : undefined}>
    <span className="sr-only" role="status" aria-live="polite">{statusText}</span>
    {saveWarning && <Tooltip text={saveWarning} multiline>
      <span className="ce-bar-warning" role="img" tabIndex={0} aria-label={saveWarning}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
      </span>
    </Tooltip>}
    {sides.length > 0 && <>
      <div className="ce-bar-sides" role="group" aria-label="People found on each side">
        {sides.map(side => <SideCount key={side.index} {...side} lead={`${side.person.name} · ${years(side.person)} · ${side.person.occupation}`} />)}
      </div>
      <span className="canvas-toolbar-divider" aria-hidden="true" />
    </>}
    {degrees !== null && <span className="ce-degrees" aria-label={`${degrees} ${degrees === 1 ? 'degree' : 'degrees'} of separation`}><b>{degrees}</b> {degrees === 1 ? 'degree' : 'degrees'}</span>}
    <Tooltip text={clockTip}><div className="ce-bar-clock" tabIndex={0}><ExplorerClock busy={busy} elapsedMs={elapsedMs} compact budget={clockBudget} waiting={waiting} /></div></Tooltip>
    {phase === 'searching' && <ToolButton accent tip="Stop search" onClick={onStop}><rect x="6" y="6" width="12" height="12" rx="2" /></ToolButton>}
    {phase === 'paused' && <>
      <ToolButton accent tip={stable ? 'Continue searching' : 'Resume search'} onClick={onContinue}><path d="M7 4.5v15l12-7.5z" /></ToolButton>
      <ToolButton tip="Start a new search" onClick={onFresh}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></ToolButton>
    </>}
    {(phase === 'found' || phase === 'solved') && <ToolButton accent tip="Reveal the connection on the canvas" label="Reveal" onClick={onReveal}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
    </ToolButton>}
    <span className="canvas-toolbar-divider" aria-hidden="true" />
    {hasSession && <ToolButton tip={panelOpen ? 'Hide people and contacts' : 'Show people and contacts'} label="People and contacts" pressed={panelOpen} onClick={onTogglePanel}>
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" />
    </ToolButton>}
    <ToolButton tip="Leave full screen" onClick={onRestore}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></ToolButton>
    <ToolButton tip="Back to canvas" label="Close contact exploration" onClick={onClose}><path d="M6 6l12 12M6 18L18 6" /></ToolButton>
  </div>;
};
export default CompactBar;
