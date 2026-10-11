import type { HistoricalFigure, IAIService, WeaveGenerationContext } from '../types';
import { getCanvasFocusFigure } from '../utils/canvasLayout';
import { savedPathFigureIds } from '../utils/connectionPaths';
import { assessRelationships, readRelationshipAssessment } from './relationshipAssessment';

// Generated entries are candidates, just as they are for Map Relationships.
// Only the focus itself and positively assessed connections enter a new build.
export async function verifyFollowFigureConnections(
  service: Pick<IAIService, 'fetchRelationshipExplanation'>, figures: HistoricalFigure[],
  context: WeaveGenerationContext, storage: Storage, signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (context.mode !== 'figure') return { figures, seedFigureId: undefined, relatedIds: [] as string[] };
  const focus = getCanvasFocusFigure(figures, context);
  if (!focus || focus.category === 'EVENTS') {
    throw new Error('The focus figure could not be identified in the generated results. Try their full historical name or another model.');
  }
  const assessed = await assessRelationships(service, focus, figures, storage, signal);
  signal?.throwIfAborted();
  return {
    figures: figures.filter(figure => figure.id === focus.id || assessed.has(figure.id)),
    seedFigureId: focus.id,
    relatedIds: [...assessed.keys()],
  };
}

// Legacy canvases load without new AI requests. Remove explicit cached rejections;
// candidates without an assessment are checked when their relationship is opened.
export function discardRejectedFollowFigureCandidates(
  figures: HistoricalFigure[], context: WeaveGenerationContext | undefined, storage: Storage, savedSeedId?: string,
): HistoricalFigure[] {
  const focus = getCanvasFocusFigure(figures, context, savedSeedId);
  if (!focus) return figures;
  // People woven into a verified Six Degrees chain stay, even if they were once rejected against the focus.
  const connected = savedPathFigureIds(storage);
  return figures.filter(figure => figure.id === focus.id || connected.has(figure.id)
    || readRelationshipAssessment(focus, figure, storage)?.isRelevant !== false);
}
