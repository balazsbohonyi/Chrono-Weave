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
const suggestion = { isValid: true, errorMessage: null, inferredStartYear: 1543, inferredEndYear: 1687,
  themeDescription: 'The Scientific Revolution', activeCategories: ['SCIENTISTS'], representativeEntries: [
    { name: 'Nicolaus Copernicus', category: 'SCIENTISTS', startYear: 1473, endYear: 1543 },
    { name: 'Galileo Galilei', category: 'SCIENTISTS', startYear: 1564, endYear: 1642 },
    { name: 'Johannes Kepler', category: 'SCIENTISTS', startYear: 1571, endYear: 1630 },
    { name: 'Isaac Newton', category: 'SCIENTISTS', startYear: 1643, endYear: 1727 },
    { name: 'Christiaan Huygens', category: 'SCIENTISTS', startYear: 1629, endYear: 1695 },
  ] };
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
        return responseFor(provider, JSON.stringify(calls === 1 ? accepted : suggestion));
      };
      const result = await serviceFor(provider).suggestWeaveTopic([accepted.themeDescription]);
      assert.equal(result.themeDescription, suggestion.themeDescription);
      assert.equal('representativeEntries' in result, false);
      assert.equal(calls, 2);
    }
  } finally { globalThis.fetch = previous; }
});

test('all providers screen coverage in the suggestion call and correct sparse, duplicate, or incompatible examples', async () => {
  const previous = globalThis.fetch;
  const changeFirst = (patch: object) => ({ ...suggestion,
    representativeEntries: [{ ...suggestion.representativeEntries[0], ...patch }, ...suggestion.representativeEntries.slice(1)] });
  const invalid = [
    accepted,
    { ...suggestion, representativeEntries: suggestion.representativeEntries.slice(0, 4) },
    changeFirst({ name: '  GALILEO GALILEI  ' }),
    changeFirst({ category: 'ARTISTS' }),
    changeFirst({ category: 'UNKNOWN' }),
    changeFirst({ startYear: 1900, endYear: 1950 }),
    changeFirst({ startYear: 1643, endYear: 1600 }),
    changeFirst({ startYear: 0 }),
    { ...changeFirst({ category: 'EVENTS', startYear: 1600, endYear: 1601 }), activeCategories: ['ALL'] },
  ];
  try {
    for (const provider of providers) {
      for (const bad of invalid) {
        let calls = 0;
        globalThis.fetch = async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          const prompt = promptFor(provider, body);
          assert.match(prompt, /broad, recognizable/);
          assert.match(prompt, /full natural historical span/);
          assert.match(prompt, /representativeEntries/);
          const system = provider === 'gemini' ? body.systemInstruction.parts[0].text : body.messages[0].content;
          assert.match(system, /ChronoWeave, an interactive historical timeline app/);
          if (provider === 'gemini') {
            assert.ok(body.generationConfig.responseSchema.properties.representativeEntries);
            assert.ok(body.generationConfig.responseSchema.required.includes('representativeEntries'));
          }
          if (++calls === 2) assert.match(JSON.stringify(body), /previous response was invalid/);
          return responseFor(provider, JSON.stringify(calls === 1 ? bad : suggestion));
        };
        const result = await serviceFor(provider).suggestWeaveTopic();
        assert.equal(result.themeDescription, suggestion.themeDescription);
        assert.equal(calls, 2);
      }
      let calls = 0;
      globalThis.fetch = async () => { calls++; return responseFor(provider, JSON.stringify(invalid[1])); };
      await assert.rejects(serviceFor(provider).suggestWeaveTopic(), /unusable data after a retry/);
      assert.equal(calls, 2);
    }
  } finally { globalThis.fetch = previous; }
});

test('rich short periods are accepted and broader recovery stays a suggestion rather than a build', async () => {
  const previous = globalThis.fetch;
  const war = { ...suggestion, themeDescription: 'World War II', inferredStartYear: 1939, inferredEndYear: 1945,
    activeCategories: ['ALL'], representativeEntries: [
      ['Winston Churchill', 1874, 1965], ['Franklin D. Roosevelt', 1882, 1945], ['Adolf Hitler', 1889, 1945],
      ['Joseph Stalin', 1878, 1953], ['Charles de Gaulle', 1890, 1970],
    ].map(([name, startYear, endYear]) => ({ name, startYear, endYear, category: 'LEADERS & BADDIES' })) };
  try {
    for (const provider of providers) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        const prompt = promptFor(provider, JSON.parse(String(init?.body)));
        assert.match(prompt, /meaningfully broader related subject/);
        assert.match(prompt, /"The Normandy campaign \(1944\)"/);
        assert.match(prompt, /no fixed minimum number of years/);
        assert.doesNotMatch(prompt, /Select historically significant people\./);
        return responseFor(provider, JSON.stringify(war));
      };
      const result = await serviceFor(provider).suggestWeaveTopic([], undefined, 'The Normandy campaign (1944)');
      assert.equal(result.inferredStartYear, 1939);
      assert.equal(result.inferredEndYear, 1945);
      assert.equal(calls, 1);
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
