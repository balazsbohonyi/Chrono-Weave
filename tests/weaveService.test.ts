import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiService } from '../src/services/geminiService';
import { OpenRouterService } from '../src/services/openRouterService';
import { OllamaService } from '../src/services/ollamaService';
import type { IAIService, WeaveGenerationContext, WeaveRequest } from '../src/types';
import { figure, localConfig, person, event } from './helpers';

const accepted = { isValid: true, errorMessage: null, inferredStartYear: 1800, inferredEndYear: 1900,
  themeDescription: 'Women in Science during the nineteenth century', activeCategories: ['SCIENTISTS'] };
const context: WeaveGenerationContext = { mode: 'theme', query: 'Women in Science during the nineteenth century',
  inferredStartYear: 1800, inferredEndYear: 1900, themeDescription: accepted.themeDescription, activeCategories: ['SCIENTISTS'] };
type Provider = 'gemini' | 'openrouter' | 'ollama';
const providers: Provider[] = ['gemini', 'openrouter', 'ollama'];
const serviceFor = (provider: Provider): IAIService => provider === 'gemini' ? new GeminiService('test-key', 'gemini-model')
  : provider === 'openrouter' ? new OpenRouterService('test-key', 'test-model') : new OllamaService(localConfig);
const responseFor = (provider: Provider, content: string): Response => provider === 'gemini'
  ? Response.json({ candidates: [{ content: { parts: [{ text: content }] } }] })
  : provider === 'openrouter' ? Response.json({ choices: [{ message: { content } }] })
    : Response.json({ message: { content }, done: true });
const promptFor = (provider: Provider, body: any): string => provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[1].content;

test('all providers perform pre-flight using the selected mode and tolerate fenced/prose JSON', async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.match(promptFor(provider, body), /"mode":"theme"/);
        assert.match(promptFor(provider, body), /Women in Science/);
        if (provider !== 'gemini') { assert.equal(body.response_format, undefined); assert.equal(body.format, undefined); }
        return responseFor(provider, `Assessment:\n\`\`\`json\n${JSON.stringify(accepted)}\n\`\`\``);
      };
      const result = await serviceFor(provider).validateWeaveQuery({ mode: 'theme', query: context.query });
      assert.deepEqual(result, accepted);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test('all launcher modes reach AI validation, while invalid strict bounds never make a request', async () => {
  const previous = globalThis.fetch;
  const requests: WeaveRequest[] = [
    { mode: 'time-span', query: '', startYear: 1800, endYear: 1900 }, { mode: 'era', query: 'The Ming Dynasty' },
    { mode: 'figure', query: 'Cleopatra' }, { mode: 'region', query: 'Feudal Japan' },
    { mode: 'theme', query: 'Women in Science' }, { mode: 'freeform', query: 'Female rulers before 1500' },
  ];
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return responseFor(provider, JSON.stringify(accepted)); };
      const service = serviceFor(provider);
      for (const request of requests) assert.equal((await service.validateWeaveQuery(request)).isValid, true);
      assert.equal(calls, 6);
      for (const [startYear, endYear] of [[1900, 1800], [1800, 1800], [-100, -500], [-500, -500],
        [1770, new Date().getFullYear() + 1], [1800.5, 1900], [NaN, 1900], [0, Infinity]]) {
        assert.equal((await service.validateWeaveQuery({ mode: 'time-span', query: '', startYear, endYear })).isValid, false);
      }
      assert.equal(calls, 6);
    }
  } finally { globalThis.fetch = previous; }
});

test('pre-flight rejection is returned inline and malformed or unknown-category responses get one correction', async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      globalThis.fetch = async () => responseFor(provider, JSON.stringify({ isValid: false, errorMessage: 'Name a historical era, such as the Renaissance.' }));
      const service = serviceFor(provider);
      const rejected = await service.validateWeaveQuery({ mode: 'era', query: 'Pizza' });
      assert.equal(rejected.isValid, false);
      assert.match(rejected.errorMessage!, /Renaissance/);
      for (const invalid of ['broken JSON', JSON.stringify({ ...accepted, activeCategories: ['DOCTORS'] })]) {
        let calls = 0;
        globalThis.fetch = async (_url, init) => {
          calls++;
          if (calls === 2) assert.match(JSON.stringify(JSON.parse(String(init?.body))), /previous response was invalid/);
          return responseFor(provider, calls === 1 ? invalid : JSON.stringify(accepted));
        };
        assert.equal((await service.validateWeaveQuery({ mode: 'theme', query: context.query })).isValid, true);
        assert.equal(calls, 2);
      }
      let calls = 0;
      globalThis.fetch = async () => { calls++; return responseFor(provider, '{}'); };
      await assert.rejects(service.validateWeaveQuery({ mode: 'theme', query: context.query }), /unusable data after a retry/);
      assert.equal(calls, 2);
    }
  } finally { globalThis.fetch = previous; }
});

test('Gemini retries unsupported structured output with the complete plain JSON prompt', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls++;
    if (calls === 1) {
      assert.ok(body.generationConfig.responseSchema);
      return Response.json({ error: { code: 400, message: 'response_schema is not supported by this model', status: 'INVALID_ARGUMENT' } }, { status: 400 });
    }
    assert.equal(body.generationConfig?.responseSchema, undefined);
    assert.match(body.contents[0].parts[0].text, /Return one JSON object/);
    return responseFor('gemini', JSON.stringify(accepted));
  };
  try {
    const service = serviceFor('gemini');
    assert.equal((await service.validateWeaveQuery({ mode: 'theme', query: context.query })).isValid, true);
    assert.equal((await service.validateWeaveQuery({ mode: 'theme', query: context.query })).isValid, true);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = previous; }
});

test('suggestions stay separate from timeline generation and avoid already displayed topics', async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.match(promptFor(provider, JSON.parse(String(init?.body))), /previously suggested topics/);
        return responseFor(provider, JSON.stringify(calls === 1 ? accepted : { ...accepted, themeDescription: 'Women astronomers in nineteenth-century America' }));
      };
      const result = await serviceFor(provider).suggestWeaveTopic([accepted.themeDescription]);
      assert.match(result.themeDescription, /astronomers/);
      assert.equal(calls, 2);
    }
  } finally { globalThis.fetch = previous; }
});

test('restricted generation preserves semantic scope, omits events, and filters off-category model entries', { timeout: 30_000 }, async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        const prompt = promptFor(provider, JSON.parse(String(init?.body)));
        assert.match(prompt, /Mandatory canvas scope/);
        assert.match(prompt, /Women in Science during the nineteenth century/);
        assert.match(prompt, /overlap 1800 to 1900/);
        assert.match(prompt, /Date overlap alone is insufficient/);
        assert.doesNotMatch(prompt, /Select major historical events/);
        return responseFor(provider, JSON.stringify([person, { ...person, name: 'Unrelated artist', category: 'ARTISTS' }]));
      };
      const data = await serviceFor(provider).fetchHistoricalFigures(1790, 1910, undefined, context);
      assert.deepEqual(data.map(item => item.name), [person.name]);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test('events-only canvases omit people and later failed batches reject the whole build', { timeout: 30_000 }, async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.match(promptFor(provider, JSON.parse(String(init?.body))), /Select major historical events/);
        return responseFor(provider, JSON.stringify([event]));
      };
      const data = await serviceFor(provider).fetchHistoricalFigures(1790, 1910, undefined, { ...context, activeCategories: ['EVENTS'] });
      assert.equal(data[0].category, 'EVENTS');
      assert.equal(calls, 1);
      calls = 0;
      globalThis.fetch = async () => ++calls === 1 ? responseFor(provider, JSON.stringify([person]))
        : Response.json(provider === 'ollama' ? { error: 'Authentication failed' } : { error: { message: 'Authentication failed' } }, { status: 401 });
      await assert.rejects(serviceFor(provider).fetchHistoricalFigures(1800, 1900), /authentication|Authentication|401/);
      assert.equal(calls, 2);
    }
  } finally { globalThis.fetch = previous; }
});

test('discovery retains the theme and excludes forbidden categories and known identities', { timeout: 30_000 }, async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.match(promptFor(provider, JSON.parse(String(init?.body))), /Women in Science/);
        return responseFor(provider, JSON.stringify([person, { ...person, name: 'Mary Somerville' }, { ...person, name: 'Artist', category: 'ARTISTS' }]));
      };
      const service = serviceFor(provider);
      const data = await service.discoverRelatedFigures(figure, [figure.name], 1790, 1910, undefined, context);
      assert.deepEqual(data.map(item => item.name), ['Mary Somerville']);
      assert.deepEqual(await service.discoverRelatedFigures(figure, [], 1790, 1910, undefined, { ...context, activeCategories: ['EVENTS'] }), []);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test('cancellation wins even when provider transport ignores its signal and does not correct or continue', async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      const controller = new AbortController();
      let release!: (response: Response) => void;
      let started!: () => void;
      let calls = 0;
      const ready = new Promise<void>(resolve => { started = resolve; });
      globalThis.fetch = async () => { calls++; started(); return new Promise<Response>(resolve => { release = resolve; }); };
      const promise = serviceFor(provider).validateWeaveQuery({ mode: 'theme', query: context.query }, controller.signal);
      await ready;
      controller.abort(new Error('Cancelled weave'));
      await assert.rejects(promise, /Cancelled weave/);
      release(responseFor(provider, JSON.stringify(accepted)));
      await Promise.resolve();
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test('cancelled generation frees the queue for a new build and never continues the old one', { timeout: 30_000 }, async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of providers) {
      const controller = new AbortController();
      let release!: (response: Response) => void;
      let started!: () => void;
      let calls = 0;
      const ready = new Promise<void>(resolve => { started = resolve; });
      globalThis.fetch = async () => { calls++; started(); return new Promise<Response>(resolve => { release = resolve; }); };
      const service = serviceFor(provider);
      const promise = service.fetchHistoricalFigures(1800, 1900, controller.signal);
      await ready;
      controller.abort();
      await assert.rejects(promise);
      globalThis.fetch = async () => { calls++; return responseFor(provider, JSON.stringify([person])); };
      const retry = await service.fetchHistoricalFigures(1790, 1910, undefined, context);
      assert.equal(retry.length, 1);
      assert.equal(calls, 2);
      release(responseFor(provider, JSON.stringify([person])));
      await Promise.resolve();
      assert.equal(calls, 2);
    }
  } finally { globalThis.fetch = previous; }
});
