import type { ContactPerson } from '../../services/connectionGraph';
import { edgeId, type NetworkEdge, type NetworkView, type PersonContact } from '../../services/connectionNetworkView';

// The lists of the inspector can hold hundreds or thousands of rows, so each tab is one flat sequence of rows (the "unverified" groups are rows
// that fold their members in and out) and only the ones near the viewport are put in the document (VirtualList).
export type InspectorTab = 'people' | 'contacts';
export type ListRow =
  | { key: string; kind: 'person'; person: ContactPerson }
  | { key: string; kind: 'contact'; edge: NetworkEdge }
  | { key: string; kind: 'group'; id: string; label: string; count: number; open: boolean }
  | { key: string; kind: 'empty'; text: string };

// Every kind has a fixed height, which includes the 6px gap under the row; the text of a row is clamped to fit it (the full text is in the
// tooltip), see `.net-vlist` in connectionExplorer.css.
export const ROW_HEIGHT: Record<ListRow['kind'], number> = { person: 54, contact: 68, group: 44, empty: 52 };
export const rowKey = (row: ListRow) => row.key;
export const rowHeight = (row: ListRow) => ROW_HEIGHT[row.kind];
export const rowClass = (row: ListRow) => `net-vitem is-${row.kind}`;

export const UNVERIFIED_GROUPS = [['unresolved', 'Unresolved'], ['proposed', 'Proposed / checking'], ['blocked', 'Blocked']] as const;

// Accent- and case-insensitive: every word typed has to appear somewhere in the text.
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const matcher = (query: string) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return (...texts: string[]) => { const haystack = fold(texts.join(' ')); return words.every(word => haystack.includes(word)); };
};

interface Sources {
  list: NetworkView['list'];
  tab: InspectorTab;
  query: string;
  people: ReadonlyMap<string, ContactPerson>;
  // The ids of the groups that are unfolded.
  open: ReadonlySet<string>;
}

// The rows of one tab. A group's members are filtered for its count but only sorted and listed while it is open.
export function buildListRows({ list, tab, query, people, open }: Sources): ListRow[] {
  const rows: ListRow[] = [];
  const matches = matcher(query);
  const name = (id: string) => people.get(id)?.name ?? id;
  const label = (edge: NetworkEdge) => `${name(edge.from)} ↔ ${name(edge.to)}`;
  const emptyRow = (what: string) => rows.push({ key: 'empty', kind: 'empty', text: query.trim() ? `No ${what} match “${query.trim()}”.` : `No ${what} yet.` });
  const personRows = (members: ContactPerson[]) => { for (const person of members) rows.push({ key: `person:${person.id}`, kind: 'person', person }); };
  const contactRows = (edges: NetworkEdge[]) => {
    for (const [, edge] of edges.map(edge => [label(edge), edge] as const).sort(([x], [y]) => x.localeCompare(y))) rows.push({ key: `contact:${edge.id}`, kind: 'contact', edge });
  };
  const matching = (edges: NetworkEdge[]) => edges.filter(edge => matches(name(edge.from), name(edge.to)));
  // Pushes the header; whether the members follow is up to the caller.
  const group = (id: string, text: string, count: number) => { rows.push({ key: `group:${id}`, kind: 'group', id, label: text, count, open: open.has(id) }); return open.has(id); };

  if (tab === 'people') {
    const shown = list.people.filter(person => matches(person.name, ...person.aliases));
    if (shown.length) personRows(shown); else emptyRow('AI-supported people');
    const unverified = list.unverified.filter(person => matches(person.name));
    if (unverified.length && group('people-unverified', 'Unverified people', unverified.length)) personRows(unverified);
  } else {
    const shown = matching(list.contacts.accepted);
    if (shown.length) contactRows(shown); else emptyRow('AI-supported contacts');
    for (const [status, text] of UNVERIFIED_GROUPS) {
      const members = matching(list.contacts[status]);
      if (members.length && group(`contacts-${status}`, `${text} contacts`, members.length)) contactRows(members);
    }
  }
  return rows;
}

// ---- The detail view of a person: two tabs, their AI-supported contacts and the unverified ones around them. ----
export type DetailTab = 'accepted' | 'unverified';
export type DetailRow =
  | { key: string; kind: 'contact'; contact: PersonContact; unverified: boolean }
  | { key: string; kind: 'empty'; text: string };
// A contact there has the name and the kind of contact on one line and up to two lines of the stored text under them.
export const DETAIL_ROW_HEIGHT: Record<DetailRow['kind'], number> = { contact: 76, empty: ROW_HEIGHT.empty };
export const detailKey = (row: DetailRow) => row.key;
export const detailHeight = (row: DetailRow) => DETAIL_ROW_HEIGHT[row.kind];
export const detailClass = (row: DetailRow) => `net-vitem is-${row.kind}`;

// Only an AI-supported person has a tab of accepted contacts; anybody else shows the unverified ones alone.
export const detailTabFor = (tab: DetailTab, supported: boolean): DetailTab => supported ? tab : 'unverified';

export function buildDetailRows({ contacts, tab }: { contacts: { accepted: PersonContact[]; unverified: PersonContact[] }; tab: DetailTab }): DetailRow[] {
  const unverified = tab === 'unverified', members = unverified ? contacts.unverified : contacts.accepted;
  if (!members.length) return [{ key: 'empty', kind: 'empty', text: unverified ? 'No unverified contacts.' : 'No accepted contacts yet.' }];
  return members.map(contact => ({ key: `contact:${edgeId(contact.candidate)}`, kind: 'contact', contact, unverified }));
}
