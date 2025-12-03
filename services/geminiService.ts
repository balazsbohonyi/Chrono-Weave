
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { HistoricalFigure, DeepDiveData, RelationshipExplanation, IAIService } from "../types";
import { safeAICall, runWithRetry } from "./utils";
import { CATEGORY_LIST, HISTORICAL_FIGURES_COUNT, HISTORICAL_EVENTS_COUNT, HISTORICAL_FIGURES_PER_CENTURY_CHUNK, HISTORICAL_EVENTS_PER_CENTURY_CHUNK } from "../constants";

export class GeminiService implements IAIService {
    private ai: GoogleGenAI;

    constructor() {
        // NOTE: We assume process.env.API_KEY is available.
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }

    private async fetchFiguresChunk(start: number, end: number): Promise<HistoricalFigure[]> {
        console.log(`[Gemini] Requesting figures chunk for years ${start}-${end}. Prompting for ${HISTORICAL_FIGURES_PER_CENTURY_CHUNK} figures across categories: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.`);
        const prompt = `
            Generate a list of exactly ${HISTORICAL_FIGURES_PER_CENTURY_CHUNK} distinct and famous historical figures (politicians, rulers, artists, scientists, etc.) 
            who lived primarily between the years ${start} and ${end}.
            
            Strict rules:
            1. The figure must have been alive for at least part of the range ${start}-${end}.
            2. Birth year and death year must be integers. 
            3. If the exact year is unknown, estimate it as an integer.
            4. Do not include overlapping duplicates.
            5. Provide a concise occupation (max 3 words).
            6. Provide a short, interesting bio description (max 25 words).
            7. Classify into exactly one category: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
        `;

        try {
            // Using runWithRetry directly to allow parallelism via Promise.all in the caller
            const response = await runWithRetry<GenerateContentResponse>(() => this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
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
        console.log(`[Gemini] Requesting events chunk for years ${start}-${end}. Prompting for ${HISTORICAL_EVENTS_PER_CENTURY_CHUNK} major events.`);
        const prompt = `
            Generate a list of exactly ${HISTORICAL_EVENTS_PER_CENTURY_CHUNK} MAJOR historical events (wars, treaties, movements, ages) 
            that occurred between the years ${start} and ${end}.
            
            Strict rules:
            1. The event must have occurred within ${start}-${end}.
            2. The event MUST span at least 3 years. Exclude single-day battles or short events.
            3. Start year and End year must be integers.
            4. If the event is ongoing, set endYear to ${new Date().getFullYear()}.
            5. Provide a concise type (max 3 words) e.g. "War", "Treaty".
            6. Provide a short description (max 25 words).
            7. Set category strictly to 'EVENTS'.
            8. Select based on historical importance.
        `;

        try {
            const response = await runWithRetry<GenerateContentResponse>(() => this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
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
        console.log(`[Gemini] Starting full timeline build for ${startYear}-${endYear}`);
        const model = "gemini-2.5-flash";
        
        // 1. Fetch People (Chunked if > 200 years, else standard)
        let peoplePromise: Promise<HistoricalFigure[]>;

        if (endYear - startYear > 200) {
            const chunks = [];
            for (let y = startYear; y < endYear; y += 100) {
                chunks.push({ start: y, end: Math.min(y + 100, endYear) });
            }
            peoplePromise = Promise.all(chunks.map(chunk => this.fetchFiguresChunk(chunk.start, chunk.end)))
                .then(results => results.flat());
        } else {
             console.log(`[Gemini] Requesting single batch of figures for ${startYear}-${endYear}. Prompting for ${HISTORICAL_FIGURES_COUNT} figures.`);
             // Standard single prompt
             const peoplePrompt = `
                Generate a list of exactly ${HISTORICAL_FIGURES_COUNT} distinct and famous historical figures (politicians, rulers, artists, scientists, etc.) 
                who lived primarily between the years ${startYear} and ${endYear}.
                
                Strict rules:
                1. The figure must have been alive for at least part of the range ${startYear}-${endYear}.
                2. Birth year and death year must be integers. 
                3. If the exact year is unknown, estimate it as an integer.
                4. Do not include overlapping duplicates.
                5. Provide a concise occupation (max 3 words).
                6. Provide a short, interesting bio description (max 25 words).
                7. Classify into exactly one category: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
            `;
            
            peoplePromise = safeAICall<GenerateContentResponse>(() => this.ai.models.generateContent({
                model,
                contents: peoplePrompt,
                config: {
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

        // 2. Fetch Events (Mixed Strategy: Global + Chunked if > 200)
        let eventsPromise: Promise<HistoricalFigure[]>;
        
        console.log(`[Gemini] Requesting global major events for ${startYear}-${endYear}. Prompting for ${HISTORICAL_EVENTS_COUNT} global events.`);
        // Always fetch global events for continuity
        const globalEventsPrompt = `
            Generate a list of exactly ${HISTORICAL_EVENTS_COUNT} MAJOR historical events (wars, treaties, movements, ages) 
            that occurred between the years ${startYear} and ${endYear}.
            
            Strict rules:
            1. The event must have occurred within ${startYear}-${endYear}.
            2. The event MUST span at least 3 years (e.g. 1939-1945). Exclude single-day battles or short events.
            3. Start year and End year must be integers.
            4. If the event is ongoing (relative to history or current day), set endYear to ${new Date().getFullYear()}.
            5. Provide a concise type (max 3 words) e.g. "War", "Treaty".
            6. Provide a short description (max 25 words).
            7. Set category strictly to 'EVENTS'.
            8. Select based on historical importance and longevity.
        `;

        const globalEventsPromise = safeAICall<GenerateContentResponse>(() => this.ai.models.generateContent({
            model,
            contents: globalEventsPrompt,
            config: {
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

        if (endYear - startYear > 200) {
            // Also fetch chunks for better density
            const chunks = [];
            for (let y = startYear; y < endYear; y += 100) {
                chunks.push({ start: y, end: Math.min(y + 100, endYear) });
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

            const allFigures = [...uniquePeople, ...uniqueEvents].filter((f: HistoricalFigure) => 
                f.birthYear <= f.deathYear && 
                f.deathYear >= startYear && 
                f.birthYear <= endYear
            );

            return allFigures;

        } catch (error) {
            console.error("Error fetching figures/events:", error);
            return [];
        }
    }

    async fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[]): Promise<string[]> {
        console.log(`[Gemini] Analyzing relationships for figure: ${target.name} (${target.birthYear}-${target.deathYear})`);
        try {
            // We only send names to save context
            const candidates = allFigures.filter(f => f.id !== target.id).map(f => ({ id: f.id, name: f.name }));
            
            if (candidates.length === 0) return [];

            const prompt = `
                I am analyzing: "${target.name}" (${target.occupation}, ${target.birthYear}-${target.deathYear}).
                
                Here is a list of other figures and events on my timeline:
                ${JSON.stringify(candidates)}

                Identify which of these figures "${target.name}" likely met, influenced, was influenced by, or fought with.
                If the target is a person, also identify which EVENTS they participated in.
                
                Return a JSON object with a single property "relatedIds" which is an array of strings containing ONLY the 'id' of the related figures/events.
                Be selective. Only include significant connections.
            `;

            const response = await safeAICall<GenerateContentResponse>(() => this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
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
            return result.relatedIds || [];

        } catch (error) {
            console.error("Error fetching relationships:", error);
            return [];
        }
    }

    async discoverRelatedFigures(
        target: HistoricalFigure,
        existingNames: string[],
        startYear: number,
        endYear: number
    ): Promise<HistoricalFigure[]> {
        console.log(`[Gemini] Discovering NEW figures related to: ${target.name} (Timeline: ${startYear}-${endYear})`);
        try {
            const prompt = `
                I have a timeline focusing on ${target.name} (${target.birthYear}-${target.deathYear}).
                
                Find exactly 5 NEW historical figures who:
                1. Had a direct and significant relationship with ${target.name} (friend, rival, student, teacher, family).
                2. Lived primarily between ${startYear} and ${endYear}.
                3. Are NOT in this list: ${JSON.stringify(existingNames)}.
                
                Strict rules:
                1. Provide a concise occupation (max 3 words).
                2. Provide a short, interesting bio description (max 25 words).
                3. Classify into exactly one category: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
                
                Strictly formatted as JSON array.
            `;

            const response = await safeAICall<GenerateContentResponse>(() => this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
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

            const rawData = JSON.parse(response.text || "[]");
            
            return rawData.map((item: any, index: number) => ({
                id: `${item.name.replace(/\s+/g, '-')}-${Date.now()}-${index}`, // Ensure unique ID
                name: item.name,
                birthYear: item.birthYear,
                deathYear: item.deathYear,
                occupation: item.occupation,
                category: item.category,
                shortDescription: item.description
            })).filter((f: HistoricalFigure) => f.birthYear < f.deathYear);

        } catch (error) {
            console.error("Error discovering new figures:", error);
            return [];
        }
    }

    async fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure): Promise<RelationshipExplanation | null> {
        console.log(`[Gemini] Explaining relationship: ${source.name} <---> ${target.name}`);
        try {
            const prompt = `
                Explain the historical relationship between ${source.name} (${source.birthYear}-${source.deathYear}) and ${target.name} (${target.birthYear}-${target.deathYear}).
                
                Provide the output in JSON format with:
                1. "summary": A 1-2 sentence high-level summary of their connection.
                2. "sections": An array of objects, each having a "title" (e.g., "Direct Interactions", "Intellectual Influence", "Conflict", "Legacy") and "content" (a paragraph explaining that aspect).
                
                Ensure the tone is educational and historical.
            `;

            const response = await safeAICall<GenerateContentResponse>(() => this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
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
                        required: ["summary", "sections"]
                    }
                }
            }));

            return JSON.parse(response.text || "null");
        } catch (error) {
            console.error("Error fetching relationship explanation:", error);
            return null;
        }
    }

    async fetchFigureDeepDive(figure: HistoricalFigure): Promise<DeepDiveData | null> {
        console.log(`[Gemini] Fetching Deep Dive for: ${figure.name}`);
        try {
            const prompt = `
                Provide a detailed historical analysis of ${figure.name} (${figure.birthYear}-${figure.deathYear}, ${figure.occupation}).
                
                Return a JSON object with:
                1. "summary": A comprehensive summary of their life and major impact (max 60 words).
                2. "famousQuote": A short, verified, and famous quote attributed to them (or a very short description of their philosophy if no quote exists).
                3. "sections": An array of 4 sections, specifically: "Early Life", "Major Achievements", "Key Relationships", and "Historical Legacy". Each content should be a substantial paragraph.
            `;

            const response = await safeAICall<GenerateContentResponse>(() => this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
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
