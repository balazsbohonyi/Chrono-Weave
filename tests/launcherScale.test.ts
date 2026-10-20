import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraOf, MAX_YEAR, MIN_YEAR, parseYear, posToYear, yearToPos } from '../src/components/launcher/strategies';

test('the era band scale maps years to positions and back', () => {
  assert.equal(yearToPos(MIN_YEAR), 0);
  assert.equal(yearToPos(MAX_YEAR), 1);
  assert.equal(yearToPos(1450), 0.54);
  for (const year of [-3000, -1200, -500, 0, 800, 1066, 1450, 1789, 1914, 2000]) {
    assert.ok(Math.abs(posToYear(yearToPos(year)) - year) < 1e-6, `${year} round-trips`);
  }
  // recent centuries get more room than deep antiquity
  assert.ok(yearToPos(1900) - yearToPos(1800) > yearToPos(-2000) - yearToPos(-2100));
});

test('the era band clamps years and positions outside its range', () => {
  assert.equal(yearToPos(-10000), 0);
  assert.equal(yearToPos(MAX_YEAR + 500), 1);
  assert.equal(posToYear(-0.5), MIN_YEAR);
  assert.equal(posToYear(2), MAX_YEAR);
});

test('a year belongs to the era that ends after it', () => {
  assert.equal(eraOf(-3000), 'Ancient world');
  assert.equal(eraOf(-501), 'Ancient world');
  assert.equal(eraOf(-500), 'Classical antiquity');
  assert.equal(eraOf(1449), 'Late Middle Ages');
  assert.equal(eraOf(1450), 'Renaissance');
  assert.equal(eraOf(1945), 'Contemporary');
  assert.equal(eraOf(MAX_YEAR + 100), 'Contemporary');
});

test('typed years accept a minus sign, an en dash or a hyphen for BCE', () => {
  assert.equal(parseYear('1400'), 1400);
  assert.equal(parseYear(' -500 '), -500);
  assert.equal(parseYear('−500'), -500);
  assert.equal(parseYear('–44'), -44);
  assert.equal(parseYear(''), null);
  assert.equal(parseYear('14.5'), null);
  assert.equal(parseYear('1400 AD'), null);
});
