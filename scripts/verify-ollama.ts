// Opt-in live verification; sends requests to the chosen model and consumes its quota.
// Run with Bun after starting Ollama (or the ChronoWeave server for cloud mode).
import assert from 'node:assert/strict';
import { OllamaService } from '../src/services/ollamaService';
import type { AppConfig } from '../src/utils/providerConfig';
import type { HistoricalFigure } from '../src/types';

const cloud = process.env.OLLAMA_MODE === 'cloud';
const config: AppConfig = {
  provider: 'ollama', ollamaMode: cloud ? 'cloud' : 'local',
  model: process.argv[2] || (process.env.PROVIDER === 'ollama' ? process.env.MODEL : '') || (cloud ? 'gpt-oss:20b' : 'gpt-oss:20b-cloud'),
  apiKey: cloud ? process.env.OLLAMA_API_KEY || '' : '',
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaReasoning: process.env.OLLAMA_REASONING === 'true',
};
const service = new OllamaService(config, (url, init) => fetch(
  cloud ? new URL(String(url), process.env.CHRONOWEAVE_URL || 'http://localhost:3000') : url, init,
));
const ada: HistoricalFigure = { id: 'ada', name: 'Ada Lovelace', birthYear: 1815, deathYear: 1852, category: 'SCIENTISTS', occupation: 'Mathematician' };
const babbage: HistoricalFigure = { id: 'babbage', name: 'Charles Babbage', birthYear: 1791, deathYear: 1871, category: 'SCIENTISTS', occupation: 'Mathematician' };

const models = await service.listModels();
assert.ok(models.length > 0);
console.log('Model catalog:', models.length, 'models');
const connection = await service.testConnection();
assert.ok(connection.success, connection.error);
console.log('Connection test passed');
const related = await service.fetchRelatedFigures(ada, [ada, babbage]);
assert.ok(related.includes(babbage.id));
console.log('Relationship tracing passed');
const relationship = await service.fetchRelationshipExplanation(ada, babbage);
assert.ok(relationship.summary && relationship.sections.length > 0);
console.log('Relationship explanation passed');
const biography = await service.fetchFigureDeepDive(ada);
assert.ok(biography.summary && biography.sections.length > 0);
console.log('Biography passed');
const discoveries = await service.discoverRelatedFigures(ada, [ada.name, babbage.name], 1750, 1900);
assert.ok(discoveries.every(figure => ![ada.name, babbage.name].includes(figure.name)));
console.log('Discovery passed:', discoveries.length, 'figures');
const timeline = await service.fetchHistoricalFigures(1800, 1900);
assert.ok(timeline.some(figure => figure.category !== 'EVENTS'));
assert.ok(timeline.some(figure => figure.category === 'EVENTS'));
console.log('Timeline generation passed:', timeline.length, 'entries');
