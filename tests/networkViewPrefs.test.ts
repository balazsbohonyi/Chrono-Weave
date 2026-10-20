import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_VIEW_PREFS_KEY, readNetworkViewPrefs, saveNetworkViewPrefs } from '../src/utils/networkViewPrefs';

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
    clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
};

test('defaults to the timeline with lines shown when nothing is stored', () => {
  assert.deepEqual(readNetworkViewPrefs(memoryStorage()), { mode: 'time', showLines: true, maximized: false });
});

test('remembers the layout and the lines setting, each saved without losing the other', () => {
  const storage = memoryStorage();
  saveNetworkViewPrefs({ mode: 'corridor' }, storage);
  saveNetworkViewPrefs({ showLines: false }, storage);
  saveNetworkViewPrefs({ maximized: true }, storage);
  assert.deepEqual(readNetworkViewPrefs(storage), { mode: 'corridor', showLines: false, maximized: true });
});

test('falls back field by field on stale, corrupt or unavailable storage', () => {
  assert.deepEqual(readNetworkViewPrefs(memoryStorage({ [NETWORK_VIEW_PREFS_KEY]: JSON.stringify({ mode: 'gone', showLines: false }) })), { mode: 'time', showLines: false, maximized: false });
  assert.deepEqual(readNetworkViewPrefs(memoryStorage({ [NETWORK_VIEW_PREFS_KEY]: '{nope' })), { mode: 'time', showLines: true, maximized: false });
  assert.deepEqual(readNetworkViewPrefs(null), { mode: 'time', showLines: true, maximized: false });
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } as unknown as Storage;
  assert.doesNotThrow(() => saveNetworkViewPrefs({ mode: 'free' }, throwing));
  assert.equal(readNetworkViewPrefs(throwing).mode, 'time');
});
