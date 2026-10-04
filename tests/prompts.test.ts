import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiService } from '../src/services/geminiService';
import { OpenRouterService } from '../src/services/openRouterService';
import { OllamaService } from '../src/services/ollamaService';
import {
  DEEP_DIVE_SECTION_TITLES,
  EVENT_DEEP_DIVE_SECTION_TITLES,
  HISTORICAL_EVENTS_COUNT,
  HISTORICAL_FIGURES_COUNT,
} from '../src/constants';
import type { IAIService } from '../src/types';
import { chatResponse, event, figure, localConfig, person, sections, relationship } from './helpers';

test('providers share task instructions while retaining their API response mechanisms', { timeout: 30_000 }, async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost:3000' } } });
  const requests: Record<string, { prompt: string; system: unknown; body: Record<string, any> }[]> = {};
  let provider = '';
  let responseData: unknown;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const prompt = provider === 'gemini'
      ? body.contents[0].parts[0].text
      : body.messages.find((message: { role: string }) => message.role === 'user').content;
    requests[provider].push({
      prompt,
      system: provider === 'gemini' ? body.systemInstruction.parts[0].text : body.messages[0].content,
      body,
    });
    if (provider === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(responseData) }] } }] });
    if (provider === 'openrouter') return Response.json({ choices: [{ message: { content: JSON.stringify(responseData) } }] });
    return chatResponse(responseData);
  };
  const services: [string, IAIService][] = [
    ['gemini', new GeminiService('test-key', 'gemini-model')],
    ['openrouter', new OpenRouterService('test-key', 'test-model')],
    ['ollama', new OllamaService(localConfig)],
  ];
  const eventFigure = { id: 'event', name: event.name, birthYear: event.startYear, deathYear: event.endYear, category: 'EVENTS' as const, occupation: event.type };
  try {
    for (const [name, service] of services) {
      provider = name;
      requests[name] = [];
      // A short range uses the whole-range targets. Small valid arrays remain acceptable.
      let timelineRequest = 0;
      const captureFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        responseData = ++timelineRequest === 1 ? [person] : [event];
        return captureFetch(url, init);
      };
      const timeline = await service.fetchHistoricalFigures(1800, 1900);
      globalThis.fetch = captureFetch;
      assert.equal(timeline.length, 2);

      responseData = [];
      assert.deepEqual(await service.discoverRelatedFigures(figure, [figure.name], 1800, 1900), []);
      responseData = relationship;
      assert.deepEqual(await service.fetchRelationshipExplanation(figure, eventFigure), relationship);
      responseData = { ...sections, famousQuote: '' };
      await service.fetchFigureDeepDive(figure);
      await service.fetchFigureDeepDive(eventFigure);
    }

    const shared = requests.gemini;
    for (const name of ['openrouter', 'ollama']) {
      assert.deepEqual(requests[name].map(request => request.prompt), shared.map(request => request.prompt));
      assert.deepEqual(requests[name].map(request => request.system), shared.map(request => request.system));
    }
    assert.match(shared[0].prompt, new RegExp(`Aim for ${HISTORICAL_FIGURES_COUNT} distinct`));
    assert.match(shared[1].prompt, new RegExp(`return up to ${HISTORICAL_EVENTS_COUNT}`));
    for (const title of DEEP_DIVE_SECTION_TITLES) assert.ok(shared[4].prompt.includes(title));
    for (const title of EVENT_DEEP_DIVE_SECTION_TITLES) assert.ok(shared[5].prompt.includes(title));
    assert.match(shared[5].prompt, /Set famousQuote to an empty string/);
    assert.ok(shared.every(request => request.body.generationConfig.responseSchema));
    assert.ok(requests.openrouter.every(request => request.body.response_format === undefined));
    assert.ok(requests.ollama.every(request => request.body.format === undefined));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('relationship prompts share selection rules and retain provider candidate IDs', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost:3000' } } });
  const candidate = { ...figure, id: 'canvas-candidate-id', name: 'Charles Babbage' };
  let provider = '';
  const prompts: Record<string, string> = {};
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const prompt = provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[1].content;
    prompts[provider] = prompt;
    const catalog = JSON.parse(prompt.match(/^Candidates: (.*)$/m)[1]);
    assert.equal(catalog[0].name, candidate.name);
    assert.equal(catalog[0].category, candidate.category);
    const data = { relatedIds: [catalog[0].id] };
    if (provider === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] });
    if (provider === 'openrouter') return Response.json({ choices: [{ message: { content: JSON.stringify(data) } }] });
    assert.equal(catalog[0].id, 'c1');
    return chatResponse(data);
  };
  try {
    const services: [string, IAIService][] = [
      ['gemini', new GeminiService('test-key', 'gemini-model')],
      ['openrouter', new OpenRouterService('test-key', 'test-model')],
      ['ollama', new OllamaService(localConfig)],
    ];
    for (const [name, service] of services) {
      provider = name;
      assert.deepEqual(await service.fetchRelatedFigures(figure, [figure, candidate]), [candidate.id]);
    }
    assert.equal(prompts.openrouter, prompts.gemini);
    assert.equal(prompts.ollama.replace('"id":"c1"', '"id":"canvas-candidate-id"'), prompts.gemini);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
