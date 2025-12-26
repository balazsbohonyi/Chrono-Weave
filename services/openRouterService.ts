
import { HistoricalFigure, DeepDiveData, RelationshipExplanation, IAIService, FigureCategory } from "../types";
import { safeAICall, runWithRetry } from "./utils";
import { CATEGORY_LIST, HISTORICAL_FIGURES_COUNT, HISTORICAL_EVENTS_COUNT, HISTORICAL_FIGURES_PER_CENTURY_CHUNK, HISTORICAL_EVENTS_PER_CENTURY_CHUNK } from "../constants";

export class OpenRouterService implements IAIService {
    private apiKey: string;
    private model: string;
    private baseUrl: string = "https://openrouter.ai/api/v1/chat/completions";

    constructor(apiKey: string, model: string) {
        this.apiKey = apiKey;
        this.model = model;
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch(this.baseUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": window.location.origin,
                    "X-Title": "ChronoWeave"
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: "user", content: "Say 'ok'" }],
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

    private parseJson(text: string): any {
        // Trim the text to remove any leading/trailing whitespace
        const trimmedText = text.trim();

        // First, try parsing the text directly
        try {
            return JSON.parse(trimmedText);
        } catch (e) {
            console.warn("[OpenRouter] Direct JSON parse failed:", (e as Error).message);
            // If direct parse fails, try cleaning and extracting
        }

        // Try to extract JSON from markdown code blocks (```json ... ``` or ``` ... ```)
        const markdownMatch = trimmedText.match(/```(?:json)?[\s\n]*([\s\S]*?)```/);
        if (markdownMatch && markdownMatch[1] && markdownMatch[1].trim().length > 0) {
            try {
                const extracted = markdownMatch[1].trim();
                console.log("[OpenRouter] Markdown extraction found, attempting parse.");
                return JSON.parse(extracted);
            } catch (e2) {
                console.warn("[OpenRouter] Markdown extraction found but parse failed:", (e2 as Error).message);
            }
        }



        // If we get here, parsing failed
        console.error("[OpenRouter] Failed to parse JSON. First 500 chars:", trimmedText.substring(0, 500));
        console.error("[OpenRouter] Last 500 chars:", trimmedText.substring(Math.max(0, trimmedText.length - 500)));
        throw new Error("Failed to parse JSON from OpenRouter response");
    }

    private async callOpenRouter(prompt: string, systemPrompt?: string): Promise<any> {
        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });

        const response = await fetch(this.baseUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.origin,
                "X-Title": "ChronoWeave"
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`OpenRouter API Error: ${response.status} - ${errBody}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        return this.parseJson(content);
    }

    private async fetchFiguresChunk(start: number, end: number): Promise<HistoricalFigure[]> {
        const prompt = `
            Generate a list of exactly ${HISTORICAL_FIGURES_PER_CENTURY_CHUNK} distinct and famous historical figures.
            Range: ${start}-${end}.
            Rules:
            1. Integers for birth/death.
            2. Concise occupation (max 3 words).
            3. Short bio (max 25 words).
            4. Classify category from: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
            
            CRITICAL: Return ONLY valid JSON. ALL string values MUST be in double quotes. Do NOT wrap in markdown code blocks.
            Return JSON array of objects with keys: "name", "birthYear", "deathYear", "occupation", "description", "category".
        `;

        try {
            const peopleData = await runWithRetry(() => this.callOpenRouter(prompt, "You are a strict JSON generator. Output ONLY valid JSON arrays. ALL string values MUST be properly quoted. Do NOT use markdown."));

            if (!Array.isArray(peopleData)) return [];

            return peopleData.map((item: any, index: number) => ({
                id: `p-${item.name.replace(/\s+/g, '-')}-${start}-${index}`,
                name: item.name,
                birthYear: item.birthYear,
                deathYear: item.deathYear,
                occupation: item.occupation,
                category: item.category as FigureCategory,
                shortDescription: item.description
            }));
        } catch (error) {
            console.warn(`[OpenRouter] Failed to fetch figures chunk ${start}-${end}:`, (error as Error).message);
            return [];
        }
    }

    private async fetchEventsChunk(start: number, end: number): Promise<HistoricalFigure[]> {
        const prompt = `
            Generate a list of exactly ${HISTORICAL_EVENTS_PER_CENTURY_CHUNK} MAJOR historical events.
            Range: ${start}-${end}.
            Rules:
            1. Integers for startYear/endYear.
            2. Duration MUST be >= 3 years.
            3. If ongoing, set endYear to ${new Date().getFullYear()}.
            4. Type (max 3 words).
            5. Short description (max 25 words).
            6. Category MUST be 'EVENTS'.
            
            CRITICAL: Return ONLY valid JSON. ALL string values MUST be in double quotes. Do NOT wrap in markdown code blocks.
            Return JSON array of objects with keys: "name", "startYear", "endYear", "type", "description", "category".
        `;
        try {
            const eventsData = await runWithRetry(() => this.callOpenRouter(prompt, "You are a strict JSON generator. Output ONLY valid JSON arrays. ALL string values MUST be properly quoted. Do NOT use markdown."));
            if (Array.isArray(eventsData)) {
                return eventsData.map((item: any, index: number) => ({
                    id: `e-${item.name.replace(/\s+/g, '-')}-${start}-${index}`,
                    name: item.name,
                    birthYear: item.startYear,
                    deathYear: item.endYear,
                    occupation: item.type,
                    category: 'EVENTS' as FigureCategory,
                    shortDescription: item.description
                }));
            }
            return [];
        } catch (e) {
            console.warn(`Failed to fetch events chunk ${start}-${end}`, e);
            return [];
        }
    }

    async fetchHistoricalFigures(startYear: number, endYear: number): Promise<HistoricalFigure[]> {
        let figures: HistoricalFigure[] = [];

        // 1. Fetch People (Chunked if > 200)
        if (endYear - startYear > 200) {
            const chunks = [];
            for (let y = startYear; y < endYear; y += 100) {
                chunks.push({ start: y, end: Math.min(y + 100, endYear) });
            }
            try {
                const chunkResults = await Promise.all(chunks.map(chunk => this.fetchFiguresChunk(chunk.start, chunk.end)));
                figures = chunkResults.flat();
            } catch (e) {
                console.error("Chunk fetch failed", e);
            }
        } else {
            const peoplePrompt = `
                Generate a list of exactly ${HISTORICAL_FIGURES_COUNT} distinct and famous historical figures.
                Range: ${startYear}-${endYear}.
                Rules:
                1. Integers for birth/death.
                2. Concise occupation (max 3 words).
                3. Short bio (max 25 words).
                4. Classify category from: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
                
                CRITICAL: Return ONLY valid JSON. ALL string values MUST be in double quotes. Do NOT wrap in markdown code blocks.
                Return JSON array of objects with keys: "name", "birthYear", "deathYear", "occupation", "description", "category".
            `;
            try {
                const peopleData = await safeAICall(() => this.callOpenRouter(peoplePrompt, "You are a strict JSON generator. Output ONLY valid JSON arrays. ALL string values MUST be properly quoted. Do NOT use markdown."));
                if (Array.isArray(peopleData)) {
                    figures = figures.concat(peopleData.map((item: any, index: number) => ({
                        id: `p-${item.name.replace(/\s+/g, '-')}-${index}`,
                        name: item.name,
                        birthYear: item.birthYear,
                        deathYear: item.deathYear,
                        occupation: item.occupation,
                        category: item.category as FigureCategory,
                        shortDescription: item.description
                    })));
                }
            } catch (e) { console.error(e); }
        }

        // 2. Fetch Events
        const globalEventsPrompt = `
            Generate a list of exactly ${HISTORICAL_EVENTS_COUNT} MAJOR historical events.
            Range: ${startYear}-${endYear}.
            Rules:
            1. Integers for startYear/endYear.
            2. Duration MUST be >= 3 years.
            3. If ongoing, set endYear to ${new Date().getFullYear()}.
            4. Type (max 3 words).
            5. Short description (max 25 words).
            6. Category MUST be 'EVENTS'.
            
            Return JSON array of objects with keys: "name", "startYear", "endYear", "type", "description", "category".
        `;

        let rawEvents: HistoricalFigure[] = [];
        const globalEventsPromise = safeAICall(() => this.callOpenRouter(globalEventsPrompt, "You are a JSON generator. Strictly output valid JSON arrays."))
            .then((eventsData: any) => {
                if (Array.isArray(eventsData)) {
                    return eventsData.map((item: any, index: number) => ({
                        id: `e-g-${item.name.replace(/\s+/g, '-')}-${index}`,
                        name: item.name,
                        birthYear: item.startYear,
                        deathYear: item.endYear,
                        occupation: item.type,
                        category: 'EVENTS' as FigureCategory,
                        shortDescription: item.description
                    }));
                }
                return [];
            })
            .catch(() => []);

        if (endYear - startYear > 200) {
            const chunks = [];
            for (let y = startYear; y < endYear; y += 100) {
                chunks.push({ start: y, end: Math.min(y + 100, endYear) });
            }
            const chunkEventsPromise = Promise.all(chunks.map(chunk => this.fetchEventsChunk(chunk.start, chunk.end)))
                .then(results => results.flat());

            rawEvents = await Promise.all([globalEventsPromise, chunkEventsPromise])
                .then(([global, chunked]) => [...global, ...chunked]);
        } else {
            rawEvents = await globalEventsPromise;
        }

        // Deduplicate Logic
        const seenNames = new Set<string>();
        const uniqueFigures: HistoricalFigure[] = [];
        for (const f of figures) {
            const key = f.name.trim().toLowerCase();
            if (!seenNames.has(key)) {
                seenNames.add(key);
                uniqueFigures.push(f);
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

        return [...uniqueFigures, ...uniqueEvents].filter((f: HistoricalFigure) => {
            // Validate that both birthYear and deathYear are valid numbers (not null, undefined, or NaN)
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
                    console.warn(`[OpenRouter] Filtering out event "${f.name}" with invalid current year end date`);
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
    }

    async fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[]): Promise<string[]> {
        const candidates = allFigures.filter(f => f.id !== target.id).map(f => ({ id: f.id, name: f.name }));
        if (candidates.length === 0) return [];

        const prompt = `
            I am analyzing: "${target.name}".
            List of others: ${JSON.stringify(candidates)}
            Identify significant connections (met, influenced, fought, participated in).
            Return JSON object with property "relatedIds" (array of strings).
        `;

        try {
            const result = await safeAICall(() => this.callOpenRouter(prompt, "You are a JSON generator. Output valid JSON."));
            return result.relatedIds || [];
        } catch (error) {
            console.error("OpenRouter fetchRelatedFigures error:", error);
            return [];
        }
    }

    async discoverRelatedFigures(target: HistoricalFigure, existingNames: string[], startYear: number, endYear: number): Promise<HistoricalFigure[]> {
        const prompt = `
            Timeline focus: ${target.name}.
            Find 5 NEW figures related to target within ${startYear}-${endYear}.
            Exclude: ${JSON.stringify(existingNames)}.
            Category from: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
            Return JSON array of objects: "name", "birthYear", "deathYear", "occupation", "description", "category".
        `;

        try {
            const rawData = await safeAICall(() => this.callOpenRouter(prompt, "You are a JSON generator. Output valid JSON arrays."));
            if (!Array.isArray(rawData)) return [];

            return rawData.map((item: any, index: number) => ({
                id: `${item.name.replace(/\s+/g, '-')}-${Date.now()}-${index}`,
                name: item.name,
                birthYear: item.birthYear,
                deathYear: item.deathYear,
                occupation: item.occupation,
                category: item.category as FigureCategory,
                shortDescription: item.description
            })).filter((f: HistoricalFigure) => {
                const hasValidDeathYear = f.deathYear != null && typeof f.deathYear === 'number' && !isNaN(f.deathYear);
                const hasValidBirthYear = f.birthYear != null && typeof f.birthYear === 'number' && !isNaN(f.birthYear);
                return hasValidBirthYear && hasValidDeathYear && f.birthYear < f.deathYear;
            });
        } catch (error) {
            console.error("OpenRouter discoverRelatedFigures error:", error);
            return [];
        }
    }

    async fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure): Promise<RelationshipExplanation | null> {
        const prompt = `
            Explain relationship between ${source.name} and ${target.name}.
            Return JSON: "summary" (string), "sections" (array of {title, content}).
        `;
        try {
            return await safeAICall(() => this.callOpenRouter(prompt, "You are a JSON generator. Output valid JSON."));
        } catch (error) {
            console.error("OpenRouter fetchRelationshipExplanation error:", error);
            return null;
        }
    }

    async fetchFigureDeepDive(figure: HistoricalFigure): Promise<DeepDiveData | null> {
        const prompt = `
            Historical analysis of ${figure.name}.
            Return JSON: "summary" (string), "famousQuote" (string), "sections" (array of {title, content}).
        `;
        try {
            return await safeAICall(() => this.callOpenRouter(prompt, "You are a JSON generator. Output valid JSON."));
        } catch (error) {
            console.error("OpenRouter fetchFigureDeepDive error:", error);
            return null;
        }
    }
}
