import { useEffect, useState } from 'react';
import { fetchWikipediaImagesByName } from '../services/wikiService';

export interface PortraitSubject { id: string; name: string }
// `onStored` is given the pictures that were already remembered (by name) while the rest are still being asked for.
type Fetcher = (names: string[], onStored?: (found: Map<string, string>) => void) => Promise<Map<string, string>>;

// Shared person ID -> portrait URL, or null once Wikipedia has been asked and had nothing.
const portraitCache = new Map<string, string | null>();

// Looks up only the people not asked about yet. It never throws: a failed lookup is not remembered
// as a miss, so the person simply keeps their initials until the next attempt. `onEarly` is told who already has a portrait (those of this
// page's cache and the ones remembered from earlier visits) while the people nobody remembers are still being looked up.
export async function loadNetworkPortraits(
  people: PortraitSubject[], fetcher: Fetcher = fetchWikipediaImagesByName, cache: Map<string, string | null> = portraitCache,
  onEarly?: (found: Map<string, string>) => void,
): Promise<Map<string, string>> {
  const collect = (extra?: ReadonlyMap<string, string>) => {
    const result = new Map<string, string>();
    for (const person of people) { const url = cache.get(person.id) ?? extra?.get(person.name); if (url) result.set(person.id, url); }
    return result;
  };
  const missing = people.filter(person => !cache.has(person.id));
  if (missing.length) {
    try {
      const found = await fetcher(missing.map(person => person.name), !onEarly ? undefined : stored => onEarly(collect(stored)));
      for (const person of missing) cache.set(person.id, found.get(person.name) ?? null);
    } catch (error) {
      console.warn('Could not load contact portraits', error);
    }
  }
  return collect();
}

// Portraits for the AI-supported people on screen. Callers must pass accepted people only: a name
// shared with someone else could put the wrong face on an unverified suggestion.
export function useNetworkPortraits(people: PortraitSubject[]) {
  const [portraits, setPortraits] = useState(new Map<string, string>());
  const requestKey = JSON.stringify(people.map(person => [person.id, person.name]));
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
