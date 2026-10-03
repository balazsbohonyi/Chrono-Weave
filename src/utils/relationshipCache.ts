import type { HistoricalFigure } from '../types';

interface RelationshipMap {
  relatedIds: string[];
  expansionAttempted: boolean;
}

interface SavedRelationshipMap extends RelationshipMap {
  version: 1;
  scope: string;
}

const cacheKey = (source: HistoricalFigure) => `chrono_map_${encodeURIComponent(source.id)}`;
const identity = (figure: HistoricalFigure) =>
  [figure.id, figure.name, figure.birthYear, figure.deathYear, figure.occupation, figure.category];

function canvasScope(source: HistoricalFigure, figures: HistoricalFigure[]): string {
  return JSON.stringify([identity(source), [...figures].sort((a, b) => a.id.localeCompare(b.id)).map(identity)]);
}

export function validRelatedIds(source: HistoricalFigure, figures: HistoricalFigure[], ids: string[]): string[] {
  const candidates = new Set(figures.filter(figure => figure.id !== source.id).map(figure => figure.id));
  return [...new Set(ids.filter(id => candidates.has(id)))];
}

function readSavedMap(source: HistoricalFigure, storage: Storage): SavedRelationshipMap | null {
  try {
    const cached = JSON.parse(storage.getItem(cacheKey(source)) || 'null');
    if (!cached || cached.version !== 1 || typeof cached.scope !== 'string' ||
        !Array.isArray(cached.relatedIds) || !cached.relatedIds.every((id: unknown) => typeof id === 'string') ||
        typeof cached.expansionAttempted !== 'boolean') return null;
    return cached;
  } catch { return null; }
}

export function readRelationshipMap(source: HistoricalFigure, figures: HistoricalFigure[], storage: Storage): RelationshipMap | null {
  try {
    const cached = readSavedMap(source, storage);
    if (!cached || cached.scope !== canvasScope(source, figures)) return null;
    const relatedIds = validRelatedIds(source, figures, cached.relatedIds);
    if (relatedIds.length !== cached.relatedIds.length) return null;
    return {
      relatedIds,
      expansionAttempted: cached.expansionAttempted,
    };
  } catch { return null; }
}

// A completed search covers one canvas. A known pair remains useful in either
// direction while both endpoints are unchanged, even if other figures changed.
export function readKnownRelationshipIds(source: HistoricalFigure, figures: HistoricalFigure[], storage: Storage): string[] {
  const current = new Map(figures.map(figure => [figure.id, JSON.stringify(identity(figure))]));
  current.set(source.id, JSON.stringify(identity(source)));
  const related = new Set<string>();
  for (const owner of figures) {
    const cached = readSavedMap(owner, storage);
    if (!cached) continue;
    try {
      const scope = JSON.parse(cached.scope);
      if (!Array.isArray(scope) || scope.length !== 2 ||
          JSON.stringify(scope[0]) !== current.get(owner.id) || !Array.isArray(scope[1]) ||
          !scope[1].every((item: unknown) => Array.isArray(item) && item.length === 6 && typeof item[0] === 'string')) continue;
      const previous = new Map<string, string>(scope[1].map((item: unknown[]) => [item[0] as string, JSON.stringify(item)]));
      if (cached.relatedIds.some(id => id === owner.id || !previous.has(id))) continue;
      const valid = cached.relatedIds.filter(id => current.has(id) && previous.get(id) === current.get(id));
      if (owner.id === source.id) valid.forEach(id => related.add(id));
      else if (valid.includes(source.id)) related.add(owner.id);
    } catch { /* Ignore malformed historical cache scopes. */ }
  }
  return validRelatedIds(source, figures, [...related]);
}

export function saveRelationshipMap(
  source: HistoricalFigure, figures: HistoricalFigure[], relatedIds: string[], storage: Storage, expansionAttempted = false,
): void {
  try {
    storage.setItem(cacheKey(source), JSON.stringify({
      version: 1, scope: canvasScope(source, figures),
      relatedIds: validRelatedIds(source, figures, relatedIds), expansionAttempted,
    }));
  } catch { /* A full or unavailable storage must not fail a successful map. */ }
}
