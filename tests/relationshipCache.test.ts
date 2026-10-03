import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readKnownRelationshipIds, readRelationshipMap, saveRelationshipMap, validRelatedIds } from '../src/utils/relationshipCache';
import { MemoryStorage, figure } from './helpers';

const other = { ...figure, id: 'babbage', name: 'Charles Babbage' };
const canvas = [figure, other];

test('relationship maps persist across reloads and are unaffected by canvas ordering', () => {
  const storage = new MemoryStorage();
  saveRelationshipMap(figure, canvas, [other.id], storage);
  const reloaded = new MemoryStorage();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)!;
    reloaded.setItem(key, storage.getItem(key)!);
  }
  assert.deepEqual(readRelationshipMap({ ...figure }, [...canvas].reverse(), reloaded), { relatedIds: [other.id], expansionAttempted: false });
});

test('a changed canvas or source invalidates its relationship map', () => {
  const storage = new MemoryStorage();
  saveRelationshipMap(figure, canvas, [other.id], storage);
  assert.equal(readRelationshipMap(figure, [figure], storage), null);
  assert.equal(readRelationshipMap(figure, [...canvas, { ...other, id: 'new' }], storage), null);
  assert.equal(readRelationshipMap(figure, [figure, { ...other, name: 'Another person' }], storage), null);
  assert.equal(readRelationshipMap({ ...figure, birthYear: 1816 }, canvas, storage), null);
});

test('empty maps distinguish an untried expansion from a completed empty expansion', () => {
  const storage = new MemoryStorage();
  assert.equal(readRelationshipMap(figure, canvas, storage), null);
  saveRelationshipMap(figure, canvas, [], storage);
  assert.deepEqual(readRelationshipMap(figure, canvas, storage), { relatedIds: [], expansionAttempted: false });
  saveRelationshipMap(figure, canvas, [], storage, true);
  assert.deepEqual(readRelationshipMap(figure, canvas, storage), { relatedIds: [], expansionAttempted: true });
});

test('discovery saves original and new connections against the expanded canvas', () => {
  const storage = new MemoryStorage();
  const discovered = { ...other, id: 'discovered', name: 'New connection' };
  const expanded = [...canvas, discovered];
  saveRelationshipMap(figure, expanded, [other.id, discovered.id], storage, true);
  assert.deepEqual(readRelationshipMap(figure, expanded, storage), { relatedIds: [other.id, discovered.id], expansionAttempted: true });
  assert.equal(readRelationshipMap(figure, canvas, storage), null);
});

test('malformed, outdated, or impossible cached maps are ignored', () => {
  const storage = new MemoryStorage();
  saveRelationshipMap(figure, canvas, [other.id], storage);
  const key = storage.key(0)!;
  const valid = JSON.parse(storage.getItem(key)!);
  for (const value of ['{broken', JSON.stringify({ ...valid, version: 99 }), JSON.stringify({ ...valid, relatedIds: ['missing'] }), JSON.stringify({ ...valid, expansionAttempted: undefined })]) {
    storage.setItem(key, value);
    assert.equal(readRelationshipMap(figure, canvas, storage), null);
  }
});

test('only distinct connections to other figures on the canvas are cached', () => {
  const storage = new MemoryStorage();
  const ids = [figure.id, other.id, other.id, 'missing'];
  assert.deepEqual(validRelatedIds(figure, canvas, ids), [other.id]);
  saveRelationshipMap(figure, canvas, ids, storage);
  assert.deepEqual(readRelationshipMap(figure, canvas, storage)?.relatedIds, [other.id]);
});

test('unavailable storage does not break mapping', () => {
  const storage = new MemoryStorage();
  storage.getItem = () => { throw new Error('Storage unavailable'); };
  storage.setItem = () => { throw new Error('Storage full'); };
  assert.equal(readRelationshipMap(figure, canvas, storage), null);
  assert.doesNotThrow(() => saveRelationshipMap(figure, canvas, [other.id], storage));
  assert.deepEqual(readKnownRelationshipIds(other, canvas, storage), []);
});

test('known pairs are reusable in both directions without marking a reverse search complete', () => {
  const storage = new MemoryStorage();
  saveRelationshipMap(figure, canvas, [other.id], storage);
  assert.deepEqual(readKnownRelationshipIds(figure, canvas, storage), [other.id]);
  assert.deepEqual(readKnownRelationshipIds(other, canvas, storage), [figure.id]);
  assert.equal(readRelationshipMap(other, canvas, storage), null);
  saveRelationshipMap(other, canvas, [], storage, true);
  assert.deepEqual(readKnownRelationshipIds(other, canvas, storage), [figure.id]);
});

test('unrelated canvas changes invalidate completed searches but preserve unchanged known pairs', () => {
  const storage = new MemoryStorage();
  const extra = { ...other, id: 'extra', name: 'Another person' };
  saveRelationshipMap(figure, [...canvas, extra], [other.id], storage);
  assert.equal(readRelationshipMap(figure, canvas, storage), null);
  assert.deepEqual(readKnownRelationshipIds(other, canvas, storage), [figure.id]);
  const expanded = [...canvas, { ...extra, id: 'new' }];
  assert.deepEqual(readKnownRelationshipIds(figure, expanded, storage), [other.id]);
});

test('known pairs exclude removed or changed endpoints', () => {
  const storage = new MemoryStorage();
  saveRelationshipMap(figure, canvas, [other.id], storage);
  assert.deepEqual(readKnownRelationshipIds(figure, [figure], storage), []);
  assert.deepEqual(readKnownRelationshipIds(other, [other], storage), []);
  const changed = { ...other, birthYear: 1816 };
  assert.deepEqual(readKnownRelationshipIds(changed, [figure, changed], storage), []);
  assert.deepEqual(readKnownRelationshipIds(figure, [figure, changed], storage), []);
  assert.deepEqual(readKnownRelationshipIds(other, [{ ...figure, name: 'Someone else' }, other], storage), []);
});

test('malformed persisted scopes and impossible pairs do not become reverse connections', () => {
  const storage = new MemoryStorage();
  saveRelationshipMap(figure, canvas, [other.id], storage);
  const key = storage.key(0)!;
  const valid = JSON.parse(storage.getItem(key)!);
  for (const value of [
    { ...valid, scope: '{broken' }, { ...valid, scope: '[]' },
    { ...valid, scope: JSON.stringify([['incorrect-source'], []]) },
    { ...valid, relatedIds: ['missing'] }, { ...valid, version: 99 },
  ]) {
    storage.setItem(key, JSON.stringify(value));
    assert.deepEqual(readKnownRelationshipIds(other, canvas, storage), []);
  }
});
