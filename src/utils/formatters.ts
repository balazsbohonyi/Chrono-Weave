
import type { CanvasConfig } from '../types';
import { eraSpan } from './eras';

export const formatYear = (year: number | undefined | null): string => {
  if (year === undefined || year === null) return '';
  if (year < 0) {
    return `${Math.abs(year)} BC`;
  }
  return year.toString();
};

export function formatCanvasPrompt(config: CanvasConfig): string {
  const context = config.weaveContext;
  // a strict time span is titled by its years and the eras they fall in
  if (context?.mode === 'time-span') {
    const start = context.inferredStartYear, end = context.inferredEndYear;
    return `${formatYear(start)} – ${formatYear(end)} · ${eraSpan(start, end)}`;
  }
  const prompt = context?.query.trim() || `${formatYear(context?.inferredStartYear ?? config.start)} – ${formatYear(context?.inferredEndYear ?? config.end)}`;
  return prompt.charAt(0).toLocaleUpperCase() + prompt.slice(1);
}
