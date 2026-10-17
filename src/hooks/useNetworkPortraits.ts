import { useEffect, useState } from 'react';
import { fetchPortraitsByQid, fetchWikipediaImagesByName } from '../services/wikiService';

// Who to look up a portrait for. With a `qid` the picture is the one Wikidata holds for that item (for people who are not AI-supported but whose
// identity Wikidata has confirmed); without one it is looked up by name on Wikipedia (AI-supported people only: see `portraitSubjects`).
export interface PortraitSubject { id: string; name: string; qid?: string }
// `onStored` is given the pictures that were already remembered (by name, or by item) while the rest are still being asked for. The result may
// name (`unanswered`) the keys whose request failed: they are not "without a picture", so they are not recorded as such and are asked again.
type Fetcher = (keys: string[], onStored?: (found: Map<string, string>) => void) => Promise<Map<string, string> & { unanswered?: ReadonlySet<string> }>;

// Shared person ID (and, for a lookup through the item, `id|qid`) -> portrait URL, or null once Wikipedia or Wikidata has been asked and had nothing.
// The two kinds are kept apart so that a person who becomes AI-supported is then looked up by name, as every supported person is.
const portraitCache = new Map<string, string | null>();
const cacheKey = (person: PortraitSubject) => person.qid ? `${person.id}|${person.qid}` : person.id;

// Looks up only the people not asked about yet. It never throws: a failed lookup is not remembered
// as a miss, so the person simply keeps their initials until the next attempt. `onEarly` is told who already has a portrait (those of this
// page's cache and the ones remembered from earlier visits) while the people nobody remembers are still being looked up.
export async function loadNetworkPortraits(
  people: PortraitSubject[], fetcher: Fetcher = fetchWikipediaImagesByName, cache: Map<string, string | null> = portraitCache,
  onEarly?: (found: Map<string, string>) => void, itemFetcher: Fetcher = fetchPortraitsByQid,
): Promise<Map<string, string>> {
  const collect = (byName?: ReadonlyMap<string, string>, byItem?: ReadonlyMap<string, string>) => {
    const result = new Map<string, string>();
    for (const person of people) {
      const url = cache.get(cacheKey(person)) ?? (person.qid ? byItem?.get(person.qid) : byName?.get(person.name));
      if (url) result.set(person.id, url);
    }
    return result;
  };
  const missing = people.filter(person => !cache.has(cacheKey(person)));
  // What each route has remembered so far, so that an early answer of one shows the other's too.
  let earlyByName: ReadonlyMap<string, string> | undefined, earlyByItem: ReadonlyMap<string, string> | undefined;
  const ask = async (subjects: PortraitSubject[], via: 'name' | 'item') => {
    if (!subjects.length) return;
    try {
      const found = await (via === 'item' ? itemFetcher : fetcher)(subjects.map(person => via === 'item' ? person.qid! : person.name), !onEarly ? undefined : stored => {
        if (via === 'item') earlyByItem = stored; else earlyByName = stored;
        onEarly(collect(earlyByName, earlyByItem));
      });
      for (const person of subjects) {
        const key = via === 'item' ? person.qid! : person.name;
        if (!found.unanswered?.has(key)) cache.set(cacheKey(person), found.get(key) ?? null);
      }
    } catch (error) {
      console.warn('Could not load contact portraits', error);
    }
  };
  await Promise.all([ask(missing.filter(person => !person.qid), 'name'), ask(missing.filter(person => person.qid), 'item')]);
  return collect();
}

// Portraits for the people on screen: the AI-supported people by name, and the unverified ones whose item Wikidata has confirmed through that
// item. Callers pass only those (see `portraitSubjects`): a name shared with someone else could otherwise put the wrong face on an unverified
// suggestion. Everybody else keeps their initials.
export function useNetworkPortraits(people: PortraitSubject[]) {
  const [portraits, setPortraits] = useState(new Map<string, string>());
  const requestKey = JSON.stringify(people.map(person => [person.id, person.name, person.qid]));
  useEffect(() => {
    if (!people.length) return;
    let current = true;
    const show = (found: Map<string, string>) => {
      if (!current) return;
      setPortraits(previous => previous.size === found.size && [...found].every(([id, url]) => previous.get(id) === url) ? previous : found);
    };
    loadNetworkPortraits(people, undefined, undefined, show).then(show);
    return () => { current = false; };
  }, [requestKey]);
  return portraits;
}
