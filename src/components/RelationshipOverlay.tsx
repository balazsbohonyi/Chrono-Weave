import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HistoricalFigure } from '../types';
import { relationshipRows } from '../utils/relationshipRows';
import ProgressOverlay from './ProgressOverlay';
import { fetchBatchFigureDetails } from '../services/wikiService';
import { formatYear } from '../utils/formatters';
import { useModalFocus } from '../hooks/useModalFocus';

export interface RelationshipOverlayState {
  sourceFigure: HistoricalFigure;
  relatedIds: string[];
  status: 'loading' | 'results' | 'empty' | 'error';
  action: 'map' | 'expand';
  message?: string;
  requestId: number;
}

interface Props {
  state: RelationshipOverlayState;
  figures: HistoricalFigure[];
  detailOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  onInspect: (figure: HistoricalFigure) => void;
  onRelationship: (figure: HistoricalFigure) => void;
}

const RelationshipOverlay: React.FC<Props> = ({ state, figures, detailOpen, onClose, onRetry, onInspect, onRelationship }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const lastCard = useRef<HTMLButtonElement | null>(null);
  const [portraits, setPortraits] = useState(new Map<string, string>());
  const [columns, setColumns] = useState(3);
  const [animation, setAnimation] = useState<'pending' | 'running' | 'done'>('pending');
  const related = useMemo(() => {
    const ids = new Set(state.relatedIds);
    return figures.filter(figure => ids.has(figure.id) && figure.id !== state.sourceFigure.id).sort((a, b) => a.name.localeCompare(b.name));
  }, [figures, state.relatedIds, state.sourceFigure.id]);
  const source = figures.find(figure => figure.id === state.sourceFigure.id) ?? state.sourceFigure;
  const allCards = useMemo(() => [source, ...related], [source, related]);
  useModalFocus(dialogRef, !detailOpen, onClose);

  useEffect(() => {
    if (detailOpen || !lastCard.current) return;
    let current = true;
    queueMicrotask(() => { if (current) lastCard.current?.focus({ preventScroll: true }); });
    return () => { current = false; };
  }, [detailOpen]);

  useEffect(() => {
    let current = true;
    fetchBatchFigureDetails(allCards).then(details => {
      if (!current) return;
      setPortraits(new Map([...details].flatMap(([id, detail]) => detail.imageUrl ? [[id, detail.imageUrl] as const] : [])));
    }).catch(error => console.warn('Could not load relationship portraits', error));
    return () => { current = false; };
  }, [allCards]);

  useLayoutEffect(() => {
    const diagram = diagramRef.current;
    if (!diagram) return;
    const measure = () => {
      const bounds = diagram.getBoundingClientRect();
      setColumns(bounds.width < 600 ? 1 : bounds.width < 900 ? 2 : bounds.width < 1280 || related.length < 7 ? 3 : 4);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(diagram);
    measure();
    return () => observer.disconnect();
  }, [related.length]);

  useLayoutEffect(() => {
    if (!related.length) return;
    if (animation === 'pending' && !detailOpen) {
      setAnimation(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'done' : 'running');
    } else if (animation === 'running' && detailOpen) {
      setAnimation('done');
    }
  }, [related.length, detailOpen, animation]);

  useEffect(() => {
    if (animation !== 'running') return;
    const timer = setTimeout(() => setAnimation('done'), 200 + Math.max(0, related.length - 1) * 70);
    return () => clearTimeout(timer);
  }, [animation, related.length]);

  const rows = relationshipRows(related, columns);
  const appearance = (index: number): React.CSSProperties => ({
    opacity: animation === 'pending' ? 0 : undefined,
    animation: animation === 'running' ? `relationship-appear 200ms ease-out ${index * 70}ms both` : undefined,
  });
  const renderCard = (figure: HistoricalFigure, isSource: boolean, index = 0) => {
    const imageUrl = figure.imageUrl || portraits.get(figure.id);
    return (
      <button
        key={figure.id}
        className={`relationship-card ${isSource ? 'relationship-source' : ''}`}
        aria-label={isSource ? `Read biography of ${figure.name}` : `Relationship between ${source.name} and ${figure.name}`}
        style={isSource ? undefined : appearance(index)}
        onClick={event => {
          lastCard.current = event.currentTarget;
          const withPortrait = imageUrl ? { ...figure, imageUrl } : figure;
          if (isSource) onInspect(withPortrait); else onRelationship(withPortrait);
        }}
      >
        <div className="relationship-card-text">
          <h2>{figure.name}</h2>
          <p className="relationship-dates">{formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}</p>
          <p className="relationship-occupation">{figure.occupation}</p>
        </div>
        {imageUrl && <img src={imageUrl} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
      </button>
    );
  };

  return (
    <div className="relationship-overlay" style={{ visibility: detailOpen ? 'hidden' : 'visible' }} aria-hidden={detailOpen} inert={detailOpen}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Relationship diagram" tabIndex={-1} className="relationship-dialog">
        <button className="relationship-close" aria-label="Close relationship diagram" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
        </button>
        <div className="relationship-scroll no-scrollbar">
          <div className="relationship-heading">
            <p>{state.action === 'expand' ? 'Expand Timeline' : 'Map Relationships'}</p>
            <h1>Connections through history</h1>
          </div>
          <div ref={diagramRef} className="relationship-diagram relationship-top" style={{ '--relationship-columns': columns } as React.CSSProperties}>
            {renderCard(source, true)}
            <div className="relationship-rows">
              {rows.map((row, rowIndex) => (
                <div className="relationship-row" key={rowIndex}>
                  {row.map(figure => renderCard(figure, false, related.indexOf(figure)))}
                </div>
              ))}
            </div>
          </div>
          {state.status === 'loading' && <ProgressOverlay title={state.action === 'expand' ? 'EXPANDING THE TIMELINE' : 'MAPPING RELATIONSHIPS'} subtitle={state.message || `Finding connections for ${source.name}`} />}
          <div className="relationship-status" role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite">
            {state.status === 'loading' && <p>{state.message || 'Assessing historical connections...'}</p>}
            {(state.status === 'empty' || state.status === 'error') && <p>{state.message}</p>}
            {state.status === 'error' && <button className="relationship-retry" onClick={onRetry}>Retry</button>}
            {state.status === 'results' && <p>{related.length} verified {related.length === 1 ? 'connection' : 'connections'} · Select a card to read more</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RelationshipOverlay;
