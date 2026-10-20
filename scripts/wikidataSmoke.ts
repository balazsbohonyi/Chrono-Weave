// Manual check of the Wikidata identity lookup against the real Wikipedia and Wikidata APIs (not part of `bun test`, which only uses recorded
// responses): `bun run scripts/wikidataSmoke.ts`. Exits with 1 when an expectation no longer holds, e.g. because Wikidata changed a date.
import { createWikidataResolver, wikidataKey, type WikidataOutcome } from '../src/services/wikidataService';

const resolver = createWikidataResolver();
const cases: Array<{ name: string; birthYear: number; deathYear: number; expect: WikidataOutcome | 'unanswered'; why: string }> = [
  { name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967, expect: { qid: 'Q132537', birthYear: 1904, deathYear: 1967 }, why: 'a redirect, with a wrong birth year' },
  { name: 'J. Robert Oppenheimer', birthYear: 1904, deathYear: 1967, expect: { qid: 'Q132537', birthYear: 1904, deathYear: 1967 }, why: 'the same person under the page title' },
  { name: 'Isaac Newton', birthYear: 1642, deathYear: 1727, expect: { qid: 'Q935', birthYear: 1643, deathYear: 1727 }, why: 'Julian and Gregorian birthdays: the preferred one wins' },
  { name: 'Newton', birthYear: 1642, deathYear: 1727, expect: 'miss', why: 'a disambiguation page is no person' },
  { name: 'Socrates', birthYear: -470, deathYear: -399, expect: { qid: 'Q913', birthYear: -470, deathYear: -399 }, why: 'BCE years have no year zero' },
  { name: 'Pierre Bourdieu', birthYear: 1919, deathYear: 2002, expect: { qid: 'Q156268', birthYear: 1930, deathYear: 2002 }, why: 'eleven years off on the birth, the death exact: a near match' },
  { name: 'Pierre Bourdieu', birthYear: 1930, deathYear: 2002, expect: { qid: 'Q156268', birthYear: 1930, deathYear: 2002 }, why: 'the same person with the right years' },
  { name: 'Adolf Hitler', birthYear: 1889, deathYear: 1945, expect: { qid: 'Q352', birthYear: 1889, deathYear: 1945 }, why: 'a year-only and a day-precise birth statement' },
  { name: 'Jennifer Lopez', birthYear: 1969, deathYear: new Date().getFullYear(), expect: { qid: 'Q40715', birthYear: 1969, deathYear: new Date().getFullYear() }, why: 'alive: no death statement' },
];

const started = Date.now();
const result = await resolver.resolve(cases);
let failures = 0;
for (const { name, birthYear, deathYear, expect, why } of cases) {
  const got = result.get(wikidataKey({ name, birthYear, deathYear })) ?? 'unanswered';
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${birthYear}-${deathYear}) -> ${JSON.stringify(got)}${ok ? '' : `, expected ${JSON.stringify(expect)}`}  [${why}]`);
}
console.log(`${cases.length} lookups in ${Date.now() - started} ms`);
process.exit(failures ? 1 : 0);
