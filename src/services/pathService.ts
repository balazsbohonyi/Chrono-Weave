import type { ConnectionPathNode, ConnectionPathOptions, ConnectionPathProposal, HistoricalFigure, NewPerson } from '../types';
import { canonicalName } from '../utils/names';
import { buildConnectionPathPrompt, buildResolveFigurePrompt } from './prompts';
import { parseWeaveFigures, type JsonGenerator } from './weaveService';

// Provider-neutral half of the Six Degrees AI tasks, like weaveService for building canvases:
// prompt wiring, reference mapping, and the pure validators every provider shares.

const START_REF = 'A';
const END_REF = 'B';

export const isNewPerson = (node: ConnectionPathNode): node is NewPerson => !('id' in node);

const object = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
};

const isEventLike = (value: unknown): boolean => {
  const category = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).category : undefined;
  return typeof category === 'string' && category.trim().toUpperCase() === 'EVENTS';
};

// Applies the same people rules as discovery and canvas building; events are refused explicitly
// because the generic category error would not tell the model what to change.
export function parseNewPerson(value: unknown): NewPerson {
  const item = object(value, 'Each new person must be a JSON object with name, birthYear, deathYear, occupation, description, and category.');
  if (typeof item.category === 'string' && item.category.trim().toUpperCase() === 'EVENTS') {
    throw new Error('A chain contains people only; an event cannot be part of it.');
  }
  const [parsed] = parseWeaveFigures([item], -Infinity, Infinity, false, undefined, true);
  if (!parsed) throw new Error('A new person needs a defensible birth and death year.');
  return { name: parsed.name, birthYear: parsed.birthYear, deathYear: parsed.deathYear,
    occupation: parsed.occupation, category: parsed.category, description: parsed.shortDescription ?? '' };
}

// Two people can only have met when their lifespans overlap.
export const overlaps = (first: Pick<HistoricalFigure, 'birthYear' | 'deathYear'>, second: Pick<HistoricalFigure, 'birthYear' | 'deathYear'>) =>
  first.birthYear <= second.deathYear && second.birthYear <= first.deathYear;
// One key per unordered pair, for ids or canonical names alike.
export const pairKey = (first: string, second: string) => [first, second].sort().join('\u0000');

interface Entry { key: string; name: string; birthYear: number; deathYear: number; id?: string }

// Pure structural validation of a model proposal whose ids are already real canvas ids.
// `null` means the model found no confident chain, which is a result and not an error.
export function validateConnectionProposal(value: unknown, from: HistoricalFigure, to: HistoricalFigure,
  options: ConnectionPathOptions): ConnectionPathProposal | null {
  if (value === null || (Array.isArray(value) && !value.length)) return null;
  const data = object(value, 'Return {"nodes":[...],"links":[...]} or null.');
  if (data.nodes === null || (Array.isArray(data.nodes) && !data.nodes.length)) return null;
  if (!Array.isArray(data.nodes)) throw new Error('nodes must be an array that starts with {"id":"A"} and ends with {"id":"B"}.');
  const nodes = data.nodes as unknown[];
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (nodes.length < 2 || !first || (first as Record<string, unknown>).id !== from.id
      || !last || (last as Record<string, unknown>).id !== to.id) {
    throw new Error(`The path must start with ${from.name} (the first node is {"id":"A"}) and end with ${to.name} (the last node is {"id":"B"}).`);
  }
  const intermediates = nodes.length - 2;
  if (intermediates > options.maxIntermediates) {
    throw new Error(`The path has ${intermediates} people between ${from.name} and ${to.name}, but at most ${options.maxIntermediates} are allowed. Find a shorter chain or return null.`);
  }

  // Endpoints are looked up too, so a misplaced endpoint reads as a duplicate rather than an unknown id.
  const known = new Map<string, { name: string; birthYear: number; deathYear: number }>([
    ...options.catalog.map(entry => [entry.id, entry] as const), ...[from, to].map(person => [person.id, person] as const),
  ]);
  const entries: Entry[] = [];
  const parsedNodes = nodes.map((raw, index): ConnectionPathNode => {
    const node = object(raw, `Node ${index + 1} must be a JSON object.`);
    if (typeof node.id === 'string' && node.id) {
      const person = known.get(node.id);
      if (!person) {
        throw new Error(`Unknown id ${JSON.stringify(node.id)}. Use only {"id":"A"}, {"id":"B"}, or an id from the catalog; describe anyone else with their full details.`);
      }
      entries.push({ key: canonicalName(person.name), name: person.name, birthYear: person.birthYear, deathYear: person.deathYear, id: node.id });
      return { id: node.id };
    }
    const person = parseNewPerson(node);
    entries.push({ key: canonicalName(person.name), name: person.name, birthYear: person.birthYear, deathYear: person.deathYear });
    return person;
  });

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) throw new Error(`${entry.name} appears more than once. Every person may appear only once in the chain.`);
    seen.add(entry.key);
  }
  for (let index = 0; index < entries.length - 1; index++) {
    const a = entries[index], b = entries[index + 1];
    if (!overlaps(a, b)) {
      throw new Error(`${a.name} (${a.birthYear} to ${a.deathYear}) and ${b.name} (${b.birthYear} to ${b.deathYear}) did not live at the same time, so they cannot have met.`);
    }
  }

  const links = Array.isArray(data.links) ? data.links as unknown[] : [];
  return {
    nodes: parsedNodes,
    links: parsedNodes.slice(1).map((_, index) => {
      const claim = (links[index] as Record<string, unknown> | undefined)?.claim;
      return { claim: typeof claim === 'string' ? claim.trim() : '' };
    }),
  };
}

// The model sees short references, which are easier to copy exactly than canvas ids such as
// "w-p-leonardo%20da%20vinci-1452-1519". Everything after this function works with real ids.
function mapReferences(value: unknown, from: HistoricalFigure, to: HistoricalFigure, references: Map<string, string>): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).nodes)) return value;
  const data = value as Record<string, unknown>;
  return { ...data, nodes: (data.nodes as unknown[]).map(node => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof (node as Record<string, unknown>).id !== 'string') return node;
    const reference = ((node as Record<string, unknown>).id as string).trim();
    const id = reference.toUpperCase() === START_REF ? from.id : reference.toUpperCase() === END_REF ? to.id : references.get(reference);
    return { ...node, id: id ?? reference };
  }) };
}

export async function requestConnectionPath(generate: JsonGenerator, from: HistoricalFigure, to: HistoricalFigure,
  options: ConnectionPathOptions, signal?: AbortSignal): Promise<ConnectionPathProposal | null> {
  signal?.throwIfAborted();
  if (from.category === 'EVENTS' || to.category === 'EVENTS') throw new Error('Connections link people, not events.');
  const references = new Map(options.catalog.map((entry, index) => [`c${index + 1}`, entry.id]));
  const prompt = buildConnectionPathPrompt(from, to, {
    ...options, catalog: options.catalog.map((entry, index) => ({ ...entry, id: `c${index + 1}` })),
  });
  return generate(prompt, value => validateConnectionProposal(mapReferences(value, from, to, references), from, to, options), signal, 'path');
}

export async function requestResolveFigure(generate: JsonGenerator, name: string, signal?: AbortSignal): Promise<NewPerson | null> {
  signal?.throwIfAborted();
  const query = name.trim();
  if (!query || query.length > 200) return null;
  return generate(buildResolveFigurePrompt(query), value => {
    if (value === null || (Array.isArray(value) && !value.length)) return null;
    // An event is a final answer ("not a person"), not a mistake to correct: a retry would only
    // invite the model to substitute a related person.
    if (isEventLike(value)) return null;
    return parseNewPerson(value);
  }, signal, 'resolve');
}
