import React from 'react';
import type { HistoricalFigure } from '../types';
import { formatYear } from '../utils/formatters';

export interface FigureDetail {
  description: string;
  imageUrl: string | null;
}

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  figure: HistoricalFigure;
  detail?: FigureDetail;
  // A ring marks the card the canvas is working on: the tracing source, or the current person in a chain.
  isActive?: boolean;
  // Makes the card itself a control, for example to fly the camera to this person.
  onSelect?: () => void;
  selectLabel?: string;
  // Hover actions, rendered over the bottom of the card.
  children?: React.ReactNode;
}

const SidebarFigureCard: React.FC<Props> = ({ figure, detail, isActive = false, onSelect, selectLabel, children, className = '', ...rest }) => (
  <div {...rest}
    className={`relative bg-surface-card/90 backdrop-blur-sm rounded-xl shadow-sm border border-card-border animate-in fade-in slide-in-from-right-4 duration-500 group transition-colors hover:bg-surface-card-hover ${isActive ? 'ring-2 ring-accent-marker' : ''} ${className}`}
  >
    <div className={`p-4 ${onSelect ? 'cursor-pointer rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-focus' : ''}`}
      {...(onSelect ? { role: 'button', tabIndex: 0, 'aria-label': selectLabel ?? `Show ${figure.name}`, onClick: onSelect,
        onKeyDown: (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } } } : {})}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-bold text-content-primary text-xl leading-tight">{figure.name}</h3>
            <span className="text-sm text-card-muted font-mono font-semibold whitespace-nowrap">
              {formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}
            </span>
          </div>
          <p className="text-xs text-success-heading font-bold uppercase tracking-wide mt-0.5 mb-2">{figure.occupation}</p>

          <div className="text-sm text-content-heading leading-relaxed">
            {detail ? detail.description : (
              <span className="text-content-faint italic">Loading insights...</span>
            )}
          </div>
        </div>

        {detail?.imageUrl && (
          <div className="w-20 h-20 bg-surface-placeholder rounded-[10px] flex-shrink-0 overflow-hidden shadow-sm border border-border-subtle mt-1">
            <img src={detail.imageUrl} alt={figure.name} className="w-full h-full object-cover object-top" />
          </div>
        )}
      </div>
    </div>
    {children}
  </div>
);

export default SidebarFigureCard;
