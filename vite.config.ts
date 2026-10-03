import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { ollamaRelayPlugin } from './server/ollamaRelay';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), ollamaRelayPlugin(env.OLLAMA_API_KEY || '')],
    define: {
      'process.env.PROVIDER': JSON.stringify(env.PROVIDER),
      'process.env.API_KEY': JSON.stringify(env.PROVIDER === 'ollama' ? '' : env.API_KEY),
      'process.env.MODEL': JSON.stringify(env.MODEL),
      'process.env.OLLAMA_MODE': JSON.stringify(env.OLLAMA_MODE),
      'process.env.OLLAMA_BASE_URL': JSON.stringify(env.OLLAMA_BASE_URL),
      'process.env.OLLAMA_REASONING': JSON.stringify(env.OLLAMA_REASONING),
      'process.env.APP_MODE': JSON.stringify(mode),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    }
  };
});
