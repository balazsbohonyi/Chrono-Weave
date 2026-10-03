import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveConfig, isConfigValid, readProviderConfig, saveProviderConfig, settingsKey, validateLocalUrl } from '../src/utils/providerConfig';
import { localConfig, MemoryStorage } from './helpers';

test('keyless local Ollama settings override Gemini environment defaults', () => {
  const storage = new MemoryStorage();
  saveProviderConfig(localConfig, storage);
  const config = getEffectiveConfig(storage, { provider: 'gemini', apiKey: 'environment-key', model: 'environment-model' });
  assert.equal(config.provider, 'ollama');
  assert.equal(config.model, localConfig.model);
  assert.equal(config.apiKey, '');
  assert.ok(isConfigValid(config));
});

test('Ollama environment settings work without an API key', () => {
  const config = getEffectiveConfig(new MemoryStorage(), { provider: 'ollama', model: 'custom:cloud', baseUrl: 'http://127.0.0.1:11434' });
  assert.equal(config.model, 'custom:cloud');
  assert.equal(config.baseUrl, 'http://127.0.0.1:11434');
  assert.ok(isConfigValid(config));
});

test('legacy credentials and models survive provider switching', () => {
  const storage = new MemoryStorage();
  storage.setItem('chrono_provider', 'openrouter');
  storage.setItem('chrono_api_key', 'legacy-key');
  storage.setItem('chrono_model', 'legacy-model');
  assert.equal(getEffectiveConfig(storage, {}).apiKey, 'legacy-key');
  saveProviderConfig(localConfig, storage);
  const restored = readProviderConfig('openrouter', 'local', storage, {});
  assert.equal(restored.apiKey, 'legacy-key');
  assert.equal(restored.model, 'legacy-model');
  assert.equal(storage.getItem('chrono_api_key'), null);
});

test('local and cloud profiles remember different models; cloud credentials survive a fresh storage instance', () => {
  const storage = new MemoryStorage();
  saveProviderConfig(localConfig, storage);
  saveProviderConfig({ ...localConfig, ollamaMode: 'cloud', model: 'cloud-model', apiKey: 'session-secret' }, storage);
  assert.equal(getEffectiveConfig(storage, {}).apiKey, 'session-secret');
  assert.equal(readProviderConfig('ollama', 'local', storage, {}).model, 'test-model');
  assert.equal(readProviderConfig('ollama', 'cloud', storage, {}).model, 'cloud-model');
  const reloaded = new MemoryStorage();
  for (let index = 0; index < storage.length; index++) reloaded.setItem(storage.key(index)!, storage.getItem(storage.key(index)!)!);
  const restored = getEffectiveConfig(reloaded, {});
  assert.equal(restored.apiKey, 'session-secret');
  assert.equal(isConfigValid(restored), true);
  saveProviderConfig({ ...restored, apiKey: '' }, reloaded);
  assert.equal(getEffectiveConfig(reloaded, {}).apiKey, '');
  assert.equal(isConfigValid(getEffectiveConfig(reloaded, {})), false);
  assert.equal(isConfigValid(restored, true), true);
  assert.equal(readProviderConfig('ollama', 'local', reloaded, {}).apiKey, '');
});

test('each provider retains its own key and model when switching away and back', () => {
  const storage = new MemoryStorage();
  saveProviderConfig({ ...localConfig, provider: 'gemini', model: 'gemini-custom', apiKey: 'gemini-key' }, storage);
  saveProviderConfig({ ...localConfig, provider: 'openrouter', model: 'router-custom', apiKey: 'router-key' }, storage);
  saveProviderConfig({ ...localConfig, ollamaMode: 'cloud', model: 'cloud-custom', apiKey: 'cloud-key' }, storage);
  saveProviderConfig(localConfig, storage);
  assert.equal(readProviderConfig('gemini', 'local', storage, {}).apiKey, 'gemini-key');
  assert.equal(readProviderConfig('gemini', 'local', storage, {}).model, 'gemini-custom');
  assert.equal(readProviderConfig('openrouter', 'local', storage, {}).apiKey, 'router-key');
  assert.equal(readProviderConfig('ollama', 'cloud', storage, {}).apiKey, 'cloud-key');
  assert.equal(readProviderConfig('ollama', 'cloud', storage, {}).model, 'cloud-custom');
  assert.equal(readProviderConfig('ollama', 'local', storage, {}).apiKey, '');
});

test('partial legacy settings keep environment credential and model fallbacks', () => {
  const storage = new MemoryStorage();
  storage.setItem('chrono_provider', 'gemini');
  const config = getEffectiveConfig(storage, { provider: 'gemini', apiKey: 'environment-key', model: 'environment-model' });
  assert.equal(config.apiKey, 'environment-key');
  assert.equal(config.model, 'environment-model');
});

test('invalid stored settings fall back to environment defaults without crashing', () => {
  const storage = new MemoryStorage();
  storage.setItem(settingsKey('ollama'), 'not json');
  assert.equal(readProviderConfig('ollama', 'local', storage, { provider: 'ollama', model: 'env-model' }).model, 'env-model');
  storage.setItem(settingsKey('ollama', 'cloud'), JSON.stringify({ model: 'cloud', apiKey: 'persisted-secret' }));
  assert.equal(readProviderConfig('ollama', 'cloud', storage, {}).apiKey, 'persisted-secret');
});

test('local URL validation rejects credentials, non-HTTP protocols, paths and query parameters', () => {
  assert.equal(validateLocalUrl('http://localhost:11434/'), 'http://localhost:11434');
  for (const url of ['file:///tmp', 'http://user:secret@localhost:11434', 'http://localhost:11434/api', 'http://localhost:11434?key=secret', 'http://localhost:11434#fragment']) {
    assert.throws(() => validateLocalUrl(url));
    assert.equal(isConfigValid({ ...localConfig, baseUrl: url }), false);
  }
});

test('reasoning defaults off for old profiles and environment can opt in', () => {
  const storage = new MemoryStorage();
  storage.setItem(settingsKey('ollama'), JSON.stringify({ model: 'old-model' }));
  assert.equal(readProviderConfig('ollama', 'local', storage, {}).ollamaReasoning, false);
  const env = { provider: 'ollama', ollamaMode: 'local', ollamaReasoning: 'true' };
  assert.equal(readProviderConfig('ollama', 'local', storage, env).ollamaReasoning, true);
  assert.equal(readProviderConfig('ollama', 'cloud', storage, env).ollamaReasoning, false);
  storage.setItem(settingsKey('ollama'), JSON.stringify({ ollamaReasoning: 'true' }));
  assert.equal(readProviderConfig('ollama', 'local', storage, {}).ollamaReasoning, false);
});

test('reasoning persists separately for local and cloud and saved false overrides environment', () => {
  const storage = new MemoryStorage();
  saveProviderConfig({ ...localConfig, ollamaReasoning: true }, storage);
  saveProviderConfig({ ...localConfig, ollamaMode: 'cloud', ollamaReasoning: false }, storage);
  assert.equal(readProviderConfig('ollama', 'local', storage, {}).ollamaReasoning, true);
  assert.equal(readProviderConfig('ollama', 'cloud', storage, { provider: 'ollama', ollamaMode: 'cloud', ollamaReasoning: 'true' }).ollamaReasoning, false);
});
