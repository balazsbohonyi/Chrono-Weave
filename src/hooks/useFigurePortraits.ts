import { useEffect, useState } from 'react';
import type { HistoricalFigure } from '../types';
import { fetchBatchFigureDetails } from '../services/wikiService';

export function useFigurePortraits(figures: HistoricalFigure[]) {
  const [portraits, setPortraits] = useState(new Map<string, string>());
  const missing = figures.filter(figure => !figure.imageUrl);
  const requestKey = JSON.stringify(missing.map(figure => [figure.id, figure.name]));
  useEffect(() => {
    if (!missing.length) return;
    let current = true;
    const show = (details: Map<string, { imageUrl: string | null }>) => {
      if (!current) return;
      setPortraits(previous => {
        const next = new Map(previous);
        for (const [id, detail] of details) if (detail.imageUrl) next.set(id, detail.imageUrl);
        return next.size === previous.size && [...next].every(([id, url]) => previous.get(id) === url) ? previous : next;
      });
    };
    // The portraits remembered from earlier visits are shown at once; people nobody remembers follow when Wikipedia has answered.
    fetchBatchFigureDetails(missing, show).then(show).catch(error => console.warn('Could not load figure portraits', error));
    return () => { current = false; };
    // Camera movement within the same visible set must not restart the request.
  }, [requestKey]);
  return portraits;
}
