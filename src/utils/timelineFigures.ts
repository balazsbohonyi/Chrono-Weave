import type { HistoricalFigure } from '../types';

export const MIN_EVENT_DURATION = 3;

export function isTimelineFigureVisible(figure: HistoricalFigure): boolean {
  return !!figure && figure.birthYear <= figure.deathYear &&
    (figure.category !== 'EVENTS' || figure.deathYear - figure.birthYear >= MIN_EVENT_DURATION);
}

export const filterTimelineFigures = (figures: HistoricalFigure[]): HistoricalFigure[] =>
  figures.filter(isTimelineFigureVisible);
