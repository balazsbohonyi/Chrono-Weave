import { MAX_RECENT_CONNECTIONS } from '../constants';
import type { HistoricalFigure } from '../types';

export const PATH_CACHE_PREFIX = 'chrono_path_';

interface SavedPath {
  version: 1;
  // Node ids in the order of the request that found the path.
  ids: string[];
  // Verified evidence for each link; evidence[i] connects ids[i] and ids[i + 1].
  evidence: string[];
  createdAt: number;
}

export interface ConnectionPathEntry {
  key: string;
  figures: HistoricalFigure[];
  evidence: string[];
  createdAt: number;
}

// One entry per unordered pair of endpoints, so a reversed request replays the same chain.
export const connectionPathKey = (firstId: string, secondId: string) =>
  `${PATH_CACHE_PREFIX}${[firstId, secondId].map(encodeURIComponent).sort().join('_')}`;

function readSaved(storage: Storage, key: string): SavedPath | null {
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!saved || saved.version !== 1 || !Array.isArray(saved.ids) || saved.ids.length < 2
        || !saved.ids.every((id: unknown) => typeof id === 'string')
        || !Array.isArray(saved.evidence) || saved.evidence.length !== saved.ids.length - 1
        || !saved.evidence.every((item: unknown) => typeof item === 'string')
        || !Number.isFinite(saved.createdAt)
        // The key names the endpoints; an entry filed under another pair is damaged.
        || key !== connectionPathKey(saved.ids[0], saved.ids[saved.ids.length - 1])) return null;
    return saved;
  } catch { return null; }
}

function listKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(PATH_CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

// Only a successful, fully verified chain is ever saved.
export function saveConnectionPath(storage: Storage, chain: HistoricalFigure[], evidence: string[], createdAt = Date.now()): void {
  if (chain.length < 2 || evidence.length !== chain.length - 1) return;
  try {
    const saved: SavedPath = { version: 1, ids: chain.map(person => person.id), evidence, createdAt };
    storage.setItem(connectionPathKey(chain[0].id, chain[chain.length - 1].id), JSON.stringify(saved));
    // Oldest paths are dropped first, including unreadable entries.
    const entries = listKeys(storage).map(key => ({ key, createdAt: readSaved(storage, key)?.createdAt ?? -Infinity }))
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const { key } of entries.slice(MAX_RECENT_CONNECTIONS)) storage.removeItem(key);
  } catch { /* A full or unavailable storage must not fail a successful connection. */ }
}

function resolve(key: string, saved: SavedPath, figures: Map<string, HistoricalFigure>, reverse: boolean): ConnectionPathEntry | null {
  const people = saved.ids.map(id => figures.get(id));
  // A path that references a person no longer on the canvas is hidden, not repaired.
  if (people.some(person => !person)) return null;
  const chain = people as HistoricalFigure[];
  return reverse
    ? { key, figures: [...chain].reverse(), evidence: [...saved.evidence].reverse(), createdAt: saved.createdAt }
    : { key, figures: chain, evidence: saved.evidence, createdAt: saved.createdAt };
}

// The saved chain between two people, oriented so it starts at `first` (reversed when it was found the other way round).
export function readConnectionPath(storage: Storage, figures: HistoricalFigure[], first: string, second: string): ConnectionPathEntry | null {
  const key = connectionPathKey(first, second);
  const saved = readSaved(storage, key);
  if (!saved) return null;
  const head = saved.ids[0], tail = saved.ids[saved.ids.length - 1];
  if (!(head === first && tail === second) && !(head === second && tail === first)) return null;
  return resolve(key, saved, new Map(figures.map(person => [person.id, person])), head !== first);
}

// Newest first, capped, with entries that no longer fit the canvas left out.
export function listConnectionPaths(storage: Storage, figures: HistoricalFigure[]): ConnectionPathEntry[] {
  const byId = new Map(figures.map(person => [person.id, person]));
  return listKeys(storage).flatMap(key => {
    const saved = readSaved(storage, key);
    const entry = saved ? resolve(key, saved, byId, false) : null;
    return entry ? [entry] : [];
  }).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECENT_CONNECTIONS);
}

// Everyone on a saved chain is a permanent canvas member, even when other rules would prune them.
export function savedPathFigureIds(storage: Storage): Set<string> {
  return new Set(listKeys(storage).flatMap(key => readSaved(storage, key)?.ids ?? []));
}
