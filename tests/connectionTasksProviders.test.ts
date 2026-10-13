import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiService } from '../src/services/geminiService';
import { OpenRouterService } from '../src/services/openRouterService';
import { OllamaService } from '../src/services/ollamaService';
import { figurePerson, identifyPerson, type ContactPerson } from '../src/services/connectionGraph';
import { localConfig, chatResponse } from './helpers';
import { person } from './connectionFixtures';
import type { IAIService } from '../src/types';

test('all three provider adapters run identical dedicated tasks and carry cancellation through transport', { timeout: 30_000 }, async () => {
  const originalFetch = globalThis.fetch, prompts: Record<string, string[]> = {}, people: ContactPerson[] = [];
  const a = identifyPerson(people, figurePerson(person('Alpha'))), b = identifyPerson(people, figurePerson(person('Beta')));
  let provider = '', responses: unknown[] = [], signals: AbortSignal[] = [];
  globalThis.fetch = async (_input, init) => {
    signals.push(init?.signal as AbortSignal); const body = JSON.parse(String(init?.body));
    prompts[provider].push(provider === 'gemini' ? body.contents[0].parts[0].text : body.messages.find(m => m.role === 'user').content);
    const response = responses.shift();
    return provider === 'gemini' ? Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] })
      : provider === 'openrouter' ? Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }) : chatResponse(response);
  };
  const services: Array<[string, IAIService]> = [['gemini', new GeminiService('test', 'test')], ['openrouter', new OpenRouterService('test', 'test')], ['ollama', new OllamaService(localConfig)]];
  try {
    for (const [name, service] of services) {
      provider = name; prompts[name] = []; signals = [];
      responses = [[{ source: 's1', reference: 'r1', claim: 'Candidate correspondence.' }],
        [{ ref: 'p1', verdict: 'accepted', interactionType: 'correspondence', evidence: 'The exact people exchanged letters about their work.', year: null }],
        { supported: true, summary: 'They exchanged letters.', sections: ['Context', 'How their paths crossed', 'What the letters changed'].map(title => ({ title, content: 'Their work prompted the exchange. '.repeat(14) })) }];
      const signal = new AbortController().signal;
      assert.equal((await service.discoverPersonalContacts({ sources: [{ person: a, round: 1, previous: [] }], target: b, references: [b], limit: 6 }, signal))[0].person.name, b.name);
      const assessment = (await service.assessPersonalContacts([{ first: a, second: b }], signal))[0];
      const narrative = await service.explainPersonalContact(a, b, { ...assessment, provenance: { provider: name, model: 'test', version: 2, assessedAt: 1 } }, signal);
      assert.equal(narrative.evidence, assessment.evidence); assert.ok(signals.every(s => s instanceof AbortSignal));
      const controller = new AbortController(); controller.abort(); const before = prompts[name].length;
      await assert.rejects(() => service.assessPersonalContacts([{ first: a, second: b }], controller.signal)); assert.equal(prompts[name].length, before);
    }
    assert.deepEqual(prompts.gemini, prompts.openrouter); assert.deepEqual(prompts.gemini, prompts.ollama);
    assert.ok(prompts.gemini.every(prompt => prompt.includes('wartime')));
  } finally { globalThis.fetch = originalFetch; }
});
