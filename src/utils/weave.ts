import { CATEGORY_LIST } from '../constants';
import { getWeaveValidationMessage } from './userErrors';
import type { FigureCategory, WeaveGenerationContext, WeaveRequest, WeaveValidationResult } from '../types';

export const WEAVE_MODES = ['time-span', 'era', 'figure', 'region', 'theme', 'freeform'] as const;

export function assertWeaveYearRange(start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end || !Number.isSafeInteger(end - start)) {
    throw new Error('Enter whole-number years with the start year earlier than the end year.');
  }
}

export function calculateWeaveBounds(start: number, end: number): { start: number; end: number } {
  assertWeaveYearRange(start, end);
  const padding = (end - start) * 0.1;
  const paddedStart = Math.floor((start - padding) / 10) * 10;
  const paddedEnd = Math.ceil((end + padding) / 10) * 10;
  if (!Number.isSafeInteger(paddedStart) || !Number.isSafeInteger(paddedEnd) || !Number.isSafeInteger(paddedEnd - paddedStart)) {
    throw new Error('This year range is too large to display safely.');
  }
  return { start: Object.is(paddedStart, -0) ? 0 : paddedStart, end: paddedEnd };
}

export function normalizeWeaveCategories(value: unknown): Array<FigureCategory | 'ALL'> {
  if (!Array.isArray(value) || !value.length) throw new Error('activeCategories must be a non-empty array of known categories or ALL.');
  const categories = value.map(category => {
    if (typeof category !== 'string') throw new Error('Each active category must be a string.');
    const normalized = category.trim().toUpperCase();
    if (normalized !== 'ALL' && !CATEGORY_LIST.includes(normalized as FigureCategory)) {
      throw new Error(`Unknown active category: ${category}. Use ${CATEGORY_LIST.join(', ')}, or ALL.`);
    }
    return normalized as FigureCategory | 'ALL';
  });
  if (categories.includes('ALL')) {
    if (categories.some(category => category !== 'ALL')) throw new Error('Use ALL alone, or list only the relevant categories.');
    return ['ALL'];
  }
  return [...new Set(categories)];
}

export function isWeaveCategoryAllowed(category: FigureCategory, context?: Pick<WeaveGenerationContext, 'activeCategories'>): boolean {
  return !context || context.activeCategories.includes('ALL') || context.activeCategories.includes(category);
}

export function rejectWeaveRequest(errorMessage: string): WeaveValidationResult {
  // Bounds on a rejection are inert; callers must check isValid before generation.
  return { isValid: false, errorMessage, inferredStartYear: 0, inferredEndYear: 1, themeDescription: '', activeCategories: ['ALL'] };
}

export function validateWeaveRequestLocally(request: WeaveRequest): WeaveValidationResult | null {
  if (!request || !WEAVE_MODES.includes(request.mode)) return rejectWeaveRequest('Choose a canvas mode to begin.');
  if (typeof request.query !== 'string' || request.query.length > 2000) return rejectWeaveRequest('Enter a historical topic in 2,000 characters or fewer.');
  if (request.mode === 'time-span') {
    try {
      assertWeaveYearRange(request.startYear, request.endYear);
      calculateWeaveBounds(request.startYear, request.endYear);
      const currentYear = new Date().getFullYear();
      if (request.startYear > currentYear || request.endYear > currentYear) {
        return rejectWeaveRequest(`Years cannot be later than ${currentYear} (the current year).`);
      }
    } catch (error) { return rejectWeaveRequest((error as Error).message); }
  } else if (!request.query.trim()) return rejectWeaveRequest('Enter a historical topic to explore.');
  return null;
}

export function parseWeaveValidationResult(value: unknown, request?: WeaveRequest): WeaveValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected one pre-flight JSON object.');
  const data = value as Record<string, unknown>;
  const verdict = typeof data.isValid === 'string' ? data.isValid.trim().toLowerCase() : data.isValid;
  if (verdict === false || verdict === 'false') {
    if (typeof data.errorMessage !== 'string' || !data.errorMessage.trim()) throw new Error('A rejected query needs a friendly errorMessage.');
    return rejectWeaveRequest(getWeaveValidationMessage(data.errorMessage, request?.mode));
  }
  if (verdict !== true && verdict !== 'true') throw new Error('Return isValid as true or false.');
  const start = request?.mode === 'time-span' ? request.startYear : data.inferredStartYear;
  const end = request?.mode === 'time-span' ? request.endYear : data.inferredEndYear;
  assertWeaveYearRange(start as number, end as number);
  calculateWeaveBounds(start as number, end as number);
  if ((end as number) > new Date().getFullYear()) throw new Error('The inferred range must end in the current year or earlier.');
  if (typeof data.themeDescription !== 'string' || !data.themeDescription.trim() || data.themeDescription.length > 2000) {
    throw new Error('Return a concise, non-empty themeDescription preserving all historical topic constraints.');
  }
  return {
    isValid: true, errorMessage: null,
    inferredStartYear: start as number, inferredEndYear: end as number,
    themeDescription: data.themeDescription.trim(),
    activeCategories: request?.mode === 'time-span' ? ['ALL'] : normalizeWeaveCategories(data.activeCategories),
  };
}

export function normalizeWeaveContext(context: WeaveGenerationContext): WeaveGenerationContext {
  if (!context || !WEAVE_MODES.includes(context.mode) || typeof context.query !== 'string' || context.query.length > 2000 ||
      (context.mode !== 'time-span' && !context.query.trim())) throw new Error('Invalid weave generation context.');
  const validated = parseWeaveValidationResult({ ...context, isValid: true }, context.mode === 'time-span'
    ? { mode: 'time-span', query: context.query, startYear: context.inferredStartYear, endYear: context.inferredEndYear } : undefined);
  return { mode: context.mode, query: context.query.trim(), inferredStartYear: validated.inferredStartYear,
    inferredEndYear: validated.inferredEndYear, themeDescription: validated.themeDescription, activeCategories: validated.activeCategories };
}
