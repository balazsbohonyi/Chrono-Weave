import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWikipediaImagesByName } from '../src/services/wikiService';
import { PortraitStore, setPortraitStore } from '../src/services/portraitStore';

// Six Degrees draws portraits in 32-64px circles: hundreds of 400px pictures overflowed the browser's decoded-image cache and made
// the explorer slow, so contacts get 120px thumbnails, from Wikipedia and from the Wikidata fallback alike.
test('Six Degrees portraits are asked for as 120px thumbnails, also through the Wikidata fallback', async () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  setPortraitStore(new PortraitStore());
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const body = url.includes('wikidata.org')
      ? { claims: { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Portrait of Beta.jpg' } } }] } }
      : { query: { pages: { 1: { title: 'Alpha', thumbnail: { source: 'https://upload.example/120px-Alpha.jpg' } }, 2: { title: 'Beta', pageprops: { wikibase_item: 'Q2' } } } } };
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  try {
    const found = await fetchWikipediaImagesByName(['Alpha', 'Beta']);
    assert.equal(new URL(requested[0]).searchParams.get('pithumbsize'), '120');
    assert.equal(found.get('Alpha'), 'https://upload.example/120px-Alpha.jpg');
    assert.match(found.get('Beta') ?? '', /Special:FilePath\/Portrait%20of%20Beta\.jpg\?width=120$/);
  } finally {
    globalThis.fetch = realFetch;
    setPortraitStore(undefined);
  }
});
