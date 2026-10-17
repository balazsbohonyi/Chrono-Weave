import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoricalFigure } from '../types';
import type { ConnectionTargetStatus } from '../services/connectionPath';
import { formatYear } from '../utils/formatters';
import { canonicalName } from '../utils/names';
import { SixDegreesInfoButton } from './SixDegreesInfo';

interface Props {
  source: HistoricalFigure;
  figures: HistoricalFigure[];
  // The reason the last attempt could not start, shown under the field.
  error: string | null;
  // Text typed before an attempt that did not work out.
  initialDraft: string;
  topOffset: number;
  statusFor: (figure: HistoricalFigure) => ConnectionTargetStatus;
  onPick: (figure: HistoricalFigure) => void;
  onSubmitName: (name: string) => void;
  onCancel: () => void;
  // Opens the explanation of Six Degrees of Separation.
  onOpenInfo?: () => void;
}

const MAX_SUGGESTIONS = 6;

// The banner for choosing the other end of a chain: click a bar, or type a name. Canvas people are
// suggested first; a name that is not on the canvas is identified by the model after Enter.
const ConnectionPicker: React.FC<Props> = ({ source, figures, error, initialDraft, topOffset, statusFor, onPick, onSubmitName, onCancel, onOpenInfo }) => {
  const [draft, setDraft] = useState(initialDraft);
  const [highlight, setHighlight] = useState(-1);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { setLocalError(null); }, [error]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const suggestions = useMemo(() => {
    const query = canonicalName(draft);
    if (!query) return [];
    return figures
      .filter(figure => figure.category !== 'EVENTS' && figure.id !== source.id)
      .map(figure => ({ figure, name: canonicalName(figure.name) }))
      .filter(({ name }) => name.includes(query))
      .sort((a, b) => Number(b.name.startsWith(query)) - Number(a.name.startsWith(query)) || a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS).map(({ figure }) => figure);
  }, [draft, figures, source.id]);

  const choose = (figure: HistoricalFigure) => {
    const status = statusFor(figure);
    if ('reason' in status) { setLocalError(status.message); return; }
    onPick(figure);
  };

  const submit = () => {
    const chosen = suggestions[highlight];
    if (chosen) return choose(chosen);
    const name = draft.trim();
    if (name) onSubmitName(name);
  };

  const message = localError ?? error;
  return (
    <div data-connection-picker className="connection-picker" style={{ top: topOffset }} role="region" aria-label="Choose who to connect">
      <div className="connection-picker-heading">
        <p className="connection-picker-text">
          Connecting from <strong>{source.name}</strong>: pick a person on the canvas or type a name. Esc to cancel.
        </p>
        {onOpenInfo && <SixDegreesInfoButton onOpen={onOpenInfo} plain />}
      </div>
      <div className="connection-picker-row">
        <input ref={input} value={draft} type="text" className="connection-picker-input" placeholder="Type a name"
          aria-label="Name of the person to connect to" aria-invalid={!!message} aria-controls="connection-picker-suggestions"
          autoComplete="off" spellCheck={false} maxLength={200}
          onChange={event => { setDraft(event.target.value); setHighlight(-1); setLocalError(null); }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
            else if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setHighlight(index => (index + 1) % suggestions.length); }
            else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setHighlight(index => (index <= 0 ? suggestions.length : index) - 1); }
          }} />
        <button type="button" className="connection-picker-button" onClick={submit} disabled={!draft.trim() && highlight < 0}>Connect</button>
        <button type="button" className="connection-picker-button connection-picker-cancel" onClick={onCancel}>Cancel</button>
      </div>
      {suggestions.length > 0 && (
        <ul id="connection-picker-suggestions" className="connection-picker-suggestions" role="listbox" aria-label="People on the canvas">
          {suggestions.map((figure, index) => {
            const status = statusFor(figure);
            const unavailable = 'reason' in status;
            return (
              <li key={figure.id} role="option" aria-selected={index === highlight} aria-disabled={unavailable}
                title={unavailable ? status.message : undefined}
                className={`connection-picker-suggestion ${index === highlight ? 'is-highlighted' : ''} ${unavailable ? 'is-unavailable' : ''}`}
                onMouseDown={event => { event.preventDefault(); choose(figure); }}>
                <span>{figure.name}</span>
                <span className="connection-picker-dates">{formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className="connection-picker-error" role="alert">{message}</p>}
    </div>
  );
};

export default ConnectionPicker;
