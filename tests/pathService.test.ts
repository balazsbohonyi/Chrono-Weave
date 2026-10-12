import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewPerson, requestConnectionPath, requestResolveFigure, validateConnectionProposal } from '../src/services/pathService';
import { generateValidatedJson } from '../src/services/jsonResponse';
import type { JsonGenerator } from '../src/services/weaveService';
import type { ConnectionPathOptions, HistoricalFigure } from '../src/types';

const person = (id: string, name: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const leonardo = person('leonardo', 'Leonardo da Vinci', 1452, 1519);
const galileo = person('galileo', 'Galileo Galilei', 1564, 1642);
const verrocchio = person('verrocchio', 'Andrea del Verrocchio', 1435, 1488);
const michelangelo = person('michelangelo', 'Michelangelo', 1475, 1564);
const vasari = person('vasari', 'Giorgio Vasari', 1511, 1574);
const options = (overrides: Partial<ConnectionPathOptions> = {}): ConnectionPathOptions => ({
  catalog: [verrocchio, michelangelo, vasari].map(({ id, name, birthYear, deathYear }) => ({ id, name, birthYear, deathYear })),
  avoidPairs: [], maxIntermediates: 10, ...overrides,
});
const newPerson = (name: string, birthYear: number, deathYear: number, extra: Record<string, unknown> = {}) =>
  ({ name, birthYear, deathYear, occupation: 'Scholar', description: 'A scholar.', category: 'THINKERS', ...extra });
const validate = (value: unknown, overrides: Partial<ConnectionPathOptions> = {}) =>
  validateConnectionProposal(value, leonardo, galileo, options(overrides));
const ends = (...middle: unknown[]) => [{ id: 'leonardo' }, ...middle, { id: 'galileo' }];

test('a well-formed proposal keeps catalog ids and new people in order', () => {
  const zeno = newPerson('Zeno of Padua', 1500, 1590);
  const proposal = validate({ nodes: ends({ id: 'vasari' }, zeno), links: [{ claim: 'Met.' }, { claim: ' Worked together. ' }, { claim: 'Corresponded.' }] });
  assert.deepEqual(proposal?.nodes, [{ id: 'leonardo' }, { id: 'vasari' }, { ...zeno, category: 'THINKERS', description: 'A scholar.' }, { id: 'galileo' }]);
  assert.deepEqual(proposal?.links, [{ claim: 'Met.' }, { claim: 'Worked together.' }, { claim: 'Corresponded.' }]);
});

test('null and empty answers mean no confident path rather than an error', () => {
  assert.equal(validate(null), null);
  assert.equal(validate([]), null);
  assert.equal(validate({ nodes: [], links: [] }), null);
  assert.throws(() => validate('nope'), /nodes/);
});

test('the endpoints must be the requested people, in order', () => {
  assert.throws(() => validate({ nodes: [{ id: 'vasari' }, { id: 'galileo' }], links: [{ claim: 'x' }] }), /start with Leonardo da Vinci/);
  assert.throws(() => validate({ nodes: [{ id: 'leonardo' }, { id: 'vasari' }], links: [{ claim: 'x' }] }), /end with Galileo Galilei/);
  assert.throws(() => validate({ nodes: [{ id: 'leonardo' }], links: [] }), /start with/);
});

test('events are never nodes', () => {
  const event = { name: 'Council of Trent', birthYear: 1545, deathYear: 1563, occupation: 'Council', description: 'A council.', category: 'EVENTS' };
  assert.throws(() => validate({ nodes: ends(event), links: [] }), /event/i);
});

test('an id outside the catalog is rejected instead of silently dropped', () => {
  assert.throws(() => validate({ nodes: ends({ id: 'c99' }), links: [] }), /Unknown id "c99"/);
});

test('too many intermediates are rejected', () => {
  const crowd = Array.from({ length: 4 }, (_, index) => newPerson(`Person ${index}`, 1500, 1600));
  assert.throws(() => validate({ nodes: ends(...crowd), links: [] }, { maxIntermediates: 3 }), /at most 3/);
  assert.ok(validate({ nodes: ends(...crowd), links: [] }, { maxIntermediates: 4 }));
});

test('consecutive lifespans must overlap', () => {
  assert.throws(() => validate({ nodes: ends({ id: 'verrocchio' }), links: [] }), /did not live at the same time/);
});

test('a person may appear once, including a new person who repeats a catalog or endpoint name', () => {
  assert.throws(() => validate({ nodes: ends({ id: 'vasari' }, { id: 'vasari' }), links: [] }), /more than once/);
  assert.throws(() => validate({ nodes: ends(newPerson('Giorgio Vasari', 1511, 1574), { id: 'vasari' }), links: [] }), /more than once/);
  assert.throws(() => validate({ nodes: ends(newPerson('Léonardo da Vinci', 1452, 1519)), links: [] }), /more than once/);
});

test('new people must satisfy the shared people rules', () => {
  const invalid = [
    newPerson('Backwards', 1600, 1500), newPerson('Fractional', 1500.5, 1600), newPerson('', 1500, 1600),
    { ...newPerson('No Description', 1500, 1600), description: '' }, newPerson('Odd Category', 1500, 1600, { category: 'ROBOTS' }),
  ];
  for (const bad of invalid) assert.throws(() => validate({ nodes: ends(bad), links: [] }));
  assert.deepEqual(parseNewPerson({ ...newPerson('  Lowercase Category ', 1500, 1600), category: 'thinkers' }),
    { name: 'Lowercase Category', birthYear: 1500, deathYear: 1600, occupation: 'Scholar', category: 'THINKERS', description: 'A scholar.' });
});

test('pairs known to be rejected can never be neighbours, and excluded people cannot be reused', () => {
  assert.throws(() => validate({ nodes: ends(newPerson('Zeno', 1500, 1700)), links: [] }, {
    avoidPairs: [[{ id: 'x', name: 'zeno' }, { id: 'y', name: 'GALILEO GALILEI' }]],
  }), /no qualifying link/);
  assert.throws(() => validate({ nodes: ends(newPerson('Giorgio Vasari', 1511, 1574)), links: [] }, {
    exclude: [{ id: 'other', name: 'giorgio vasari' }],
  }), /already part of the chain/);
  assert.throws(() => validate({ nodes: ends({ id: 'vasari' }), links: [] }, {
    exclude: [{ id: 'vasari', name: 'Someone Else' }],
  }), /already part of the chain/);
});

test('link claims are optional labels and are padded to one per link', () => {
  assert.deepEqual(validate({ nodes: ends(newPerson('Zeno', 1500, 1700)) })?.links, [{ claim: '' }, { claim: '' }]);
});

const generatorFor = (responses: unknown[], prompts: string[] = []): JsonGenerator => (prompt, check, signal) =>
  generateValidatedJson(prompt, async requestPrompt => { prompts.push(requestPrompt); return JSON.stringify(responses.shift()); }, check, signal);

test('the prompt shows short references and the result maps them back to canvas ids', async () => {
  const prompts: string[] = [];
  const proposal = await requestConnectionPath(generatorFor([
    { nodes: [{ id: 'A' }, { id: 'c3' }, { id: 'B' }], links: [{ claim: 'a' }, { claim: 'b' }] },
  ], prompts), leonardo, galileo, options());
  assert.deepEqual(proposal?.nodes, [{ id: 'leonardo' }, { id: 'vasari' }, { id: 'galileo' }]);
  assert.match(prompts[0], /"id":"c3"/);
  assert.doesNotMatch(prompts[0], /"id":"vasari"/);
  assert.match(prompts[0], /Never include events/);
  assert.match(prompts[0], /Influence through a work or ideas alone does not count/);
});

test('an invalid proposal gets exactly one corrective retry', async () => {
  const prompts: string[] = [];
  const proposal = await requestConnectionPath(generatorFor([
    { nodes: [{ id: 'A' }, { id: 'c9' }, { id: 'B' }], links: [] },
    { nodes: [{ id: 'A' }, { id: 'c3' }, { id: 'B' }], links: [] },
  ], prompts), leonardo, galileo, options());
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous response was invalid/);
  assert.match(prompts[1], /Unknown id "c9"/);
  assert.deepEqual(proposal?.nodes[1], { id: 'vasari' });
  await assert.rejects(requestConnectionPath(generatorFor([
    { nodes: [{ id: 'A' }, { id: 'c9' }, { id: 'B' }], links: [] },
    { nodes: [{ id: 'A' }, { id: 'c9' }, { id: 'B' }], links: [] },
  ]), leonardo, galileo, options()), /unusable data after a retry/);
});

test('avoided pairs and excluded people are passed to the model by name', async () => {
  const prompts: string[] = [];
  await requestConnectionPath(generatorFor([null], prompts), leonardo, galileo, options({
    avoidPairs: [[{ id: '1', name: 'Giorgio Vasari' }, { id: '2', name: 'Peter Paul Rubens' }]],
    exclude: [{ id: '3', name: 'Michelangelo' }], maxIntermediates: 4,
  }));
  assert.match(prompts[0], /\[\["Giorgio Vasari","Peter Paul Rubens"\]\]/);
  assert.match(prompts[0], /Do not include them: \["Michelangelo"\]/);
  assert.match(prompts[0], /at most 4 people between A and B/);
});

test('a null answer is a result, and events are refused before any request', async () => {
  assert.equal(await requestConnectionPath(generatorFor([null]), leonardo, galileo, options()), null);
  let requests = 0;
  const counting: JsonGenerator = (() => { requests++; return Promise.resolve(null); }) as JsonGenerator;
  await assert.rejects(requestConnectionPath(counting, { ...leonardo, category: 'EVENTS' }, galileo, options()), /people, not events/);
  assert.equal(requests, 0);
});

test('resolving a name returns one person, or null for unknown, ambiguous, and non-person names', async () => {
  const resolved = await requestResolveFigure(generatorFor([newPerson('Henry VIII', 1491, 1547, { category: 'LEADERS & BADDIES' })]), ' Henry VIII ');
  assert.equal(resolved?.name, 'Henry VIII');
  assert.equal(resolved?.category, 'LEADERS & BADDIES');
  assert.equal(await requestResolveFigure(generatorFor([null]), 'Zzyzx'), null);
  assert.equal(await requestResolveFigure(generatorFor([]), '   '), null);
  await assert.rejects(requestResolveFigure(generatorFor([
    newPerson('Broken', 1789, 1700), newPerson('Broken', 1789, 1700),
  ]), 'Broken'), /unusable data/i);
});

test('an event answer to a typed name is null at once, without a corrective retry', async () => {
  const prompts: string[] = [];
  const event = newPerson('French Revolution', 1789, 1799, { category: 'EVENTS' });
  assert.equal(await requestResolveFigure(generatorFor([event, event], prompts), 'French Revolution'), null);
  assert.equal(prompts.length, 1);
  assert.equal(await requestResolveFigure(generatorFor([{ ...event, category: ' events ' }]), 'French Revolution'), null);
});

test('cancelling stops path and resolve requests before the model answers', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Cancelled'));
  await assert.rejects(requestConnectionPath(generatorFor([null]), leonardo, galileo, options(), controller.signal), /Cancelled/);
  await assert.rejects(requestResolveFigure(generatorFor([null]), 'Henry VIII', controller.signal), /Cancelled/);
});
