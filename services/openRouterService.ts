
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

    private parseJson(text: string): any {
        try {
            return JSON.parse(text);
        } catch (e) {
            const match = text.match(/```json([\s\S]*?)```/);
            if (match && match[1]) {
                try {
                    return JSON.parse(match[1]);
                } catch (e2) {}
            }
            const matchNoLang = text.match(/```([\s\S]*?)```/);
            if (matchNoLang && matchNoLang[1]) {
                try {
                    return JSON.parse(matchNoLang[1]);
                } catch (e3) {}
            }
            const startBrace = text.indexOf('{');
            const endBrace = text.lastIndexOf('}');
            if (startBrace !== -1 && endBrace !== -1) {
                try {
                     return JSON.parse(text.substring(startBrace, endBrace + 1));
                } catch(e4) {}
            }
            const startBracket = text.indexOf('[');
            const endBracket = text.lastIndexOf(']');
            if (startBracket !== -1 && endBracket !== -1) {
                try {
                     return JSON.parse(text.substring(startBracket, endBracket + 1));
                } catch(e5) {}
            }
            console.error("Failed to parse JSON. Raw text:", text);
            throw new Error("Failed to parse JSON from OpenRouter response");
        }
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
        console.log(`[OpenRouter] Requesting figures chunk: ${start}-${end}. Prompting for ${HISTORICAL_FIGURES_PER_CENTURY_CHUNK} figures.`);
        const prompt = `
            Generate a list of exactly ${HISTORICAL_FIGURES_PER_CENTURY_CHUNK} distinct and famous historical figures.
            Range: ${start}-${end}.
            Rules:
            1. Integers for birth/death.
            2. Concise occupation (max 3 words).
            3. Short bio (max 25 words).
            4. Classify category from: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
            
            Return JSON array of objects with keys: "name", "birthYear", "deathYear", "occupation", "description", "category".
        `;

        try {
            const peopleData = await runWithRetry(() => this.callOpenRouter(prompt, "You are a JSON generator. Strictly output valid JSON arrays."));
            
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
             console.warn(`Failed to fetch chunk ${start}-${end}`, error);
             return [];
        }
    }

    private async fetchEventsChunk(start: number, end: number): Promise<HistoricalFigure[]> {
        console.log(`[OpenRouter] Requesting events chunk: ${start}-${end}. Prompting for ${HISTORICAL_EVENTS_PER_CENTURY_CHUNK} events.`);
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
            
            Return JSON array of objects with keys: "name", "startYear", "endYear", "type", "description", "category".
        `;
        try {
             const eventsData = await runWithRetry(() => this.callOpenRouter(prompt, "You are a JSON generator. Strictly output valid JSON arrays."));
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
        console.log(`[OpenRouter] Starting timeline build: ${startYear}-${endYear}`);
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
             console.log(`[OpenRouter] Requesting single batch of figures for ${startYear}-${endYear}. Prompting for ${HISTORICAL_FIGURES_COUNT} figures.`);
             const peoplePrompt = `
                Generate a list of exactly ${HISTORICAL_FIGURES_COUNT} distinct and famous historical figures.
                Range: ${startYear}-${endYear}.
                Rules:
                1. Integers for birth/death.
                2. Concise occupation (max 3 words).
                3. Short bio (max 25 words).
                4. Classify category from: ${CATEGORY_LIST.filter(c => c !== 'EVENTS').join(', ')}.
                
                Return JSON array of objects with keys: "name", "birthYear", "deathYear", "occupation", "description", "category".
            `;
             try {
                const peopleData = await safeAICall(() => this.callOpenRouter(peoplePrompt, "You are a JSON generator. Strictly output valid JSON arrays."));
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
        console.log(`[OpenRouter] Requesting global events for ${startYear}-${endYear}. Prompting for ${HISTORICAL_EVENTS_COUNT} events.`);
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

        return [...uniqueFigures, ...uniqueEvents].filter((f: HistoricalFigure) => 
            f.birthYear <= f.deathYear && 
            f.deathYear >= startYear && 
            f.birthYear <= endYear
        );
    }

    async fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[]): Promise<string[]> {
        console.log(`[OpenRouter] Analyzing relationships for: ${target.name}`);
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
        console.log(`[OpenRouter] Discovering NEW figures related to: ${target.name}`);
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
            })).filter((f: HistoricalFigure) => f.birthYear < f.deathYear);
        } catch (error) {
            console.error("OpenRouter discoverRelatedFigures error:", error);
            return [];
        }
    }

    async fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure): Promise<RelationshipExplanation | null> {
         console.log(`[OpenRouter] Explaining relationship: ${source.name} <---> ${target.name}`);
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
        console.log(`[OpenRouter] Deep dive for: ${figure.name}`);
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
