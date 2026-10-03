import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOllamaRelay } from '../server/ollamaRelay';

async function withRelay(key: string, upstream: typeof fetch, check: (url: string) => Promise<void>) {
  const relay = createOllamaRelay(key, upstream);
  const server = createServer((req, res) => { void relay(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ollama/cloud`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

const headers = { 'X-ChronoWeave-Relay': '1', 'Content-Type': 'application/json' };
const body = JSON.stringify({ model: 'exact-cloud-model', messages: [{ role: 'user', content: 'Hello' }], stream: true, url: 'https://attacker.example' });

test('relay forwards low reasoning effort and drops other unapproved generation options', async () => {
  let calls = 0;
  await withRelay('environment-test-key', async (_url, init) => {
    const forwarded = JSON.parse(String(init?.body));
    assert.equal(forwarded.think, calls++ === 0 ? 'low' : undefined);
    assert.equal(forwarded.options, undefined);
    return Response.json({ message: { content: '{"ok":true}' } });
  }, async url => {
    for (const think of ['low', { unexpected: true }]) {
      const response = await fetch(`${url}/chat`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...JSON.parse(body), think, options: { num_predict: -1 } }),
      });
      assert.equal(response.status, 200);
    }
  });
  assert.equal(calls, 2);
});

test('relay keeps environment credentials server-side and uses a fixed destination', async () => {
  await withRelay('environment-test-key', async (url, init) => {
    assert.equal(String(url), 'https://ollama.com/api/chat');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer environment-test-key');
    assert.equal(init?.redirect, 'error');
    const forwarded = JSON.parse(String(init?.body));
    assert.equal(forwarded.model, 'exact-cloud-model');
    assert.equal(forwarded.stream, false);
    assert.equal(forwarded.url, undefined);
    return Response.json({ message: { content: 'Hello' } });
  }, async url => {
    const status = await fetch(`${url}/status`, { headers });
    assert.deepEqual(await status.json(), { hasApiKey: true });
    const response = await fetch(`${url}/chat`, { method: 'POST', headers: { ...headers, Origin: new URL(url).origin }, body });
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes('environment-test-key'));
  });
});

test('relay preserves an explicit false thinking flag rather than dropping it', async () => {
  await withRelay('test-key', async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).think, false);
    return Response.json({ message: { content: '{"ok":true}' } });
  }, async url => {
    const response = await fetch(`${url}/chat`, { method: 'POST', headers,
      body: JSON.stringify({ ...JSON.parse(body), think: false }) });
    assert.equal(response.status, 200);
  });
});

test('relay preserves supported reasoning opt-in values and drops unsupported options', async () => {
  let expected: boolean | string | undefined;
  await withRelay('test-key', async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).think, expected);
    return Response.json({ message: { content: 'OK' } });
  }, async url => {
    for (const think of [true, 'medium', 'unexpected', { value: true }]) {
      expected = think === true || think === 'medium' ? think : undefined;
      assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body: JSON.stringify({ ...JSON.parse(body), think }) })).status, 200);
    }
  });
});

test('session key overrides the environment key and upstream error responses redact it', async () => {
  await withRelay('environment-test-key', async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer session-test-key');
    return Response.json({ error: 'Invalid session-test-key' }, { status: 401 });
  }, async url => {
    const response = await fetch(`${url}/chat`, { method: 'POST', headers: { ...headers, 'X-Ollama-Api-Key': 'session-test-key' }, body });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid [REDACTED]' });
  });
});

test('missing cloud credentials reject inference but permit public model listing', async () => {
  let calls = 0;
  await withRelay('', async (_url, init) => { calls++; assert.equal(new Headers(init?.headers).has('Authorization'), false); return Response.json({ models: [] }); }, async url => {
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body })).status, 401);
    assert.equal((await fetch(`${url}/tags`, { headers })).status, 200);
    assert.equal(calls, 1);
  });
});

test('relay redacts credentials even when JSON escapes them in nested fields', async () => {
  const key = 'test-key-with-"quote';
  await withRelay(key, async () => Response.json({ error: { message: key, details: [key] } }, { status: 401 }), async url => {
    const response = await fetch(`${url}/chat`, { method: 'POST', headers, body });
    assert.deepEqual(await response.json(), { error: { message: '[REDACTED]', details: ['[REDACTED]'] } });
  });
});

test('relay blocks cross-origin requests and requests without its custom header', async () => {
  await withRelay('test-key', async () => { throw new Error('Upstream must not be called'); }, async url => {
    assert.equal((await fetch(`${url}/status`)).status, 403);
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body })).status, 403);
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers: { ...headers, Origin: 'http://127.0.0.1:1' }, body })).status, 403);
  });
});

test('relay rejects malformed, unsupported and oversized requests', async () => {
  await withRelay('test-key', async () => { throw new Error('Upstream must not be called'); }, async url => {
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body: 'invalid-json' })).status, 400);
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body: 'null' })).status, 400);
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body: JSON.stringify({ model: 'model', messages: [{ role: 'developer', content: 'no' }] }) })).status, 400);
    assert.equal((await fetch(`${url}/unknown`, { headers })).status, 404);
    assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  });
});

test('relay handles network errors without reflecting credential-bearing exception messages', async () => {
  await withRelay('private-test-key', async () => { throw new Error('private-test-key: connection failed'); }, async url => {
    const response = await fetch(`${url}/chat`, { method: 'POST', headers, body });
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('private-test-key'));
  });
});
