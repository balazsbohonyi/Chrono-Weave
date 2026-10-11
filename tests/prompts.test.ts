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
  SHORT_DESCRIPTION_MAX_WORDS,
  DEEP_DIVE_SUMMARY_MAX_WORDS,
} from '../src/constants';
import type { IAIService, WeaveGenerationContext } from '../src/types';
import { chatResponse, event, figure, localConfig, person, sections, relationship } from './helpers';
import { buildPeoplePrompt, buildEventsPrompt, buildDiscoveryPrompt, buildDeepDivePrompt, buildRelatedFiguresPrompt, buildRelationshipExplanationPrompt } from '../src/services/prompts';

test('Follow a Figure generation uses the mapping evidence standard for people and events', () => {
  const context: WeaveGenerationContext = { mode: 'figure', query: figure.name, inferredStartYear: 1800,
    inferredEndYear: 1900, themeDescription: 'Ada Lovelace and her connections', activeCategories: ['ALL'] };
  for (const prompt of [buildPeoplePrompt(1800, 1900, 10, context), buildEventsPrompt(1800, 1900, 10, context)]) {
    assert.match(prompt, /Every other person or event must have an established relationship to that exact seed identity/);
    assert.match(prompt, /Shared eras, places, professions, similar ideas, or multi-step chains through unrelated intermediaries do not qualify/);
    assert.match(prompt, /Do not include someone merely as a contemporary/);
    assert.match(prompt, /concrete interaction, role, work, or historical episode linking it to the seed in its description/);
  }
  assert.doesNotMatch(buildPeoplePrompt(1800, 1900, 10, { ...context, mode: 'era' }), /canvas of connections to the named seed/);
});

test('reader-facing tasks share the historical storytelling voice without changing their output structures', () => {
  const eventFigure = { ...figure, name: event.name, category: 'EVENTS' as const };
  const shortPrompts = [buildPeoplePrompt(1800, 1900, 10), buildEventsPrompt(1800, 1900, 10), buildDiscoveryPrompt(figure, [], 1800, 1900)];
  const biographies = [buildDeepDivePrompt(figure), buildDeepDivePrompt(eventFigure)];
  for (const prompt of [...shortPrompts, ...biographies]) {
    assert.match(prompt, /Write for a curious reader in warm, clear, natural language/);
    assert.match(prompt, /Use active verbs and concrete details, without invented dialogue, feelings, motives, scenes, or quotations/);
    assert.match(prompt, /note.*uncertain|uncertain.*plainly|uncertainty naturally/);
  }
  for (const prompt of shortPrompts) {
    assert.match(prompt, new RegExp(`description \\(max ${SHORT_DESCRIPTION_MAX_WORDS} words\\)`));
    assert.match(prompt, /Return a JSON array/);
  }
  for (const prompt of biographies) {
    assert.match(prompt, new RegExp(`summary \\(string, max ${DEEP_DIVE_SUMMARY_MAX_WORDS} words\\)`));
    assert.match(prompt, /each content is a substantial, focused paragraph/);
    assert.match(prompt, /rather than dramatic embellishment/);
  }
  assert.match(biographies[0], /reliably attribute its wording/);
  assert.match(biographies[1], /Set famousQuote to an empty string/);
  assert.match(shortPrompts[2], /actual family tie, shared episode, work, or role in everyday language/);
  // ID selection has no reader-facing prose and must retain its narrow output.
  const mapping = buildRelatedFiguresPrompt(figure, []);
  assert.doesNotMatch(mapping, /Write for a curious reader/);
  assert.match(mapping, /relatedIds \(array of strings\)/);
});

test('relationship narratives request depth and natural prose while retaining factual and rejection safeguards', () => {
  const prompt = buildRelationshipExplanationPrompt(figure, { ...figure, id: 'babbage', name: 'Charles Babbage' });
  assert.match(prompt, /2-3 sentences/);
  assert.match(prompt, /2-4 objects/);
  assert.match(prompt, /250-450 words/);
  assert.match(prompt, /at least four substantive paragraphs/);
  assert.match(prompt, /escaped newline pairs \(\\n\\n\)/);
  assert.match(prompt, /separate from the reader-facing summary and sections/);
  assert.match(prompt, /warm, clear, natural language/);
  assert.match(prompt, /without invented dialogue, feelings, motives, scenes, or quotations/);
  assert.match(prompt, /Do not confuse a parent with a sibling or an uncle with a father/);
  assert.match(prompt, /For isRelevant=false, keep the summary and one limitation section concise/);
  assert.match(prompt, /Shared eras, places, professions, similar ideas, or multi-step chains through unrelated intermediaries do not qualify/);
  assert.doesNotMatch(prompt, /each content is a paragraph/);
});

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
    assert.ok(shared.every(request => request.prompt.includes('Write for a curious reader in warm, clear, natural language')));
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
