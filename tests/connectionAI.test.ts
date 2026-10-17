import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContactAssessments, recordedContactSection, requestContactDiscovery, requestContactExplanation } from '../src/services/connectionAI';
import { figurePerson, identifyPerson, type ContactPerson } from '../src/services/connectionGraph';
import { buildContactAssessmentPrompt, buildContactDiscoveryPrompt, buildContactExplanationPrompt, buildRelationshipExplanationPrompt } from '../src/services/prompts';
import { person } from './connectionFixtures';
const people: ContactPerson[] = [];
const first = identifyPerson(people, figurePerson(person('Napoleon', 1769, 1821))), second = identifyPerson(people, figurePerson(person('Wellington', 1769, 1852)));
const pairs = [{ first, second }];
test('named exact wartime opposition qualifies; absent episode, malformed references and chronology are rejected', () => {
  const accepted = { ref: 'p1', verdict: 'accepted', interactionType: 'wartime-opposition', evidence: 'Napoleon and Wellington commanded directly opposing armies at Waterloo.', episode: 'Battle of Waterloo', year: 1815 };
  assert.equal(parseContactAssessments([accepted], pairs)[0].verdict, 'accepted');
  assert.throws(() => parseContactAssessments([{ ...accepted, episode: '' }], pairs));
  assert.throws(() => parseContactAssessments([{ ...accepted, year: 1900 }], pairs));
  assert.throws(() => parseContactAssessments([{ ...accepted, ref: 'p2' }], pairs));
  assert.throws(() => parseContactAssessments([{ ...accepted, evidence: '' }], pairs));
  assert.throws(() => parseContactAssessments([accepted], [{ first, second: { ...second, birthYear: 1900, deathYear: 1980 } }]));
});
test('uncertainty is explicit and broad war, kinship, overlap and influence cannot establish contact in task instructions', () => {
  const unresolved = parseContactAssessments([{ ref: 'p1', verdict: 'unresolved', evidence: '', uncertainty: 'Only common war membership is known.' }], pairs)[0];
  assert.equal(unresolved.verdict, 'unresolved'); assert.equal(unresolved.evidence, '');
  const prompt = buildContactAssessmentPrompt(pairs); assert.match(prompt, /larger war do not qualify/); assert.match(prompt, /Kinship alone is not evidence/);
  assert.match(prompt, /never evidence of contact/); assert.doesNotMatch(prompt, /unverified supplied biography/);
  assert.doesNotMatch(buildRelationshipExplanationPrompt(person('A'), person('B')), /Napoleon and Wellington/);
});
test('discovery maps short references, bounds source batches and never treats claims as assessment evidence', async () => {
  const request = { sources: [{ person: first, round: 2, previous: [] }], target: second, references: [second], limit: 6 };
  const result = await requestContactDiscovery(async (_prompt, validate) => validate([{ source: 's1', reference: 'r1', claim: 'Proposed exact opposition.' }]), request);
  assert.equal(result[0].person.name, second.name);
  await assert.rejects(() => requestContactDiscovery(async (_prompt, validate) => validate([{ source: 's9', reference: 'r1', claim: 'Claim' }]), request));
  assert.match(buildContactDiscoveryPrompt(request), /PAIRS, never all known people/);
});

const record = { pair: [first.id, second.id] as [string, string], verdict: 'accepted' as const, interactionType: 'family-interaction' as const, year: 1818,
  evidence: 'They married in 1818 and kept house together.', provenance: { provider: 'test', model: 'test', version: 2, assessedAt: 1 } };

test('the Why prompt hands over the stored record and asks for the same length and shape as the canvas relationship dialog', () => {
  const prompt = buildContactExplanationPrompt(first, second, record);
  // The record the reader sees beside the link is handed over and has to be told, not contradicted.
  assert.match(prompt, /They married in 1818 and kept house together/);
  assert.match(prompt, /sees this record beside the link/);
  assert.match(prompt, /never contradict it/);
  // The same length and shape targets as the general prompt: a summary, sections, 250-450 words, four paragraphs.
  assert.match(prompt, /Return summary \(string, \d+-\d+ sentences\)/);
  assert.match(prompt, /array of 3-5 objects with title and content strings/);
  assert.match(prompt, /250-450 words/);
  assert.match(prompt, /at least four substantive paragraphs/);
  // The Context section stays first.
  assert.match(prompt, /Start with a section titled "Context"/);
  // The honest fallback remains, for a record that cannot be supported at all.
  assert.match(prompt, /supported":false/);
});

test('the dialog always says what the sidebar says: the stored record is the first section of the explanation', async () => {
  const section = recordedContactSection({ ...record, episode: 'The wedding' });
  assert.equal(section.title, 'The recorded interaction');
  assert.match(section.content, /^They married in 1818 and kept house together\. Episode: The wedding\./);
  assert.match(section.content, /family interaction · 1818/);
  // A bare record has no details line.
  assert.equal(recordedContactSection({ ...record, interactionType: undefined, year: undefined }).content, record.evidence);
  const body = (words: number) => 'They kept house together. '.repeat(Math.ceil(words / 4));
  const narrative = { supported: true, summary: 'A marriage.', sections: [{ title: 'Context', content: body(60) }, { title: 'How their paths crossed', content: body(60) }, { title: 'The household', content: body(60) }] };
  const result = await requestContactExplanation(async (_prompt, validate) => validate(narrative), first, second, record);
  assert.deepEqual(result.sections.map(item => item.title), ['The recorded interaction', 'Context', 'How their paths crossed', 'The household']);
  assert.equal(result.evidence, record.evidence);
  assert.equal(result.summary, 'A marriage.');
  // An expansion the model cannot support still falls back to the record in the caller.
  await assert.rejects(() => requestContactExplanation(async (_prompt, validate) => validate({ supported: false, summary: '', sections: [] }), first, second, record));
});

test('the Why prompt shares the general relationship narrative rules, with a Context section and no re-assessment', () => {
  const prompt = buildContactExplanationPrompt(first, second, record);
  const general = buildRelationshipExplanationPrompt(person('A'), person('B'), { contactOnly: true });
  // The same bullets as the canvas dialogs ask for (only the number of sections differs).
  for (const line of general.split('\n').filter(item => item.startsWith('- ') && !item.includes('array of'))) assert.ok(prompt.includes(line), `missing: ${line.slice(0, 80)}`);
  assert.match(prompt, /array of 3-5 objects/);
  assert.match(prompt, /do not re-assess whether it qualifies/);
  assert.match(prompt, /Start with a section titled "Context"/);
  // The cautious contact rules that made the model answer briefly are gone.
  assert.doesNotMatch(prompt, /Expand only what this record can reliably support/);
});

test('a brief answer is asked for again once, and a brief second answer is still used', async () => {
  const brief = { supported: true, summary: 'A marriage.', sections: [{ title: 'Context', content: 'Who they were.' }] };
  const full = { supported: true, summary: 'A marriage.', sections: ['Context', 'Paths', 'Home'].map(title => ({ title, content: 'They kept house together. '.repeat(15) })) };
  const asked: string[] = [];
  const answers = (replies: unknown[]) => async (prompt: string, validate: (value: unknown) => any) => {
    asked.push(prompt);
    for (let attempt = 0; ; attempt++) {
      try { return validate(replies[attempt]); } catch (error) { if (attempt === 1) throw error; }
    }
  };
  // Brief, then full: the full one wins.
  const second1 = await requestContactExplanation(answers([brief, full]) as any, first, second, record);
  assert.equal(second1.sections.length, 4);
  // Brief twice: the brief one is used rather than nothing.
  const thin = await requestContactExplanation(answers([brief, brief]) as any, first, second, record);
  assert.deepEqual(thin.sections.map(item => item.title), ['The recorded interaction', 'Context']);
  // A refusal is still a refusal.
  await assert.rejects(() => requestContactExplanation(answers([{ supported: false, summary: '', sections: [] }, { supported: false, summary: '', sections: [] }]) as any, first, second, record));
});
