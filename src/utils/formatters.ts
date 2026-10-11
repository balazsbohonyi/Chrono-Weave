
import type { CanvasConfig } from '../types';

export const formatYear = (year: number | undefined | null): string => {
  if (year === undefined || year === null) return '';
  if (year < 0) {
    return `${Math.abs(year)} BC`;
  }
  return year.toString();
};

export function formatCanvasPrompt(config: CanvasConfig): string {
  const context = config.weaveContext;
  const prompt = context?.query.trim() || `${formatYear(context?.inferredStartYear ?? config.start)} – ${formatYear(context?.inferredEndYear ?? config.end)}`;
  return prompt.charAt(0).toLocaleUpperCase() + prompt.slice(1);
}
