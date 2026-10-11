import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeaveBounds, normalizeWeaveCategories, normalizeWeaveContext, parseWeaveValidationResult, validateWeaveRequestLocally } from '../src/utils/weave';
import { parseJsonResponse } from '../src/services/jsonResponse';
import { planWeaveChunks } from '../src/services/weaveService';

const accepted = { isValid: true, errorMessage: null, inferredStartYear: 1368, inferredEndYear: 1644,
  themeDescription: 'The Ming Dynasty in China', activeCategories: ['ALL'] };

test('weave bounds add ten percent padding and round outward across BCE and CE', () => {
  assert.deepEqual(calculateWeaveBounds(1368, 1644), { start: 1340, end: 1680 });
  assert.deepEqual(calculateWeaveBounds(-69, -30), { start: -80, end: -20 });
  assert.deepEqual(calculateWeaveBounds(-1, 1), { start: -10, end: 10 });
  assert.deepEqual(calculateWeaveBounds(100, 101), { start: 90, end: 110 });
});

test('weave bounds reject reversed, fractional, nonfinite, and unsafe dates', () => {
  for (const [start, end] of [[1, 1], [2, 1], [1.5, 2], [NaN, 2], [0, Infinity], [0, Number.MAX_SAFE_INTEGER], [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
    assert.throws(() => calculateWeaveBounds(start, end));
  }
});

test('strict year validation rejects future dates with a current-year hint', () => {
  const currentYear = new Date().getFullYear();
  for (const [startYear, endYear] of [[1770, currentYear + 1], [currentYear + 1, currentYear + 2]]) {
    const result = validateWeaveRequestLocally({ mode: 'time-span', query: '', startYear, endYear });
    assert.equal(result?.isValid, false);
    assert.equal(result?.errorMessage, `Years cannot be later than ${currentYear} (the current year).`);
  }
});

test('strict year validation accepts ordered BCE dates and the current year, and rejects equal or reversed dates', () => {
  const currentYear = new Date().getFullYear();
  for (const [startYear, endYear] of [[-500, -100], [-500, 100], [1770, currentYear], [currentYear - 1, currentYear]]) {
    assert.equal(validateWeaveRequestLocally({ mode: 'time-span', query: '', startYear, endYear }), null);
  }
  for (const [startYear, endYear] of [[-100, -500], [-500, -500], [1900, 1770], [currentYear, currentYear]]) {
    const result = validateWeaveRequestLocally({ mode: 'time-span', query: '', startYear, endYear });
    assert.equal(result?.isValid, false);
    assert.match(result?.errorMessage ?? '', /start year earlier than the end year/);
  }
});

test('pre-flight normalization handles casing and duplicates without broadening unknown categories', () => {
  assert.deepEqual(normalizeWeaveCategories([' scientists ', 'SCIENTISTS']), ['SCIENTISTS']);
  assert.deepEqual(normalizeWeaveCategories(['all', 'ALL']), ['ALL']);
  for (const categories of [[], null, ['Doctors'], ['ALL', 'SCIENTISTS'], [1]]) assert.throws(() => normalizeWeaveCategories(categories));
  assert.equal(parseWeaveValidationResult({ ...accepted, isValid: 'true' }).isValid, true);
});

test('strict pre-flight fixes model-adjusted years and category limits to the explicit user span', () => {
  const result = parseWeaveValidationResult({ ...accepted, activeCategories: ['SCIENTISTS'] }, { mode: 'time-span', query: '', startYear: -500, endYear: 0 });
  assert.equal(result.inferredStartYear, -500);
  assert.equal(result.inferredEndYear, 0);
  assert.deepEqual(result.activeCategories, ['ALL']);
});

test('invalid inferred data never becomes an accepted context, and rejections need a message', () => {
  for (const invalid of [null, [], { ...accepted, inferredStartYear: '1368' }, { ...accepted, inferredEndYear: 1368 },
    { ...accepted, inferredEndYear: new Date().getFullYear() + 1 }, { ...accepted, themeDescription: '' },
    { ...accepted, isValid: false, errorMessage: null }]) assert.throws(() => parseWeaveValidationResult(invalid));
  const rejected = parseWeaveValidationResult({ isValid: false, errorMessage: 'Try a historical era such as the Renaissance.' });
  assert.equal(rejected.isValid, false);
  assert.match(rejected.errorMessage!, /Renaissance/);
  assert.throws(() => normalizeWeaveContext({ mode: 'era', query: 'Ming', ...accepted, activeCategories: ['UNKNOWN'] } as any));
});

test('JSON extraction tolerates markdown and surrounding text with nested braces inside strings', () => {
  for (const content of [JSON.stringify(accepted), `Here is the assessment:\n\`\`\`JSON\n${JSON.stringify(accepted)}\n\`\`\`\nDone.`,
    `Assessment: ${JSON.stringify({ ...accepted, themeDescription: 'A topic with } and \\" characters' })} End.`]) {
    assert.equal((parseJsonResponse(content) as any).isValid, true);
  }
  assert.deepEqual(parseJsonResponse('Results: [{"nested":{"text":"bracket ]"}}] Thank you.'), [{ nested: { text: 'bracket ]' } }]);
  assert.throws(() => parseJsonResponse('```json\n{"isValid":true\n```'));
});

test('long semantic histories have bounded chunks that cover the full inferred range', () => {
  const chunks = planWeaveChunks(-3100, -30, true);
  assert.ok(chunks.length <= 6);
  assert.equal(chunks[0].start, -3100);
  assert.equal(chunks.at(-1)!.end, -30);
  chunks.slice(1).forEach((chunk, index) => assert.equal(chunk.start, chunks[index].end));
  assert.equal(planWeaveChunks(600, 1600).length, 10);
  assert.ok(planWeaveChunks(-3_000_000, 2026).length <= 12);
});
