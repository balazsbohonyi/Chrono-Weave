import type { HistoricalFigure } from '../types';

import { MIN_EVENT_DURATION } from '../constants';

export { MIN_EVENT_DURATION } from '../constants';

export function isTimelineFigureVisible(figure: HistoricalFigure): boolean {
  return !!figure && figure.birthYear <= figure.deathYear &&
    (figure.category !== 'EVENTS' || figure.deathYear - figure.birthYear >= MIN_EVENT_DURATION);
}

export const filterTimelineFigures = (figures: HistoricalFigure[]): HistoricalFigure[] =>
  figures.filter(isTimelineFigureVisible);
