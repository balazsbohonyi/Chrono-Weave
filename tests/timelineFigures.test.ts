import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTimelineFigures } from '../src/utils/timelineFigures';
import { figure } from './helpers';

test('new and restored timelines exclude short events while keeping short person lifetimes', () => {
  const person = { ...figure, birthYear: 1815, deathYear: 1816 };
  const events = [0, 1, 2, 3].map(duration => ({ ...figure, id: `event-${duration}`, category: 'EVENTS' as const, birthYear: 1815, deathYear: 1815 + duration }));
  const timeline = JSON.parse(JSON.stringify([person, ...events]));
  assert.deepEqual(filterTimelineFigures(timeline).map(item => item.id), [person.id, 'event-3']);
  assert.equal(timeline.length, 5);
});

test('the three-year event threshold also works for BCE and excludes reversed dates', () => {
  const events = [2, 3].map(duration => ({ ...figure, id: `event-${duration}`, category: 'EVENTS' as const, birthYear: -100, deathYear: -100 + duration }));
  const reversed = { ...figure, birthYear: 1852, deathYear: 1815 };
  assert.deepEqual(filterTimelineFigures([...events, reversed]).map(item => item.id), ['event-3']);
});
