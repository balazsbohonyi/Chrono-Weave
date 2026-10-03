import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const PREFIX = '/api/ollama/cloud';
const MAX_BODY_BYTES = 1024 * 1024;
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function isLocalRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  if (req.headers['x-chronoweave-relay'] !== '1') return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!loopbackHosts.has(host.hostname)) return false;
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== host.host) return false;
    }
    return true;
  } catch { return false; }
}

function redact(value: unknown, key: string): unknown {
  if (!key) return value;
  if (typeof value === 'string') return value.split(key).join('[REDACTED]');
  if (Array.isArray(value)) return value.map(item => redact(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name.split(key).join('[REDACTED]'), redact(item, key)]));
  }
  return value;
}

export function createOllamaRelay(environmentKey: string, fetcher: typeof fetch = fetch) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith(`${PREFIX}/`)) { next(); return; }
    if (!isLocalRequest(req)) { send(res, 403, { error: 'The Ollama cloud relay only accepts local, same-origin requests.' }); return; }
    if (path === `${PREFIX}/status` && req.method === 'GET') {
      send(res, 200, { hasApiKey: !!environmentKey.trim() });
      return;
    }
    const isChat = path === `${PREFIX}/chat` && req.method === 'POST';
    const isTags = path === `${PREFIX}/tags` && req.method === 'GET';
    if (!isChat && !isTags) { send(res, 404, { error: 'Unknown Ollama relay endpoint.' }); return; }
    const suppliedKey = req.headers['x-ollama-api-key'];
    const key = typeof suppliedKey === 'string' && suppliedKey.trim() ? suppliedKey.trim() : environmentKey.trim();
    if (isChat && !key) { send(res, 401, { error: 'Enter an Ollama Cloud API key in Settings or configure OLLAMA_API_KEY on the server.' }); return; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      let body: string | undefined;
      if (isChat) {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) { send(res, 413, { error: 'Ollama request is too large.' }); return; }
          chunks.push(Buffer.from(chunk));
        }
        let input: Record<string, unknown>;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { send(res, 400, { error: 'Invalid JSON request.' }); return; }
        if (!input || typeof input.model !== 'string' || !input.model.trim() ||
            !Array.isArray(input.messages) || input.messages.length === 0 ||
            !input.messages.every(message => message && typeof message.content === 'string' &&
              ['system', 'user', 'assistant'].includes(message.role))) {
          send(res, 400, { error: 'A model and valid chat messages are required.' }); return;
        }
        // Fixed destination and explicit fields prevent credential forwarding to arbitrary URLs.
        body = JSON.stringify({
          model: input.model, messages: input.messages.map(({ role, content }) => ({ role, content })), stream: false,
          ...(['low', 'medium', false, true].includes(input.think as string | boolean) ? { think: input.think } : {}),
        });
      }
      const upstream = await fetcher(`https://ollama.com/api/${isChat ? 'chat' : 'tags'}`, {
        method: isChat ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body, signal: controller.signal, redirect: 'error',
      });
      const raw = await upstream.text();
      let data: unknown;
      try { data = JSON.parse(raw); }
      catch { send(res, upstream.ok ? 502 : upstream.status, { error: 'Ollama Cloud returned an unexpected response. Try again later.' }); return; }
      send(res, upstream.status, redact(data, key));
    } catch {
      send(res, controller.signal.aborted ? 504 : 502, {
        error: controller.signal.aborted ? 'Ollama Cloud request timed out.' : 'Cannot reach Ollama Cloud. Check your connection and try again.',
      });
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
    }
  };
}

export function ollamaRelayPlugin(environmentKey: string): Plugin {
  const middleware = createOllamaRelay(environmentKey);
  const install = (server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => unknown } }) => {
    server.middlewares.use((req, res, next) => { void middleware(req, res, next); });
  };
  return { name: 'chronoweave-ollama-relay', configureServer: install, configurePreviewServer: install };
}
