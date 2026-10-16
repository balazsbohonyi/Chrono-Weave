import React from 'react';
import type { HistoricalFigure } from '../types';
import { CATEGORY_COLORS } from '../constants';
import { formatYear } from '../utils/formatters';
import { sizedPortrait } from '../utils/portraitSize';

type Props = React.ComponentPropsWithRef<'button'> & {
  figure: HistoricalFigure;
  imageUrl?: string;
  // How much the card is magnified on screen (a zoomable canvas), so its portrait is fetched sharp enough but no bigger.
  zoom?: number;
  isSource?: boolean;
  // Six Degrees: the person's place in the chain, drawn on the card corner.
  badge?: { number: number; scale: number };
};

// The portrait's box, as in the stylesheet (.relationship-card img).
const CARD_PORTRAIT = 64;

const FigureCard: React.FC<Props> = ({ figure, imageUrl = figure.imageUrl, zoom = 1, isSource = false, badge,
  className = '', style, ...buttonProps }) => (
  <button
    type="button"
    {...buttonProps}
    className={`relationship-card ${isSource ? 'relationship-source' : ''} ${className}`}
    style={style}
  >
    {badge && <span className="connection-badge connection-badge-corner" aria-label={`Number ${badge.number} in the chain`}
      style={{ transform: `scale(${badge.scale})` }}>{badge.number}</span>}
    <span className="figure-card-corner" aria-hidden="true"
      style={{ backgroundColor: CATEGORY_COLORS[figure.category] }} />
    <div className="relationship-card-text">
      <h2>{figure.name}</h2>
      <p className="relationship-dates">{formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}</p>
      <p className="relationship-occupation">{figure.occupation}</p>
    </div>
    {imageUrl && <img src={sizedPortrait(imageUrl, CARD_PORTRAIT, zoom)} alt="" loading="lazy" draggable={false}
      onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </button>
);

export default FigureCard;
