import React, { useEffect, useState } from 'react';

// The explored time ticks every second while a search runs; it is a component of its own so the tick re-renders only the clock,
// not the graph and the panel. `compact` is the full-screen bar's smaller clock (no caption, a smaller glass and digits).
const ExplorerClock: React.FC<{ busy: boolean; elapsedMs: number; compact?: boolean }> = ({ busy, elapsedMs, compact = false }) => {
  const [elapsed, setElapsed] = useState(elapsedMs);
  useEffect(() => {
    setElapsed(elapsedMs);
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(elapsedMs + Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [busy, elapsedMs]);
  const minutes = Math.floor(elapsed / 60000), seconds = Math.floor(elapsed / 1000) % 60;
  return <div className={compact ? 'ce-clock is-compact' : 'ce-clock'}>
    <span className={`ce-working ${busy ? 'is-working' : ''}`} aria-hidden="true">
      <svg className="ce-working-glass" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="10.5" cy="10.5" r="5.8" /><path d="M15 15l5.5 5.5" />
      </svg>
    </span>
    <div className={`ce-timer ${busy ? 'is-running' : ''}`} role="timer" aria-label={`${minutes} minutes ${seconds} seconds explored`}>
      {/* Every character has a cell of its own width, so the digits changing never move the clock. */}
      <span className="ce-timer-value" aria-hidden="true">{`${minutes}:${String(seconds).padStart(2, '0')}`.split('').map((character, index) =>
        <span key={index} className={character === ':' ? 'ce-colon' : 'ce-digit'}>{character}</span>)}</span>
      <span className="ce-timer-caption" aria-hidden="true">explored</span>
    </div>
  </div>;
};
export default ExplorerClock;
