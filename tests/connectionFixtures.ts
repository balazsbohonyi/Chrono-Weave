import type { HistoricalFigure, IAIService } from '../src/types';
import { figurePerson } from '../src/services/connectionGraph';
import { pairKey } from '../src/services/pathService';
import { identifyPerson, type ContactPerson } from '../src/services/connectionGraph';
import { saveConnectionPath as savePath } from '../src/utils/connectionPaths';
export function saveTestConnectionPath(storage: Storage, chain: HistoricalFigure[], evidence: string[], createdAt = Date.now()) {
  const people: ContactPerson[] = [], ids = chain.map(p => identifyPerson(people, figurePerson(p)).id);
  const contacts = chain.slice(1).map((_, i) => ({ pair: [ids[i], ids[i + 1]] as [string, string], verdict: 'accepted' as const, interactionType: 'meeting' as const,
    evidence: evidence[i] ?? '', provenance: { provider: 'synthetic-test', model: 'synthetic-test', version: 2, assessedAt: createdAt } }));
  savePath(storage, chain, evidence, createdAt, contacts, people);
}
export const person = (name: string, birthYear = 1500, deathYear = 1600): HistoricalFigure => ({ id: name, name, birthYear, deathYear, occupation: 'Scholar', category: 'THINKERS' });
export const A = person('Alpha', 1500, 1560), B = person('Beta', 1700, 1760), M = person('Middle', 1550, 1640), N = person('Next', 1630, 1710);
export const proposal = (p: HistoricalFigure) => ({ ...figurePerson(p), aliases: [] });
export function fakeContacts(links: Array<[HistoricalFigure, HistoricalFigure]>, discover?: IAIService['discoverPersonalContacts']) {
  const supported = new Set(links.map(([a, b]) => pairKey(a.name, b.name)));
  const calls = { seeds: 0, discovery: [] as string[], assessments: [] as string[] };
  const service = {
    resolveFigure: async () => null,
    fetchConnectionPath: async () => { calls.seeds++; return null; },
    discoverPersonalContacts: discover ?? (async request => request.sources.flatMap(source => {
      calls.discovery.push(source.person.name);
      return links.flatMap(([a, b]) => {
        const other = source.person.name === a.name ? b : source.person.name === b.name ? a : undefined;
        return other && !source.previous.some(p => p.name === other.name) ? [{ sourceId: source.person.id, person: proposal(other), claim: 'They exchanged letters about their joint research.' }] : [];
      });
    })),
    assessPersonalContacts: async pairs => pairs.map(pair => {
      const key = pairKey(pair.first.name, pair.second.name); calls.assessments.push(key);
      return supported.has(key) ? { pair: [pair.first.id, pair.second.id], verdict: 'accepted', interactionType: 'correspondence', evidence: `${pair.first.name} and ${pair.second.name} exchanged letters about their joint research.` }
        : { pair: [pair.first.id, pair.second.id], verdict: 'unresolved', evidence: '', uncertainty: 'No specific interaction established.' };
    }),
  } as Pick<IAIService, 'fetchConnectionPath' | 'discoverPersonalContacts' | 'assessPersonalContacts' | 'resolveFigure'>;
  return { service, calls };
}
