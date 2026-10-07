import {
  CATEGORY_LIST, HISTORICAL_EVENTS_COUNT, HISTORICAL_EVENTS_PER_CENTURY_CHUNK,
  HISTORICAL_FIGURES_COUNT, HISTORICAL_FIGURES_PER_CENTURY_CHUNK,
  TIMELINE_CHUNKING_THRESHOLD_YEARS, TIMELINE_CHUNK_YEARS,
} from '../constants';
import type { FigureCategory, HistoricalFigure, WeaveGenerationContext, WeaveRequest, WeaveValidationResult } from '../types';
import { isTimelineFigureVisible } from '../utils/timelineFigures';
import {
  assertWeaveYearRange, isWeaveCategoryAllowed, normalizeWeaveContext,
  parseWeaveValidationResult, validateWeaveRequestLocally,
} from '../utils/weave';
import { buildEventsPrompt, buildPeoplePrompt, buildWeaveSuggestionPrompt, buildWeaveValidationPrompt } from './prompts';

export type JsonTask = 'people' | 'events' | 'preflight';
export type JsonGenerator = <T>(prompt: string, validate: (value: unknown) => T, signal?: AbortSignal, task?: JsonTask) => Promise<T>;

export async function validateWeaveQuery(generate: JsonGenerator, request: WeaveRequest, signal?: AbortSignal): Promise<WeaveValidationResult> {
  signal?.throwIfAborted();
  const rejection = validateWeaveRequestLocally(request);
  if (rejection) return rejection;
  const normalized = { ...request, query: request.query.trim() };
  return generate(buildWeaveValidationPrompt(normalized), value => parseWeaveValidationResult(value, normalized), signal, 'preflight');
}

export async function suggestWeaveTopic(generate: JsonGenerator, excludedTopics: string[] = [], signal?: AbortSignal): Promise<WeaveValidationResult> {
  signal?.throwIfAborted();
  const excluded = excludedTopics.filter(topic => typeof topic === 'string').map(topic => topic.trim()).filter(Boolean).slice(-50);
  return generate(buildWeaveSuggestionPrompt(excluded), value => {
    const result = parseWeaveValidationResult(value);
    if (!result.isValid) throw new Error('Suggest a valid historical topic rather than a rejection.');
    if (excluded.some(topic => topic.toLowerCase() === result.themeDescription.toLowerCase())) {
      throw new Error('This topic was already suggested. Choose a different subject, not a rewording.');
    }
    return result;
  }, signal, 'preflight');
}

export function getWeaveGenerationRange(start: number, end: number, context?: WeaveGenerationContext): { start: number; end: number; context?: WeaveGenerationContext } {
  assertWeaveYearRange(start, end);
  if (!context) return { start, end };
  const normalized = normalizeWeaveContext(context);
  const rangeStart = Math.max(start, normalized.inferredStartYear);
  const rangeEnd = Math.min(end, normalized.inferredEndYear);
  assertWeaveYearRange(rangeStart, rangeEnd);
  return { start: rangeStart, end: rangeEnd, context: normalized };
}

export function planWeaveChunks(start: number, end: number, contextual = false): Array<{ start: number; end: number }> {
  assertWeaveYearRange(start, end);
  if (end - start <= TIMELINE_CHUNKING_THRESHOLD_YEARS) return [{ start, end }];
  // Large civilizations and prehistory get broader chunks, not thousands of API calls.
  const maximum = contextual ? 6 : 12;
  const size = Math.max(TIMELINE_CHUNK_YEARS, Math.ceil((end - start) / maximum));
  const chunks: Array<{ start: number; end: number }> = [];
  for (let year = start; year < end; year += size) chunks.push({ start: year, end: Math.min(year + size, end) });
  return chunks;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}: expected a non-empty string.`);
  return value.trim();
}

export function parseWeaveFigures(value: unknown, start: number, end: number, events: boolean, context?: WeaveGenerationContext, allowEmpty = false): HistoricalFigure[] {
  if (!Array.isArray(value) || (!events && !allowEmpty && !context && !value.length)) throw new Error('Expected a non-empty JSON array of historical figures.');
  const results = value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each figure must be a JSON object.');
    const item = raw as Record<string, unknown>;
    const name = requiredString(item.name, 'name');
    const birthYear = events ? item.startYear : item.birthYear;
    const deathYear = events ? item.endYear : item.deathYear;
    if (!Number.isSafeInteger(birthYear) || !Number.isSafeInteger(deathYear)) throw new Error('Years must be integers.');
    if ((birthYear as number) > (deathYear as number)) throw new Error(`Invalid historical date range for "${name}": ${events ? 'startYear' : 'birthYear'} (${birthYear}) must be less than or equal to ${events ? 'endYear' : 'deathYear'} (${deathYear}). Use negative years for BCE dates.`);
    const category = requiredString(item.category, 'category').toUpperCase() as FigureCategory;
    if (!CATEGORY_LIST.includes(category) || (events ? category !== 'EVENTS' : category === 'EVENTS')) throw new Error('Invalid figure category.');
    return {
      id: `w-${events ? 'e' : 'p'}-${encodeURIComponent(name.toLowerCase())}-${birthYear}-${deathYear}`,
      name, birthYear: birthYear as number, deathYear: deathYear as number, category,
      occupation: requiredString(events ? item.type : item.occupation, 'occupation'),
      shortDescription: requiredString(item.description, 'description'),
    };
  }).filter(figure => isTimelineFigureVisible(figure) && figure.deathYear >= start && figure.birthYear <= end && isWeaveCategoryAllowed(figure.category, context));
  if (!events && !allowEmpty && !context && !results.length) throw new Error('No returned entries overlap the requested year range.');
  return results;
}

export async function generateWeaveTimeline(generate: JsonGenerator, start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]> {
  signal?.throwIfAborted();
  const range = getWeaveGenerationRange(start, end, context);
  const chunks = planWeaveChunks(range.start, range.end, !!range.context);
  const chunked = chunks.length > 1;
  const peopleAllowed = CATEGORY_LIST.some(category => category !== 'EVENTS' && isWeaveCategoryAllowed(category, range.context));
  const eventsAllowed = isWeaveCategoryAllowed('EVENTS', range.context);
  const results: HistoricalFigure[] = [];
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    if (peopleAllowed) results.push(...await generate(buildPeoplePrompt(chunk.start, chunk.end, chunked ? HISTORICAL_FIGURES_PER_CENTURY_CHUNK : HISTORICAL_FIGURES_COUNT, range.context),
      value => parseWeaveFigures(value, chunk.start, chunk.end, false, range.context), signal, 'people'));
    if (eventsAllowed && chunked) results.push(...await generate(buildEventsPrompt(chunk.start, chunk.end, HISTORICAL_EVENTS_PER_CENTURY_CHUNK, range.context),
      value => parseWeaveFigures(value, chunk.start, chunk.end, true, range.context), signal, 'events'));
  }
  if (eventsAllowed) results.push(...await generate(buildEventsPrompt(range.start, range.end, HISTORICAL_EVENTS_COUNT, range.context),
    value => parseWeaveFigures(value, range.start, range.end, true, range.context), signal, 'events'));
  signal?.throwIfAborted();
  const seen = new Set<string>();
  return results.filter(figure => {
    const key = `${figure.category === 'EVENTS' ? 'event' : 'person'}:${figure.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
