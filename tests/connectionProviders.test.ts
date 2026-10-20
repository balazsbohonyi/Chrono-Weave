import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiService } from '../src/services/geminiService';
import { OpenRouterService } from '../src/services/openRouterService';
import { OllamaService } from '../src/services/ollamaService';
import type { ConnectionPathOptions, HistoricalFigure, IAIService } from '../src/types';
import { chatResponse, localConfig, relationship } from './helpers';

const person = (id: string, name: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const from = person('leonardo', 'Leonardo da Vinci', 1452, 1519);
const to = person('galileo', 'Galileo Galilei', 1564, 1642);
const options: ConnectionPathOptions = {
  catalog: [{ id: 'vasari', name: 'Giorgio Vasari', birthYear: 1511, deathYear: 1574 }],
  maxIntermediates: 10,
};
const resolved = { name: 'Henry VIII', birthYear: 1491, deathYear: 1547, occupation: 'King', description: 'King of England.', category: 'LEADERS & BADDIES' };

test('every provider runs the same contact-only path and resolve prompts and maps the answer back to canvas ids', { timeout: 30_000 }, async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost:3000' } } });
  let provider = '';
  let answers: unknown[] = [];
  const requests: Record<string, Array<{ prompt: string; body: Record<string, any> }>> = {};
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests[provider].push({
      prompt: provider === 'gemini' ? body.contents[0].parts[0].text : body.messages.find((message: { role: string }) => message.role === 'user').content,
      body,
    });
    const data = answers.shift();
    if (provider === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] });
    if (provider === 'openrouter') return Response.json({ choices: [{ message: { content: JSON.stringify(data) } }] });
    return chatResponse(data);
  };
  const services: Array<[string, IAIService]> = [
    ['gemini', new GeminiService('test-key', 'gemini-model')],
    ['openrouter', new OpenRouterService('test-key', 'test-model')],
    ['ollama', new OllamaService(localConfig)],
  ];
  try {
    for (const [name, service] of services) {
      provider = name;
      requests[name] = [];
      answers = [
        { nodes: [{ id: 'A' }, { id: 'c1' }, { id: 'B' }], links: [{ claim: 'They met.' }, { claim: 'They corresponded.' }] },
        null,
        resolved,
        null,
        relationship,
        relationship,
      ];
      const path = await service.fetchConnectionPath(from, to, options);
      assert.deepEqual(path?.nodes, [{ id: 'leonardo' }, { id: 'vasari' }, { id: 'galileo' }]);
      assert.equal(await service.fetchConnectionPath(from, to, options), null);
      assert.equal((await service.resolveFigure('Henry VIII'))?.name, 'Henry VIII');
      assert.equal(await service.resolveFigure('Zzyzx'), null);
      assert.equal((await service.fetchRelationshipExplanation(from, to, undefined, { contactOnly: true }))?.isRelevant, true);
      assert.equal((await service.fetchRelationshipExplanation(from, to))?.isRelevant, true);
    }
    const shared = requests.gemini;
    for (const name of ['openrouter', 'ollama']) {
      assert.deepEqual(requests[name].map(request => request.prompt), shared.map(request => request.prompt));
    }
    assert.match(shared[0].prompt, /personal interaction/);
    assert.match(shared[0].prompt, /Influence through works\/ideas/);
    assert.match(shared[0].prompt, /"id":"c1"/);
    assert.match(shared[2].prompt, /Identify the one real historical person/);
    // The contact option reaches the prompt of every provider; the default stays the general standard.
    assert.match(shared[4].prompt, /Only documented personal contact qualifies/);
    assert.doesNotMatch(shared[4].prompt, /specifically engaged with the other person's work/);
    assert.match(shared[5].prompt, /specifically engaged with the other person's work/);
    // Gemini constrains both answers with a schema that allows null; the others rely on the prompt alone.
    assert.ok(shared.every(request => request.body.generationConfig.responseSchema));
    assert.ok(requests.openrouter.every(request => request.body.response_format === undefined));
    assert.ok(requests.ollama.every(request => request.body.format === undefined));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
