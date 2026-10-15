import type { HistoricalFigure, IAIService } from '../src/types';
import assert from 'node:assert/strict';
import { figurePerson } from '../src/services/connectionGraph';
import { pairKey } from '../src/services/pathService';
import { identifyPerson, type ConnectionDiagnostics, type ConnectionSession, type ContactAssessment, type ContactPerson } from '../src/services/connectionGraph';
import { saveConnectionPath as savePath } from '../src/utils/connectionPaths';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
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

// Two accepted clusters (Alpha-Middle and Next-Beta) already in the shared knowledge, joined only through "Bridge": a name that exists twice
// with conflicting dates, so no route may pass through it. `twinContacts` links the second record to Middle; without it the twin is a
// bare record that appears in no session, so only the shared store reveals the ambiguity. Clean Bridge is the person a discovery can
// still find between Middle and Next.
export const BRIDGE = person('Bridge', 1540, 1640), BRIDGE_TWIN = person('Bridge', 1545, 1645), CLEAN_BRIDGE = person('Clean Bridge', 1560, 1680);
export async function ambiguousBridgeRepository(twinContacts = false, twinFigure = BRIDGE_TWIN): Promise<MemoryConnectionRepository> {
  const repository = new MemoryConnectionRepository(), people: ContactPerson[] = [];
  const [a, b, m, n, bridge, twin] = [A, B, M, N, BRIDGE, twinFigure].map(p => identifyPerson(people, figurePerson(p)));
  const accepted = (first: ContactPerson, second: ContactPerson): ContactAssessment => ({ pair: [first.id, second.id], verdict: 'accepted', interactionType: 'correspondence',
    evidence: `${first.name} and ${second.name} exchanged letters about their joint research.`, provenance: { provider: 'fake', model: 'fake', version: 2, assessedAt: Date.now() } });
  const contacts = [accepted(a, m), accepted(m, bridge), accepted(bridge, n), accepted(n, b), ...(twinContacts ? [accepted(m, twin)] : [])];
  // A checkpoint whose session is not a session only stores the knowledge.
  await repository.checkpoint({ people, contacts }, {} as ConnectionSession);
  return repository;
}

// Request accounting that must hold for every snapshot and every finished segment of every search:
// the per-kind counters add up to the tasks issued, and the batches and reasons describe the same requests.
const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);
export function assertRequestAccounting(diagnostics: ConnectionDiagnostics) {
  const { requests, assessBatches, discoverSources, pairAsks, total } = diagnostics;
  assert.ok(requests && assessBatches && discoverSources && pairAsks && total, 'a current search records every counter');
  assert.equal(sum(Object.values(requests)), diagnostics.tasks, 'requests by kind add up to the tasks issued');
  assert.equal(assessBatches.length, (requests.direct ?? 0) + (requests.assess ?? 0), 'one batch size per assessment request');
  assert.equal(discoverSources.length, requests.discover ?? 0, 'one source count per discovery request');
  assert.equal(sum(Object.values(pairAsks)), sum(assessBatches), 'every pair in a batch has exactly one reason');
  assert.ok(sum(Object.values(total.requests)) >= diagnostics.tasks && total.segments >= 1, 'the session total includes this segment');
}
