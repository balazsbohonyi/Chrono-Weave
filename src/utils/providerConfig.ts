export type AIProvider = 'gemini' | 'openrouter' | 'ollama';
export type OllamaMode = 'local' | 'cloud';

export interface AppConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  ollamaMode: OllamaMode;
  baseUrl: string;
  ollamaReasoning?: boolean;
}

export interface EnvironmentDefaults {
  provider?: string;
  apiKey?: string;
  model?: string;
  ollamaMode?: string;
  baseUrl?: string;
  ollamaReasoning?: string;
}

export const environmentDefaults: EnvironmentDefaults = {
  provider: process.env.PROVIDER,
  apiKey: process.env.API_KEY,
  model: process.env.MODEL,
  ollamaMode: process.env.OLLAMA_MODE,
  baseUrl: process.env.OLLAMA_BASE_URL,
  ollamaReasoning: process.env.OLLAMA_REASONING,
};

export const providerNames: Record<AIProvider, string> = {
  gemini: 'Google Gemini', openrouter: 'OpenRouter', ollama: 'Ollama',
};

export const isProvider = (value: string | null | undefined): value is AIProvider =>
  value === 'gemini' || value === 'openrouter' || value === 'ollama';

export const defaultModel = (provider: AIProvider, mode: OllamaMode = 'local'): string =>
  provider === 'gemini' ? 'gemini-2.5-flash' : provider === 'openrouter' ? 'openai/gpt-oss-120b'
    : mode === 'cloud' ? 'gpt-oss:20b' : 'gpt-oss:20b-cloud';

export const settingsKey = (provider: AIProvider, mode: OllamaMode = 'local') =>
  `chrono_settings_${provider === 'ollama' ? `ollama_${mode}` : provider}`;

export function migrateLegacySettings(storage: Storage): void {
  const provider = storage.getItem('chrono_provider');
  if (!isProvider(provider) || provider === 'ollama' || storage.getItem(settingsKey(provider))) return;
  const apiKey = storage.getItem('chrono_api_key');
  const model = storage.getItem('chrono_model');
  storage.setItem(settingsKey(provider), JSON.stringify({
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
  }));
}

export function readProviderConfig(
  provider: AIProvider,
  mode: OllamaMode,
  storage: Storage,
  env: EnvironmentDefaults = environmentDefaults,
): AppConfig {
  const usesEnvironment = provider === (isProvider(env.provider) ? env.provider : 'gemini') &&
    (provider !== 'ollama' || mode === (env.ollamaMode === 'cloud' ? 'cloud' : 'local'));
  const config: AppConfig = {
    provider, ollamaMode: mode,
    apiKey: provider === 'ollama' ? '' : usesEnvironment ? env.apiKey || '' : '',
    model: usesEnvironment && env.model ? env.model : defaultModel(provider, mode),
    baseUrl: env.baseUrl || 'http://localhost:11434',
    ollamaReasoning: usesEnvironment && env.ollamaReasoning === 'true',
  };
  try {
    const saved: unknown = JSON.parse(storage.getItem(settingsKey(provider, mode)) || 'null');
    if (saved && typeof saved === 'object') {
      const fields = saved as Record<string, unknown>;
      if (typeof fields.model === 'string' && fields.model.trim()) config.model = fields.model;
      if ((provider !== 'ollama' || mode === 'cloud') && typeof fields.apiKey === 'string') config.apiKey = fields.apiKey;
      if (provider === 'ollama' && mode === 'local' && typeof fields.baseUrl === 'string') config.baseUrl = fields.baseUrl;
      if (provider === 'ollama' && typeof fields.ollamaReasoning === 'boolean') config.ollamaReasoning = fields.ollamaReasoning;
    }
  } catch { /* Ignore malformed stored settings and use environment defaults. */ }
  return config;
}

export function getEffectiveConfig(storage: Storage, env: EnvironmentDefaults = environmentDefaults): AppConfig {
  migrateLegacySettings(storage);
  const storedProvider = storage.getItem('chrono_provider');
  const provider = isProvider(storedProvider) ? storedProvider : isProvider(env.provider) ? env.provider : 'gemini';
  const mode = (storage.getItem('chrono_ollama_mode') || env.ollamaMode) === 'cloud' ? 'cloud' : 'local';
  return readProviderConfig(provider, mode, storage, env);
}

export function saveProviderConfig(config: AppConfig, storage: Storage): void {
  migrateLegacySettings(storage);
  storage.setItem('chrono_provider', config.provider);
  if (config.provider === 'ollama') {
    storage.setItem('chrono_ollama_mode', config.ollamaMode);
  }
  storage.setItem(settingsKey(config.provider, config.ollamaMode), JSON.stringify({
    model: config.model.trim(),
    ...(config.provider !== 'ollama' || config.ollamaMode === 'cloud' ? { apiKey: config.apiKey.trim() } : {}),
    ...(config.provider === 'ollama' && config.ollamaMode === 'local' ? { baseUrl: config.baseUrl.trim() } : {}),
    ...(config.provider === 'ollama' ? { ollamaReasoning: config.ollamaReasoning === true } : {}),
  }));
  // Migrate before removing the shared fields; never copy a cloud key into them.
  storage.removeItem('chrono_api_key');
  storage.removeItem('chrono_model');
}

export function validateLocalUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Enter an absolute HTTP or HTTPS Ollama server URL, such as http://localhost:11434.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS Ollama server URL without credentials, query parameters, or a fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Enter the Ollama server URL without /api or other paths.');
  return url.origin;
}

export function isConfigValid(config: AppConfig, hasCloudEnvironmentKey = false): boolean {
  if (!config.model.trim()) return false;
  if (config.provider !== 'ollama') return !!config.apiKey.trim();
  if (config.ollamaMode === 'cloud') return !!config.apiKey.trim() || hasCloudEnvironmentKey;
  try { validateLocalUrl(config.baseUrl); return true; } catch { return false; }
}
