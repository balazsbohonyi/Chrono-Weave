import type { CanvasConfig, HistoricalFigure } from '../types';
import { addGuests } from './connectionGuests';

// Padding, in years, added beyond woven-in people who fall outside the canvas range.
export const CONNECTION_RANGE_PADDING = 20;

// Grows the canvas range only as far as the new people need.
export function extendConnectionRange(range: Pick<CanvasConfig, 'start' | 'end'>, people: readonly HistoricalFigure[],
  padding = CONNECTION_RANGE_PADDING): Pick<CanvasConfig, 'start' | 'end'> {
  if (!people.length) return range;
  const earliest = Math.min(...people.map(person => person.birthYear));
  const latest = Math.max(...people.map(person => person.deathYear));
  return {
    start: earliest < range.start ? Math.floor((earliest - padding) / 10) * 10 : range.start,
    end: latest > range.end ? Math.ceil((latest + padding) / 10) * 10 : range.end,
  };
}

export interface WovenCanvas {
  figures: HistoricalFigure[];
  config: CanvasConfig;
  newIds: string[];
}

interface WeaveInput {
  figures: HistoricalFigure[];
  config: CanvasConfig;
  chain: HistoricalFigure[];
  newFigures: HistoricalFigure[];
  // The saved path key of the connection, which its guests are recorded under.
  pathKey: string;
}

// The canvas after a verified chain is woven in: its new people join as guests of this connection, kept apart from the
// people the canvas is about, and chain members who are already guests of another connection become guests of this one
// too. The canvas topic (its categories and filter) is left alone; only the range grows so the guests fit on the axis.
export function weaveConnectionIntoCanvas({ figures, config, chain, newFigures, pathKey }: WeaveInput): WovenCanvas {
  const existing = new Set(figures.map(figure => figure.id));
  const added = newFigures.filter((figure, index) => !existing.has(figure.id) && newFigures.findIndex(other => other.id === figure.id) === index);
  const sharedGuests = chain.filter(person => existing.has(person.id) && config.guests?.[person.id] && !config.guests[person.id].includes(pathKey));
  if (!added.length && !sharedGuests.length) return { figures, config, newIds: [] };
  return {
    figures: added.length ? [...figures, ...added] : figures,
    config: {
      ...config, ...extendConnectionRange(config, added),
      guests: addGuests(config.guests, [...added, ...sharedGuests].map(figure => figure.id), pathKey),
    },
    newIds: added.map(figure => figure.id),
  };
}
