import React, { useEffect, useRef } from 'react';
import type { ConnectionProgress as Progress } from '../services/connectionPath';

interface Props {
  progress: Progress;
  onCancel: () => void;
}

// Same glass card and position as ProgressOverlay, with a live list of the links being checked.
// The names are proposals until the check turns them green; the container ignores pointer events so
// the canvas stays free to pan and zoom while a search runs.
const ConnectionProgress: React.FC<Props> = ({ progress, onCancel }) => {
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight });
  }, [progress.links.length]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none animate-in fade-in duration-300">
      <div role="status" aria-live="polite" aria-label="Connecting two people"
        className="bg-surface/60 backdrop-blur-xl px-12 py-8 rounded-2xl shadow-2xl border border-border-glass/40 flex flex-col items-center gap-5 pointer-events-auto min-w-[300px] max-w-[min(560px,calc(100vw-32px))] text-center">
        <div className="w-12 h-12 border-4 border-progress-track border-t-progress-active rounded-full animate-spin" aria-hidden="true" />
        <span className="text-2xl font-bold text-content-primary tracking-tight">{progress.label}</span>
        {progress.links.length > 0 && (
          <div className="w-full text-left">
            <p className="text-sm text-content-secondary font-medium uppercase tracking-wider mb-2">Checking proposed links…</p>
            <ul ref={list} className="connection-progress-list no-scrollbar" aria-label="Proposed links">
              {progress.links.map(link => (
                <li key={link.id} className={`connection-progress-link connection-progress-${link.status}`}>
                  <span className="connection-progress-mark" aria-hidden="true">
                    {link.status === 'checking' && <span className="connection-progress-spinner" />}
                    {link.status === 'verified' && '✓'}
                    {link.status === 'rejected' && '✗'}
                  </span>
                  <span className="connection-progress-names">{link.from} → {link.to}</span>
                  <span className="sr-only">{link.status === 'checking' ? 'checking' : link.status === 'verified' ? 'verified' : 'not verified'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" onClick={onCancel} className="relationship-retry" style={{ marginTop: 0 }}>Cancel</button>
      </div>
    </div>
  );
};

export default ConnectionProgress;
