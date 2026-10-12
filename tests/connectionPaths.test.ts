import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECENT_CONNECTIONS } from '../src/constants';
import { CanvasCache } from '../src/utils/canvasHistory';
import {
  connectionPathKey, listConnectionPaths, readConnectionPath, saveConnectionPath, savedPathFigureIds, saveWovenFigureIds, wovenFigureIds,
} from '../src/utils/connectionPaths';
import { discardRejectedFollowFigureCandidates } from '../src/services/followFigureConnections';
import { saveRelationshipMap } from '../src/utils/relationshipCache';
import type { HistoricalFigure } from '../src/types';
import { MemoryStorage } from './helpers';

const person = (id: string, birthYear = 1500, deathYear = 1560): HistoricalFigure =>
  ({ id, name: id.toUpperCase(), birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const [a, m, b] = ['a', 'm', 'b'].map(id => person(id));
const canvas = [a, m, b];

test('paths are keyed by the sorted endpoint ids, whichever way they were found', () => {
  assert.equal(connectionPathKey('b', 'a'), connectionPathKey('a', 'b'));
  assert.equal(connectionPathKey('w-p-x y-1-2', 'a'), 'chrono_path_a_w-p-x%20y-1-2');
  assert.notEqual(connectionPathKey('a', 'b'), connectionPathKey('a', 'c'));
});

test('a saved path replays in the requested direction, with its evidence reversed to match', () => {
  const storage = new MemoryStorage();
  saveConnectionPath(storage, [a, m, b], ['A met M.', 'M taught B.'], 100);
  const forward = readConnectionPath(storage, canvas, 'a', 'b');
  assert.deepEqual(forward?.figures.map(figure => figure.id), ['a', 'm', 'b']);
  assert.deepEqual(forward?.evidence, ['A met M.', 'M taught B.']);
  const reversed = readConnectionPath(storage, canvas, 'b', 'a');
  assert.deepEqual(reversed?.figures.map(figure => figure.id), ['b', 'm', 'a']);
  assert.deepEqual(reversed?.evidence, ['M taught B.', 'A met M.']);
  assert.equal(reversed?.createdAt, 100);
  assert.equal(readConnectionPath(storage, canvas, 'a', 'm'), null);
});

test('a path whose people left the canvas is hidden without touching the others', () => {
  const storage = new MemoryStorage();
  saveConnectionPath(storage, [a, m, b], ['x', 'y'], 1);
  saveConnectionPath(storage, [a, m], ['z'], 2);
  assert.deepEqual(listConnectionPaths(storage, [a, m]).map(entry => entry.figures.map(figure => figure.id)), [['a', 'm']]);
  assert.equal(readConnectionPath(storage, [a, m], 'a', 'b'), null);
  assert.equal(listConnectionPaths(storage, canvas).length, 2);
});

test('recent connections are newest first and capped, dropping the oldest', () => {
  const storage = new MemoryStorage();
  const hub = person('hub');
  const spokes = Array.from({ length: MAX_RECENT_CONNECTIONS + 5 }, (_, index) => person(`s${String(index).padStart(2, '0')}`));
  spokes.forEach((spoke, index) => saveConnectionPath(storage, [hub, spoke], ['met'], index + 1));
  const entries = listConnectionPaths(storage, [hub, ...spokes]);
  assert.equal(entries.length, MAX_RECENT_CONNECTIONS);
  assert.equal(entries[0].figures[1].id, `s${MAX_RECENT_CONNECTIONS + 4}`);
  assert.equal(entries.at(-1)?.figures[1].id, 's05');
  assert.equal(readConnectionPath(storage, [hub, ...spokes], 'hub', 's00'), null);
  let stored = 0;
  for (let index = 0; index < storage.length; index++) if (storage.key(index)?.startsWith('chrono_path_')) stored++;
  assert.equal(stored, MAX_RECENT_CONNECTIONS);
});

test('damaged or mismatched entries are ignored and never replace a good path', () => {
  const storage = new MemoryStorage();
  saveConnectionPath(storage, [a, m, b], ['x', 'y'], 1);
  storage.setItem('chrono_path_broken', '{nope');
  storage.setItem('chrono_path_wrongshape', JSON.stringify({ version: 1, ids: ['a', 'b'], evidence: [], createdAt: 5 }));
  storage.setItem(connectionPathKey('a', 'm'), JSON.stringify({ version: 1, ids: ['a', 'b'], evidence: ['mismatched endpoints'], createdAt: 6 }));
  assert.deepEqual(listConnectionPaths(storage, canvas).map(entry => entry.createdAt), [1]);
  assert.equal(readConnectionPath(storage, canvas, 'a', 'm'), null);
  // The evidence count must match the number of links, and an incomplete save is refused.
  saveConnectionPath(storage, [a, b], [], 9);
  assert.equal(readConnectionPath(storage, canvas, 'a', 'b')?.figures.length, 3);
});

test('path entries live in the canvas cache, so they are saved, restored, and evicted with their canvas', () => {
  const cache = new CanvasCache();
  saveConnectionPath(cache, [a, m, b], ['x', 'y'], 7);
  const restored = new CanvasCache(cache.snapshot());
  assert.deepEqual(readConnectionPath(restored, canvas, 'b', 'a')?.figures.map(figure => figure.id), ['b', 'm', 'a']);
  assert.equal(readConnectionPath(new CanvasCache(), canvas, 'a', 'b'), null);
  cache.setItem('chrono_other_', 'ignored');
  assert.deepEqual(Object.keys(cache.snapshot()), [connectionPathKey('a', 'b')]);
});

test('woven-in people on a saved path survive the Follow a Figure rejection filter', () => {
  const storage = new MemoryStorage();
  const focus = person('a');
  const stranger = person('stranger');
  const context = { mode: 'figure' as const, query: 'A', inferredStartYear: 1500, inferredEndYear: 1560, themeDescription: 'A', activeCategories: ['ALL' as const] };
  const figures = [focus, stranger];
  saveRelationshipMap(focus, figures, [], storage);
  storage.setItem('chrono_assessment_a_stranger', JSON.stringify({
    scope: JSON.stringify([focus, stranger].map(({ id, name, birthYear, deathYear, occupation, category }) => [id, name, birthYear, deathYear, occupation, category])),
    narrativeVersion: 1, explanation: { isRelevant: false, evidence: '', summary: 'None.', sections: [{ title: 'Assessment', content: 'None.' }] },
  }));
  assert.deepEqual(discardRejectedFollowFigureCandidates(figures, context, storage).map(figure => figure.id), ['a']);
  saveConnectionPath(storage, [focus, stranger], ['They met.'], 1);
  assert.deepEqual(savedPathFigureIds(storage), new Set(['a', 'stranger']));
  assert.deepEqual(discardRejectedFollowFigureCandidates(figures, context, storage).map(figure => figure.id), ['a', 'stranger']);
});

test('woven-in people stay protected after their path is evicted from the recent list', () => {
  const storage = new MemoryStorage();
  const focus = person('a');
  const woven = person('woven');
  const context = { mode: 'figure' as const, query: 'A', inferredStartYear: 1500, inferredEndYear: 1560, themeDescription: 'A', activeCategories: ['ALL' as const] };
  const figures = [focus, woven];
  saveRelationshipMap(focus, figures, [], storage);
  storage.setItem('chrono_assessment_a_woven', JSON.stringify({
    scope: JSON.stringify([focus, woven].map(({ id, name, birthYear, deathYear, occupation, category }) => [id, name, birthYear, deathYear, occupation, category])),
    narrativeVersion: 1, explanation: { isRelevant: false, evidence: '', summary: 'None.', sections: [{ title: 'Assessment', content: 'None.' }] },
  }));
  // The path that brought the person in, then enough newer ones to push it out of the list.
  saveConnectionPath(storage, [focus, woven], ['They met.'], 1);
  saveWovenFigureIds(storage, ['woven']);
  for (let index = 0; index < MAX_RECENT_CONNECTIONS; index++) saveConnectionPath(storage, [person(`p${index}`), person(`q${index}`)], ['x'], 10 + index);
  assert.equal(readConnectionPath(storage, figures, 'a', 'woven'), null, 'the path itself was evicted');
  assert.ok(!savedPathFigureIds(storage).has('woven'));
  assert.deepEqual(wovenFigureIds(storage), new Set(['woven']));
  assert.deepEqual(discardRejectedFollowFigureCandidates(figures, context, storage).map(figure => figure.id), ['a', 'woven']);
});

test('woven-in ids accumulate without duplicates, ignore damage, and travel with the canvas cache', () => {
  const storage = new MemoryStorage();
  saveWovenFigureIds(storage, []);
  assert.equal(storage.length, 0);
  saveWovenFigureIds(storage, ['x', 'y']);
  saveWovenFigureIds(storage, ['y', 'z']);
  assert.deepEqual([...wovenFigureIds(storage)], ['x', 'y', 'z']);
  const cache = new CanvasCache(Object.fromEntries(Array.from({ length: storage.length }, (_, index) => [storage.key(index)!, storage.getItem(storage.key(index)!)!])));
  assert.deepEqual([...wovenFigureIds(cache)], ['x', 'y', 'z']);
  storage.setItem(storage.key(0)!, '{nope');
  assert.deepEqual([...wovenFigureIds(storage)], []);
  storage.setItem(storage.key(0)!, JSON.stringify(['a', 3, null]));
  assert.deepEqual([...wovenFigureIds(storage)], ['a']);
});
