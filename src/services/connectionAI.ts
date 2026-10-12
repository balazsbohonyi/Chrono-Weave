import type { RelationshipExplanation } from '../types';
import type { JsonGenerator } from './weaveService';
import { parseNewPerson } from './pathService';
import { blockedContact, CONTACT_VERSION, type ContactAssessment, type ContactPerson, type ContactProvenance, type InteractionType } from './connectionGraph';
import { buildContactAssessmentPrompt, buildContactDiscoveryPrompt, buildContactExplanationPrompt } from './prompts';

export interface ContactDiscoveryRequest {
  sources: Array<{ person: ContactPerson; round: number; previous: ContactPerson[] }>;
  target: ContactPerson; references: ContactPerson[]; limit: number;
}
export interface ContactProposal { sourceId: string; person: Omit<ContactPerson, 'id'>; claim: string }
export interface ContactPair { first: ContactPerson; second: ContactPerson; focused?: boolean }
export type ContactAssessmentResult = Omit<ContactAssessment, 'provenance'>;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a contact task JSON object.');
  return value as Record<string, unknown>;
};
const string = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}.`);
  return value.trim();
};
const interactionTypes: InteractionType[] = ['meeting', 'correspondence', 'collaboration', 'family-interaction', 'service', 'teaching', 'wartime-opposition', 'other'];

export function parseContactAssessments(value: unknown, pairs: ContactPair[]): ContactAssessmentResult[] {
  if (!Array.isArray(value) || value.length !== pairs.length) throw new Error('Return one independent assessment per requested pair.');
  const seen = new Set<number>();
  return value.map(raw => {
    const item = object(raw);
    const index = typeof item.ref === 'string' && /^p\d+$/.test(item.ref) ? Number(item.ref.slice(1)) - 1 : -1;
    const pair = pairs[index];
    if (!pair || seen.has(index)) throw new Error('Unknown or duplicate pair reference.');
    seen.add(index);
    if (item.verdict !== 'accepted' && item.verdict !== 'unresolved') throw new Error('Verdict must be accepted or unresolved.');
    const result: ContactAssessmentResult = { pair: [pair.first.id, pair.second.id], verdict: item.verdict, evidence: '' };
    if (result.verdict === 'unresolved') { result.uncertainty = string(item.uncertainty, 'uncertainty reason'); return result; }
    const blocked = blockedContact(pair.first, pair.second);
    if (blocked) throw new Error(blocked);
    if (!interactionTypes.includes(item.interactionType as InteractionType)) throw new Error('Accepted contacts need an interaction type.');
    result.interactionType = item.interactionType as InteractionType;
    result.evidence = string(item.evidence, 'concrete interaction evidence');
    if (result.interactionType === 'wartime-opposition') result.episode = string(item.episode, 'named battle or campaign involving these exact opponents');
    if (item.year !== undefined && item.year !== null) {
      if (!Number.isSafeInteger(item.year) || item.year === 0 || (item.year as number) < Math.max(pair.first.birthYear, pair.second.birthYear)
        || (item.year as number) > Math.min(pair.first.deathYear, pair.second.deathYear)) throw new Error('Interaction year contradicts supplied lifespans.');
      result.year = item.year as number;
    }
    return result;
  });
}

export function requestContactDiscovery(generate: JsonGenerator, request: ContactDiscoveryRequest, signal?: AbortSignal): Promise<ContactProposal[]> {
  const references = new Map(request.references.map((person, index) => [`r${index + 1}`, person]));
  return generate(buildContactDiscoveryPrompt(request), value => {
    if (!Array.isArray(value) || value.length > request.sources.length * request.limit) throw new Error('Contact discovery must return a bounded JSON array.');
    const counts = new Map<string, number>();
    return value.map(raw => {
      const item = object(raw);
      const index = typeof item.source === 'string' && /^s\d+$/.test(item.source) ? Number(item.source.slice(1)) - 1 : -1;
      const source = request.sources[index];
      if (!source) throw new Error('Unknown discovery source.');
      counts.set(source.person.id, (counts.get(source.person.id) ?? 0) + 1);
      if (counts.get(source.person.id)! > request.limit) throw new Error('Too many contacts for one source.');
      const ref = typeof item.reference === 'string' ? references.get(item.reference) : undefined;
      if (item.reference && !ref) throw new Error('Unknown person reference.');
      if (ref && item.person !== undefined) throw new Error('Use a reference or full person details, not both. Never alter a referenced identity.');
      const newData = ref ? { ...ref } : { ...parseNewPerson(item.person), aliases: [] as string[] };
      if (!ref && item.person && typeof item.person === 'object') {
        const aliases = object(item.person).aliases;
        if (aliases !== undefined && (!Array.isArray(aliases) || aliases.length > 6 || !aliases.every(alias => typeof alias === 'string' && alias.trim()))) throw new Error('Invalid explicit aliases.');
        newData.aliases = (aliases as string[] | undefined) ?? [];
      }
      return { sourceId: source.person.id, person: newData, claim: string(item.claim, 'proposed interaction') };
    });
  }, signal, 'contacts-discover');
}
export const requestContactAssessment = (generate: JsonGenerator, pairs: ContactPair[], signal?: AbortSignal) =>
  generate(buildContactAssessmentPrompt(pairs), value => parseContactAssessments(value, pairs), signal, 'contacts-assess');

export async function requestContactExplanation(generate: JsonGenerator, first: ContactPerson, second: ContactPerson,
  contact: ContactAssessment, signal?: AbortSignal): Promise<RelationshipExplanation> {
  return generate(buildContactExplanationPrompt(first, second, contact), value => {
    const item = object(value);
    if (item.supported !== true) throw new Error('Cannot reliably expand this accepted record.');
    if (!Array.isArray(item.sections) || !item.sections.length) throw new Error('Expected narrative sections.');
    return { isRelevant: true, evidence: contact.evidence, summary: string(item.summary, 'summary'), sections: item.sections.map(raw => {
      const section = object(raw); return { title: string(section.title, 'title'), content: string(section.content, 'content') };
    }) };
  }, signal, 'contacts-explain');
}
export function withProvenance(result: ContactAssessmentResult, provenance: Pick<ContactProvenance, 'provider' | 'model'>): ContactAssessment {
  return { ...result, provenance: { ...provenance, version: CONTACT_VERSION, assessedAt: Date.now() } };
}
