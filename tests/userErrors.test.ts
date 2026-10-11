import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUserErrorMessage, getWeaveValidationMessage, UserFacingError } from '../src/utils/userErrors';
import { parseWeaveValidationResult } from '../src/utils/weave';
import { buildWeaveValidationPrompt } from '../src/services/prompts';

const fallback = 'We could not create your canvas. Please try again.';
const screenshotMessage = 'The request mixes a region with an era, but mode "region" expects only a geographic or cultural name. For example, a valid request could be {"mode":"region","query":"Italian city-states"}, or if you want the era, use {"mode":"era","query":"Italian Renaissance"}. Please specify only the region.';

test('the screenshot rejection becomes plain historical guidance without request syntax', () => {
  const result = parseWeaveValidationResult({ isValid: false, errorMessage: screenshotMessage },
    { mode: 'region', query: 'city states in the Italian renaissance era' });
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage!, /Italian city-states/);
  assert.match(result.errorMessage!, /include a historical period/);
  assert.doesNotMatch(result.errorMessage!, /[{}]|mode|query|JSON/i);
  assert.equal(getUserErrorMessage(new UserFacingError(result.errorMessage!), fallback), result.errorMessage);
});

test('friendly clarifications remain useful while diagnostic model responses are replaced', () => {
  const friendly = 'Please name a historical era, such as the Renaissance.';
  assert.equal(getWeaveValidationMessage(friendly, 'era'), friendly);
  for (const message of ['Return isValid=false and errorMessage.', 'Invalid parameter inferredStartYear.',
    'Schema validation failed.', '<script>alert(1)</script>', 'a'.repeat(301), '', null]) {
    const displayed = getWeaveValidationMessage(message, 'figure');
    assert.match(displayed, /Leonardo da Vinci/);
    assert.doesNotMatch(displayed, /isValid|errorMessage|parameter|schema|<|>/i);
  }
});

test('unknown and malformed-response errors never expose their technical details', () => {
  for (const error of [new Error('Expected pre-flight JSON: {"secret":"private"}'),
    new SyntaxError('Unexpected token at line 42'), new TypeError('Cannot read properties of undefined'),
    { message: 'stack trace: private' }, 'Raw backend diagnostics', null]) {
    assert.equal(getUserErrorMessage(error, fallback), fallback);
  }
});

test('provider failures give actionable guidance without codes or response bodies', () => {
  for (const [status, expected] of [[401, /access key/], [403, /permissions/], [402, /credit/],
    [404, /another model/], [429, /usage limit/], [503, /temporarily unavailable/]] as const) {
    const error = Object.assign(new Error('Technical body: {"token":"private"}'), { status });
    const message = getUserErrorMessage(error, fallback);
    assert.match(message, expected);
    assert.doesNotMatch(message, /private|Technical|HTTP|[{}]|\d{3}/);
  }
  assert.match(getUserErrorMessage(new Error('Failed to fetch'), fallback), /Check your connection/);
  assert.match(getUserErrorMessage(new DOMException('timeout details', 'TimeoutError'), fallback), /longer than expected/);
  assert.match(getUserErrorMessage(new DOMException('disk details', 'QuotaExceededError'), fallback), /saved on this device/);
});

test('preflight accepts region context and instructs the AI to avoid technical user messages', () => {
  const prompt = buildWeaveValidationPrompt({ mode: 'region', query: 'Italian city-states in the Renaissance' });
  assert.match(prompt, /valid region request/);
  assert.match(prompt, /Preserve both its geography and period/);
  assert.match(prompt, /Never mention internal modes, field names, JSON, schemas, code, or technical diagnostics/);
});
