import { generateRelationshipAssessment } from './relationshipAssessment';

import { GenerateContentResponse, GoogleGenAI, Type } from "@google/genai";
import { DeepDiveData, HistoricalFigure, IAIService, RelationshipExplanation } from "../types";
import {
  TIMELINE_CHUNKING_THRESHOLD_YEARS,
  TIMELINE_CHUNK_YEARS,
  HISTORICAL_EVENTS_COUNT,
  HISTORICAL_EVENTS_PER_CENTURY_CHUNK,
  HISTORICAL_FIGURES_COUNT,
  HISTORICAL_FIGURES_PER_CENTURY_CHUNK,
} from '../constants';
import {
  buildPeoplePrompt,
  buildEventsPrompt,
  buildDiscoveryPrompt,
  buildRelatedFiguresPrompt,
  buildRelationshipExplanationPrompt,
  buildDeepDivePrompt,
  HISTORIAN_SYSTEM_PROMPT,
  CONNECTION_TEST_PROMPT,
} from './prompts';
import { runWithRetry, enqueueTaskWithRetry } from "./utils";

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

    private async fetchFiguresChunk(start: number, end: number): Promise<HistoricalFigure[]> {
        const prompt = buildPeoplePrompt(start, end, HISTORICAL_FIGURES_PER_CENTURY_CHUNK);

        try {
            const ai = this.ensureAI();
            // Using runWithRetry directly to allow parallelism via Promise.all in the caller
            const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: this.model,
                contents: prompt,
                config: {
                    systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                birthYear: { type: Type.INTEGER },
                                deathYear: { type: Type.INTEGER },
                                occupation: { type: Type.STRING },
                                description: { type: Type.STRING },
                                category: { type: Type.STRING },
                            },
                            required: ["name", "birthYear", "deathYear", "occupation", "description", "category"],
                        },
                    },
                },
            }));

            const peopleData = JSON.parse(response.text || "[]");

            return peopleData.map((item: any, index: number) => ({
                id: `p-${item.name.replace(/\s+/g, '-')}-${start}-${index}`,
                name: item.name,
                birthYear: item.birthYear,
                deathYear: item.deathYear,
                occupation: item.occupation,
                category: item.category,
                shortDescription: item.description
            }));
        } catch (error) {
            console.warn(`Failed to fetch chunk ${start}-${end}`, error);
            return [];
        }
    }

    private async fetchEventsChunk(start: number, end: number): Promise<HistoricalFigure[]> {
        const prompt = buildEventsPrompt(start, end, HISTORICAL_EVENTS_PER_CENTURY_CHUNK);

        try {
            const ai = this.ensureAI();
            const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: this.model,
                contents: prompt,
                config: {
                    systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                startYear: { type: Type.INTEGER },
                                endYear: { type: Type.INTEGER },
                                type: { type: Type.STRING },
                                description: { type: Type.STRING },
                                category: { type: Type.STRING },
                            },
                            required: ["name", "startYear", "endYear", "type", "description", "category"],
                        },
                    },
                },
            }));

            const eventsData = JSON.parse(response.text || "[]");

            return eventsData.map((item: any, index: number) => ({
                id: `e-${item.name.replace(/\s+/g, '-')}-${start}-${index}`,
                name: item.name,
                birthYear: item.startYear,
                deathYear: item.endYear,
                occupation: item.type,
                category: 'EVENTS',
                shortDescription: item.description
            }));
        } catch (error) {
            console.warn(`Failed to fetch events chunk ${start}-${end}`, error);
            return [];
        }
    }

    async fetchHistoricalFigures(startYear: number, endYear: number): Promise<HistoricalFigure[]> {
        const model = this.model;

        // 1. Fetch People (Chunked if > 200 years, else standard)
        let peoplePromise: Promise<HistoricalFigure[]>;

        if (endYear - startYear > TIMELINE_CHUNKING_THRESHOLD_YEARS) {
            const chunks = [];
            for (let y = startYear; y < endYear; y += TIMELINE_CHUNK_YEARS) {
                chunks.push({ start: y, end: Math.min(y + TIMELINE_CHUNK_YEARS, endYear) });
            }
            peoplePromise = Promise.all(chunks.map(chunk => this.fetchFiguresChunk(chunk.start, chunk.end)))
                .then(results => results.flat());
        } else {
            // Standard single prompt
            const peoplePrompt = buildPeoplePrompt(startYear, endYear, HISTORICAL_FIGURES_COUNT);

            const ai = this.ensureAI();
            peoplePromise = enqueueTaskWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model,
                contents: peoplePrompt,
                config: {
                    systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                birthYear: { type: Type.INTEGER },
                                deathYear: { type: Type.INTEGER },
                                occupation: { type: Type.STRING },
                                description: { type: Type.STRING },
                                category: { type: Type.STRING },
                            },
                            required: ["name", "birthYear", "deathYear", "occupation", "description", "category"],
                        },
                    },
                },
            })).then(response => {
                const peopleData = JSON.parse(response.text || "[]");
                return peopleData.map((item: any, index: number) => ({
                    id: `p-${item.name.replace(/\s+/g, '-')}-${index}`,
                    name: item.name,
                    birthYear: item.birthYear,
                    deathYear: item.deathYear,
                    occupation: item.occupation,
                    category: item.category,
                    shortDescription: item.description
                }));
            }).catch(() => []);
        }

        // 2. Fetch Events (Mixed Strategy: Global + Chunked if > TIMELINE_CHUNKING_THRESHOLD_YEARS)
        let eventsPromise: Promise<HistoricalFigure[]>;

        // Always fetch global events for continuity
        const globalEventsPrompt = buildEventsPrompt(startYear, endYear, HISTORICAL_EVENTS_COUNT);

        const ai = this.ensureAI();
        const globalEventsPromise = enqueueTaskWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: globalEventsPrompt,
            config: {
                systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            startYear: { type: Type.INTEGER },
                            endYear: { type: Type.INTEGER },
                            type: { type: Type.STRING },
                            description: { type: Type.STRING },
                            category: { type: Type.STRING },
                        },
                        required: ["name", "startYear", "endYear", "type", "description", "category"],
                    },
                },
            },
        })).then(response => {
            const eventsData = JSON.parse(response.text || "[]");
            return eventsData.map((item: any, index: number) => ({
                id: `e-g-${item.name.replace(/\s+/g, '-')}-${index}`,
                name: item.name,
                birthYear: item.startYear,
                deathYear: item.endYear,
                occupation: item.type,
                category: 'EVENTS',
                shortDescription: item.description
            }));
        }).catch(() => []);

        if (endYear - startYear > TIMELINE_CHUNKING_THRESHOLD_YEARS) {
            // Also fetch chunks for better density
            const chunks = [];
            for (let y = startYear; y < endYear; y += TIMELINE_CHUNK_YEARS) {
                chunks.push({ start: y, end: Math.min(y + TIMELINE_CHUNK_YEARS, endYear) });
            }

            const chunkEventsPromise = Promise.all(chunks.map(chunk => this.fetchEventsChunk(chunk.start, chunk.end)))
                .then(results => results.flat());

            eventsPromise = Promise.all([globalEventsPromise, chunkEventsPromise])
                .then(([global, chunked]) => [...global, ...chunked]);
        } else {
            eventsPromise = globalEventsPromise;
        }

        try {
            // Run People and Events in parallel
            const [people, rawEvents] = await Promise.all([peoplePromise, eventsPromise]);

            // Deduplicate people (names might overlap in adjacent century chunks)
            const seenNames = new Set<string>();
            const uniquePeople: HistoricalFigure[] = [];
            for (const p of people) {
                const key = p.name.trim().toLowerCase();
                if (!seenNames.has(key)) {
                    seenNames.add(key);
                    uniquePeople.push(p);
                }
            }

            // Deduplicate Events (by Name OR by exact Start/End year match)
            const uniqueEvents: HistoricalFigure[] = [];
            for (const ev of rawEvents) {
                const isDuplicate = uniqueEvents.some(existing => {
                    const existingName = existing.name.toLowerCase().trim();
                    const newName = ev.name.toLowerCase().trim();
                    const existingTime = `${existing.birthYear}-${existing.deathYear}`;
                    const newTime = `${ev.birthYear}-${ev.deathYear}`;

                    return existingName === newName || existingTime === newTime;
                });

                if (!isDuplicate) {
                    uniqueEvents.push(ev);
                }
            }

            const allFigures = [...uniquePeople, ...uniqueEvents].filter((f: HistoricalFigure) => {
                // Validate that deathYear is a valid number (not null, undefined, or NaN)
                const hasValidDeathYear = f.deathYear != null && typeof f.deathYear === 'number' && !isNaN(f.deathYear);
                const hasValidBirthYear = f.birthYear != null && typeof f.birthYear === 'number' && !isNaN(f.birthYear);

                if (!hasValidBirthYear || !hasValidDeathYear) {
                    return false;
                }

                // For events, ensure both birthYear (startYear) and deathYear (endYear) are valid
                if (f.category === 'EVENTS') {
                    const currentYear = new Date().getFullYear();

                    // Filter out events that have deathYear = current year when timeline endYear < current year
                    // This indicates the AI incorrectly set an ongoing event marker for a historical timeline
                    if (endYear < currentYear && f.deathYear === currentYear) {
                        console.warn(`[Gemini] Filtering out event "${f.name}" with invalid current year end date`);
                        return false;
                    }

                    // Event must span at least 1 year and overlap with timeline range
                    return f.birthYear < f.deathYear &&
                        f.deathYear >= startYear &&
                        f.birthYear <= endYear;
                }
                // For figures, allow deathYear >= birthYear and must overlap with timeline range
                return f.birthYear <= f.deathYear &&
                    f.deathYear >= startYear &&
                    f.birthYear <= endYear;
            });

            return allFigures;

        } catch (error) {
            console.error("Error fetching figures/events:", error);
            return [];
        }
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

            const result = JSON.parse(response.text || "{}");
            if (!Array.isArray(result.relatedIds) || !result.relatedIds.every((id: unknown) => typeof id === 'string')) {
                throw new Error('The model returned an invalid relationship map.');
            }
            return result.relatedIds;

        } catch (error) {
            console.error("Error fetching relationships:", error);
            throw error;
        }
    }

    async discoverRelatedFigures(
        target: HistoricalFigure,
        existingNames: string[],
        startYear: number,
        endYear: number
    ): Promise<HistoricalFigure[]> {
        try {
            const prompt = buildDiscoveryPrompt(target, existingNames, startYear, endYear);

            const ai = this.ensureAI();
            const response = await enqueueTaskWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: this.model,
                contents: prompt,
                config: {
                    systemInstruction: HISTORIAN_SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                birthYear: { type: Type.INTEGER },
                                deathYear: { type: Type.INTEGER },
                                occupation: { type: Type.STRING },
                                description: { type: Type.STRING },
                                category: { type: Type.STRING },
                            },
                            required: ["name", "birthYear", "deathYear", "occupation", "description", "category"],
                        },
                    },
                },
            }));

            const rawData = JSON.parse(response.text || "null");
            if (!Array.isArray(rawData)) throw new Error('The model returned invalid discovery data.');

            return rawData.map((item: any, index: number) => ({
                id: `${item.name.replace(/\s+/g, '-')}-${Date.now()}-${index}`, // Ensure unique ID
                name: item.name,
                birthYear: item.birthYear,
                deathYear: item.deathYear,
                occupation: item.occupation,
                category: item.category,
                shortDescription: item.description
            })).filter((f: HistoricalFigure) => {
                const hasValidDeathYear = f.deathYear != null && typeof f.deathYear === 'number' && !isNaN(f.deathYear);
                const hasValidBirthYear = f.birthYear != null && typeof f.birthYear === 'number' && !isNaN(f.birthYear);
                return hasValidBirthYear && hasValidDeathYear && f.birthYear < f.deathYear;
            });

        } catch (error) {
            console.error("Error discovering new figures:", error);
            throw error;
        }
    }

    async fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure): Promise<RelationshipExplanation | null> {
        try {
            const prompt = buildRelationshipExplanationPrompt(source, target);

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

                return JSON.parse(response.text || "null");
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

            return JSON.parse(response.text || "null");
        } catch (error) {
            console.error("Error fetching figure deep dive:", error);
            return null;
        }
    }
}
