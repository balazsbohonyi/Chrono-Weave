import {
  CONTACT_VERSION, validAccepted, validPerson, sessionKey, type ContactAssessment, type ContactKnowledge, type ContactPerson, type ConnectionSession,
} from '../services/connectionGraph';
import { pairKey } from '../services/pathService';

export const CONNECTION_DATABASE = 'chronoweave-six-degrees-v2';
const STORE = 'knowledge';
export const KNOWLEDGE_LIMITS = { people: 5000, contacts: 12000, sessions: 30, sessionPeople: 1024, sessionPairs: 4096, checkpointAgeMs: 30 * 24 * 60 * 60 * 1000 };
interface State { version: 2; knowledge: ContactKnowledge; sessions: ConnectionSession[] }
export interface ConnectionRepository {
  readonly persistent: boolean;
  loadKnowledge(): Promise<ContactKnowledge>;
  loadSession(key: string): Promise<ConnectionSession | null>;
  listSessions(canvasId: string): Promise<ConnectionSession[]>;
  checkpoint(knowledge: ContactKnowledge, session: ConnectionSession): Promise<boolean>;
}
const clone = <T>(value: T): T => structuredClone(value);
const empty = (): State => ({ version: 2, knowledge: { people: [], contacts: [] }, sessions: [] });
const contactKey = (contact: ContactAssessment) => `${pairKey(...contact.pair)}:${contact.verdict === 'accepted' ? 'accepted' : `${contact.provenance.provider}:${contact.provenance.model}`}`;

// Recovery whitelists data: unknown fields (especially settings/credentials) never enter records.
function person(raw: unknown): ContactPerson | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as ContactPerson;
  if (!validPerson(p) || typeof p.id !== 'string' || !p.id || typeof p.occupation !== 'string' || typeof p.description !== 'string'
    || !Array.isArray(p.aliases) || !p.aliases.every(alias => typeof alias === 'string')) return null;
  return { id: p.id, name: p.name, birthYear: p.birthYear, deathYear: p.deathYear, occupation: p.occupation,
    category: p.category, description: p.description, aliases: p.aliases.slice(0, 6),
    proposedAliases: Array.isArray(p.proposedAliases) ? p.proposedAliases.filter(a => typeof a === 'string').slice(0, 6) : [],
    ...(typeof p.canonicalId === 'string' ? { canonicalId: p.canonicalId } : {}) };
}
function assessment(raw: unknown, people: Map<string, ContactPerson>): ContactAssessment | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as ContactAssessment;
  if (!Array.isArray(c.pair) || c.pair.length !== 2 || !c.pair.every(id => typeof id === 'string' && people.has(id))
    || !['accepted', 'unresolved'].includes(c.verdict) || typeof c.evidence !== 'string'
    || !c.provenance || c.provenance.version !== CONTACT_VERSION || !Number.isFinite(c.provenance.assessedAt)
    || typeof c.provenance.provider !== 'string' || typeof c.provenance.model !== 'string'
    || (c.verdict === 'accepted' && !validAccepted(c, people)) || (c.verdict === 'unresolved' && typeof c.uncertainty !== 'string')) return null;
  return { pair: [...c.pair], verdict: c.verdict, evidence: c.evidence,
    ...(c.interactionType ? { interactionType: c.interactionType } : {}), ...(typeof c.episode === 'string' ? { episode: c.episode } : {}),
    ...(Number.isSafeInteger(c.year) ? { year: c.year } : {}), ...(typeof c.uncertainty === 'string' ? { uncertainty: c.uncertainty } : {}),
    provenance: { provider: c.provenance.provider, model: c.provenance.model, version: CONTACT_VERSION, assessedAt: c.provenance.assessedAt } };
}
export function recoverKnowledge(raw: unknown): ContactKnowledge {
  const k = raw as ContactKnowledge | null;
  const people = new Map((Array.isArray(k?.people) ? k.people : []).flatMap(raw => { const p = person(raw); return p ? [[p.id, p] as const] : []; }));
  const canonical = (id: string) => {
    const seen = new Set<string>();
    while (people.get(id)?.canonicalId && !seen.has(id)) { seen.add(id); id = people.get(id)!.canonicalId!; }
    return id;
  };
  const contacts = (Array.isArray(k?.contacts) ? k.contacts : []).flatMap(raw => {
    const data = raw && typeof raw === 'object' && Array.isArray(raw.pair) ? { ...raw, pair: raw.pair.map(canonical) } : raw;
    const c = assessment(data, people); return c ? [c] : [];
  });
  return { people: [...people.values()], contacts };
}
export function recoverSession(raw: unknown): ConnectionSession | null {
  try {
    const s = raw as ConnectionSession;
    if (!s || s.version !== 2 || typeof s.key !== 'string' || typeof s.canvasId !== 'string' || !Array.isArray(s.endpoints)
      || s.endpoints.length !== 2 || !Number.isSafeInteger(s.segment) || !Number.isFinite(s.updatedAt) || !Number.isFinite(s.elapsedMs)
      || !Array.isArray(s.candidates) || s.candidates.length > KNOWLEDGE_LIMITS.sessionPairs
      || !Array.isArray(s.people) || s.people.length > KNOWLEDGE_LIMITS.sessionPeople || !Array.isArray(s.rounds) || !s.attempts || !s.diagnostics) return null;
    const people = recoverKnowledge({ people: s.people, contacts: [] }).people;
    const byId = new Map(people.map(p => [p.id, p]));
    if (!s.endpoints.every(id => byId.has(id)) || s.endpoints[0] === s.endpoints[1]) return null;
    if (s.key !== sessionKey(s.canvasId, s.endpoints[0], s.endpoints[1])) return null;
    const candidates = s.candidates.filter(c => c && byId.has(c.from) && byId.has(c.to) && typeof c.claim === 'string')
      .map(c => ({ from: c.from, to: c.to, claim: c.claim,
        status: c.status === 'checking' ? (c.assessment && assessment(c.assessment, byId)?.verdict === 'unresolved' ? 'unresolved' as const : 'proposed' as const)
          : (c.status === 'accepted' && (!c.assessment || !assessment(c.assessment, byId) || c.assessment.verdict !== 'accepted')) ? 'proposed' as const : ['proposed', 'accepted', 'unresolved', 'blocked'].includes(c.status) ? c.status : 'proposed' as const,
        pendingFocused: c.pendingFocused === true,
        ...(c.assessment && assessment(c.assessment, byId) ? { assessment: assessment(c.assessment, byId)! } : {}),
        ...(typeof c.blockedReason === 'string' ? { blockedReason: c.blockedReason } : {}),
      }));
    return { version: 2, key: s.key, canvasId: s.canvasId, endpoints: [...s.endpoints], people, candidates,
      rounds: s.rounds.filter(r => byId.has(r.personId) && Number.isSafeInteger(r.round) && Array.isArray(r.proposed)).map(r => ({
        personId: r.personId, round: r.round, proposed: r.proposed.filter(id => typeof id === 'string'), emptyRounds: r.emptyRounds || 0, lastExpanded: r.lastExpanded || 0,
      })), attempts: Object.fromEntries(Object.entries(s.attempts).filter(([, a]) => a && typeof a.context === 'string' && Number.isSafeInteger(a.segment) && Number.isSafeInteger(a.count))
        .map(([key, a]) => [key, { context: a.context, segment: a.segment, count: a.count, focusedSegment: Number.isSafeInteger(a.focusedSegment) ? a.focusedSegment : undefined }])),
      segment: s.segment, seedContext: typeof s.seedContext === 'string' ? s.seedContext : undefined,
      status: s.status === 'connected' ? 'connected' : s.status === 'explored' ? 'explored' : s.status === 'error' ? 'error' : 'paused',
      phase: typeof s.phase === 'string' ? s.phase : 'Paused', error: typeof s.error === 'string' ? s.error : undefined,
      elapsedMs: s.elapsedMs, updatedAt: s.updatedAt, diagnostics: {
        tasks: Number.isSafeInteger(s.diagnostics.tasks) ? s.diagnostics.tasks : 0,
        people: Number.isSafeInteger(s.diagnostics.people) ? s.diagnostics.people : 0,
        pairs: Number.isSafeInteger(s.diagnostics.pairs) ? s.diagnostics.pairs : 0,
        stopReason: typeof s.diagnostics.stopReason === 'string' ? s.diagnostics.stopReason : undefined,
      }, persistent: s.persistent === true, runStartedAt: Number.isFinite(s.runStartedAt) ? s.runStartedAt : 0, retiredKeys: Array.isArray(s.retiredKeys) ? s.retiredKeys.filter(k => typeof k === 'string').slice(-10) : [],
    };
  } catch { return null; }
}

export class MemoryConnectionRepository implements ConnectionRepository {
  protected state = empty();
  get persistent() { return false; }
  async loadKnowledge() { return clone(this.state.knowledge); }
  async loadSession(key: string) { return clone(this.state.sessions.find(s => s.key === key) ?? null); }
  async listSessions(canvasId: string) { return clone(this.state.sessions.filter(s => s.canvasId === canvasId && s.status !== 'connected')); }
  protected merge(knowledge: ContactKnowledge, session: ConnectionSession) {
    const incoming = recoverKnowledge(knowledge);
    const people = new Map([...this.state.knowledge.people, ...incoming.people].map(p => [p.id, p]));
    const contacts = new Map(this.state.knowledge.contacts.map(c => [contactKey(c), c]));
    for (const c of incoming.contacts) if (!contacts.has(contactKey(c)) || contacts.get(contactKey(c))!.provenance.assessedAt <= c.provenance.assessedAt) contacts.set(contactKey(c), c);
    const keep = [...contacts.values()].sort((a, b) => b.provenance.assessedAt - a.provenance.assessedAt).slice(0, KNOWLEDGE_LIMITS.contacts);
    const important = new Set(keep.flatMap(c => c.pair));
    const retainedPeople = [...people.values()].sort((a, b) => Number(important.has(b.id)) - Number(important.has(a.id))).slice(0, KNOWLEDGE_LIMITS.people);
    const retainedIds = new Set(retainedPeople.map(p => p.id));
    this.state.knowledge = { people: retainedPeople, contacts: keep.filter(c => c.pair.every(id => retainedIds.has(id))) };
    const checkpoint = recoverSession(session);
    const newer = this.state.sessions.find(s => s.key === checkpoint?.key && (s.runStartedAt ?? 0) > (checkpoint?.runStartedAt ?? 0));
    if (checkpoint && !newer) this.state.sessions = [checkpoint, ...this.state.sessions.filter(s => s.key !== checkpoint.key && !checkpoint.retiredKeys?.includes(s.key))]
      .filter(s => s.updatedAt >= Date.now() - KNOWLEDGE_LIMITS.checkpointAgeMs).slice(0, KNOWLEDGE_LIMITS.sessions);
  }
  async checkpoint(knowledge: ContactKnowledge, session: ConnectionSession) { this.merge(knowledge, session); return this.persistent; }
}

export class IndexedConnectionRepository extends MemoryConnectionRepository {
  private db: IDBDatabase | null = null;
  private available = false;
  private ready: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  get persistent() { return this.available; }
  constructor(factory: IDBFactory | undefined = globalThis.indexedDB) {
    super();
    this.ready = new Promise(resolve => {
      if (!factory) { resolve(); return; }
      let settled = false;
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, 5000);
      try {
        const request = factory.open(CONNECTION_DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = finish;
        request.onblocked = finish;
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          this.db = request.result;
          this.db.onversionchange = () => { this.db?.close(); this.available = false; };
          const tx = this.db.transaction(STORE, 'readonly');
          const read = tx.objectStore(STORE).get('state');
          read.onsuccess = () => {
            if (settled) return;
            const raw = read.result;
            if (raw?.version === 2) this.state = { version: 2, knowledge: recoverKnowledge(raw.knowledge),
              sessions: (Array.isArray(raw.sessions) ? raw.sessions : []).flatMap((s: unknown) => { const session = recoverSession(s); return session ? [session] : []; }) };
          };
          tx.oncomplete = () => { if (!settled) this.available = true; finish(); };
          tx.onerror = finish;
          tx.onabort = finish;
        };
      } catch { finish(); }
    });
  }
  async loadKnowledge() { await this.ready; await this.writes; return super.loadKnowledge(); }
  async loadSession(key: string) { await this.ready; await this.writes; return super.loadSession(key); }
  async listSessions(canvasId: string) { await this.ready; await this.writes; return super.listSessions(canvasId); }
  async checkpoint(knowledge: ContactKnowledge, session: ConnectionSession): Promise<boolean> {
    await this.ready;
    const write = this.writes.then(async () => {
      if (!recoverSession(session)) return false;
      this.merge(knowledge, session);
      if (!this.available || !this.db) return false;
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction(STORE, 'readwrite');
          const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Checkpoint write timed out.')); }, 5000);
          tx.oncomplete = () => { clearTimeout(timer); resolve(); };
          tx.onerror = () => { clearTimeout(timer); reject(tx.error); };
          tx.onabort = () => { clearTimeout(timer); reject(tx.error); };
          try { tx.objectStore(STORE).put(clone(this.state), 'state'); }
          catch (error) { clearTimeout(timer); try { tx.abort(); } catch {} reject(error); }
        });
        return true;
      } catch { this.available = false; return false; }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
let repository: ConnectionRepository | undefined;
export const connectionRepository = () => repository ??= new IndexedConnectionRepository();
