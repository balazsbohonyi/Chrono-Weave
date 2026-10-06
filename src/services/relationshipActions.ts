import { HistoricalFigure, IAIService } from '../types';
import { readKnownRelationshipIds, readRelationshipMap, validRelatedIds } from '../utils/relationshipCache';
import { isTimelineFigureVisible } from '../utils/timelineFigures';
import { assessRelationships } from './relationshipAssessment';

interface Options {
  service: IAIService;
  source: HistoricalFigure;
  figures: HistoricalFigure[];
  action: 'map' | 'expand';
  config: { start: number; end: number };
  knownIds: string[];
  storage: Storage;
  signal: AbortSignal;
  onExpansionFallback: () => void;
}

// Return a complete, verified result before the UI commits figures or placements.
// Check cancellation even when a provider ignores its AbortSignal.
export async function resolveRelationshipAction({ service, source, figures, action, config, knownIds, storage, signal, onExpansionFallback }: Options) {
  signal.throwIfAborted();
  const cached = readRelationshipMap(source, figures, storage);
  const known = validRelatedIds(source, figures, [
    ...readKnownRelationshipIds(source, figures, storage), ...knownIds, ...(cached?.relatedIds || []),
  ]);
  if (action === 'map') {
    const knownSet = new Set(known);
    const remaining = figures.filter(figure => !knownSet.has(figure.id));
    const needsMapping = cached === null && remaining.some(figure => figure.id !== source.id);
    const aiIds = cached?.relatedIds ?? (needsMapping ? await service.fetchRelatedFigures(source, remaining, signal) : []);
    signal.throwIfAborted();
    const proposed = new Set(validRelatedIds(source, figures, [...aiIds, ...known]));
    const assessed = await assessRelationships(service, source, figures.filter(figure => proposed.has(figure.id)), storage, signal);
    signal.throwIfAborted();
    if (assessed.size || cached?.expansionAttempted) {
      return { relatedIds: [...assessed.keys()], newFigures: [] as HistoricalFigure[], expansionAttempted: cached?.expansionAttempted ?? false };
    }
    onExpansionFallback();
    signal.throwIfAborted();
  }

  const candidates = await service.discoverRelatedFigures(source, figures.map(figure => figure.name), config.start, config.end, signal);
  signal.throwIfAborted();
  const seenIds = new Set(figures.map(figure => figure.id));
  const seenNames = new Set(figures.map(figure => figure.name.trim().toLowerCase()));
  const proposedNew = candidates.filter(figure => {
    const name = figure.name.trim().toLowerCase();
    if (!isTimelineFigureVisible(figure) || figure.deathYear < config.start || figure.birthYear > config.end || seenIds.has(figure.id) || seenNames.has(name)) return false;
    seenIds.add(figure.id);
    seenNames.add(name);
    return true;
  });
  const previousIds = new Set(known);
  const assessed = await assessRelationships(service, source, [
    ...figures.filter(figure => previousIds.has(figure.id)), ...proposedNew,
  ], storage, signal);
  signal.throwIfAborted();
  const newFigures = proposedNew.filter(figure => assessed.has(figure.id));
  return { relatedIds: validRelatedIds(source, [...figures, ...newFigures], [...assessed.keys()]), newFigures, expansionAttempted: true };
}
