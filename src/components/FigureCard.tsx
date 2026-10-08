import React from 'react';
import type { HistoricalFigure } from '../types';
import { CATEGORY_COLORS } from '../constants';
import { formatYear } from '../utils/formatters';

type Props = React.ComponentPropsWithRef<'button'> & {
  figure: HistoricalFigure;
  imageUrl?: string;
  isSource?: boolean;
};

const FigureCard: React.FC<Props> = ({ figure, imageUrl = figure.imageUrl, isSource = false,
  className = '', style, ...buttonProps }) => (
  <button
    type="button"
    {...buttonProps}
    className={`relationship-card ${isSource ? 'relationship-source' : ''} ${className}`}
    style={style}
  >
    <span className="figure-card-corner" aria-hidden="true"
      style={{ backgroundColor: CATEGORY_COLORS[figure.category] }} />
    <div className="relationship-card-text">
      <h2>{figure.name}</h2>
      <p className="relationship-dates">{formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}</p>
      <p className="relationship-occupation">{figure.occupation}</p>
    </div>
    {imageUrl && <img src={imageUrl} alt="" loading="lazy" draggable={false}
      onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </button>
);

export default FigureCard;
