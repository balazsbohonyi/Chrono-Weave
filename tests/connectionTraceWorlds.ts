import { findConnection, type ConnectionResult, type ConnectionSearchOptions } from '../src/services/connectionPath';
import { figurePerson } from '../src/services/connectionGraph';
import { MemoryConnectionRepository } from '../src/utils/connectionKnowledge';
import { fakeContacts, person, ambiguousBridgeRepository, A, B, M, N, BRIDGE, CLEAN_BRIDGE, proposal } from './connectionFixtures';

export type TraceService = ConnectionSearchOptions['service'];

// The model operations the engine asked for, in order, as "<kind> <batch size>": assess is the number of
// pairs, discover the number of sources, seed and identity are always one. Recorded at the service
// boundary, so it is independent of the engine's own counters.
export function recordService(service: TraceService, trace: string[]): TraceService {
  return {
    fetchConnectionPath: (...args) => { trace.push('seed 1'); return service.fetchConnectionPath(...args); },
    resolveFigure: (...args) => { trace.push('identity 1'); return service.resolveFigure(...args); },
    discoverPersonalContacts: (request, signal) => { trace.push(`discover ${request.sources.length}`); return service.discoverPersonalContacts(request, signal); },
    assessPersonalContacts: (pairs, signal) => { trace.push(`assess ${pairs.length}`); return service.assessPersonalContacts(pairs, signal); },
  };
}

export interface TraceWorld {
  name: string;
  // Runs every segment of the world through `wrap`ped services and returns each segment's result.
  run: (wrap: (service: TraceService) => TraceService) => Promise<ConnectionResult[]>;
}

const search = (overrides: Partial<ConnectionSearchOptions> & Pick<ConnectionSearchOptions, 'service'>): Promise<ConnectionResult> =>
  findConnection({ from: A, to: B, figures: [A, B], signal: new AbortController().signal, repository: new MemoryConnectionRepository(), canvasId: 'one', ...overrides });

const contemporary = person('Contemporary');
// People who overlap Alpha (1500-1560) and Beta (1700-1760), so a wide discovery produces a long queue of plausible pairs.
const early = Array.from({ length: 11 }, (_, i) => person(`Early ${i + 1}`, 1520, 1600));
const late = Array.from({ length: 11 }, (_, i) => person(`Late ${i + 1}`, 1690, 1770));

export const traceWorlds: TraceWorld[] = [
  { name: 'three-hop chain', run: async wrap => [await search({ service: wrap(fakeContacts([[A, M], [M, N], [N, B]]).service) })] },
  { name: 'direct contact between overlapping endpoints', run: async wrap =>
    [await search({ service: wrap(fakeContacts([[A, contemporary]]).service), to: contemporary, figures: [A, contemporary] })] },
  { name: 'unsupported direct contact exhausts the frontier', run: async wrap =>
    [await search({ service: wrap(fakeContacts([]).service), to: contemporary, figures: [A, contemporary] })] },
  { name: 'work budget pauses and a reversed explicit continuation finishes', run: async wrap => {
    const repository = new MemoryConnectionRepository(), service = wrap(fakeContacts([[A, M], [M, N], [N, B]]).service);
    const first = await search({ service, repository, limits: { tasks: 2 } });
    const saved = await repository.loadSession(first.session!.key);
    return [first, await search({ service, repository, session: saved!, from: B, to: A })];
  } },
  { name: 'seed route with a chronological detour', run: async wrap => {
    const detour = person('Detour', 1490, 1555), bridge = person('Bridge', 1540, 1640), fake = fakeContacts([[A, detour], [detour, bridge], [bridge, N], [N, B]]);
    fake.service.fetchConnectionPath = async () => ({ nodes: [{ id: A.id }, proposal(M), proposal(N), { id: B.id }], links: [{ claim: 'A claim' }, { claim: 'A claim' }, { claim: 'A claim' }] });
    return [await search({ service: wrap(fake.service) })];
  } },
  { name: 'cross-frontier alias needs two canonical resolutions', run: async wrap => {
    const oldName = person('Charles Contact', 1600, 1730), alias = person('Charles C. Contact', 1600, 1730), fake = fakeContacts([[A, M], [M, oldName], [alias, B]]);
    fake.service.resolveFigure = async name => name.includes('Charles') ? figurePerson(oldName) : null;
    return [await search({ service: wrap(fake.service) })];
  } },
  { name: 'wide discovery fills and overflows an assessment batch', run: async wrap => {
    const fake = fakeContacts([[A, M], [M, N], [N, B]], async request => request.sources.flatMap(source => {
      const pool = source.person.name === A.name ? [...early, M] : source.person.name === B.name ? [...late, N] : [];
      return pool.filter(p => !source.previous.some(q => q.name === p.name)).map(p => ({ sourceId: source.person.id, person: proposal(p), claim: 'They exchanged letters.' }));
    }));
    return [await search({ service: wrap(fake.service), limits: { candidates: 12 } })];
  } },
  { name: 'uncertain promising pairs get one focused reassessment, then resume', run: async wrap => {
    const repository = new MemoryConnectionRepository(), fake = fakeContacts([]);
    fake.service.assessPersonalContacts = async pairs => pairs.map(p => ({ pair: [p.first.id, p.second.id], verdict: 'unresolved', evidence: '', uncertainty: 'Conflicting account.' }));
    const service = wrap(fake.service), first = await search({ service, repository, to: contemporary, figures: [A, contemporary], limits: { tasks: 4 } });
    return [first, await search({ service, repository, to: contemporary, figures: [A, contemporary], session: first.session! })];
  } },
  { name: 'a changed model re-asks every earlier pair inside the direct check', run: async wrap => {
    const repository = new MemoryConnectionRepository(), fake = fakeContacts([], async request => request.sources.flatMap(source => source.person.name === A.name
      ? early.slice(0, 3).filter(p => !source.previous.some(q => q.name === p.name)).map(p => ({ sourceId: source.person.id, person: proposal(p), claim: 'They exchanged letters.' })) : []));
    const service = wrap(fake.service), options = { service, repository, to: contemporary, figures: [A, contemporary] };
    const first = await search({ ...options, provenance: { provider: 'test', model: 'first' }, limits: { tasks: 5 } });
    return [first, await search({ ...options, provenance: { provider: 'test', model: 'second' }, session: first.session! })];
  } },
  // The shared store already holds a chain whose middle person exists twice with conflicting dates, so it is not a route. Both ends
  // keep being expanded until a clean bridge turns up between Middle and Next (the twin is in no session, only in the store).
  // Before anything else is spent, one identity request asks which dates are right for the name on the accepted bridge. Here the answer
  // is inconclusive (the fake resolver knows nobody), so the records stay separate and the search expands on.
  { name: 'a chain through a person with conflicting date records is not a route, so both ends keep expanding until a clean bridge is found', run: async wrap =>
    [await search({ service: wrap(fakeContacts([[M, CLEAN_BRIDGE], [CLEAN_BRIDGE, N]]).service), repository: await ambiguousBridgeRepository() })] },
  { name: 'one identity request settles which dates are right for the name on the only accepted bridge, and that finishes the search', run: async wrap => {
    const fake = fakeContacts([]); fake.service.resolveFigure = async () => figurePerson(BRIDGE);
    return [await search({ service: wrap(fake.service), repository: await ambiguousBridgeRepository(true) })];
  } },
  { name: 'a chain only through conflicting date records ends explored once both ends are exhausted, and resuming repeats it without requests', run: async wrap => {
    const repository = await ambiguousBridgeRepository(true), service = wrap(fakeContacts([]).service), first = await search({ service, repository });
    return [first, await search({ service, repository, session: first.session! })];
  } },
];

export async function recordWorld(world: TraceWorld): Promise<{ trace: string[]; results: ConnectionResult[] }> {
  const trace: string[] = [];
  const results = await world.run(service => recordService(service, trace));
  return { trace, results };
}

export async function recordAllWorlds(worlds: TraceWorld[] = traceWorlds): Promise<Record<string, string[]>> {
  const traces: Record<string, string[]> = {};
  for (const world of worlds) traces[world.name] = (await recordWorld(world)).trace;
  return traces;
}
