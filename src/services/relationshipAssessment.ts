import type { HistoricalFigure, IAIService, RelationshipExplanation } from '../types';
import { buildCorrectionPrompt } from './prompts';

export class RelationshipAssessmentError extends Error {}

export async function generateRelationshipAssessment(generate: (correction?: string) => Promise<unknown>): Promise<RelationshipExplanation> {
  let correction: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseRelationshipAssessment(await generate(correction));
    } catch (error) {
      if (!(error instanceof RelationshipAssessmentError) && !(error instanceof SyntaxError)) throw error;
      const validationMessage = error.message;
      const message = error instanceof SyntaxError ? 'Return one valid JSON object, with isRelevant and evidence fields.' : validationMessage;
      if (attempt === 1) throw new RelationshipAssessmentError(message);
      correction = buildCorrectionPrompt(message);
    }
  }
  throw new RelationshipAssessmentError('The model did not return a usable relationship assessment.');
}

export function parseRelationshipAssessment(value: unknown): RelationshipExplanation {
  const data = value as Record<string, unknown> | null;
  const verdict = typeof data?.isRelevant === 'string' ? data.isRelevant.trim().toLowerCase() : data?.isRelevant;
  const isRelevant = verdict === true || verdict === 'true' ? true : verdict === false || verdict === 'false' ? false : undefined;
  if (isRelevant === undefined) {
    throw new RelationshipAssessmentError('Missing relevance verdict. Return isRelevant as true or false; do not omit it.');
  }
  const evidence = typeof data.evidence === 'string' ? data.evidence.trim()
    : Array.isArray(data.evidence) && data.evidence.every(item => typeof item === 'string') ? data.evidence.join('\n').trim() : '';
  if (isRelevant && !evidence) {
    throw new RelationshipAssessmentError('A positive relevance verdict requires evidence: a nonempty string naming the concrete interaction, work, or role. Otherwise return isRelevant=false.');
  }
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary.trim()
    : isRelevant ? evidence : 'A specific historical relationship could not be established.';
  const sections = Array.isArray(data.sections) ? data.sections.flatMap(section => {
    if (!section || typeof section.title !== 'string' || !section.title.trim() ||
        typeof section.content !== 'string' || !section.content.trim()) return [];
    return [{ title: section.title.trim(), content: section.content.trim() }];
  }) : [];
  // Narrative formatting must not invalidate an otherwise explicit verdict.
  // Missing presentation fields can be derived from the supplied evidence;
  // missing verdicts or evidence cannot be inferred from a persuasive summary.
  return { isRelevant, evidence: isRelevant ? evidence : '', summary,
    sections: sections.length ? sections : [{ title: isRelevant ? 'Evidence' : 'Assessment', content: isRelevant ? evidence : summary }] };
}

const key = (source: HistoricalFigure, target: HistoricalFigure) =>
  `chrono_assessment_${encodeURIComponent(source.id)}_${encodeURIComponent(target.id)}`;
const scope = (source: HistoricalFigure, target: HistoricalFigure) => JSON.stringify(
  [source, target].map(({ id, name, birthYear, deathYear, occupation, category }) =>
    [id, name, birthYear, deathYear, occupation, category]),
);

export function readRelationshipAssessment(source: HistoricalFigure, target: HistoricalFigure, storage: Storage): RelationshipExplanation | null {
  try {
    const cached = JSON.parse(storage.getItem(key(source, target)) || 'null');
    if (!cached || cached.scope !== scope(source, target)) return null;
    return parseRelationshipAssessment(cached.explanation);
  } catch { return null; }
}

// Discovery and mapping propose candidates; only an explicit evidence-bearing
// positive assessment admits a connection. Old IDs/descriptions are not proof.
export async function assessRelationships(
  service: Pick<IAIService, 'fetchRelationshipExplanation'>, source: HistoricalFigure, candidates: HistoricalFigure[], storage: Storage, signal?: AbortSignal,
): Promise<Map<string, RelationshipExplanation>> {
  const accepted = new Map<string, RelationshipExplanation>();
  const seen = new Set<string>([source.id]);
  const failed: string[] = [];
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    let explanation = readRelationshipAssessment(source, candidate, storage);
    if (!explanation) {
      try {
        explanation = parseRelationshipAssessment(await service.fetchRelationshipExplanation(source, candidate, signal));
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof RelationshipAssessmentError)) throw error;
        failed.push(candidate.name);
        continue;
      }
      signal?.throwIfAborted();
      try {
        storage.setItem(key(source, candidate), JSON.stringify({ scope: scope(source, candidate), explanation }));
      } catch { /* Storage failure must not bypass or fail the assessment. */ }
    }
    if (explanation.isRelevant) accepted.set(candidate.id, explanation);
  }
  if (!accepted.size && failed.length) {
    throw new RelationshipAssessmentError(`The model could not assess ${failed.length} ${failed.length === 1 ? 'candidate' : 'candidates'}. Try mapping again or choose another model. No unchecked links were added.`);
  }
  return accepted;
}
