// Remembers which picture Wikipedia (or Wikidata) had for a person, so reloading the page, reopening a canvas or an exploration shows the faces at once
// instead of asking the Wikipedia and Wikidata APIs about every person again. Kept in a small IndexedDB database of its own (never in the canvas's
// localStorage, whose quota belongs to the timelines, nor in the Six Degrees knowledge store, whose records it would have to be threaded through).
//
// An entry is the thumbnail URL asked for at one width, or null when Wikipedia had no picture. The width is part of the key: the canvas shows
// 400px thumbnails and Six Degrees 120px ones, and a picture is only ever made smaller on display, so one cannot stand in for the other.
// Only an answer is remembered. A request that failed (offline, rate limited, a malformed reply) is not an answer and is asked again next time.

export interface PortraitRecord { url: string | null; at: number }
export type PortraitEntry = [key: string, record: PortraitRecord];
export interface PortraitBackend {
  load(): Promise<PortraitEntry[]>;
  save(entries: PortraitEntry[]): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const DAY = 24 * 60 * 60 * 1000;
export const PORTRAIT_LIMITS = {
  // A thumbnail address almost never changes, but a better page image may be chosen one day, so even a hit is asked again after a while.
  hitMs: 90 * DAY,
  // Wikipedia gains pictures: a person without one is looked up again after a week.
  missMs: 7 * DAY,
  maxEntries: 20000,
  // A database that does not answer must not hold the faces back: after this long the store carries on in memory only.
  loadMs: 3000,
  // Answers are written in batches, not one by one.
  flushMs: 250,
};

const keyOf = (width: number, name: string) => `${width}|${name}`;
const wellFormed = (entry: unknown): entry is PortraitEntry => Array.isArray(entry) && typeof entry[0] === 'string' && !!entry[1]
  && (typeof entry[1].url === 'string' || entry[1].url === null) && Number.isFinite(entry[1].at);

export class PortraitStore {
  private records = new Map<string, PortraitRecord>();
  private pending = new Map<string, PortraitRecord>();
  private ready: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;

  // Without a backend (no IndexedDB: a private window, the tests) the store is a memory of this page's life only.
  constructor(private readonly backend: PortraitBackend | null = null, private readonly now: () => number = Date.now, private readonly limits = PORTRAIT_LIMITS) {
    this.ready = backend ? this.hydrate(backend) : Promise.resolve();
  }

  private fresh(record: PortraitRecord) { return this.now() - record.at < (record.url ? this.limits.hitMs : this.limits.missMs); }

  private async hydrate(backend: PortraitBackend) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const loaded = await Promise.race([backend.load(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The portrait database did not answer.')), this.limits.loadMs); })]);
      const entries = (Array.isArray(loaded) ? loaded : []).filter(wellFormed);
      const live = entries.filter(([, record]) => this.fresh(record)).sort((a, b) => b[1].at - a[1].at);
      const kept = live.slice(0, this.limits.maxEntries), keptKeys = new Set(kept.map(([key]) => key));
      // What was answered while the database was still loading is newer than anything it holds.
      for (const [key, record] of kept) if (!this.records.has(key)) this.records.set(key, record);
      // Expired and surplus entries go.
      const drop = entries.map(([key]) => key).filter(key => !keptKeys.has(key));
      if (drop.length) this.writes = this.writes.then(() => backend.remove(drop)).catch(() => {});
    } catch { /* memory only */ } finally { clearTimeout(timer); }
  }

  // What is known and still fresh about these names at this width: the thumbnail URL, or null for a person Wikipedia had no picture for.
  // A name that is not in the result has to be asked about.
  async known(names: readonly string[], width: number): Promise<Map<string, string | null>> {
    await this.ready;
    const result = new Map<string, string | null>();
    for (const name of names) {
      const record = this.records.get(keyOf(width, name));
      if (record && this.fresh(record)) result.set(name, record.url);
    }
    return result;
  }

  // Remembers what Wikipedia answered: the URL, or null when it had no picture. Only names that were really answered belong here.
  record(width: number, answers: ReadonlyMap<string, string | null>) {
    const at = this.now();
    for (const [name, url] of answers) {
      const key = keyOf(width, name), record = { url, at };
      this.records.set(key, record);
      this.pending.set(key, record);
    }
    if (this.backend && this.pending.size && this.timer === undefined) this.timer = setTimeout(() => { void this.flush(); }, this.limits.flushMs);
  }

  // Writes what is waiting. Resolves once it is stored (or could not be: a failed write only means those answers are asked again later).
  async flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    const backend = this.backend, batch = [...this.pending];
    this.pending = new Map();
    if (backend && batch.length) this.writes = this.writes.then(() => this.ready).then(() => backend.save(batch)).catch(() => {});
    await this.writes;
  }
}

export const PORTRAIT_DATABASE = 'chronoweave-portraits';
const STORE = 'portraits';

// The browser's IndexedDB, in a database of its own: one object store, the key `width|name`, the record as value. Null where there is none.
export function indexedPortraitBackend(factory: IDBFactory | undefined = globalThis.indexedDB): PortraitBackend | null {
  if (!factory) return null;
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = factory.open(PORTRAIT_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The portrait database is blocked.'));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); opened = undefined; };
        resolve(database);
      };
    } catch (error) { reject(error); }
  });
  const transact = async (mode: IDBTransactionMode, work: (store: IDBObjectStore) => void): Promise<void> => {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
      work(transaction.objectStore(STORE));
    });
  };
  return {
    async load() {
      let keys: IDBRequest<IDBValidKey[]> | undefined, values: IDBRequest<PortraitRecord[]> | undefined;
      await transact('readonly', store => { keys = store.getAllKeys(); values = store.getAll(); });
      return (keys?.result ?? []).map((key, index): PortraitEntry => [String(key), values!.result[index]]);
    },
    save: entries => transact('readwrite', store => { for (const [key, record] of entries) store.put(record, key); }),
    remove: keys => transact('readwrite', store => { for (const key of keys) store.delete(key); }),
  };
}

let shared: PortraitStore | undefined;
// The one store of the page, created (and its database read) when first needed.
export function portraitStore(): PortraitStore {
  if (!shared) {
    shared = new PortraitStore(indexedPortraitBackend());
    // A tab closed within the flush delay must not lose what it just learned.
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { void shared?.flush(); });
  }
  return shared;
}
// Replaces (or, with undefined, forgets) the page's store; for tests.
export function setPortraitStore(store: PortraitStore | undefined) { shared = store; }
