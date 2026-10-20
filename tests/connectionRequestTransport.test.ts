import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConnection, type ConnectionResult } from '../src/services/connectionPath';
import { generateValidatedJson, validationRetryCount } from '../src/services/jsonResponse';
import { OllamaService } from '../src/services/ollamaService';
import { OpenRouterService } from '../src/services/openRouterService';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { pairKey } from '../src/services/pathService';
import { chatResponse, localConfig } from './helpers';
import { A, B, M, N, assertRequestAccounting, proposal } from './connectionFixtures';
import type { HistoricalFigure } from '../src/types';

// A scripted model behind a real OllamaService: every POST it receives is the wire truth to compare the
// engine's counters with, including the correction rounds that happen below the engine's own requests.
interface Wire { kind: 'seed' | 'identity' | 'discover' | 'assess'; size: number; correction: boolean }
function scriptedModel(links: Array<[HistoricalFigure, HistoricalFigure]>, garble: (wire: Wire, nth: number) => boolean) {
  const wire: Wire[] = [], supported = new Set(links.map(([a, b]) => pairKey(a.name, b.name))), seen: Record<string, number> = {};
  const listed = (prompt: string, label: string) => JSON.parse(prompt.split('\n').find(line => line.startsWith(`${label}: `))!.slice(label.length + 2));
  const fetcher = async (_url: unknown, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)).messages as Array<{ content: string }>, prompt = messages[1].content, correction = messages.length > 2;
    let kind: Wire['kind'], size = 1, answer: unknown = null;
    if (prompt.startsWith('Six Degrees: independently assess')) {
      kind = 'assess'; const pairs = listed(prompt, 'Pairs') as Array<{ ref: string; first: { name: string }; second: { name: string } }>; size = pairs.length;
      answer = pairs.map(pair => supported.has(pairKey(pair.first.name, pair.second.name))
        ? { ref: pair.ref, verdict: 'accepted', interactionType: 'correspondence', evidence: `${pair.first.name} and ${pair.second.name} exchanged letters about their joint research.`, year: null }
        : { ref: pair.ref, verdict: 'unresolved', evidence: '', uncertainty: 'No specific interaction established.' });
    } else if (prompt.startsWith('Six Degrees: discover')) {
      kind = 'discover'; const sources = listed(prompt, 'Sources') as Array<{ ref: string; name: string; previouslyProposedPairsWith: Array<{ name: string }> }>; size = sources.length;
      const everyone = [A, B, M, N];
      answer = sources.flatMap(source => links.flatMap(([a, b]) => {
        const other = source.name === a.name ? b : source.name === b.name ? a : undefined;
        return other && !source.previouslyProposedPairsWith.some(p => p.name === other.name)
          ? [{ source: source.ref, person: { ...proposal(everyone.find(p => p.name === other.name)!), description: 'A scholar.' }, claim: 'They exchanged letters about their joint research.' }] : [];
      }));
    } else if (prompt.startsWith('Propose a short chain')) kind = 'seed';
    else if (prompt.startsWith('Identify the one real')) kind = 'identity';
    else throw new Error(`Unexpected prompt: ${prompt.slice(0, 60)}`);
    const entry: Wire = { kind, size, correction }; wire.push(entry);
    const nth = seen[kind] = (seen[kind] ?? 0) + (correction ? 0 : 1);
    return garble(entry, nth) ? Response.json({ message: { content: 'I am unable to produce JSON for that.' }, done: true }) : chatResponse(answer);
  };
  return { wire, service: new OllamaService(localConfig, fetcher as typeof fetch) };
}
const search = (service: OllamaService, overrides: Partial<Parameters<typeof findConnection>[0]> = {}): Promise<ConnectionResult> =>
  findConnection({ service, from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', ...overrides });
const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

test('on a mocked transport the counters equal the POSTs it received, with malformed replies counted as correction rounds', async () => {
  // The first discovery reply and the first assessment reply are not JSON; each is corrected once.
  const model = scriptedModel([[A, M], [M, N], [N, B]], (wire, nth) => !wire.correction && nth === 1 && (wire.kind === 'discover' || wire.kind === 'assess'));
  const result = await search(model.service); assert.equal(result.status, 'connected');
  const d = result.session!.diagnostics, requests = model.wire.filter(wire => !wire.correction), corrections = model.wire.filter(wire => wire.correction);
  assertRequestAccounting(d);
  assert.equal(d.validationRetries, 2); assert.equal(corrections.length, 2);
  assert.equal(model.wire.length, sum(Object.values(d.requests!)) + d.validationRetries!, 'every POST is a request or a correction round');
  assert.equal(requests.length, d.tasks);
  for (const kind of ['seed', 'identity', 'discover'] as const) assert.equal(requests.filter(wire => wire.kind === kind).length, d.requests![kind], kind);
  assert.equal(requests.filter(wire => wire.kind === 'assess').length, d.requests!.assess! + d.requests!.direct!);
  assert.deepEqual(d.assessBatches, requests.filter(wire => wire.kind === 'assess').map(wire => wire.size));
  assert.deepEqual(d.discoverSources, requests.filter(wire => wire.kind === 'discover').map(wire => wire.size));
  assert.deepEqual(d.total!.requests, d.requests);
});

test('a request that fails after its correction round still counts both the request and the round', async () => {
  const model = scriptedModel([[A, M], [M, N], [N, B]], wire => wire.kind === 'assess');
  const result = await search(model.service); assert.equal(result.status, 'error');
  const d = result.session!.diagnostics;
  assertRequestAccounting(d);
  assert.equal(d.requests!.assess, 1); assert.equal(d.validationRetries, 1);
  assert.equal(model.wire.length, d.tasks + d.validationRetries!, 'the failed assessment was posted twice');
  assert.equal(model.wire.filter(wire => wire.kind === 'assess').length, 2);
});

test('the correction observer counts one round per invalid reply that is retried, for every provider that validates through it', async () => {
  const delta = async (replies: string[]) => {
    const before = validationRetryCount(), sent: string[] = [];
    await generateValidatedJson('prompt', async text => { sent.push(text); return replies[sent.length - 1] ?? replies.at(-1)!; }, value => { if (!value || typeof value !== 'object') throw new Error('Expected an object.'); return value; }).catch(() => undefined);
    return { rounds: validationRetryCount() - before, sent: sent.length };
  };
  assert.deepEqual(await delta(['{"ok":true}']), { rounds: 0, sent: 1 });
  assert.deepEqual(await delta(['nope', '{"ok":true}']), { rounds: 1, sent: 2 });
  assert.deepEqual(await delta(['nope', 'still nope']), { rounds: 1, sent: 2 });
  const before = validationRetryCount();
  await assert.rejects(generateValidatedJson('prompt', async () => { throw new Error('HTTP 500'); }, value => value));
  assert.equal(validationRetryCount(), before, 'a transport error is not a validation round');

  const previousFetch = globalThis.fetch, previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost:3000' } } });
  const contents = ['not json', 'null']; let posts = 0;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: contents[posts++] } }] });
  try {
    const start = validationRetryCount();
    assert.equal(await new OpenRouterService('test-key', 'test-model').resolveFigure('Zzyzx'), null);
    assert.equal(posts, 2); assert.equal(validationRetryCount() - start, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete (globalThis as { window?: unknown }).window;
  }
});
