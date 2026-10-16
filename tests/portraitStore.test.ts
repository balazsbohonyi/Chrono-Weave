import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortraitStore, PORTRAIT_LIMITS, setPortraitStore, type PortraitBackend, type PortraitEntry } from '../src/services/portraitStore';
import { fetchBatchFigureDetails, fetchPortraitsByQid, fetchWikipediaImagesByName } from '../src/services/wikiService';
import { loadNetworkPortraits } from '../src/hooks/useNetworkPortraits';
import { figure } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
// A database in memory that counts what is asked of it.
function memoryBackend(initial: PortraitEntry[] = []) {
  const rows = new Map<string, PortraitEntry[1]>(initial);
  const calls = { load: 0, save: 0, remove: [] as string[] };
  const backend: PortraitBackend = {
    async load() { calls.load++; return [...rows]; },
    async save(entries) { calls.save++; for (const [key, record] of entries) rows.set(key, record); },
    async remove(keys) { calls.remove.push(...keys); for (const key of keys) rows.delete(key); },
  };
  return { backend, rows, calls };
}

test('the store remembers hits and misses by width and name, and knows nothing about anyone else', async () => {
  const store = new PortraitStore();
  store.record(400, new Map([['Ada', 'https://img/400-ada'], ['Nobody', null]]));
  assert.deepEqual([...await store.known(['Ada', 'Nobody', 'Grace'], 400)], [['Ada', 'https://img/400-ada'], ['Nobody', null]]);
  // The same people at the other width are not known: a small picture cannot stand in for a big one.
  assert.deepEqual([...await store.known(['Ada', 'Nobody'], 120)], []);
});

test('a hit is asked again after three months and a miss after a week', async () => {
  let now = 1_000_000;
  const store = new PortraitStore(null, () => now);
  store.record(120, new Map([['Ada', 'u'], ['Nobody', null]]));
  now += 6 * DAY;
  assert.equal((await store.known(['Ada', 'Nobody'], 120)).size, 2);
  now += 2 * DAY;
  assert.deepEqual([...await store.known(['Ada', 'Nobody'], 120)].map(([name]) => name), ['Ada'], 'the miss has expired');
  now += PORTRAIT_LIMITS.hitMs;
  assert.equal((await store.known(['Ada'], 120)).size, 0, 'and so has the hit');
});

test('what a page learned is there for the next visit: written to the database, read back by a new store', async () => {
  const { backend, rows, calls } = memoryBackend();
  const first = new PortraitStore(backend);
  first.record(120, new Map([['Ada', 'https://img/ada'], ['Nobody', null]]));
  assert.equal(calls.save, 0, 'writes are batched, not immediate');
  await first.flush();
  assert.equal(calls.save, 1); assert.equal(rows.size, 2);
  const second = new PortraitStore(backend);
  assert.deepEqual([...await second.known(['Ada', 'Nobody'], 120)], [['Ada', 'https://img/ada'], ['Nobody', null]]);
});

test('answers are written in one batch after a short while, and a flush writes at once', async () => {
  const { backend, calls } = memoryBackend();
  const store = new PortraitStore(backend, Date.now, { ...PORTRAIT_LIMITS, flushMs: 10 });
  store.record(120, new Map([['A', 'a']])); store.record(120, new Map([['B', 'b']])); store.record(400, new Map([['C', 'c']]));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(calls.save, 1);
  store.record(120, new Map([['D', 'd']]));
  await store.flush();
  assert.equal(calls.save, 2);
});

test('expired and malformed entries are not used and are removed; only the newest few thousand are kept', async () => {
  const now = 10_000 * DAY;
  const entries = [
    ['120|Fresh', { url: 'u', at: now - DAY }], ['120|OldMiss', { url: null, at: now - 8 * DAY }], ['120|OldHit', { url: 'u', at: now - 100 * DAY }],
    ['120|Broken', { url: 42, at: now }], ['bad'], ['120|NoTime', { url: 'u' }], ['120|Newer', { url: 'u', at: now - 1000 }],
  ] as unknown as PortraitEntry[];
  const { backend, calls } = memoryBackend(entries);
  const store = new PortraitStore(backend, () => now, { ...PORTRAIT_LIMITS, maxEntries: 1 });
  assert.deepEqual([...await store.known(['Fresh', 'OldMiss', 'OldHit', 'Broken', 'NoTime', 'Newer'], 120)], [['Newer', 'u']], 'one is kept: the newest');
  await store.flush();
  assert.deepEqual(calls.remove.sort(), ['120|Fresh', '120|OldHit', '120|OldMiss'].sort());
});

test('a database that fails or never answers leaves a working store of this page\'s life', async () => {
  const broken: PortraitBackend = { load: () => Promise.reject(new Error('no database')), save: () => Promise.reject(new Error('full')), remove: () => Promise.reject(new Error('full')) };
  const failing = new PortraitStore(broken);
  failing.record(120, new Map([['Ada', 'u']]));
  await failing.flush();
  assert.equal((await failing.known(['Ada'], 120)).get('Ada'), 'u');
  const silent: PortraitBackend = { load: () => new Promise(() => {}), save: async () => {}, remove: async () => {} };
  const waiting = new PortraitStore(silent, Date.now, { ...PORTRAIT_LIMITS, loadMs: 20 });
  assert.deepEqual([...await waiting.known(['Ada'], 120)], [], 'it carried on once the wait was over');
});

// The Wikipedia API as the page sees it: a title query answers with pages, and the Wikidata API with a portrait file (or none).
interface Api {
  requests: URL[]; wikipedia: (titles: string[]) => Response | Promise<Response>; wikidata: (entity: string) => Response | Promise<Response>;
  // The SPARQL service, asked with the items of a portraits query.
  sparql: (qids: string[]) => Response | Promise<Response>;
}
const sparqlPortraits = (found: Record<string, string>) => Response.json({ results: { bindings: Object.entries(found).map(([qid, file]) => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` }, image: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}` } })) } });
const pageFor = (title: string, extra: object) => ({ title, ...extra });
const answer = (pages: object[]) => Response.json({ query: { pages: Object.fromEntries(pages.map((page, index) => [index + 1, page])) } });
async function withApi<T>(api: Partial<Api>, run: (api: Api) => Promise<T>): Promise<T> {
  const real = globalThis.fetch, warn = console.warn;
  const full: Api = {
    requests: [],
    wikipedia: titles => answer(titles.map(title => pageFor(title, { thumbnail: { source: `https://upload.example/thumb/a/ab/${title.replace(/ /g, '_')}.jpg/PX-${title}.jpg` } }))),
    wikidata: () => Response.json({ claims: {} }),
    sparql: qids => sparqlPortraits(Object.fromEntries(qids.map(qid => [qid, `${qid}.jpg`]))),
    ...api,
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    full.requests.push(url);
    if (url.hostname === 'query.wikidata.org') return full.sparql(url.searchParams.get('query')!.match(/Q\d+/g) ?? []);
    return url.hostname.includes('wikidata') ? full.wikidata(url.searchParams.get('entity')!) : full.wikipedia((url.searchParams.get('titles') ?? '').split('|'));
  }) as typeof fetch;
  console.warn = () => {};
  try { return await run(full); } finally { globalThis.fetch = real; console.warn = warn; setPortraitStore(undefined); }
}
const wikipediaRequests = (api: Api) => api.requests.filter(url => url.hostname.includes('wikipedia'));

test('after a reload nobody already seen is asked about again: no request goes out for them', async () => {
  const { backend } = memoryBackend();
  await withApi({}, async api => {
    const first = new PortraitStore(backend); setPortraitStore(first);
    const found = await fetchWikipediaImagesByName(['Isaac Newton', 'Marie Curie']);
    assert.equal(found.size, 2); assert.equal(wikipediaRequests(api).length, 1);
    await first.flush();
    // A new page: a new store over the same database.
    setPortraitStore(new PortraitStore(backend));
    const again = await fetchWikipediaImagesByName(['Isaac Newton', 'Marie Curie']);
    assert.deepEqual([...again], [...found]);
    assert.equal(wikipediaRequests(api).length, 1, 'still just the first request');
  });
});

test('only the newcomers are asked about, and the remembered portraits are handed over before they are answered', async () => {
  await withApi({}, async api => {
    setPortraitStore(new PortraitStore());
    await fetchWikipediaImagesByName(['Isaac Newton']);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = api.wikipedia;
    api.wikipedia = async titles => { await gate; return slow(titles); };
    const early: string[][] = [];
    const pending = fetchWikipediaImagesByName(['Isaac Newton', 'Robert Hooke'], found => early.push([...found.keys()]));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(early, [['Isaac Newton']], 'Newton is shown while Hooke is still being asked about');
    release();
    const found = await pending;
    assert.deepEqual([...found.keys()].sort(), ['Isaac Newton', 'Robert Hooke']);
    assert.deepEqual(wikipediaRequests(api).map(url => url.searchParams.get('titles')), ['Isaac Newton', 'Robert Hooke']);
  });
});

test('a person Wikipedia has no picture for is remembered as such; a failed request is not remembered as anything', async () => {
  const failures: Array<() => Response | Promise<Response>> = [
    () => new Response('slow down', { status: 429 }),
    () => new Response('{"error":{"code":"internal"}}'),
    () => Promise.reject(new Error('offline')),
  ];
  for (const fail of failures) {
    await withApi({ wikipedia: fail }, async api => {
      setPortraitStore(new PortraitStore());
      assert.equal((await fetchWikipediaImagesByName(['Ada Lovelace'])).size, 0);
      // Nothing was recorded, so the next try asks again, and this time it is answered.
      api.wikipedia = titles => answer(titles.map(title => pageFor(title, { thumbnail: { source: 'https://upload.example/ada.jpg' } })));
      assert.equal((await fetchWikipediaImagesByName(['Ada Lovelace'])).get('Ada Lovelace'), 'https://upload.example/ada.jpg');
      assert.equal(wikipediaRequests(api).length, 2);
    });
  }
  await withApi({ wikipedia: titles => answer(titles.map(title => pageFor(title, {}))) }, async api => {
    setPortraitStore(new PortraitStore());
    assert.equal((await fetchWikipediaImagesByName(['No Picture'])).size, 0);
    assert.equal((await fetchWikipediaImagesByName(['No Picture'])).size, 0);
    assert.equal(wikipediaRequests(api).length, 1, 'a real miss is remembered');
  });
});

test('the Wikidata fallback: a portrait found is remembered, "none" is a miss, and a failed lookup is asked again', async () => {
  const noImage = (titles: string[]) => answer(titles.map((title, index) => pageFor(title, { pageprops: { wikibase_item: `Q${index + 1}` } })));
  await withApi({ wikipedia: noImage, wikidata: () => new Response('boom', { status: 500 }) }, async api => {
    setPortraitStore(new PortraitStore());
    assert.equal((await fetchWikipediaImagesByName(['Pat'])).size, 0);
    api.wikidata = () => Response.json({ claims: { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Pat.jpg' } } }] } });
    const found = await fetchWikipediaImagesByName(['Pat']);
    assert.match(found.get('Pat') ?? '', /Special:FilePath\/Pat\.jpg\?width=120$/);
    const requests = api.requests.length;
    await fetchWikipediaImagesByName(['Pat']);
    assert.equal(api.requests.length, requests, 'remembered, not asked again');
  });
  await withApi({ wikipedia: noImage }, async api => {
    setPortraitStore(new PortraitStore());
    await fetchWikipediaImagesByName(['Sam']); await fetchWikipediaImagesByName(['Sam']);
    assert.equal(api.requests.length, 2, 'Wikidata has none either: one question to each, once');
  });
});

test('the small pictures of Six Degrees and the big ones of the canvas are remembered apart', async () => {
  await withApi({}, async api => {
    setPortraitStore(new PortraitStore());
    await fetchWikipediaImagesByName(['Ada Lovelace']);
    const details = await fetchBatchFigureDetails([{ ...figure, id: 'store-ada-width' }]);
    assert.deepEqual(wikipediaRequests(api).map(url => url.searchParams.get('pithumbsize')), ['120', '400']);
    assert.ok(details.get('store-ada-width')?.imageUrl);
    await fetchWikipediaImagesByName(['Ada Lovelace']);
    assert.equal(wikipediaRequests(api).length, 2, 'both are now remembered');
  });
});

test('figures that already carry a portrait are not looked up, and remembered portraits reach the sidebar before the rest are answered', async () => {
  await withApi({}, async api => {
    setPortraitStore(new PortraitStore());
    const have = { ...figure, id: 'store-have', name: 'Has Portrait', imageUrl: 'https://upload.example/mine.jpg' };
    assert.equal((await fetchBatchFigureDetails([have])).get('store-have')?.imageUrl, 'https://upload.example/mine.jpg');
    assert.equal(api.requests.length, 0);
    await fetchBatchFigureDetails([{ ...figure, id: 'store-first', name: 'Seen Before' }]);
    const early: Array<[string, string | null]> = [];
    const results = await fetchBatchFigureDetails([{ ...figure, id: 'store-first-again', name: 'Seen Before' }, { ...figure, id: 'store-new', name: 'Never Seen' }],
      stored => { for (const [id, detail] of stored) early.push([id, detail.imageUrl]); });
    assert.deepEqual(early.map(([id]) => id), ['store-first-again']);
    assert.equal(results.size, 2); assert.ok(results.get('store-new')?.imageUrl);
  });
});

test('a big network is asked about in chunks of fifty, a few at a time, and every answer arrives', async () => {
  await withApi({}, async api => {
    setPortraitStore(new PortraitStore());
    const names = Array.from({ length: 230 }, (_, index) => `Person ${index}`);
    let running = 0, most = 0;
    const answerChunk = api.wikipedia;
    api.wikipedia = async titles => { running++; most = Math.max(most, running); await new Promise(resolve => setTimeout(resolve, 10)); running--; return answerChunk(titles); };
    const found = await fetchWikipediaImagesByName(names);
    assert.equal(found.size, 230);
    assert.deepEqual(wikipediaRequests(api).map(url => url.searchParams.get('titles')!.split('|').length).sort(), [30, 50, 50, 50, 50]);
    assert.ok(most > 1 && most <= 3, `${most} at a time`);
  });
});

const sparqlRequests = (api: Api) => api.requests.filter(url => url.hostname === 'query.wikidata.org');

test('portraits through the item: one request for many, remembered across a reload, apart from the same person looked up by name', async () => {
  const { backend } = memoryBackend();
  await withApi({ sparql: qids => sparqlPortraits(Object.fromEntries(qids.filter(qid => qid !== 'Q3').map(qid => [qid, `${qid} portrait.jpg`]))) }, async api => {
    const first = new PortraitStore(backend); setPortraitStore(first);
    const found = await fetchPortraitsByQid(['Q1', 'Q2', 'Q3']);
    assert.deepEqual([...found.keys()].sort(), ['Q1', 'Q2'], 'an item without a portrait is absent');
    assert.equal(found.get('Q1'), 'https://commons.wikimedia.org/wiki/Special:FilePath/Q1%20portrait.jpg?width=120');
    assert.equal(sparqlRequests(api).length, 1); assert.equal(wikipediaRequests(api).length, 0, 'no name was looked up');
    await first.flush();
    setPortraitStore(new PortraitStore(backend));
    assert.deepEqual([...await fetchPortraitsByQid(['Q1', 'Q2', 'Q3'])].sort(), [...found].sort());
    assert.equal(sparqlRequests(api).length, 1, 'after a reload nobody is asked again, the item without a portrait included');
    // A person called "Q1" is not the item Q1.
    assert.equal((await fetchWikipediaImagesByName(['Q1'])).size, 1); assert.equal(wikipediaRequests(api).length, 1);
  });
});

test('portraits through the item: a failed request is not "no portrait", and remembered items are handed over before the others are answered', async () => {
  await withApi({ sparql: () => new Response('busy', { status: 503 }) }, async api => {
    setPortraitStore(new PortraitStore());
    assert.equal((await fetchPortraitsByQid(['Q1'])).size, 0);
    api.sparql = qids => sparqlPortraits(Object.fromEntries(qids.map(qid => [qid, `${qid}.jpg`])));
    assert.equal((await fetchPortraitsByQid(['Q1'])).size, 1);
    assert.equal(sparqlRequests(api).length, 2, 'the first failure was asked again');
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fast = api.sparql;
    api.sparql = async qids => { await gate; return fast(qids); };
    const early: string[][] = [];
    const pending = fetchPortraitsByQid(['Q1', 'Q2'], found => early.push([...found.keys()]));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(early, [['Q1']]);
    release();
    assert.deepEqual([...(await pending).keys()].sort(), ['Q1', 'Q2']);
  });
});

test('Six Degrees portraits: unverified people with a confirmed item are looked up through it, everybody else by name, each kept apart', async () => {
  const cache = new Map<string, string | null>(), byName: string[][] = [], byItem: string[][] = [];
  const names = async (keys: string[]) => { byName.push(keys); return new Map(keys.map(key => [key, `https://img/name/${key}`])); };
  const items = async (keys: string[]) => { byItem.push(keys); return new Map(keys.filter(key => key !== 'Q9').map(key => [key, `https://img/item/${key}`])); };
  const people = [{ id: 'sd2-a', name: 'Supported Sam' }, { id: 'sd2-b', name: 'Albert Speer', qid: 'Q60' }, { id: 'sd2-c', name: 'No Portrait', qid: 'Q9' }];
  const first = await loadNetworkPortraits(people, names, cache, undefined, items);
  assert.deepEqual(byName, [['Supported Sam']]); assert.deepEqual(byItem, [['Q60', 'Q9']]);
  assert.deepEqual([...first].sort(), [['sd2-a', 'https://img/name/Supported Sam'], ['sd2-b', 'https://img/item/Q60']]);
  // Known people, the one without a portrait included, are not asked again.
  await loadNetworkPortraits(people, names, cache, undefined, items);
  assert.equal(byName.length + byItem.length, 2);
  // Once Albert Speer is AI-supported (no item in the subject) he is looked up by name, as every supported person is.
  const supported = await loadNetworkPortraits([{ id: 'sd2-b', name: 'Albert Speer' }], names, cache, undefined, items);
  assert.deepEqual(byName[1], ['Albert Speer']); assert.equal(supported.get('sd2-b'), 'https://img/name/Albert Speer');
});

test('a lookup that failed is not kept as "no portrait" anywhere above the store: Six Degrees people and canvas figures are asked again', async () => {
  await withApi({ sparql: () => new Response('busy', { status: 503 }), wikipedia: () => new Response('slow down', { status: 429 }) }, async api => {
    setPortraitStore(new PortraitStore());
    const cache = new Map<string, string | null>(), people = [{ id: 'by-name', name: 'Pat' }, { id: 'by-item', name: 'Speer', qid: 'Q60' }];
    assert.equal((await fetchPortraitsByQid(['Q60'])).unanswered?.has('Q60'), true);
    assert.equal((await loadNetworkPortraits(people, undefined, cache)).size, 0);
    assert.deepEqual([...cache.keys()], [], 'neither the failed name nor the failed item was recorded as "no portrait"');
    // The services are back: the same people are asked about again and now have their faces.
    api.sparql = qids => sparqlPortraits(Object.fromEntries(qids.map(qid => [qid, `${qid}.jpg`])));
    api.wikipedia = titles => answer(titles.map(title => pageFor(title, { thumbnail: { source: `https://upload.example/${title}.jpg` } })));
    const result = await loadNetworkPortraits(people, undefined, cache);
    assert.deepEqual([...result.keys()].sort(), ['by-item', 'by-name']);
    assert.deepEqual([...cache.keys()].sort(), ['by-item|Q60', 'by-name']);
    // A canvas figure whose lookup failed is not stuck without a portrait for the rest of the page either.
    api.wikipedia = () => new Response('slow down', { status: 429 });
    const canvasFigure = { ...figure, id: 'store-retry', name: 'Retry Person' };
    assert.equal((await fetchBatchFigureDetails([canvasFigure])).get('store-retry')?.imageUrl, null);
    api.wikipedia = titles => answer(titles.map(title => pageFor(title, { thumbnail: { source: `https://upload.example/${title}.jpg` } })));
    assert.equal((await fetchBatchFigureDetails([canvasFigure])).get('store-retry')?.imageUrl, 'https://upload.example/Retry Person.jpg');
    const asked = api.requests.length;
    await fetchBatchFigureDetails([canvasFigure]);
    assert.equal(api.requests.length, asked, 'once answered, it is cached');
  });
});

test('Six Degrees portraits: the remembered ones of both kinds are handed over early, and a failing route does not take the other down', async () => {
  const early: Array<Array<[string, string]>> = [], warn = console.warn;
  console.warn = () => {};
  try {
    const names = async (keys: string[], onStored?: (found: Map<string, string>) => void) => { onStored?.(new Map([['Sam', 'https://img/sam']])); return new Map(keys.map(key => [key, `https://img/${key}`])); };
    const items = async (keys: string[], onStored?: (found: Map<string, string>) => void) => { onStored?.(new Map([['Q60', 'https://img/q60']])); return new Map(keys.map(key => [key, `https://img/${key}`])); };
    const people = [{ id: 'a', name: 'Sam' }, { id: 'b', name: 'Speer', qid: 'Q60' }];
    await loadNetworkPortraits(people, names, new Map(), found => early.push([...found].sort()), items);
    assert.deepEqual(early[0], [['a', 'https://img/sam']], 'the first early answer is only what that route knew');
    assert.deepEqual(early[1], [['a', 'https://img/sam'], ['b', 'https://img/q60']], 'the second also has the first');
    const cache = new Map<string, string | null>();
    const result = await loadNetworkPortraits(people, names, cache, undefined, async () => { throw new Error('wikidata is down'); });
    assert.deepEqual([...result.keys()], ['a']);
    assert.equal(cache.has('b|Q60'), false, 'a failed lookup is not remembered as "no portrait"');
  } finally { console.warn = warn; }
});

test('Six Degrees portraits: people remembered from earlier are handed over early, by person', async () => {
  const cache = new Map<string, string | null>(), early: Array<Array<[string, string]>> = [];
  const fetcher = async (names: string[], onStored?: (found: Map<string, string>) => void) => {
    onStored?.(new Map([['Isaac Newton', 'https://img/newton']]));
    return new Map(names.map(name => [name, `https://img/${name}`]));
  };
  const people = [{ id: 'sd2-a', name: 'Isaac Newton' }, { id: 'sd2-b', name: 'Robert Hooke' }];
  const result = await loadNetworkPortraits(people, fetcher, cache, found => early.push([...found]));
  assert.deepEqual(early, [[['sd2-a', 'https://img/newton']]]);
  assert.equal(result.size, 2);
});
