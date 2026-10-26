import React, { useEffect, useState } from 'react';
import { SEARCH_LIMITS } from '../../services/connectionPath';

// The explored time ticks every second while a search runs; it is a component of its own so the tick re-renders only the clock,
// not the graph and the panel. `compact` is the full-screen bar's smaller clock (no caption, a smaller glass and digits).
// `budget` is what this round of the search has used of its limits (requests, and time since the round began); `waiting` is a request held
// back by a rate limit, which the clock says instead of "explored".
const ExplorerClock: React.FC<{ busy: boolean; elapsedMs: number; compact?: boolean; budget?: { tasks: number; startedAt?: number }; waiting?: boolean }> = ({ busy, elapsedMs, compact = false, budget, waiting = false }) => {
  const [elapsed, setElapsed] = useState(elapsedMs);
  useEffect(() => {
    setElapsed(elapsedMs);
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(elapsedMs + Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [busy, elapsedMs]);
  // The round ends at whichever limit comes first. The share is read at each tick of the clock (a request does not wait for the next one).
  const roundMs = busy && budget?.startedAt ? Date.now() - budget.startedAt : 0;
  const used = budget && busy ? Math.min(1, Math.max(budget.tasks / SEARCH_LIMITS.tasks, roundMs / SEARCH_LIMITS.wallMs)) : 0;
  const minutes = Math.floor(elapsed / 60000), seconds = Math.floor(elapsed / 1000) % 60;
  return <div className={`${compact ? 'ce-clock is-compact' : 'ce-clock'}${waiting ? ' is-waiting' : ''}`}>
    <span className={`ce-working ${busy ? 'is-working' : ''}`} aria-hidden="true">
      <svg className="ce-working-glass" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="10.5" cy="10.5" r="5.8" /><path d="M15 15l5.5 5.5" />
      </svg>
    </span>
    <div className={`ce-timer ${busy ? 'is-running' : ''}`} role="timer" aria-label={`${minutes} minutes ${seconds} seconds explored`}>
      {/* Every character has a cell of its own width, so the digits changing never move the clock. */}
      <span className="ce-timer-value" aria-hidden="true">{`${minutes}:${String(seconds).padStart(2, '0')}`.split('').map((character, index) =>
        <span key={index} className={character === ':' ? 'ce-colon' : 'ce-digit'}>{character}</span>)}</span>
      <span className="ce-timer-caption" aria-hidden="true">{waiting ? 'waiting' : 'explored'}</span>
      {used > 0 && <span className="ce-budget" role="progressbar" aria-label="Share of this round's request and time limits used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}
        title={`${budget!.tasks} of ${SEARCH_LIMITS.tasks} requests, ${Math.round(roundMs / 1000)} s of ${SEARCH_LIMITS.wallMs / 1000} s this round`}><i style={{ width: `${used * 100}%` }} /></span>}
    </div>
  </div>;
};
export default ExplorerClock;
