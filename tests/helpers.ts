import type { AppConfig } from '../src/utils/providerConfig';

export class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

export const localConfig: AppConfig = {
  provider: 'ollama', ollamaMode: 'local', model: 'test-model', apiKey: '', baseUrl: 'http://localhost:11434',
};

export const person = { name: 'Ada Lovelace', birthYear: 1815, deathYear: 1852, occupation: 'Mathematician', description: 'Early computing pioneer.', category: 'SCIENTISTS' };
export const figure = { id: 'ada', name: person.name, birthYear: person.birthYear, deathYear: person.deathYear, occupation: person.occupation, category: 'SCIENTISTS' as const };
export const event = { name: 'Industrial Revolution', startYear: 1760, endYear: 1840, type: 'Industrial transformation', description: 'Expansion of mechanized production.', category: 'EVENTS' };
export const sections = { summary: 'Historical summary.', sections: [{ title: 'Context', content: 'Historical context.' }] };
export const chatResponse = (data: unknown) => Response.json({ message: { content: JSON.stringify(data) }, done: true });

export const relationship = { ...sections, isRelevant: true, evidence: 'Ada Lovelace published notes on Charles Babbage\'s Analytical Engine.' };
