import { useEffect, useState } from 'react';
import { fetchWikipediaImagesByName } from '../services/wikiService';

export interface PortraitSubject { id: string; name: string }
type Fetcher = (names: string[]) => Promise<Map<string, string>>;

// Shared person ID -> portrait URL, or null once Wikipedia has been asked and had nothing.
const portraitCache = new Map<string, string | null>();

// Looks up only the people not asked about yet. It never throws: a failed lookup is not remembered
// as a miss, so the person simply keeps their initials until the next attempt.
export async function loadNetworkPortraits(
  people: PortraitSubject[], fetcher: Fetcher = fetchWikipediaImagesByName, cache: Map<string, string | null> = portraitCache,
): Promise<Map<string, string>> {
  const missing = people.filter(person => !cache.has(person.id));
  if (missing.length) {
    try {
      const found = await fetcher(missing.map(person => person.name));
      for (const person of missing) cache.set(person.id, found.get(person.name) ?? null);
    } catch (error) {
      console.warn('Could not load contact portraits', error);
    }
  }
  const result = new Map<string, string>();
  for (const person of people) { const url = cache.get(person.id); if (url) result.set(person.id, url); }
  return result;
}

// Portraits for the AI-supported people on screen. Callers must pass accepted people only: a name
// shared with someone else could put the wrong face on an unverified suggestion.
export function useNetworkPortraits(people: PortraitSubject[]) {
  const [portraits, setPortraits] = useState(new Map<string, string>());
  const requestKey = JSON.stringify(people.map(person => [person.id, person.name]));
  useEffect(() => {
    if (!people.length) return;
    let current = true;
    loadNetworkPortraits(people).then(found => {
      if (!current) return;
      setPortraits(previous => previous.size === found.size && [...found].every(([id, url]) => previous.get(id) === url) ? previous : found);
    });
    return () => { current = false; };
  }, [requestKey]);
  return portraits;
}
