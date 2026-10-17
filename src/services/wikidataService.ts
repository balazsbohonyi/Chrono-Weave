import { DUPLICATE_DATE_TOLERANCE_YEARS, NEAR_MATCH_TOLERANCE_YEARS, NEAR_MATCH_YEARS, QID_PATTERN, proposalKey } from './connectionGraph';
import { mapInputsToTitles, type TitleChanges } from './wikiTitles';

// Wikidata as the source of truth for who a Six Degrees person is: a stable QID (two records with one QID are one person) and the
// birth and death years (not the model's). Everything here is best effort: a lookup that fails is reported as unknown and the search
// carries on exactly as it would without Wikidata.

export interface ProposedLifespan { name: string; birthYear: number; deathYear: number }
// The years a QID stands for after the rules below; a field Wikidata cannot give reliably keeps the proposed year.
export interface WikidataIdentity { qid: string; birthYear: number; deathYear: number }
// A person resolved, or definitely not resolvable ('miss': no page, not a person, or years too far from the proposed ones). A person
// missing from a result was not answered (the network failed): nothing is remembered about them.
export type WikidataOutcome = WikidataIdentity | 'miss';
export interface WikidataResolver {
  resolve(inputs: ProposedLifespan[], signal?: AbortSignal): Promise<Map<string, WikidataOutcome>>;
}
export const wikidataKey = (person: ProposedLifespan) => proposalKey(person);

export const WIKIDATA_LIMITS = {
  titleBatch: 50, claimBatch: 50, timeoutMs: 8000, pool: 3, searchFallbacks: 8, searchCandidates: 5,
  // A date given only to a decade or a century (month 10, day 11 are finer than the year 9) is not a year.
  minPrecision: 9,
};

export type ClaimKind = 'human' | 'birth' | 'death';
export interface WikidataClaim { year: number; precision: number; rank: 'preferred' | 'normal' | 'deprecated' }
export interface WikidataEntity { qid: string; human: boolean; births: WikidataClaim[]; deaths: WikidataClaim[] }

// ---- Pure rules -----------------------------------------------------------------------------------------------------------------

// SPARQL numbers years astronomically (1 BCE is 0, 470 BCE is -469); the app, like the models' answers, counts BCE years with no year zero.
export const historicalYear = (astronomical: number) => astronomical <= 0 ? astronomical - 1 : astronomical;
const YEAR_OF_TIME = /^([+-]?)(\d+)-/;
export function yearOfTime(time: string): number | undefined {
  const match = YEAR_OF_TIME.exec(time);
  if (!match) return undefined;
  const astronomical = (match[1] === '-' ? -1 : 1) * Number(match[2]);
  return Number.isSafeInteger(astronomical) ? historicalYear(astronomical) : undefined;
}
const rankOf = (value: string | undefined): WikidataClaim['rank'] => /Preferred/i.test(value ?? '') ? 'preferred' : /Deprecated/i.test(value ?? '') ? 'deprecated' : 'normal';

// The rows of the claims query (one row per statement) as one entity per QID. Anything malformed is skipped.
export interface SparqlBinding { item?: { value?: string }; kind?: { value?: string }; time?: { value?: string }; prec?: { value?: string }; rank?: { value?: string } }
export function parseClaimRows(json: unknown): Map<string, WikidataEntity> {
  const entities = new Map<string, WikidataEntity>();
  const rows = (json as { results?: { bindings?: SparqlBinding[] } } | null)?.results?.bindings;
  if (!Array.isArray(rows)) return entities;
  for (const row of rows) {
    const qid = row?.item?.value?.match(/Q\d+$/)?.[0], kind = row?.kind?.value as ClaimKind | undefined;
    if (!qid || !kind) continue;
    const entity = entities.get(qid) ?? { qid, human: false, births: [], deaths: [] };
    entities.set(qid, entity);
    if (kind === 'human') { entity.human = true; continue; }
    const year = row.time?.value ? yearOfTime(row.time.value) : undefined, precision = Number(row.prec?.value);
    if (year === undefined || !Number.isFinite(precision)) continue;
    const claim: WikidataClaim = { year, precision, rank: rankOf(row.rank?.value) };
    if (kind === 'birth') entity.births.push(claim); else if (kind === 'death') entity.deaths.push(claim);
  }
  return entities;
}

// The year Wikidata gives for one field, or undefined when it gives none that can be trusted: deprecated statements and dates coarser than
// a year are ignored; a preferred statement wins; statements that still disagree (Julian and Gregorian birthdays) are settled by the one
// nearest the year that was proposed.
export function pickYear(claims: readonly WikidataClaim[], proposed: number, minPrecision = WIKIDATA_LIMITS.minPrecision): number | undefined {
  const usable = claims.filter(claim => claim.rank !== 'deprecated' && claim.precision >= minPrecision);
  const preferred = usable.filter(claim => claim.rank === 'preferred');
  const years = [...new Set((preferred.length ? preferred : usable).map(claim => claim.year))];
  if (!years.length) return undefined;
  return years.reduce((best, year) => Math.abs(year - proposed) < Math.abs(best - proposed) || (Math.abs(year - proposed) === Math.abs(best - proposed) && year < best) ? year : best);
}

// The guards: a human, years within the tolerance of what was proposed (or, when one of the two years is all but exact, the other within a
// wider one: a model that gets one end of a life right and the other badly wrong is still describing the same person, and somebody else
// with the same name would have to die in the same year as well), and a lifespan that overlaps it. A person with no trustworthy year
// at all in Wikidata proves nothing about who this is, so it is not accepted either. A human with no death statement at all is alive:
// the app counts that as dying this year. Null when the entity cannot be this person.
export function acceptIdentity(proposed: ProposedLifespan, entity: WikidataEntity, now = new Date().getFullYear(),
  tolerance = DUPLICATE_DATE_TOLERANCE_YEARS): WikidataIdentity | null {
  if (!entity.human || !QID_PATTERN.test(entity.qid)) return null;
  const birth = pickYear(entity.births, proposed.birthYear), statedDeath = pickYear(entity.deaths, proposed.deathYear);
  if (birth === undefined && statedDeath === undefined) return null;
  const alive = entity.deaths.length === 0;
  const death = statedDeath ?? (alive ? now : undefined);
  const birthYear = birth ?? proposed.birthYear, deathYear = death ?? proposed.deathYear;
  if (birthYear === 0 || deathYear === 0 || birthYear > deathYear || deathYear > now) return null;
  const offBirth = Math.abs(birthYear - proposed.birthYear), offDeath = Math.abs(deathYear - proposed.deathYear);
  const near = tolerance >= DUPLICATE_DATE_TOLERANCE_YEARS && ((offBirth <= NEAR_MATCH_YEARS && offDeath <= NEAR_MATCH_TOLERANCE_YEARS) || (offDeath <= NEAR_MATCH_YEARS && offBirth <= NEAR_MATCH_TOLERANCE_YEARS));
  if ((offBirth > tolerance || offDeath > tolerance) && !near) return null;
  if (birthYear > proposed.deathYear || deathYear < proposed.birthYear) return null;
  return { qid: entity.qid, birthYear, deathYear };
}
const distance = (proposed: ProposedLifespan, identity: WikidataIdentity) => Math.abs(identity.birthYear - proposed.birthYear) + Math.abs(identity.deathYear - proposed.deathYear);

// ---- Requests -------------------------------------------------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
// Browsers cannot set User-Agent; Wikimedia asks API clients to identify themselves with this header instead.
const API_USER_AGENT = 'ChronoWeave (https://github.com/balazsbohonyi/Chrono-Weave)';

async function getJson(fetchImpl: FetchLike, url: string, signal: AbortSignal | undefined, timeoutMs: number, headers?: Record<string, string>): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, { signal: combined, ...(headers ? { headers } : {}) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const chunked = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
async function inPool<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => { for (let index = next++; index < items.length; index = next++) results[index] = await work(items[index]); }));
  return results;
}

// Titles -> QIDs through Wikipedia, which follows redirects ("Robert Oppenheimer" is a redirect to "J. Robert Oppenheimer"). Disambiguation
// pages have QIDs too; the entity check decides later. Names with no page are absent from the result; `failed` lists the names of batches
// that could not be asked.
export async function titlesToQids(names: readonly string[], fetchImpl: FetchLike, signal?: AbortSignal, limits = WIKIDATA_LIMITS): Promise<{ qids: Map<string, string>; failed: Set<string> }> {
  const qids = new Map<string, string>(), failed = new Set<string>();
  await inPool(chunked([...new Set(names)], limits.titleBatch), limits.pool, async chunk => {
    const params = new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: chunk.join('|'), format: 'json', origin: '*' });
    try {
      const query = ((await getJson(fetchImpl, `${WIKIPEDIA_API}?${params}`, signal, limits.timeoutMs)) as { query?: TitleChanges & { pages?: Record<string, { title?: string; pageprops?: { wikibase_item?: string } }> } }).query;
      const byTitle = new Map(Object.values(query?.pages ?? {}).flatMap(page => page.title && page.pageprops?.wikibase_item ? [[page.title, page.pageprops.wikibase_item] as const] : []));
      for (const [name, title] of mapInputsToTitles(chunk, query ?? {})) { const qid = byTitle.get(title); if (qid) qids.set(name, qid); }
    } catch { signal?.throwIfAborted(); chunk.forEach(name => failed.add(name)); }
  });
  return { qids, failed };
}

// Candidate QIDs for a name, for when it is no page title: Wikidata's own search.
export async function searchQids(name: string, fetchImpl: FetchLike, signal?: AbortSignal, limits = WIKIDATA_LIMITS): Promise<string[]> {
  const params = new URLSearchParams({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: String(limits.searchCandidates), format: 'json', origin: '*' });
  const found = (await getJson(fetchImpl, `${WIKIDATA_API}?${params}`, signal, limits.timeoutMs)) as { search?: Array<{ id?: string }> };
  return (found.search ?? []).flatMap(entry => entry.id && QID_PATTERN.test(entry.id) ? [entry.id] : []);
}

// One row per statement: whether the item is a human, and every birth (P569) and death (P570) statement with its precision and rank.
export function claimsQuery(qids: readonly string[]): string {
  const items = qids.filter(qid => QID_PATTERN.test(qid)).map(qid => `wd:${qid}`).join(' ');
  const statements = (property: string, kind: string) =>
    `{ ?item p:${property} ?st . ?st wikibase:rank ?rank ; psv:${property} ?v . ?v wikibase:timeValue ?time ; wikibase:timePrecision ?prec . BIND("${kind}" AS ?kind) }`;
  return `SELECT ?item ?kind ?time ?prec ?rank WHERE { VALUES ?item { ${items} } { ?item wdt:P31 wd:Q5 . BIND("human" AS ?kind) } UNION ${statements('P569', 'birth')} UNION ${statements('P570', 'death')} }`;
}
export async function fetchClaimRows(qids: readonly string[], fetchImpl: FetchLike, signal?: AbortSignal, limits = WIKIDATA_LIMITS): Promise<unknown> {
  const params = new URLSearchParams({ query: claimsQuery(qids), format: 'json' });
  return getJson(fetchImpl, `${SPARQL_ENDPOINT}?${params}`, signal, limits.timeoutMs, { Accept: 'application/sparql-results+json', 'Api-User-Agent': API_USER_AGENT });
}
// ---- Portraits through the item -------------------------------------------------------------------------------------------------
// A person whose item is known (their QID) can be shown with the picture Wikidata holds for exactly that item (P18, the preferred
// statement, else a normal one), however unverified their contacts are: no name is looked up, so no namesake's face can turn up.

export function portraitsQuery(qids: readonly string[]): string {
  const items = qids.filter(qid => QID_PATTERN.test(qid)).map(qid => `wd:${qid}`).join(' ');
  return `SELECT ?item ?image WHERE { VALUES ?item { ${items} } ?item wdt:P18 ?image }`;
}
// The thumbnail address of a Commons file named by an entity statement (`…/Special:FilePath/Name.jpg`), the same form the name-based
// fallback in wikiService builds. Anything else is no usable portrait.
export function portraitUrl(image: string, width: number): string | null {
  const file = /\/Special:FilePath\/([^/?#]+)$/.exec(image)?.[1];
  if (!file) return null;
  try { return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(decodeURIComponent(file))}?width=${width}`; } catch { return null; }
}
// The rows of the portraits query as a portrait URL per QID (the first when an item has several). An item with no row is not in the result.
export function parsePortraitRows(json: unknown, width: number): Map<string, string> {
  const portraits = new Map<string, string>();
  const rows = (json as { results?: { bindings?: Array<{ item?: { value?: string }; image?: { value?: string } }> } } | null)?.results?.bindings;
  if (!Array.isArray(rows)) return portraits;
  for (const row of rows) {
    const qid = row?.item?.value?.match(/Q\d+$/)?.[0], url = row?.image?.value ? portraitUrl(row.image.value, width) : null;
    if (qid && url && !portraits.has(qid)) portraits.set(qid, url);
  }
  return portraits;
}
// Portraits by item, 50 at a time: `portraits` has the ones found, `answered` every item the service answered about (an item answered without
// a portrait simply has none), so an item whose batch could not be asked is in neither and is asked again later. Never throws, except to say it was cancelled.
export async function portraitsByQid(qids: readonly string[], width: number, fetchImpl: FetchLike, signal?: AbortSignal, limits = WIKIDATA_LIMITS): Promise<{ portraits: Map<string, string>; answered: Set<string> }> {
  const portraits = new Map<string, string>(), answered = new Set<string>();
  await inPool(chunked([...new Set(qids.filter(qid => QID_PATTERN.test(qid)))], limits.claimBatch), limits.pool, async chunk => {
    try {
      const params = new URLSearchParams({ query: portraitsQuery(chunk), format: 'json' });
      const json = await getJson(fetchImpl, `${SPARQL_ENDPOINT}?${params}`, signal, limits.timeoutMs, { Accept: 'application/sparql-results+json', 'Api-User-Agent': API_USER_AGENT });
      // A reply that is not SPARQL results is not an answer.
      if (!Array.isArray((json as { results?: { bindings?: unknown } } | null)?.results?.bindings)) throw new Error('No SPARQL results');
      for (const [qid, url] of parsePortraitRows(json, width)) portraits.set(qid, url);
      chunk.forEach(qid => answered.add(qid));
    } catch { signal?.throwIfAborted(); }
  });
  return { portraits, answered };
}

async function fetchEntities(qids: readonly string[], fetchImpl: FetchLike, signal: AbortSignal | undefined, limits: typeof WIKIDATA_LIMITS): Promise<{ entities: Map<string, WikidataEntity>; failed: Set<string> }> {
  const entities = new Map<string, WikidataEntity>(), failed = new Set<string>();
  await inPool(chunked([...new Set(qids)], limits.claimBatch), limits.pool, async chunk => {
    try { for (const [qid, entity] of parseClaimRows(await fetchClaimRows(chunk, fetchImpl, signal, limits))) entities.set(qid, entity); }
    catch { signal?.throwIfAborted(); chunk.forEach(qid => failed.add(qid)); }
  });
  return { entities, failed };
}

// ---- The resolver ---------------------------------------------------------------------------------------------------------------

export interface WikidataResolverOptions { fetch?: FetchLike; now?: () => number; limits?: Partial<typeof WIKIDATA_LIMITS> }
export function createWikidataResolver(options: WikidataResolverOptions = {}): WikidataResolver {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init)), limits = { ...WIKIDATA_LIMITS, ...options.limits };
  return {
    async resolve(inputs, signal) {
      const asked = [...new Map(inputs.map(input => [wikidataKey(input), input])).values()];
      const result = new Map<string, WikidataOutcome>();
      if (!asked.length) return result;
      const year = options.now?.() ?? new Date().getFullYear();
      // 1. The name as a page title (redirect-aware), then what Wikidata knows about the page.
      const titles = await titlesToQids(asked.map(input => input.name), fetchImpl, signal, limits);
      const first = await fetchEntities([...titles.qids.values()], fetchImpl, signal, limits);
      const unknown = new Set<string>(), unmatched: ProposedLifespan[] = [];
      for (const input of asked) {
        const qid = titles.qids.get(input.name);
        if (titles.failed.has(input.name) || (qid && first.failed.has(qid))) { unknown.add(wikidataKey(input)); continue; }
        const entity = qid ? first.entities.get(qid) : undefined, accepted = entity && acceptIdentity(input, entity, year);
        if (accepted) result.set(wikidataKey(input), accepted); else unmatched.push(input);
      }
      // 2. A name that is no page title, or whose page is no match (a town, another person): Wikidata's own search, the years deciding
      // between its candidates. Only a bounded number are tried per call; the rest stay unanswered and are asked again next time.
      const searched = unmatched.slice(0, limits.searchFallbacks);
      for (const input of unmatched.slice(limits.searchFallbacks)) unknown.add(wikidataKey(input));
      const candidates = new Map<string, string[]>();
      await inPool(searched, limits.pool, async input => {
        try { candidates.set(wikidataKey(input), (await searchQids(input.name, fetchImpl, signal, limits)).filter(qid => qid !== titles.qids.get(input.name))); }
        catch { signal?.throwIfAborted(); unknown.add(wikidataKey(input)); }
      });
      const second = await fetchEntities([...candidates.values()].flat(), fetchImpl, signal, limits);
      for (const input of searched) {
        const key = wikidataKey(input), listed = candidates.get(key);
        if (!listed) continue; // the search failed: already unknown
        const accepted = listed.flatMap(qid => { const entity = second.entities.get(qid), identity = entity && acceptIdentity(input, entity, year); return identity ? [identity] : []; })
          .sort((a, b) => distance(input, a) - distance(input, b))[0];
        if (accepted) result.set(key, accepted);
        else if (!listed.some(qid => second.failed.has(qid))) result.set(key, 'miss');
        else unknown.add(key);
      }
      for (const key of unknown) result.delete(key);
      return result;
    },
  };
}
