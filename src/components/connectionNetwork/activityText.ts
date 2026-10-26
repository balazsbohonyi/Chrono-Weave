import type { SearchActivity } from '../../services/connectionGraph';

// "A, B and 2 others": the first names of a list, then how many more.
const listNames = (names: string[], shown = 2): string => {
  if (names.length <= shown + 1) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
};

// What the search is asking the model right now, in a sentence for the caption over the graph.
export function activityText(activity: SearchActivity, nameOf: (id: string) => string, now = Date.now()): string {
  if (activity.waitUntil) {
    const seconds = Math.max(1, Math.ceil((activity.waitUntil - now) / 1000));
    return `Rate limit reached · trying again in ${seconds} s`;
  }
  const people = activity.people.map(person => nameOf(person.id));
  switch (activity.kind) {
    case 'discover': return `Asking who ${listNames(people)} knew`;
    case 'identity': return `Checking who ${people[0] ?? 'this person'} is`;
    case 'seed': return `Asking for a likely route from ${people[0] ?? ''} to ${people[1] ?? ''}`;
    default: {
      const pairs = activity.pairs ?? [];
      if (pairs.length === 1) return `Checking whether ${nameOf(pairs[0][0])} and ${nameOf(pairs[0][1])} knew each other`;
      return `Checking ${pairs.length} pairs, such as ${nameOf(pairs[0]?.[0] ?? '')} and ${nameOf(pairs[0]?.[1] ?? '')}`;
    }
  }
}
