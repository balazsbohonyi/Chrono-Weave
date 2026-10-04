import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaService } from '../src/services/ollamaService';
import { chatResponse, event, figure, localConfig, person, sections, relationship } from './helpers';

test('local model listing uses native API and never forwards an API key', async () => {
  const service = new OllamaService({ ...localConfig, baseUrl: 'http://localhost:11434/', apiKey: 'unused-key' }, async (url, init) => {
    assert.equal(String(url), 'http://localhost:11434/api/tags');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.equal(new Headers(init?.headers).has('X-Ollama-Api-Key'), false);
    return Response.json({ models: [{ name: 'z-model' }, { name: 'a-model' }, { name: 'z-model' }] });
  });
  assert.deepEqual(await service.listModels(), ['a-model', 'z-model']);
});

test('cloud requests use the relay, exact model ID and session key without forced schemas', async () => {
  const service = new OllamaService({ ...localConfig, ollamaMode: 'cloud', model: 'cloud-exact-id', apiKey: 'test-key' }, async (url, init) => {
    assert.equal(String(url), '/api/ollama/cloud/chat');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Ollama-Api-Key'), 'test-key');
    assert.equal(headers.get('X-ChronoWeave-Relay'), '1');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'cloud-exact-id');
    assert.equal(body.stream, false);
    assert.equal(body.format, undefined);
    return chatResponse({ ok: true });
  });
  assert.deepEqual(await service.testConnection(), { success: true });
});

test('connection test accepts a fenced JSON response', async () => {
  const service = new OllamaService(localConfig, async () => Response.json({ message: { content: '```json\n{"ok":true}\n```' } }));
  assert.equal((await service.testConnection()).success, true);
});

test('reasoning defaults off for Ollama models, with low effort for GPT-OSS', async () => {
  for (const ollamaMode of ['local', 'cloud'] as const) {
    for (const model of ['gpt-oss:20b', 'gpt-oss:20b-cloud', 'gpt-oss:120b', 'gemma4:e4b']) {
      const service = new OllamaService({ ...localConfig, ollamaMode, model }, async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.think, model.startsWith('gpt-oss:') ? 'low' : false);
        return chatResponse({ ok: true });
      });
      assert.equal((await service.testConnection()).success, true);
    }
  }
});

test('reasoning opt-in applies to connection tests and generation in both modes', async () => {
  for (const ollamaMode of ['local', 'cloud'] as const) {
    for (const model of ['nemotron-3-nano:30b', 'qwen3:8b', 'gpt-oss:20b-cloud']) {
      let calls = 0;
      const service = new OllamaService({ ...localConfig, ollamaMode, model, ollamaReasoning: true }, async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).think, model.startsWith('gpt-oss:') ? 'medium' : true);
        return chatResponse(++calls === 1 ? { ok: true } : { ...sections, famousQuote: '' });
      });
      assert.equal((await service.testConnection()).success, true);
      await service.fetchFigureDeepDive(figure);
      assert.equal(calls, 2);
    }
  }
});

test('malformed output gets exactly one corrective retry', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++;
    if (calls === 2) assert.match(String(init?.body), /previous response was invalid/);
    return calls === 1 ? Response.json({ message: { content: 'not JSON' } }) : chatResponse({ ...sections, famousQuote: '' });
  });
  await service.fetchFigureDeepDive(figure);
  assert.equal(calls, 2);
});

test('Nemotron 3 disables thinking for direct cloud IDs and local cloud aliases', async () => {
  for (const ollamaMode of ['local', 'cloud'] as const) {
    for (const model of ['nemotron-3-nano:30b', 'nemotron-3-nano:30b-cloud', 'nemotron-3-super', 'nemotron-3-super:cloud', 'nemotron-3-ultra', 'nemotron-3-ultra:cloud']) {
      let calls = 0;
      const service = new OllamaService({ ...localConfig, ollamaMode, model }, async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).think, false);
        calls++;
        return chatResponse(calls === 1 ? { ok: true } : { ...sections, famousQuote: '' });
      });
      assert.equal((await service.testConnection()).success, true);
      await service.fetchFigureDeepDive(figure);
      assert.equal(calls, 2);
    }
  }
});

test('permanently invalid data is an error rather than an empty result', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async () => { calls++; return chatResponse([{ ...person, birthYear: '1815' }]); });
  await assert.rejects(service.fetchHistoricalFigures(1800, 1900), /unusable data/);
  assert.equal(calls, 2);
});

test('a later failed timeline batch rejects the entire build', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async () => {
    calls++;
    return calls === 1 ? chatResponse([person]) : Response.json({ error: 'authentication required' }, { status: 401 });
  });
  await assert.rejects(service.fetchHistoricalFigures(1800, 1900), /authentication failed/);
  assert.equal(calls, 2);
});

test('events shorter than three years are excluded without retries; qualifying dates stay unchanged', async () => {
  for (const ollamaMode of ['local', 'cloud'] as const) {
    const events = [0, 1, 2, 3].map(duration => ({ ...event, name: `Event lasting ${duration} years`, startYear: 1815, endYear: 1815 + duration }));
    let calls = 0;
    const service = new OllamaService({ ...localConfig, ollamaMode }, async () => chatResponse(++calls === 1 ? [person] : events));
    const data = await service.fetchHistoricalFigures(1800, 1900);
    assert.deepEqual(data.filter(item => item.category === 'EVENTS').map(item => [item.birthYear, item.deathYear]), [[1815, 1818]]);
    assert.equal(calls, 2);
  }
});

test('an all-short or empty event batch leaves a valid people timeline without validation retries', async () => {
  for (const events of [[], [{ ...event, startYear: 1815, endYear: 1815 }]]) {
    let calls = 0;
    const service = new OllamaService(localConfig, async () => chatResponse(++calls === 1 ? [person] : events));
    const data = await service.fetchHistoricalFigures(1800, 1900);
    assert.deepEqual(data.map(item => item.name), ['Ada Lovelace']);
    assert.equal(calls, 2);
  }
});

test('reversed event dates get named feedback and the previous answer for correction', async () => {
  let calls = 0;
  const reversed = { ...event, startYear: 1840, endYear: 1760 };
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++;
    if (calls === 1) return chatResponse([person]);
    if (calls === 2) return chatResponse([reversed]);
    const messages = JSON.parse(String(init?.body)).messages;
    assert.equal(messages[2].role, 'assistant');
    assert.deepEqual(JSON.parse(messages[2].content), [reversed]);
    assert.equal(messages[3].role, 'user');
    assert.match(messages[3].content, /Industrial Revolution/);
    assert.match(messages[3].content, /startYear \(1840\).*endYear \(1760\)/);
    return chatResponse([event]);
  });
  assert.equal((await service.fetchHistoricalFigures(1800, 1900)).length, 2);
  assert.equal(calls, 3);
});

test('permanently reversed dates still fail the build instead of being swapped or stretched', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async () => {
    calls++;
    return chatResponse([{ ...person, birthYear: 1852, deathYear: 1815 }]);
  });
  await assert.rejects(service.fetchHistoricalFigures(1800, 1900), /Ada Lovelace.*birthYear \(1852\).*deathYear \(1815\)/);
  assert.equal(calls, 2);
});

test('600–1600 retains 21 requests and serializes requests', async () => {
  let calls = 0;
  let active = 0;
  let peak = 0;
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++; active++; peak = Math.max(peak, active);
    const prompt: string = JSON.parse(String(init?.body)).messages[1].content;
    const range = prompt.match(/(?:overlap|overlapping) (-?\d+) to (-?\d+)/)!;
    const start = Number(range[1]);
    await Promise.resolve();
    active--;
    return prompt.includes('major historical events')
      ? chatResponse([{ ...event, name: `Event ${start}`, startYear: start, endYear: start + 10 }])
      : chatResponse([{ ...person, name: `Person ${start}`, birthYear: start, deathYear: start + 50 }]);
  });
  const data = await service.fetchHistoricalFigures(600, 1600);
  assert.equal(calls, 21);
  assert.equal(peak, 1);
  assert.equal(new Set(data.map(item => item.id)).size, data.length);
});

test('relationship tracing accepts only existing candidate IDs', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async () => {
    calls++;
    return chatResponse({ relatedIds: calls === 1 ? ['unknown'] : ['other', 'other'] });
  });
  assert.deepEqual(await service.fetchRelatedFigures(figure, [figure, { ...figure, id: 'other', name: 'Charles Babbage' }]), ['other']);
  assert.equal(calls, 2);
  assert.deepEqual(await service.fetchRelatedFigures(figure, [figure]), []);
  assert.equal(calls, 2);
});

test('relationship mapping resolves unique candidate names and retains valid links despite unknown and self IDs', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async () => {
    calls++;
    return chatResponse({ relatedIds: ['Charles Babbage', 'missing', figure.id, figure.name] });
  });
  assert.deepEqual(await service.fetchRelatedFigures(figure, [figure, { ...figure, id: 'other', name: 'Charles Babbage' }]), ['other']);
  assert.equal(calls, 1);
});

test('relationship mapping sends short references and translates them to actual canvas IDs in both modes', async () => {
  const candidates = [figure, { ...figure, id: 'long-encoded%20candidate-id-1800-99', name: 'Charles Babbage' }, { ...figure, id: 'another-long-id', name: 'Alan Turing' }];
  for (const ollamaMode of ['local', 'cloud'] as const) {
    const service = new OllamaService({ ...localConfig, ollamaMode }, async (_url, init) => {
      const prompt = JSON.parse(String(init?.body)).messages[1].content;
      const catalog = JSON.parse(prompt.match(/^Candidates: (.*)$/m)[1]);
      assert.deepEqual(catalog.map((item: { id: string }) => item.id), ['c1', 'c2']);
      assert.ok(!prompt.includes(candidates[1].id));
      return chatResponse({ relatedIds: ['c2', 'c1', 'c2'] });
    });
    assert.deepEqual(await service.fetchRelatedFigures(figure, candidates), [candidates[2].id, candidates[1].id]);
  }
});

test('unknown-only IDs receive specific corrective feedback and cannot masquerade as an empty map', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++;
    if (calls === 2) {
      const messages = JSON.parse(String(init?.body)).messages;
      assert.match(messages.at(-1).content, /Unrecognized related figure IDs.*typo/);
      assert.match(messages.at(-1).content, /"c1"/);
      assert.match(messages[1].content, /Charles Babbage/);
    }
    return chatResponse({ relatedIds: ['typo'] });
  });
  await assert.rejects(service.fetchRelatedFigures(figure, [figure, { ...figure, id: 'other', name: 'Charles Babbage' }]), /Unrecognized related figure IDs.*typo/);
  assert.equal(calls, 2);
});

test('ambiguous names and non-string IDs are rejected; self-only and true empty results contain no connections', async () => {
  const candidates = [figure, { ...figure, id: 'other-1', name: 'Charles Babbage' }, { ...figure, id: 'other-2', name: 'Charles Babbage' }];
  for (const relatedIds of [['Charles Babbage'], [123]]) {
    const service = new OllamaService(localConfig, async () => chatResponse({ relatedIds }));
    await assert.rejects(service.fetchRelatedFigures(figure, candidates), /Unrecognized related figure IDs|Invalid relatedIds/);
  }
  for (const relatedIds of [[figure.id, figure.name], []]) {
    const service = new OllamaService(localConfig, async () => chatResponse({ relatedIds }));
    assert.deepEqual(await service.fetchRelatedFigures(figure, candidates), []);
  }
});

test('discovery filters existing names, duplicates, and out-of-range figures', async () => {
  const service = new OllamaService(localConfig, async () => chatResponse([
    person, { ...person, name: 'Charles Babbage' }, { ...person, name: 'Charles Babbage' },
    { ...person, name: 'Earlier figure', birthYear: 1400, deathYear: 1450 },
  ]));
  const data = await service.discoverRelatedFigures(figure, ['ada lovelace'], 1800, 1900);
  assert.deepEqual(data.map(item => item.name), ['Charles Babbage']);
});

test('relationship explanations and biographies validate their structures', async () => {
  const service = new OllamaService(localConfig, async (_url, init) => {
    const prompt = String(init?.body);
    return chatResponse(prompt.includes('famousQuote') ? { ...sections, famousQuote: '' } : relationship);
  });
  assert.deepEqual(await service.fetchRelationshipExplanation(figure, figure), relationship);
  assert.deepEqual(await service.fetchFigureDeepDive(figure), { ...sections, famousQuote: '' });
});

test('relationship assessment corrects omitted verdicts and accepts positives without presentation fields', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++;
    if (calls === 1) return chatResponse(sections);
    const messages = JSON.parse(String(init?.body)).messages;
    assert.match(messages.at(-1).content, /isRelevant as true or false/);
    return chatResponse({ isRelevant: true, evidence: relationship.evidence });
  });
  const result = await service.fetchRelationshipExplanation(figure, { ...figure, id: 'other' });
  assert.equal(calls, 2);
  assert.equal(result.isRelevant, true);
  assert.equal(result.sections[0].content, relationship.evidence);
});

test('quota failures are actionable, redacted, and not retried', async () => {
  let calls = 0;
  const service = new OllamaService({ ...localConfig, ollamaMode: 'cloud', apiKey: 'private-test-key' }, async () => {
    calls++; return Response.json({ error: 'weekly limit private-test-key' }, { status: 429 });
  });
  const result = await service.testConnection();
  assert.equal(result.success, false);
  assert.match(result.error!, /usage or rate limit/);
  assert.ok(!result.error!.includes('private-test-key'));
  assert.equal(calls, 1);
});

test('transient busy errors retry a bounded number of times', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async () => { calls++; return Response.json({ error: 'busy' }, { status: 503 }); });
  await assert.rejects(service.fetchFigureDeepDive(figure), /busy/);
  assert.equal(calls, 3);
});

test('request timeout is reported without hanging', async () => {
  const service = new OllamaService(localConfig, async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), 10);
  assert.match((await service.testConnection()).error!, /timed out/);
});

test('cloud connection test has a total deadline and makes only one request', async () => {
  let calls = 0;
  const service = new OllamaService({ ...localConfig, ollamaMode: 'cloud' }, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  });
  const result = await service.testConnection(undefined, 20);
  assert.equal(result.success, false);
  assert.match(result.error!, /connection test timed out/);
  assert.equal(calls, 1);
});

test('connection test accepts plain text without JSON correction or hidden retries', async () => {
  let calls = 0;
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)).messages, [{ role: 'user', content: 'Reply with OK.' }]);
    return Response.json({ message: { content: 'OK' }, done: true });
  });
  assert.equal((await service.testConnection()).success, true);
  assert.equal(calls, 1);
});

test('connection test rejects empty, incomplete and busy replies without retrying', async () => {
  for (const response of [Response.json({ message: { content: '' } }), Response.json({ message: { content: 'OK' }, done: false }), Response.json({ error: 'busy' }, { status: 503 })]) {
    let calls = 0;
    const service = new OllamaService(localConfig, async () => { calls++; return response; });
    assert.equal((await service.testConnection()).success, false);
    assert.equal(calls, 1);
  }
});

test('cancelling a connection test aborts its request and does not retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      controller.abort(new Error('Test cancelled'));
    });
  });
  assert.match((await service.testConnection(controller.signal)).error!, /Test cancelled/);
  assert.equal(calls, 1);
});

test('cloud subscription access errors retain upstream detail and redact the key', async () => {
  const service = new OllamaService({ ...localConfig, ollamaMode: 'cloud', apiKey: 'secret-key' }, async () =>
    Response.json({ error: 'This model requires a subscription: secret-key' }, { status: 403 }));
  const result = await service.testConnection();
  assert.equal(result.success, false);
  assert.match(result.error!, /subscription.*This model requires a subscription/);
  assert.ok(!result.error!.includes('secret-key'));
});

test('aborted queued operations never start another request', async () => {
  let calls = 0;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const controller = new AbortController();
  const service = new OllamaService(localConfig, async (_url, init) => {
    calls++; started();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const first = service.fetchFigureDeepDive(figure, controller.signal);
  const queued = service.fetchFigureDeepDive(figure, controller.signal);
  await ready;
  controller.abort();
  const results = await Promise.allSettled([first, queued]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
});

test('invalid local environment URLs do not crash construction or Settings', async () => {
  const service = new OllamaService({ ...localConfig, baseUrl: 'invalid-url' });
  assert.equal((await service.testConnection()).success, false);
});
