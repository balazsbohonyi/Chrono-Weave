import { MAX_RECENT_CONNECTIONS } from '../constants';
import type { HistoricalFigure } from '../types';
import { samePerson, validAccepted, type ContactAssessment, type ContactPerson } from '../services/connectionGraph';
import { pairKey } from '../services/pathService';
import { recoverKnowledge } from './connectionKnowledge';

export const LEGACY_PATH_CACHE_PREFIX = 'chrono_path_';
export const PATH_CACHE_PREFIX = 'chrono_sd2_path_';
export const MEMBERSHIP_CACHE_PREFIX = 'chrono_sd2_members_';
const MEMBERSHIP_KEY = `${MEMBERSHIP_CACHE_PREFIX}migration`;
// Everyone a connection wove into the canvas. Kept apart from the saved paths, which are evicted after
// MAX_RECENT_CONNECTIONS, because woven-in people stay on the canvas for good.
export const WOVEN_CACHE_PREFIX = 'chrono_woven_';
const WOVEN_KEY = `${WOVEN_CACHE_PREFIX}ids`;

interface SavedPath {
  version: 2;
  contacts: ContactAssessment[];
  people: ContactPerson[];
  identityIds: string[];
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
  contacts?: import('../services/connectionGraph').ContactAssessment[];
  // The shared identities of the people on the chain, in the same order as `figures`, and their records: what the exploration of this
  // connection is rebuilt from when the saved search itself is gone.
  identityIds?: string[];
  people?: ContactPerson[];
}

// One entry per unordered pair of endpoints, so a reversed request replays the same chain.
export const connectionPathKey = (firstId: string, secondId: string) =>
  `${PATH_CACHE_PREFIX}${[firstId, secondId].map(encodeURIComponent).sort().join('_')}`;

function readSaved(storage: Storage, key: string): SavedPath | null {
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!saved || saved.version !== 2 || !Array.isArray(saved.ids) || saved.ids.length < 2 || saved.ids.length > 22 || new Set(saved.ids).size !== saved.ids.length
        || !saved.ids.every((id: unknown) => typeof id === 'string')
        || !Array.isArray(saved.evidence) || saved.evidence.length !== saved.ids.length - 1
        || !saved.evidence.every((item: unknown) => typeof item === 'string')
        || !Number.isFinite(saved.createdAt)
        // The key names the endpoints; an entry filed under another pair is damaged.
        || key !== connectionPathKey(saved.ids[0], saved.ids[saved.ids.length - 1])) return null;
    if (!Array.isArray(saved.contacts) || saved.contacts.length !== saved.ids.length - 1 || !Array.isArray(saved.people)
      || !Array.isArray(saved.identityIds) || saved.identityIds.length !== saved.ids.length || new Set(saved.identityIds).size !== saved.identityIds.length) return null;
    const knowledge = recoverKnowledge({ people: saved.people, contacts: saved.contacts });
    const people = new Map(knowledge.people.map(p => [p.id, p]));
    if (!saved.identityIds.every(id => people.has(id)) || !saved.contacts.every((c: ContactAssessment, i: number) => validAccepted(c, people)
      && pairKey(...c.pair) === pairKey(saved.identityIds[i], saved.identityIds[i + 1]) && c.evidence === saved.evidence[i])) return null;
    return { ...saved, people: knowledge.people, contacts: knowledge.contacts };
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
export function saveConnectionPath(storage: Storage, chain: HistoricalFigure[], evidence: string[], createdAt = Date.now(), contacts: ContactAssessment[] = [], people: ContactPerson[] = []): void {
  if (chain.length < 2 || chain.length > 22 || evidence.length !== chain.length - 1 || contacts.length !== evidence.length) return;
  const identities = chain.map(p => people.find(shared => !shared.canonicalId && samePerson(shared, p)));
  if (identities.some(p => !p)) return;
  const identityIds = identities.map(p => p!.id);
  try {
    const saved: SavedPath = { version: 2, contacts, people: identities as ContactPerson[], identityIds, ids: chain.map(person => person.id), evidence, createdAt };
    const key = connectionPathKey(chain[0].id, chain[chain.length - 1].id);
    // Validate without touching a good existing entry.
    const json = JSON.stringify(saved);
    if (!readSaved({ getItem: () => json } as unknown as Storage, key)) return;
    storage.setItem(key, json);
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
  const identities = new Map(saved.people.map(p => [p.id, p]));
  if (!chain.every((p, i) => samePerson(p, identities.get(saved.identityIds[i])!))) return null;
  return reverse
    ? { key, figures: [...chain].reverse(), evidence: [...saved.evidence].reverse(), createdAt: saved.createdAt, contacts: saved.contacts ? [...saved.contacts].reverse() : undefined,
      identityIds: [...saved.identityIds].reverse(), people: saved.people }
    : { key, figures: chain, evidence: saved.evidence, createdAt: saved.createdAt, contacts: saved.contacts, identityIds: saved.identityIds, people: saved.people };
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

export function savedPathFigureIds(storage: Storage): Set<string> {
  return new Set(listKeys(storage).flatMap(key => readSaved(storage, key)?.ids ?? []));
}

export function wovenFigureIds(storage: Storage): Set<string> {
  try {
    const ids = JSON.parse(storage.getItem(WOVEN_KEY) || 'null');
    return new Set(Array.isArray(ids) ? ids.filter((id: unknown): id is string => typeof id === 'string') : []);
  } catch { return new Set(); }
}

export function saveWovenFigureIds(storage: Storage, ids: readonly string[]): void {
  if (!ids.length) return;
  try {
    storage.setItem(WOVEN_KEY, JSON.stringify([...new Set([...wovenFigureIds(storage), ...ids])]));
  } catch { /* A full or unavailable storage must not fail a successful connection. */ }
}

// Everyone on a saved chain or woven in by one is a permanent canvas member, even when other rules would prune them.
export function connectionFigureIds(storage: Storage): Set<string> {
  return new Set([...savedPathFigureIds(storage), ...wovenFigureIds(storage), ...legacyConnectionMemberIds(storage)]);
}

// Logical retirement only: legacy paths are never replayed or imported into shared knowledge.
// Their membership union remains protected even if migration/storage fails. No legacy record is deleted.
export function legacyConnectionMemberIds(storage: Storage): Set<string> {
  const ids = new Set<string>();
  try {
    const marker = JSON.parse(storage.getItem(MEMBERSHIP_KEY) || 'null');
    if (marker?.version === 2 && Array.isArray(marker.protectedIds)) for (const id of marker.protectedIds) if (typeof id === 'string') ids.add(id);
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(LEGACY_PATH_CACHE_PREFIX)) continue;
      try {
        const path = JSON.parse(storage.getItem(key) || 'null');
        if (path?.version === 1 && Array.isArray(path.ids)) for (const id of path.ids) if (typeof id === 'string') ids.add(id);
      } catch { /* Isolate a damaged legacy entry. */ }
    }
  } catch { /* The original metadata remains untouched. */ }
  return ids;
}
export function migrateLegacyConnectionMembers(storage: Storage): boolean {
  try {
    const protectedIds = [...new Set([...legacyConnectionMemberIds(storage), ...wovenFigureIds(storage)])].sort();
    const value = JSON.stringify({ version: 2, protectedIds });
    if (storage.getItem(MEMBERSHIP_KEY) !== value) storage.setItem(MEMBERSHIP_KEY, value);
    return storage.getItem(MEMBERSHIP_KEY) === value;
  } catch { return false; }
}
