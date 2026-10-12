import { requestContactDiscovery, requestContactAssessment, requestContactExplanation, type ContactDiscoveryRequest, type ContactPair } from './connectionAI';
import type { ContactPerson, ContactAssessment } from './connectionGraph';
import { generateRelationshipAssessment } from './relationshipAssessment';

import { GenerateContentResponse, GoogleGenAI, Type, type Schema } from "@google/genai";
import { ConnectionPathOptions, ConnectionPathProposal, DeepDiveData, HistoricalFigure, IAIService, NewPerson, RelationshipExplanation, RelationshipExplanationOptions, WeaveGenerationContext, WeaveRequest, WeaveValidationResult } from "../types";
import { requestConnectionPath, requestResolveFigure } from './pathService';
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
import { CATEGORY_LIST, SURPRISE_MIN_EXAMPLES, SURPRISE_MAX_EXAMPLES } from '../constants';
import { isWeaveCategoryAllowed } from '../utils/weave';

export class GeminiService implements IAIService {
    private ai: GoogleGenAI | null = null;
    private apiKey: string;
    private model: string;

    constructor(apiKey?: string, model?: string) {
        this.apiKey = apiKey ?? process.env.API_KEY ?? '';
        this.model = model || process.env.MODEL || "gemini-2.5-flash";

        if (this.apiKey) {
            this.ai = new GoogleGenAI({ apiKey: this.apiKey });
        }
    }

    private ensureAI(): GoogleGenAI {
        if (!this.ai) {
            throw new Error('Gemini API key not configured. Please add your API key in Settings.');
        }
        return this.ai;
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            const ai = this.ensureAI();
            // Quick test: generate a simple response with minimal tokens
            const response = await ai.models.generateContent({
                model: this.model,
                contents: CONNECTION_TEST_PROMPT,
                config: { responseMimeType: "text/plain" }
            });

            // Check if we got a valid response (text can be empty string, which is falsy)
            if (response && response.text !== undefined) {
                return { success: true };
            }
            console.error("[Gemini] Unexpected response structure:", response);
            return { success: false, error: "No response received" };
        } catch (error: any) {
            console.error("[Gemini] Connection test failed:", error);
            let errorMsg = "Connection test failed";

            if (error.message?.includes("API key")) {
                errorMsg = "Invalid API key";
            } else if (error.status === 403 || error.status === 401) {
                errorMsg = "Authentication failed - check API key";
            } else if (error.status === 404 || error.message?.includes("models/") || error.message?.includes("not found")) {
                errorMsg = "Model not found - check model ID";
            } else if (error.message?.toLowerCase().includes("model") && (error.message?.includes("invalid") || error.message?.includes("does not exist"))) {
                errorMsg = `Invalid model: ${error.message}`;
            } else if (error.message) {
                errorMsg = error.message;
            }

            return { success: false, error: errorMsg };
        }
    }

    private supportsJsonSchema = true;

    private schema(task: JsonTask): Schema {
        if (task === 'preflight' || task === 'suggestion') return {
            type: Type.OBJECT,
            properties: {
                isValid: { type: Type.BOOLEAN }, errorMessage: { type: Type.STRING, nullable: true },
                inferredStartYear: { type: Type.INTEGER }, inferredEndYear: { type: Type.INTEGER },
                themeDescription: { type: Type.STRING }, activeCategories: { type: Type.ARRAY, items: { type: Type.STRING } },
                ...(task === 'suggestion' ? { representativeEntries: {
                    type: Type.ARRAY, minItems: String(SURPRISE_MIN_EXAMPLES), maxItems: String(SURPRISE_MAX_EXAMPLES),
                    items: { type: Type.OBJECT, properties: {
                        name: { type: Type.STRING }, category: { type: Type.STRING },
                        startYear: { type: Type.INTEGER }, endYear: { type: Type.INTEGER },
                    }, required: ['name', 'category', 'startYear', 'endYear'] },
                } } : {}),
            },
            required: ['isValid', 'errorMessage', 'inferredStartYear', 'inferredEndYear', 'themeDescription', 'activeCategories',
                ...(task === 'suggestion' ? ['representativeEntries'] : [])],
        };
        const person = {
            name: { type: Type.STRING }, birthYear: { type: Type.INTEGER }, deathYear: { type: Type.INTEGER },
            occupation: { type: Type.STRING }, description: { type: Type.STRING }, category: { type: Type.STRING },
        };
        // Both Six Degrees answers may legitimately be null: no confident chain, or no identifiable person.
        if (task === 'resolve') return { type: Type.OBJECT, nullable: true, properties: person, required: Object.keys(person) };
        if (task === 'path') return {
            type: Type.OBJECT, nullable: true,
            properties: {
                nodes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, ...person } } },
                links: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { claim: { type: Type.STRING } }, required: ['claim'] } },
            },
            required: ['nodes', 'links'],
        };
        if (task === 'contacts-assess') return { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
            ref: { type: Type.STRING }, verdict: { type: Type.STRING }, interactionType: { type: Type.STRING },
            evidence: { type: Type.STRING }, episode: { type: Type.STRING }, year: { type: Type.INTEGER, nullable: true }, uncertainty: { type: Type.STRING },
        }, required: ['ref', 'verdict', 'evidence'] } };
        if (task === 'contacts-discover') return { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
            source: { type: Type.STRING }, reference: { type: Type.STRING }, claim: { type: Type.STRING },
            person: { type: Type.OBJECT, properties: { ...person, aliases: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: Object.keys(person) },
        }, required: ['source', 'claim'] } };
        if (task === 'contacts-explain') return { type: Type.OBJECT, properties: {
            supported: { type: Type.BOOLEAN }, summary: { type: Type.STRING }, sections: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
                title: { type: Type.STRING }, content: { type: Type.STRING },
            }, required: ['title', 'content'] } },
        }, required: ['supported', 'summary', 'sections'] };
        const events = task === 'events';
        return { type: Type.ARRAY, items: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                [events ? 'startYear' : 'birthYear']: { type: Type.INTEGER },
                [events ? 'endYear' : 'deathYear']: { type: Type.INTEGER },
                [events ? 'type' : 'occupation']: { type: Type.STRING },
                description: { type: Type.STRING }, category: { type: Type.STRING },
            },
            required: ['name', events ? 'startYear' : 'birthYear', events ? 'endYear' : 'deathYear', events ? 'type' : 'occupation', 'description', 'category'],
        } };
    }

    private generate<T>(prompt: string, validate: (value: unknown) => T, signal?: AbortSignal, task: JsonTask = 'people'): Promise<T> {
        const ai = this.ensureAI();
        return generateValidatedJson(prompt, requestPrompt => {
            const request = async () => {
                signal?.throwIfAborted();
                const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
                const config = { systemInstruction: HISTORIAN_SYSTEM_PROMPT, abortSignal: combined,
                    ...(this.supportsJsonSchema ? { responseMimeType: 'application/json', responseSchema: this.schema(task) } : {}) };
                let response: GenerateContentResponse;
                try { response = await withAbort(ai.models.generateContent({ model: this.model, contents: requestPrompt, config }), combined); }
                catch (error) {
                    signal?.throwIfAborted();
                    // Some compatible models reject structured output. Retry with the
                    // full JSON instructions already present in the shared task prompt.
                    const message = error instanceof Error ? error.message : String(error);
                    if (!this.supportsJsonSchema || !/schema|response.?mime|structured|json.?mode/i.test(message) ||
                        !/unsupported|not supported|invalid|not allowed|400/i.test(message)) throw error;
                    this.supportsJsonSchema = false;
                    combined.throwIfAborted();
                    response = await withAbort(ai.models.generateContent({ model: this.model, contents: requestPrompt,
                        config: { systemInstruction: HISTORIAN_SYSTEM_PROMPT, abortSignal: combined } }), combined);
                }
                signal?.throwIfAborted();
                return response.text || '';
            };
            return task === 'preflight' || task === 'suggestion' ? runWithRetry(request, 2, 1000, signal) : enqueueTaskWithRetry(request, signal);
        }, validate, signal);
    }

    validateWeaveQuery(request: WeaveRequest, signal?: AbortSignal): Promise<WeaveValidationResult> {
        return validateWeaveQuery(this.generate.bind(this), request, signal);
    }

    suggestWeaveTopic(excludedTopics?: string[], signal?: AbortSignal, broadenTopic?: string): Promise<WeaveValidationResult> {
        return suggestWeaveTopic(this.generate.bind(this), excludedTopics, signal, broadenTopic);
    }

    fetchHistoricalFigures(start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]> {
        return generateWeaveTimeline(this.generate.bind(this), start, end, signal, context);
    }

    discoverPersonalContacts(request: ContactDiscoveryRequest, signal?: AbortSignal) {
        return requestContactDiscovery(this.generate.bind(this), request, signal);
    }
    assessPersonalContacts(pairs: ContactPair[], signal?: AbortSignal) {
        return requestContactAssessment(this.generate.bind(this), pairs, signal);
    }
    explainPersonalContact(first: ContactPerson, second: ContactPerson, contact: ContactAssessment, signal?: AbortSignal) {
        return requestContactExplanation(this.generate.bind(this), first, second, contact, signal);
    }

    fetchConnectionPath(from: HistoricalFigure, to: HistoricalFigure, options: ConnectionPathOptions, signal?: AbortSignal): Promise<ConnectionPathProposal | null> {
        return requestConnectionPath(this.generate.bind(this), from, to, options, signal);
    }

    resolveFigure(name: string, signal?: AbortSignal): Promise<NewPerson | null> {
        return requestResolveFigure(this.generate.bind(this), name, signal);
    }

    async fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[]): Promise<string[]> {
        try {
            // Send compact historical context without descriptions or images
            const candidates = allFigures.filter(f => f.id !== target.id).map(({ id, name, birthYear, deathYear, category }) => ({ id, name, birthYear, deathYear, category }));

            if (candidates.length === 0) return [];

            const prompt = buildRelatedFiguresPrompt(target, candidates);

            const ai = this.ensureAI();
            const response = await enqueueTaskWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: this.model,
                contents: prompt,
                config: {
                    systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            relatedIds: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            }
                        }
                    }
                }
            }));

            const result = parseJsonResponse(response.text || "{}") as { relatedIds?: string[] };
            if (!Array.isArray(result.relatedIds) || !result.relatedIds.every((id: unknown) => typeof id === 'string')) {
                throw new Error('The model returned an invalid relationship map.');
            }
            return result.relatedIds;

        } catch (error) {
            console.error("Error fetching relationships:", error);
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

    async fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure, _signal?: AbortSignal, options?: RelationshipExplanationOptions): Promise<RelationshipExplanation | null> {
        try {
            const prompt = buildRelationshipExplanationPrompt(source, target, options);

            const ai = this.ensureAI();
            return await generateRelationshipAssessment(async correction => {
                const response = await enqueueTaskWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                    model: this.model,
                    contents: correction ? `${prompt}\n${correction}` : prompt,
                    config: {
                        systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                isRelevant: { type: Type.BOOLEAN },
                                evidence: { type: Type.STRING },
                                summary: { type: Type.STRING },
                                sections: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            title: { type: Type.STRING },
                                            content: { type: Type.STRING }
                                        },
                                        required: ["title", "content"]
                                    }
                                }
                            },
                            required: ["isRelevant", "evidence", "summary", "sections"]
                        }
                    }
                }));

                return parseJsonResponse(response.text || "null");
            });
        } catch (error) {
            console.error("Error fetching relationship explanation:", error);
            throw error;
        }
    }

    async fetchFigureDeepDive(figure: HistoricalFigure): Promise<DeepDiveData | null> {
        try {
            const prompt = buildDeepDivePrompt(figure);

            const ai = this.ensureAI();
            const response = await enqueueTaskWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: this.model,
                contents: prompt,
                config: {
                    systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            summary: { type: Type.STRING },
                            famousQuote: { type: Type.STRING },
                            sections: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING },
                                        content: { type: Type.STRING }
                                    },
                                    required: ["title", "content"]
                                }
                            }
                        },
                        required: ["summary", "famousQuote", "sections"]
                    }
                }
            }));

            return parseJsonResponse(response.text || "null") as DeepDiveData | null;
        } catch (error) {
            console.error("Error fetching figure deep dive:", error);
            return null;
        }
    }
}
