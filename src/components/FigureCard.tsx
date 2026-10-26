import React from 'react';
import type { HistoricalFigure } from '../types';
import { CATEGORY_COLORS } from '../constants';
import { formatYear } from '../utils/formatters';
import { sizedPortrait } from '../utils/portraitSize';
import { GuestLinkIcon } from './GuestSectionHeader';
import ConnectionPair from './ConnectionPair';
import type { ConnectionPathEntry } from '../utils/connectionPaths';

type Props = React.ComponentPropsWithRef<'button'> & {
  figure: HistoricalFigure;
  imageUrl?: string;
  // How much the card is magnified on screen (a zoomable canvas), so its portrait is fetched sharp enough but no bigger.
  zoom?: number;
  isSource?: boolean;
  // Six Degrees: the person's place in the chain, drawn on the card corner.
  badge?: { number: number; scale: number };
  // A guest of a Six Degrees connection, drawn apart from the people the canvas is about.
  isGuest?: boolean;
  // The saved connections this person is on, drawn as a chip of the paired portraits of the newest one's ends; the canvas
  // opens the menu of those connections when it is clicked.
  connections?: ConnectionPathEntry[];
  connectionPortraits?: ReadonlyMap<string, string>;
};

// The portrait's box, as in the stylesheet (.relationship-card img).
const CARD_PORTRAIT = 64;

const FigureCard: React.FC<Props> = ({ figure, imageUrl = figure.imageUrl, zoom = 1, isSource = false, badge, isGuest = false, connections, connectionPortraits,
  className = '', style, ...buttonProps }) => (
  <button
    type="button"
    {...buttonProps}
    className={`relationship-card ${isSource ? 'relationship-source' : ''} ${isGuest ? 'figure-card--guest' : ''} ${connections?.length ? 'figure-card-has-connection' : ''} ${className}`}
    style={style}
  >
    {badge && <span className="connection-badge connection-badge-corner" aria-label={`Number ${badge.number} in the chain`}
      style={{ transform: `scale(${badge.scale})` }}>{badge.number}</span>}
    {isGuest && <span className="figure-card-guest-mark" title="Added by a Six Degrees connection"><GuestLinkIcon size={12} /></span>}
    <span className="figure-card-corner" aria-hidden="true"
      style={{ backgroundColor: CATEGORY_COLORS[figure.category] }} />
    <div className="relationship-card-text">
      <h2>{figure.name}</h2>
      <p className="relationship-dates">{formatYear(figure.birthYear)} — {formatYear(figure.deathYear)}</p>
      <p className="relationship-occupation">{figure.occupation}</p>
    </div>
    {!!connections?.length && <ConnectionPair entries={connections} portraits={connectionPortraits} size={31} className="figure-card-connection" chip />}
    {imageUrl && <img src={sizedPortrait(imageUrl, CARD_PORTRAIT, zoom)} alt="" loading="lazy" draggable={false}
      onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </button>
);

export default FigureCard;
