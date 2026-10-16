import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptIdentity, claimsQuery, createWikidataResolver, historicalYear, parseClaimRows, parsePortraitRows, pickYear, portraitsByQid, portraitsQuery, portraitUrl,
  titlesToQids, wikidataKey, yearOfTime,
  type FetchLike, type WikidataClaim, type WikidataEntity,
} from '../src/services/wikidataService';

// Real responses recorded from the live APIs (see scripts/wikidataSmoke.ts to check them again).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/wikidata/${name}.json`, import.meta.url), 'utf8'));
const titles = fixture('titles'), claims = fixture('claims'), search = fixture('search-oppenheimer');
const entities = parseClaimRows(claims);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const claim = (year: number, precision = 11, rank: WikidataClaim['rank'] = 'normal'): WikidataClaim => ({ year, precision, rank });
const entity = (extra: Partial<WikidataEntity> = {}): WikidataEntity => ({ qid: 'Q1', human: true, births: [], deaths: [], ...extra });

// The three services the resolver talks to, answered from the recordings. `searches` maps a searched name to the recorded answer.
function fakeFetch(options: { searches?: Record<string, unknown>; failing?: Array<'wikipedia' | 'sparql' | 'search'> } = {}) {
  const calls: Array<{ service: string; url: URL; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input), service = url.hostname === 'en.wikipedia.org' ? 'wikipedia' : url.hostname === 'query.wikidata.org' ? 'sparql' : 'search';
    calls.push({ service, url, init });
    if (options.failing?.includes(service as 'wikipedia')) return reply({}, 503);
    if (service === 'wikipedia') return reply(titles);
    if (service === 'sparql') return reply(claims);
    return reply(options.searches?.[url.searchParams.get('search') ?? ''] ?? { search: [] });
  };
  return { fetchImpl, calls };
}

test('years from SPARQL follow the app: BCE has no year zero, so the astronomical -469 is 470 BCE', () => {
  assert.equal(yearOfTime('1904-04-22T00:00:00Z'), 1904);
  assert.equal(yearOfTime('-0469-01-01T00:00:00Z'), -470);
  assert.equal(yearOfTime('0000-06-01T00:00:00Z'), -1);
  assert.equal(yearOfTime('0001-01-01T00:00:00Z'), 1);
  assert.equal(yearOfTime('garbage'), undefined);
  assert.equal(historicalYear(0), -1);
});

test('the recorded claims parse into one entity per QID, with ranks, precisions and the human flag', () => {
  const oppenheimer = entities.get('Q132537')!, newton = entities.get('Q935')!, socrates = entities.get('Q913')!;
  assert.deepEqual([oppenheimer.human, oppenheimer.births.map(c => c.year), oppenheimer.deaths.map(c => c.year)], [true, [1904], [1967]]);
  // Newton has a year-only 1642 and two day-precise 1643 statements, one of them preferred.
  assert.deepEqual(newton.births.map(c => [c.year, c.precision, c.rank]).sort(), [[1642, 9, 'normal'], [1643, 11, 'normal'], [1643, 11, 'preferred']]);
  assert.deepEqual([socrates.births.map(c => c.year), socrates.deaths.map(c => c.year).sort()], [[-470], [-399, -399]]);
  assert.equal(entities.get('Q568182'), undefined, 'a disambiguation page has no statements at all');
  assert.deepEqual(parseClaimRows(null), new Map());
  // Rows with no QID or no kind are skipped; a birth row with no usable date adds nothing.
  const odd = parseClaimRows({ results: { bindings: [{ item: { value: 'http://x/Q1' } }, { kind: { value: 'birth' } }, { item: { value: 'nope' }, kind: { value: 'birth' } },
    { item: { value: 'http://x/Q7' }, kind: { value: 'human' } }, { item: { value: 'http://x/Q7' }, kind: { value: 'birth' }, time: { value: 'garbage' }, prec: { value: '11' } }] } });
  assert.deepEqual([...odd.keys()], ['Q7']);
  assert.deepEqual([odd.get('Q7')!.human, odd.get('Q7')!.births], [true, []]);
});

test('a year: deprecated statements and dates coarser than a year are ignored, preferred wins, disagreement goes to the nearest proposed year', () => {
  assert.equal(pickYear(entities.get('Q935')!.births, 1642), 1643, 'the preferred statement beats the year-only one that is nearer');
  assert.equal(pickYear([claim(1642), claim(1643)], 1642), 1642);
  assert.equal(pickYear([claim(1642), claim(1643)], 1644), 1643);
  assert.equal(pickYear([claim(1642), claim(1644)], 1643), 1642, 'a tie goes to the earlier year');
  assert.equal(pickYear([claim(1700, 11, 'deprecated')], 1700), undefined);
  assert.equal(pickYear([claim(1700, 8)], 1700), undefined, 'a century is no year');
  assert.equal(pickYear([claim(1700, 8), claim(1702, 9)], 1700), 1702);
  assert.equal(pickYear([], 1700), undefined);
});

test('Oppenheimer proposed with either pair of years is the same QID with the right years', () => {
  const wrong = acceptIdentity({ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }, entities.get('Q132537')!, 2026);
  const right = acceptIdentity({ name: 'J. Robert Oppenheimer', birthYear: 1904, deathYear: 1967 }, entities.get('Q132537')!, 2026);
  assert.deepEqual(wrong, { qid: 'Q132537', birthYear: 1904, deathYear: 1967 });
  assert.deepEqual(right, wrong);
});

test('the guards: a human, within ten years of what was proposed, overlapping, and with some trustworthy year at all', () => {
  const socrates = entities.get('Q913')!, lopez = entities.get('Q40715')!, newton = entities.get('Q935')!;
  assert.deepEqual(acceptIdentity({ name: 'Socrates', birthYear: -470, deathYear: -399 }, socrates, 2026), { qid: 'Q913', birthYear: -470, deathYear: -399 });
  assert.equal(acceptIdentity({ name: 'Socrates', birthYear: -480, deathYear: -399 }, socrates, 2026)?.birthYear, -470, 'ten years off is still accepted');
  assert.equal(acceptIdentity({ name: 'Socrates', birthYear: -481, deathYear: -399 }, socrates, 2026), null, 'eleven is not');
  assert.equal(acceptIdentity({ name: 'Isaac Newton', birthYear: 1800, deathYear: 1860 }, newton, 2026), null, 'another person with the same name');
  assert.equal(acceptIdentity({ name: 'Newton', birthYear: 1642, deathYear: 1727 }, entity({ human: false, births: [claim(1642)] }), 2026), null, 'not a human');
  assert.equal(acceptIdentity({ name: 'X', birthYear: 1642, deathYear: 1727 }, entity({ qid: 'nope', births: [claim(1642)], deaths: [claim(1727)] }), 2026), null);
  assert.equal(acceptIdentity({ name: 'X', birthYear: 1642, deathYear: 1727 }, entity({ births: [claim(1600, 7)], deaths: [claim(1727, 11, 'deprecated')] }), 2026), null, 'no trustworthy year proves nothing');
  // A living person has no death statement: the app counts that as dying this year.
  assert.deepEqual(acceptIdentity({ name: 'Jennifer Lopez', birthYear: 1969, deathYear: 2026 }, lopez, 2026), { qid: 'Q40715', birthYear: 1969, deathYear: 2026 });
  assert.equal(acceptIdentity({ name: 'Somebody', birthYear: 1650, deathYear: 1720 }, entity({ births: [claim(1650)] }), 2026), null, 'a historical person missing a death statement is not mistaken for a living one');
  // A field Wikidata cannot give keeps the proposed year.
  assert.deepEqual(acceptIdentity({ name: 'X', birthYear: 1650, deathYear: 1720 }, entity({ births: [claim(1650, 8)], deaths: [claim(1722)] }), 2026), { qid: 'Q1', birthYear: 1650, deathYear: 1722 });
});

test('titles are asked in one request, joined by |, redirects and capitalisation followed; names with no page are absent', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const names = ['Robert Oppenheimer', 'J. Robert Oppenheimer', 'isaac newton', 'Newton', 'Zzyzx Nobody Person'];
  const { qids, failed } = await titlesToQids(names, fetchImpl);
  assert.deepEqual([...qids].sort(), [['J. Robert Oppenheimer', 'Q132537'], ['Newton', 'Q568182'], ['Robert Oppenheimer', 'Q132537'], ['isaac newton', 'Q935']]);
  assert.equal(failed.size, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('titles'), names.join('|'));
  assert.equal(calls[0].url.searchParams.get('redirects'), '1');
});

test('titles are asked fifty at a time, and a batch that cannot be asked is reported, not thrown', async () => {
  const many = Array.from({ length: 120 }, (_, index) => `Person ${index}`), { fetchImpl, calls } = fakeFetch();
  await titlesToQids(many, fetchImpl);
  assert.deepEqual(calls.map(call => call.url.searchParams.get('titles')!.split('|').length).sort(), [20, 50, 50]);
  const broken = await titlesToQids(['A', 'B'], fakeFetch({ failing: ['wikipedia'] }).fetchImpl);
  assert.deepEqual([broken.qids.size, [...broken.failed]], [0, ['A', 'B']]);
});

test('the claims query asks only for the given QIDs, with one row per statement', () => {
  const query = claimsQuery(['Q132537', 'Q935', 'not-a-qid', 'Q1 } DROP']);
  assert.ok(query.includes('wd:Q132537 wd:Q935 }'), query);
  assert.ok(!query.includes('not-a-qid') && !query.includes('DROP'));
  assert.ok(/UNION/.test(query) && query.includes('P569') && query.includes('P570') && query.includes('wd:Q5'));
});

// Portraits through the item (recorded: Oppenheimer, Hitler and Dante have a P18 picture, Q4115189 has none).
test('the portraits query asks only for the given QIDs and only for their portrait statement', () => {
  const query = portraitsQuery(['Q132537', 'Q352', 'not-a-qid', 'Q1 } DROP']);
  assert.ok(query.includes('wd:Q132537 wd:Q352 }') && query.includes('wdt:P18'), query);
  assert.ok(!query.includes('not-a-qid') && !query.includes('DROP'));
});

test('a recorded portraits answer becomes one thumbnail URL per item, and an item without a portrait is simply absent', () => {
  const portraits = parsePortraitRows(fixture('portraits'), 120);
  assert.deepEqual([...portraits.keys()].sort(), ['Q1067', 'Q132537', 'Q352']);
  assert.equal(portraits.get('Q352'), 'https://commons.wikimedia.org/wiki/Special:FilePath/Adolf%20Hitler%20cropped%20restored%203x4.jpg?width=120');
  assert.ok(portraits.get('Q132537')!.startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/Oppenheimer%20(cropped).jpg?width=120'));
  assert.equal(portraits.has('Q4115189'), false);
});

test('portrait files: the name is re-encoded once, and anything that is not a Commons file path is no portrait', () => {
  assert.equal(portraitUrl('http://commons.wikimedia.org/wiki/Special:FilePath/A%20B%C3%A9.jpg', 400), 'https://commons.wikimedia.org/wiki/Special:FilePath/A%20B%C3%A9.jpg?width=400');
  assert.equal(portraitUrl('http://example.org/elsewhere.jpg', 120), null);
  assert.equal(portraitUrl('http://commons.wikimedia.org/wiki/Special:FilePath/%E0%A4%A.jpg', 120), null, 'a malformed escape does not throw');
  assert.equal(parsePortraitRows({ results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/One.jpg' } },
    { item: { value: 'http://www.wikidata.org/entity/Q1' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Two.jpg' } }, { item: {} }, null] } }, 120).get('Q1')?.includes('One.jpg'), true, 'the first of several');
  assert.equal(parsePortraitRows({ nonsense: true }, 120).size, 0);
});

test('portraits are asked for fifty items at a time in one SPARQL request each, naming every item answered', async () => {
  const { fetchImpl, calls } = fakeFetch(), sparqlPortraits: FetchLike = async (input, init) => { await fetchImpl(input, init); return reply(fixture('portraits')); };
  const qids = ['Q132537', 'Q352', 'Q1067', 'Q4115189', ...Array.from({ length: 116 }, (_, index) => `Q${900000 + index}`)];
  const { portraits, answered } = await portraitsByQid(qids, 120, sparqlPortraits);
  assert.deepEqual(calls.map(call => call.service), ['sparql', 'sparql', 'sparql']);
  assert.deepEqual(calls.map(call => (call.url.searchParams.get('query')!.match(/wd:Q\d+/g) ?? []).length).sort(), [20, 50, 50]);
  assert.equal(answered.size, 120, 'every item of a batch that was answered, with or without a portrait');
  assert.equal(portraits.size, 3);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.ok(headers['Api-User-Agent'] && headers.Accept.includes('sparql-results+json'));
});

test('a portraits batch that cannot be asked, or is not SPARQL, answers nothing: those items are not "without a portrait"', async () => {
  assert.deepEqual(await portraitsByQid(['Q1', 'Q2'], 120, async () => reply({}, 503)), { portraits: new Map(), answered: new Set() });
  assert.equal((await portraitsByQid(['Q1'], 120, async () => reply({ unexpected: 'shape' }))).answered.size, 0);
  assert.equal((await portraitsByQid(['Q1'], 120, async () => { throw new Error('offline'); })).answered.size, 0);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(portraitsByQid(['Q1'], 120, async () => { throw new Error('cancelled'); }, aborted.signal));
  assert.deepEqual(await portraitsByQid([], 120, async () => { throw new Error('never asked'); }), { portraits: new Map(), answered: new Set() });
});

const lopez = { name: 'Jennifer Lopez', birthYear: 1969, deathYear: 2026 };
test('the resolver sends two people with different names and years to one QID and corrects the years', async () => {
  const { fetchImpl, calls } = fakeFetch(), resolver = createWikidataResolver({ fetch: fetchImpl, now: () => 2026 });
  const wrong = { name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }, right = { name: 'J. Robert Oppenheimer', birthYear: 1904, deathYear: 1967 };
  const result = await resolver.resolve([wrong, right, lopez]);
  assert.deepEqual(result.get(wikidataKey(wrong)), { qid: 'Q132537', birthYear: 1904, deathYear: 1967 });
  assert.deepEqual(result.get(wikidataKey(right)), result.get(wikidataKey(wrong)));
  assert.deepEqual(result.get(wikidataKey(lopez)), { qid: 'Q40715', birthYear: 1969, deathYear: 2026 });
  assert.deepEqual(calls.map(call => call.service), ['wikipedia', 'sparql'], 'one title request and one claims request for the whole batch');
  const headers = calls[1].init?.headers as Record<string, string>;
  assert.ok(headers['Api-User-Agent'] && headers.Accept.includes('sparql-results+json'));
  assert.ok(calls[1].url.searchParams.get('query')!.includes('wd:Q132537'));
});

test('a name that is only a town or no page at all falls back to search, and with no fitting candidate is a definite miss', async () => {
  const { fetchImpl, calls } = fakeFetch(), resolver = createWikidataResolver({ fetch: fetchImpl, now: () => 2026 });
  const town = { name: 'Newton', birthYear: 1642, deathYear: 1727 }, nobody = { name: 'Zzyzx Nobody Person', birthYear: 1700, deathYear: 1760 };
  const result = await resolver.resolve([town, nobody]);
  assert.deepEqual([result.get(wikidataKey(town)), result.get(wikidataKey(nobody))], ['miss', 'miss']);
  assert.deepEqual(calls.filter(call => call.service === 'search').map(call => call.url.searchParams.get('search')).sort(), ['Newton', 'Zzyzx Nobody Person']);
});

test('search finds a person whose name is no page title, the years choosing among its candidates', async () => {
  const { fetchImpl } = fakeFetch({ searches: { 'Julius Robert Oppenheimer': search } }), resolver = createWikidataResolver({ fetch: fetchImpl, now: () => 2026 });
  const input = { name: 'Julius Robert Oppenheimer', birthYear: 1905, deathYear: 1967 };
  const result = await resolver.resolve([input]);
  assert.deepEqual(result.get(wikidataKey(input)), { qid: 'Q132537', birthYear: 1904, deathYear: 1967 });
});

test('search is tried for a bounded number of names per call; the others stay unanswered, to be asked again', async () => {
  const resolver = createWikidataResolver({ fetch: fakeFetch().fetchImpl, now: () => 2026, limits: { searchFallbacks: 1 } });
  const first = { name: 'Zzyzx Nobody Person', birthYear: 1700, deathYear: 1760 }, second = { name: 'Zzyzx Other Person', birthYear: 1700, deathYear: 1760 };
  const result = await resolver.resolve([first, second]);
  assert.deepEqual([result.get(wikidataKey(first)), result.has(wikidataKey(second))], ['miss', false]);
});

test('when Wikipedia, the claims service or search cannot be reached, those people are unanswered, never a miss and never an error', async () => {
  const input = { name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 };
  for (const failing of [['wikipedia'], ['sparql'], ['wikipedia', 'sparql', 'search']] as const) {
    const result = await createWikidataResolver({ fetch: fakeFetch({ failing: [...failing] }).fetchImpl, now: () => 2026 }).resolve([input]);
    assert.equal(result.has(wikidataKey(input)), false, failing.join('+'));
  }
  // A page that is no match whose search fails stays unknown too: nothing is remembered.
  const town = { name: 'Newton', birthYear: 1642, deathYear: 1727 };
  const result = await createWikidataResolver({ fetch: fakeFetch({ failing: ['search'] }).fetchImpl, now: () => 2026 }).resolve([town]);
  assert.equal(result.has(wikidataKey(town)), false);
});

test('a cancelled search cancels the lookup', async () => {
  const controller = new AbortController(); controller.abort();
  const fetchImpl: FetchLike = async (_input, init) => { init?.signal?.throwIfAborted(); return reply(titles); };
  await assert.rejects(createWikidataResolver({ fetch: fetchImpl }).resolve([lopez], controller.signal));
});

test('nothing asked, nothing sent', async () => {
  const { fetchImpl, calls } = fakeFetch();
  assert.equal((await createWikidataResolver({ fetch: fetchImpl }).resolve([])).size, 0);
  assert.equal(calls.length, 0);
});
