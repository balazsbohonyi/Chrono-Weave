import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAIService } from '../src/services/aiService';
import { OllamaService } from '../src/services/ollamaService';
import { GeminiService } from '../src/services/geminiService';
import { OpenRouterService } from '../src/services/openRouterService';
import { figure, localConfig } from './helpers';

test('service factory selects the requested provider without a Gemini default', () => {
  assert.ok(createAIService(localConfig) instanceof OllamaService);
  assert.ok(createAIService({ ...localConfig, provider: 'gemini', model: 'gemini-model' }) instanceof GeminiService);
  assert.ok(createAIService({ ...localConfig, provider: 'openrouter', model: 'router-model' }) instanceof OpenRouterService);
});

test('explicitly empty Gemini credentials cannot inherit another provider environment key', async () => {
  const previous = process.env.API_KEY;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  let requests = 0;
  process.env.API_KEY = 'different-provider-key';
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected network request'); };
  console.error = () => undefined;
  try {
    const service = createAIService({ ...localConfig, provider: 'gemini', apiKey: '', model: 'gemini-model' });
    const result = await service.testConnection();
    assert.equal(result.success, false);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
    if (previous === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previous;
  }
});

test('Gemini relationship and discovery failures reject instead of reporting no connections', async () => {
  const service = new GeminiService('', 'test-model');
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(service.fetchRelatedFigures(figure, [figure, { ...figure, id: 'other' }]), /API key not configured/);
    await assert.rejects(service.discoverRelatedFigures(figure, [figure.name], 1800, 1900), /API key not configured/);
  } finally {
    console.error = previousError;
  }
});

test('Gemini rejects missing and malformed discovery responses rather than caching an empty expansion', async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  console.error = () => undefined;
  const service = new GeminiService('test-key', 'gemini-model');
  try {
    for (const text of ['', '{}']) {
      globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
      await assert.rejects(service.discoverRelatedFigures(figure, [figure.name], 1800, 1900), /invalid discovery data|no JSON/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
});

test('OpenRouter rejects failed or malformed relationship results instead of treating them as empty', { timeout: 10_000 }, async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousError = console.error;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost:3000' } } });
  console.error = () => undefined;
  const service = new OpenRouterService('test-key', 'test-model');
  const candidates = [figure, { ...figure, id: 'other' }];
  try {
    globalThis.fetch = async () => Response.json({ error: { message: 'Authentication failed' } }, { status: 401 });
    await assert.rejects(service.fetchRelatedFigures(figure, candidates), /Authentication failed/);
    await assert.rejects(service.discoverRelatedFigures(figure, [figure.name], 1800, 1900), /Authentication failed/);
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{}' } }] });
    await assert.rejects(service.fetchRelatedFigures(figure, candidates), /invalid relationship map/);
    await assert.rejects(service.discoverRelatedFigures(figure, [figure.name], 1800, 1900), /invalid discovery data/);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
