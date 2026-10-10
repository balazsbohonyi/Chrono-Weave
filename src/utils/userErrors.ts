import type { WeaveMode } from '../types';

// Only messages written for users may bypass the error formatter.
export class UserFacingError extends Error {}

export function getUserErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) return error.message;
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const data = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const nested = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : {};
  const status = Number(data.status ?? data.code ?? nested.status ?? nested.code);
  if (data.name === 'QuotaExceededError' || /storage|disk quota/i.test(detail)) {
    return 'Your changes could not be saved on this device. Free up some browser storage and try again.';
  }
  if (status === 401 || status === 403 || /api key|authentication|unauthorized|access denied|permission denied/i.test(detail)) {
    return 'We could not connect with your current settings. Check your access key and account permissions in Settings.';
  }
  if (status === 402 || /insufficient credits|payment required|billing/i.test(detail)) {
    return 'Your AI account needs more credit. Check your account balance or choose another provider in Settings.';
  }
  if (status === 429 || /rate limit|quota|usage limit|resource_exhausted/i.test(detail)) {
    return 'The AI service has reached its usage limit. Please try again later or choose another provider in Settings.';
  }
  if (data.name === 'TimeoutError' || /timed? out|timeout/i.test(detail)) {
    return 'This is taking longer than expected. Please try again, or choose a smaller topic.';
  }
  if (status >= 500 && status < 600) return 'The AI service is temporarily unavailable. Please try again shortly.';
  if (/network|fetch failed|failed to fetch|cannot reach|connection refused/i.test(detail)) {
    return 'We could not connect to the AI service. Check your connection and provider settings, then try again.';
  }
  if (status === 404 || /model.*(?:not found|does not exist|invalid)|invalid model/i.test(detail)) {
    return 'The selected model is unavailable. Please choose another model in Settings.';
  }
  if (/server url/i.test(detail)) return 'Enter a valid server address in Settings and try again.';
  return fallback;
}

const clarification: Record<WeaveMode, string> = {
  'time-span': 'Choose a historical start year and an end year that comes after it.',
  era: 'Please name a historical period or civilization, such as the Italian Renaissance.',
  figure: 'Please use the full name of a historical figure, such as Leonardo da Vinci.',
  region: 'Please name a region or culture, such as the Italian city-states. You can include a historical period to narrow it down.',
  theme: 'Please describe a historical idea or discipline, such as Renaissance art.',
  freeform: 'Please make your historical topic more specific by naming a place, period, person, or idea.',
};

export function getWeaveValidationMessage(message: unknown, mode: WeaveMode = 'freeform'): string {
  // Model-written rejections are untrusted prose. Do not show code, internal
  // field names, transport details, or long diagnostic explanations to users.
  if (typeof message !== 'string') return clarification[mode];
  const text = message.trim();
  const technical = /[{}\[\]`<>]|https?:\/\/|\b(?:json|http|api|schema|mode|query|isValid|errorMessage|inferredStartYear|inferredEndYear|activeCategories|themeDescription|startYear|endYear|stack trace|exception|payload|parameter|integer)\b/i;
  return text && text.length <= 300 && !technical.test(text) ? text : clarification[mode];
}
