import { parseRelationshipAssessment, RelationshipAssessmentError } from './relationshipAssessment';
import { CATEGORY_LIST } from '../constants';
import {
  buildDiscoveryPrompt,
  buildRelatedFiguresPrompt,
  buildRelationshipExplanationPrompt,
  buildDeepDivePrompt,
  HISTORIAN_SYSTEM_PROMPT,
  CONNECTION_TEST_PROMPT,
  buildCorrectionPrompt,
} from './prompts';
import type { DeepDiveData, FigureCategory, HistoricalFigure, IAIService, RelationshipExplanation, WeaveGenerationContext, WeaveRequest, WeaveValidationResult } from '../types';
import { validateLocalUrl, type AppConfig } from '../utils/providerConfig';
import { generateWeaveTimeline, getWeaveGenerationRange, parseWeaveFigures, suggestWeaveTopic, validateWeaveQuery } from './weaveService';
import { parseJsonResponse } from './jsonResponse';
import { isWeaveCategoryAllowed } from '../utils/weave';
import { withAbort } from './utils';

const RELAY = '/api/ollama/cloud';

function thinkingOptions(model: string, enabled = false): { think: 'low' | 'medium' | boolean } {
  // Use identical controls for direct cloud IDs and local cloud aliases.
  // GPT-OSS supports effort levels rather than disabling reasoning entirely.
  if (/(?:^|\/)gpt-oss(?::|$)/i.test(model)) return { think: enabled ? 'medium' : 'low' };
  return { think: enabled };
}

class OllamaHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`Invalid ${field}: expected a string.`);
  return value.trim();
}

function explanation(value: unknown): RelationshipExplanation {
  const data = object(value);
  if (!Array.isArray(data.sections) || data.sections.length === 0) throw new Error('Expected explanation sections.');
  return {
    summary: string(data.summary, 'summary'),
    sections: data.sections.map(section => {
      const item = object(section);
      return { title: string(item.title, 'title'), content: string(item.content, 'content') };
    }),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class OllamaService implements IAIService {
  private readonly baseUrl: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: AppConfig, private readonly fetcher: typeof fetch = (input, init) => fetch(input, init), private readonly timeoutMs = 180_000) {
    this.baseUrl = config.ollamaMode === 'cloud' ? RELAY : config.baseUrl;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.config.ollamaMode === 'cloud' ? {
        'X-ChronoWeave-Relay': '1',
        ...(this.config.apiKey ? { 'X-Ollama-Api-Key': this.config.apiKey } : {}),
      } : {}),
    };
  }

  static async hasEnvironmentKey(signal?: AbortSignal): Promise<boolean> {
    const response = await fetch(`${RELAY}/status`, {
      headers: { 'X-ChronoWeave-Relay': '1' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Ollama Cloud needs the local ChronoWeave server. Start the development or preview server.');
    const data = object(await response.json());
    return data.hasApiKey === true;
  }

  private async request(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      const baseUrl = this.config.ollamaMode === 'cloud' ? this.baseUrl : `${validateLocalUrl(this.baseUrl)}/api`;
      const response = await withAbort(this.fetcher(`${baseUrl}/${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST', headers: this.headers(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: combined,
      }), combined);
      let data: unknown;
      try { data = await withAbort(response.json(), combined); }
      catch (error) {
        combined.throwIfAborted();
        throw new Error('Ollama returned an unexpected response. Cloud mode requires the ChronoWeave development or preview server.');
      }
      if (!response.ok) {
        const error = object(data).error;
        const detail = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
        const hints: Record<number, string> = {
          401: 'Ollama authentication failed. Check your cloud API key, or sign in to your local Ollama installation.',
          403: this.config.ollamaMode === 'cloud'
            ? 'Ollama Cloud access denied. Check the API key, model access for your subscription, and that ChronoWeave is opened on localhost.'
            : 'Ollama access denied. Check authentication and allowed browser origins.',
          404: `Model ${this.config.model} was not found. Refresh the model list and check the exact model ID.`,
          429: 'Ollama cloud usage or rate limit reached. Wait and try again, or choose another provider.',
          503: 'Ollama is busy. Try again shortly.',
        };
        const message = `${hints[response.status] || `Ollama request failed (HTTP ${response.status}).`}${detail ? ` ${detail}` : ''}`;
        throw new OllamaHttpError(this.config.apiKey ? message.split(this.config.apiKey).join('[REDACTED]') : message, response.status);
      }
      if (data && typeof data === 'object' && 'error' in data) throw new Error('Ollama returned an error instead of model data.');
      return data;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.signal.aborted) throw new Error('Ollama request timed out. Try a faster model or a smaller year range.');
      if (error instanceof TypeError) throw new Error(this.config.ollamaMode === 'local'
        ? 'Cannot reach Ollama. Start Ollama, check the server URL, and allow this app origin with OLLAMA_ORIGINS if needed.'
        : 'Cannot reach the Ollama Cloud relay. Start the ChronoWeave development or preview server.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = object(await this.request('tags', undefined, signal));
    if (!Array.isArray(data.models)) throw new Error('Ollama returned an invalid model list.');
    return [...new Set(data.models.map(model => string(object(model).name, 'model name')))].sort();
  }

  private generate<T>(prompt: string, validate: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    // One request at a time per service, including retries, avoids a century-wide burst.
    const result = this.queue.then(async () => {
      signal?.throwIfAborted();
      let validationError = '';
      let previousContent = '';
      for (let correction = 0; correction < 2; correction++) {
        let data: unknown;
        for (let attempt = 0; ; attempt++) {
          signal?.throwIfAborted();
          try {
            data = await this.request('chat', {
              model: this.config.model, stream: false,
              ...thinkingOptions(this.config.model, this.config.ollamaReasoning),
              messages: [
                { role: 'system', content: HISTORIAN_SYSTEM_PROMPT },
                { role: 'user', content: prompt },
                ...(validationError ? [
                  ...(previousContent ? [{ role: 'assistant', content: previousContent }] : []),
                  { role: 'user', content: buildCorrectionPrompt(validationError) },
                ] : []),
              ],
            }, signal);
            break;
          } catch (error) {
            if (!(error instanceof OllamaHttpError) || ![429, 503].includes(error.status) || attempt >= 2 ||
                /quota|usage limit|daily limit|weekly limit/i.test(error.message)) throw error;
            await sleep(1000 * 2 ** attempt, signal);
          }
        }
        try {
          const response = object(data);
          previousContent = string(object(response.message).content, 'model response');
          if (response.done === false || response.done_reason === 'length') throw new Error('The model response was incomplete.');
          signal?.throwIfAborted();
          return validate(parseJsonResponse(previousContent));
        } catch (error) {
          signal?.throwIfAborted();
          validationError = error instanceof Error ? error.message : 'Invalid JSON response.';
          if (correction === 1) {
            if (error instanceof RelationshipAssessmentError) throw error;
            if (validate === parseRelationshipAssessment && error instanceof SyntaxError) {
              throw new RelationshipAssessmentError('The model did not return valid JSON for this relationship.');
            }
            throw new Error(`Model ${this.config.model} returned unusable data after a retry: ${validationError}`);
          }
        }
      }
      throw new Error('Ollama generation failed.');
    });
    this.queue = result.catch(() => undefined);
    return withAbort(result, signal);
  }

  async testConnection(signal?: AbortSignal, timeoutMs = this.config.ollamaMode === 'cloud' ? 60_000 : 180_000): Promise<{ success: boolean; error?: string }> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    try {
      // Test transport, credentials and model availability with one tiny generation.
      // Historical JSON validation and its retries belong to the actual AI operations.
      const response = object(await this.request('chat', {
        model: this.config.model, stream: false, ...thinkingOptions(this.config.model, this.config.ollamaReasoning),
        messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
      }, combined));
      string(object(response.message).content, 'model response');
      if (response.done === false || response.done_reason === 'length') throw new Error('The model response was incomplete.');
      return { success: true };
    } catch (error) {
      return { success: false, error: deadline.signal.aborted && !signal?.aborted
        ? `Ollama connection test timed out after ${timeoutMs / 1000} seconds. ${this.config.ollamaMode === 'cloud' ? 'Check the cloud connection and try another model.' : 'Check your local Ollama server and try a smaller model.'}`
        : error instanceof Error ? error.message : 'Ollama connection failed.' };
    } finally { clearTimeout(timer); }
  }

  validateWeaveQuery(request: WeaveRequest, signal?: AbortSignal): Promise<WeaveValidationResult> {
    return validateWeaveQuery(this.generate.bind(this), request, signal);
  }

  suggestWeaveTopic(excludedTopics?: string[], signal?: AbortSignal): Promise<WeaveValidationResult> {
    return suggestWeaveTopic(this.generate.bind(this), excludedTopics, signal);
  }

  fetchHistoricalFigures(start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]> {
    return generateWeaveTimeline(this.generate.bind(this), start, end, signal, context);
  }

  async fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[], signal?: AbortSignal): Promise<string[]> {
    const candidates = allFigures.filter(figure => figure.id !== target.id);
    if (!candidates.length) return [];
    const ids = new Set(candidates.map(figure => figure.id));
    const references = new Map(candidates.map((figure, index) => [`c${index + 1}`, figure.id]));
    const names = new Map<string, string[]>();
    candidates.forEach(figure => {
      const name = figure.name.trim().toLowerCase();
      names.set(name, [...(names.get(name) || []), figure.id]);
    });
    const catalog = candidates.map(({ name, birthYear, deathYear, category }, index) => ({ id: `c${index + 1}`, name, birthYear, deathYear, category }));
    return this.generate(buildRelatedFiguresPrompt(target, catalog), value => {
      const related = object(value).relatedIds;
      if (!Array.isArray(related) || !related.every(id => typeof id === 'string')) {
        throw new Error('Invalid relatedIds: expected an array of strings containing candidate IDs.');
      }
      const resolved = new Set<string>();
      const unknown: string[] = [];
      for (const raw of related as string[]) {
        const id = raw.trim();
        const matchingNames = names.get(id.toLowerCase());
        const match = references.get(id) || (ids.has(id) ? id : matchingNames?.length === 1 && id.toLowerCase() !== target.name.trim().toLowerCase() ? matchingNames[0] : undefined);
        if (match) resolved.add(match);
        else if (id !== target.id && id.toLowerCase() !== target.name.trim().toLowerCase()) unknown.push(raw);
      }
      if (unknown.length && !resolved.size) {
        throw new Error(`Unrecognized related figure IDs: ${JSON.stringify(unknown.slice(0, 5))}. Copy exact IDs such as ${JSON.stringify(catalog[0].id)} from the original candidate list. Return {"relatedIds":[]} only if no candidates are connected.`);
      }
      return [...resolved];
    }, signal);
  }

  async discoverRelatedFigures(target: HistoricalFigure, existingNames: string[], start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]> {
    const range = getWeaveGenerationRange(start, end, context);
    if (!CATEGORY_LIST.some(category => category !== 'EVENTS' && isWeaveCategoryAllowed(category, range.context))) return [];
    const excluded = new Set([...existingNames, target.name].map(name => name.trim().toLowerCase()));
    return this.generate(buildDiscoveryPrompt(target, existingNames, range.start, range.end, range.context), value => {
      return parseWeaveFigures(value, range.start, range.end, false, range.context, true).filter(figure => {
        const key = figure.name.toLowerCase();
        if (excluded.has(key)) return false;
        excluded.add(key); return true;
      });
    }, signal);
  }

  fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure, signal?: AbortSignal): Promise<RelationshipExplanation> {
    return this.generate(buildRelationshipExplanationPrompt(source, target), parseRelationshipAssessment, signal);
  }

  fetchFigureDeepDive(figure: HistoricalFigure, signal?: AbortSignal): Promise<DeepDiveData> {
    return this.generate(buildDeepDivePrompt(figure), value => ({
      ...explanation(value), famousQuote: string(object(value).famousQuote, 'famousQuote', true),
    }), signal);
  }
}
