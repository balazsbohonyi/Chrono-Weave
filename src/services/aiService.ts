import type { IAIService } from '../types';
import type { AppConfig } from '../utils/providerConfig';
import { GeminiService } from './geminiService';
import { OpenRouterService } from './openRouterService';
import { OllamaService } from './ollamaService';

export function createAIService(config: AppConfig): IAIService {
  if (config.provider === 'ollama') return new OllamaService(config);
  if (config.provider === 'openrouter') return new OpenRouterService(config.apiKey, config.model);
  return new GeminiService(config.apiKey, config.model);
}
