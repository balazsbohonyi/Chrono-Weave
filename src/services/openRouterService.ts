import { generateRelationshipAssessment } from './relationshipAssessment';

import { DeepDiveData, FigureCategory, HistoricalFigure, IAIService, RelationshipExplanation, WeaveGenerationContext, WeaveRequest, WeaveValidationResult } from "../types";
import {
  buildDiscoveryPrompt,
  buildRelatedFiguresPrompt,
  buildRelationshipExplanationPrompt,
  buildDeepDivePrompt,
  HISTORIAN_SYSTEM_PROMPT,
  CONNECTION_TEST_PROMPT,
} from './prompts';
import { runWithRetry, enqueueTaskWithRetry, withAbort } from "./utils";
import { generateValidatedJson, parseJsonResponse } from './jsonResponse';
import { generateWeaveTimeline, getWeaveGenerationRange, parseWeaveFigures, suggestWeaveTopic, validateWeaveQuery, type JsonTask } from './weaveService';
import { CATEGORY_LIST } from '../constants';
import { isWeaveCategoryAllowed } from '../utils/weave';

export class OpenRouterService implements IAIService {
    private apiKey: string;
    private model: string;
    private baseUrl: string = "https://openrouter.ai/api/v1/chat/completions";

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || "openai/gpt-oss-120b";
    }

    async testConnection(signal?: AbortSignal): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch(this.baseUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
                    "X-Title": "ChronoWeave"
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: "user", content: CONNECTION_TEST_PROMPT }],
                    max_tokens: 5
                })
            });

            if (!response.ok) {
                const errBody = await response.text();
                let errorMsg = `HTTP ${response.status}`;

                if (response.status === 401 || response.status === 403) {
                    errorMsg = "Invalid API key";
                } else if (response.status === 404) {
                    errorMsg = "Model not found - check model ID";
                } else {
                    try {
                        const errJson = JSON.parse(errBody);
                        errorMsg = errJson.error?.message || errorMsg;
                    } catch {}
                }

                return { success: false, error: errorMsg };
            }

            const data = await response.json();
            // Check if response has the expected structure (even if content is empty)
            if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
                return { success: true };
            }

            console.error("[OpenRouter] Unexpected response structure:", data);
            return { success: false, error: "Invalid response format" };
        } catch (error: any) {
            console.error("[OpenRouter] Connection test failed:", error);
            return {
                success: false,
                error: error.message || "Network error - check connection"
            };
        }
    }

    private async callOpenRouter(prompt: string, signal?: AbortSignal, raw = false): Promise<any> {
        signal?.throwIfAborted();
        const messages = [];
        messages.push({ role: "system", content: HISTORIAN_SYSTEM_PROMPT });
        messages.push({ role: "user", content: prompt });

        const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
        const response = await withAbort(fetch(this.baseUrl, {
            method: "POST",
            signal: combined,
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
                "X-Title": "ChronoWeave"
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
            })
        }), combined);

        if (!response.ok) {
            const errBody = await response.text();
            throw Object.assign(new Error(`OpenRouter API Error: ${response.status} - ${errBody}`), { status: response.status });
        }

        const data = await withAbort(response.json(), combined);
        const content = data.choices?.[0]?.message?.content || "";
        signal?.throwIfAborted();
        return raw ? content : parseJsonResponse(content);
    }

    private generate<T>(prompt: string, validate: (value: unknown) => T, signal?: AbortSignal, task: JsonTask = 'people'): Promise<T> {
        // Plain task JSON keeps this compatible with models that do not support
        // OpenAI-style response_format/json_schema parameters.
        return generateValidatedJson(prompt, requestPrompt => task === 'preflight'
            ? runWithRetry(() => this.callOpenRouter(requestPrompt, signal, true), 2, 1000, signal)
            : enqueueTaskWithRetry(() => this.callOpenRouter(requestPrompt, signal, true), signal), validate, signal);
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

    async fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[]): Promise<string[]> {
        const candidates = allFigures.filter(f => f.id !== target.id).map(({ id, name, birthYear, deathYear, category }) => ({ id, name, birthYear, deathYear, category }));
        if (candidates.length === 0) return [];

        const prompt = buildRelatedFiguresPrompt(target, candidates);

        try {
            const result = await enqueueTaskWithRetry(() => this.callOpenRouter(prompt));
            if (!Array.isArray(result.relatedIds) || !result.relatedIds.every((id: unknown) => typeof id === 'string')) {
                throw new Error('The model returned an invalid relationship map.');
            }
            return result.relatedIds;
        } catch (error) {
            console.error("OpenRouter fetchRelatedFigures error:", error);
            throw error;
        }
    }

    async discoverRelatedFigures(target: HistoricalFigure, existingNames: string[], start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]> {
        const range = getWeaveGenerationRange(start, end, context);
        if (!CATEGORY_LIST.some(category => category !== 'EVENTS' && isWeaveCategoryAllowed(category, range.context))) return [];
        const excluded = new Set([...existingNames, target.name].map(name => name.trim().toLowerCase()));
        return this.generate(buildDiscoveryPrompt(target, existingNames, range.start, range.end, range.context), value => {
            if (!Array.isArray(value)) throw new Error('The model returned invalid discovery data.');
            return parseWeaveFigures(value, range.start, range.end, false, range.context, true).filter(figure => {
                const key = figure.name.toLowerCase();
                if (excluded.has(key)) return false;
                excluded.add(key); return true;
            });
        }, signal);
    }

    async fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure): Promise<RelationshipExplanation | null> {
        const prompt = buildRelationshipExplanationPrompt(source, target);
        try {
            return await generateRelationshipAssessment(correction =>
                enqueueTaskWithRetry(() => this.callOpenRouter(correction ? `${prompt}\n${correction}` : prompt)));
        } catch (error) {
            console.error("OpenRouter fetchRelationshipExplanation error:", error);
            throw error;
        }
    }

    async fetchFigureDeepDive(figure: HistoricalFigure): Promise<DeepDiveData | null> {
        const prompt = buildDeepDivePrompt(figure);
        try {
            return await enqueueTaskWithRetry(() => this.callOpenRouter(prompt));
        } catch (error) {
            console.error("OpenRouter fetchFigureDeepDive error:", error);
            return null;
        }
    }
}
