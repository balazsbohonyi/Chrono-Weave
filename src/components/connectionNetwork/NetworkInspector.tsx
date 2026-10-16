import React, { useEffect, useMemo, useState } from 'react';
import type { CandidateContact, ConnectionSession, ContactPerson } from '../../services/connectionGraph';
import {
  closestApproachLabel, describeSide, edgeId, personContacts, STATUS_LABELS, years, type NetworkEdge, type NetworkNode, type NetworkSelection, type NetworkView,
} from '../../services/connectionNetworkView';
import NetworkPortrait from './NetworkPortrait';
import MarkdownContent from '../MarkdownContent';
import { stripMarkdown } from '../../utils/plainText';

interface Props {
  session: ConnectionSession | null;
  view: NetworkView | null;
  selection: NetworkSelection;
  portraits: Map<string, string>;
  pinned: ReadonlySet<string>;
  narrow: boolean;
  // Narrow screens show this as a bottom sheet that is only there when asked for or something is selected.
  open: boolean;
  onSelect: (selection: NetworkSelection) => void;
  onUnpin: (id: string) => void;
  onDismiss: () => void;
  // From a person or contact back to the lists; on narrow screens the sheet stays open.
  onBackToList: () => void;
  // The search text lives in the shell so that Escape can clear it before it closes the overlay.
  query: string;
  onQueryChange: (query: string) => void;
}

type Tab = 'people' | 'contacts';
const UNVERIFIED_GROUPS = [['unresolved', 'Unresolved'], ['proposed', 'Proposed / checking'], ['blocked', 'Blocked']] as const;

// A clamped excerpt: Markdown in the stored text would only show as stray symbols, so it is stripped before cutting.
const excerpt = (text: string, max = 96) => {
  const plain = stripMarkdown(text);
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
};
const interaction = (contact: CandidateContact) => contact.assessment?.interactionType?.replace(/-/g, ' ') ?? '';
const detailOf = (contact: CandidateContact) => contact.assessment?.evidence || contact.assessment?.uncertainty || contact.blockedReason || contact.claim || 'Awaiting assessment';
// Accent- and case-insensitive: every word typed has to appear somewhere in the text.
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const matcher = (query: string) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return (...texts: string[]) => { const haystack = fold(texts.join(' ')); return words.every(word => haystack.includes(word)); };
};

const NetworkInspector: React.FC<Props> = ({ session, view, selection, portraits, pinned, narrow, open, onSelect, onUnpin, onDismiss, onBackToList, query, onQueryChange }) => {
  const [tab, setTab] = useState<Tab>('people');
  // A different exploration starts on the first tab.
  const resetKey = session?.key ?? '';
  useEffect(() => { setTab('people'); }, [resetKey]);

  const people = useMemo(() => new Map((session?.people ?? []).map(person => [person.id, person])), [session?.people]);
  const name = (id: string) => people.get(id)?.name ?? id;
  const endpointNames: [string, string] = [name(session?.endpoints[0] ?? ''), name(session?.endpoints[1] ?? '')];
  const supportedIds = useMemo(() => new Set([...(view?.list.endpoints ?? []), ...(view?.list.people ?? [])].map(person => person.id)), [view]);
  const supported = (id: string) => supportedIds.has(id) || (session?.endpoints.includes(id) ?? false);
  const portrait = (person: ContactPerson, size: number) => <NetworkPortrait person={person} size={size} url={portraits.get(person.id)} tentative={!supported(person.id)} />;

  const selectedPerson = selection.person ? people.get(selection.person) : undefined;
  const selectedEdge = selection.edge ? session?.candidates.find(c => edgeId(c) === selection.edge) : undefined;
  const hasSelection = !!selectedPerson || !!selectedEdge;

  const renderPerson = (target: ContactPerson) => {
    const node: NetworkNode | undefined = view?.nodes.find(item => item.id === target.id);
    const isSupported = supported(target.id);
    const { accepted, unverified } = personContacts(session!, target.id);
    const side = node ? describeSide(node, endpointNames) : isSupported ? 'AI-supported' : 'Tentative';
    // The identity stays put; only the contacts below it scroll.
    return <>
      <div className="net-detail-fixed">
        <div className="net-person-head">{portrait(target, 72)}<div><h4>{target.name}</h4>
          {isSupported ? <p>{years(target)} · {target.occupation}</p> : <p>Tentative person · identity details are not yet checked.</p>}</div></div>
        <p className="net-side-line">{side}</p>
        {target.aliases.length > 0 && isSupported && <p>Explicit aliases: {target.aliases.join(', ')}</p>}
        {pinned.has(target.id) && <p><button type="button" onClick={() => onUnpin(target.id)}>Unpin</button></p>}
        {isSupported && <h5>AI-supported contacts ({accepted.length})</h5>}
      </div>
      <div className="net-detail-scroll no-scrollbar">
        {isSupported && <section aria-label="AI-supported contacts">
          {accepted.length === 0 ? <p>No accepted contacts yet.</p> : <ul className="net-contact-rows">{accepted.map(({ other, candidate }) =>
            <li key={edgeId(candidate)}><button type="button" onClick={() => onSelect({ edge: edgeId(candidate) })}>
              {portrait(other, 34)}<span><strong>{other.name}</strong>{interaction(candidate) && <em> · {interaction(candidate)}</em>}<small>{excerpt(candidate.assessment?.evidence ?? '')}</small></span>
            </button></li>)}</ul>}
        </section>}
        {unverified.length > 0 && <details className="net-unverified"><summary>Unverified around this person ({unverified.length})</summary>
          <ul className="net-contact-rows">{unverified.map(({ other, candidate }) => <li key={edgeId(candidate)}><button type="button" onClick={() => onSelect({ edge: edgeId(candidate) })}>
            <span><strong>{other.name}</strong><em> · {STATUS_LABELS[candidate.status]}</em><small>{excerpt(detailOf(candidate))}</small></span>
          </button></li>)}</ul></details>}
      </div>
    </>;
  };

  const renderEdge = (contact: CandidateContact) => {
    const a = people.get(contact.from), b = people.get(contact.to);
    const assessment = contact.assessment;
    return <>
      <div className="net-detail-fixed">
        <div className="net-edge-head">{a && portrait(a, 56)}<span aria-hidden="true">↔</span>{b && portrait(b, 56)}</div>
        <h4>{name(contact.from)} ↔ {name(contact.to)}</h4>
        <p className={`connection-inspection-verdict is-${contact.status}`}>{STATUS_LABELS[contact.status]}{interaction(contact) && ` · ${interaction(contact)}`}{assessment?.year !== undefined && ` · ${assessment.year}`}</p>
      </div>
      <div className="net-detail-scroll no-scrollbar">
        <MarkdownContent>{(contact.status === 'accepted'
          ? assessment?.evidence
          : contact.status === 'blocked' ? contact.blockedReason : assessment?.uncertainty || `Unverified proposal: ${contact.claim || 'awaiting assessment'}`) ?? ''}</MarkdownContent>
        {assessment?.episode && <p>Episode: {assessment.episode}</p>}
        {assessment && <small>AI assessment · {assessment.provenance.provider} / {assessment.provenance.model} · {new Date(assessment.provenance.assessedAt).toLocaleDateString()}</small>}
      </div>
    </>;
  };

  // ---- The lists: pinned endpoints, then People / Contacts tabs with a search each. ----
  const list = view?.list;
  const matches = useMemo(() => matcher(query), [query]);
  const searching = query.trim().length > 0;
  const contactLabel = (edge: NetworkEdge) => `${name(edge.from)} ↔ ${name(edge.to)}`;
  const shownPeople = useMemo(() => (list?.people ?? []).filter(person => matches(person.name, ...person.aliases)), [list, matches]);
  const shownUnverifiedPeople = useMemo(() => (list?.unverified ?? []).filter(person => matches(person.name)), [list, matches]);
  const byLabel = (edges: NetworkEdge[]) => [...edges].sort((x, y) => contactLabel(x).localeCompare(contactLabel(y)));
  const shownContacts = useMemo(() => byLabel((list?.contacts.accepted ?? []).filter(edge => matches(name(edge.from), name(edge.to)))), [list, matches, people]);
  const shownUnverifiedContacts = (status: 'unresolved' | 'proposed' | 'blocked') =>
    byLabel((list?.contacts[status] ?? []).filter(edge => matches(name(edge.from), name(edge.to))));

  const personRow = (person: ContactPerson) => <li key={person.id}><button type="button" className="net-row" onClick={() => onSelect({ person: person.id })}>
    {portrait(person, 36)}<span><strong>{person.name}</strong><small>{supported(person.id) ? `${years(person)} · ${person.occupation}` : 'Tentative person'}</small></span>
  </button></li>;
  const contactRow = (edge: NetworkEdge) => {
    const a = people.get(edge.from), b = people.get(edge.to);
    const detail = edge.status === 'accepted' ? interaction(edge.candidate) : STATUS_LABELS[edge.status];
    return <li key={edge.id}><button type="button" className="net-row is-contact" onClick={() => onSelect({ edge: edge.id })}>
      <span className="net-pair">{a && portrait(a, 30)}{b && portrait(b, 30)}</span>
      <span><strong>{contactLabel(edge)}</strong>{detail && <small>{detail}</small>}</span>
    </button></li>;
  };
  const empty = (what: string) => <p className="net-list-empty">{searching ? `No ${what} match “${query.trim()}”.` : `No ${what} yet.`}</p>;

  // The summary counts the endpoints among the AI-supported people, so the badge does too.
  const peopleCount = (list?.people.length ?? 0) + (list?.endpoints.length ?? 0), contactCount = list?.contacts.accepted.length ?? 0;
  const tabButton = (id: Tab, label: string, aria: string, count: number) =>
    <button type="button" role="tab" id={`net-tab-${id}`} aria-selected={tab === id} aria-controls="net-tabpanel" aria-label={`${aria}, ${count}`} className={`net-tab ${tab === id ? 'is-selected' : ''}`} onClick={() => setTab(id)}>
      {label}<span className="net-tab-badge">{count}</span>
    </button>;

  const summary = view && session && <>
    <p className="net-summary"><strong>{view.counts.people}</strong> AI-supported {view.counts.people === 1 ? 'person' : 'people'} · <strong>{view.counts.contacts}</strong> {view.counts.contacts === 1 ? 'contact' : 'contacts'}</p>
    {view.chain ? <p>A chain of accepted contacts connects both ends.</p> : view.closest && <p className="net-closest">{closestApproachLabel(view.closest, name)}</p>}
  </>;
  const hint = <p className="net-hint-line">Select a person or contact to read the stored evidence. Inspection does not make additional AI requests.</p>;

  return <aside className={`connection-explorer-inspection ${narrow ? 'is-sheet' : ''} ${narrow && open ? 'is-open' : ''}`} aria-label="Network inspection" hidden={narrow && !open}>
    {narrow && <button type="button" className="net-sheet-close" onClick={onDismiss} aria-label="Close inspection">×</button>}
    <div className="net-inspect-head">
      <h3>Inspect the exploration</h3>
      {hasSelection && <button type="button" className="net-back" onClick={onBackToList}>← Back to list</button>}
    </div>
    {hasSelection && <div className="net-detail">{selectedPerson && session ? renderPerson(selectedPerson) : selectedEdge ? renderEdge(selectedEdge) : null}</div>}
    <div className="net-browser" hidden={hasSelection}>
      {summary}
      {hint}
      {list && <>
        <section className="net-endpoints" aria-label="Endpoints"><h5>Endpoints</h5>
          <ul className="net-contact-rows">{list.endpoints.map((person, index) => <li key={person.id}><button type="button" className="net-row" onClick={() => onSelect({ person: person.id })}>
            {portrait(person, 40)}<span><strong>{person.name}</strong><small>{years(person)} · {person.occupation}</small></span><b className={`net-end-badge is-${index === 0 ? 'a' : 'b'}`}>{index === 0 ? 'A' : 'B'}</b>
          </button></li>)}</ul>
        </section>
        <div className="net-tablist" role="tablist" aria-label="AI-supported people and contacts">
          {tabButton('people', 'People', 'AI-supported people', peopleCount)}
          {tabButton('contacts', 'Contacts', 'AI-supported contacts', contactCount)}
        </div>
        <input type="search" className="net-search" value={query} onChange={event => onQueryChange(event.target.value)} autoComplete="off" spellCheck={false}
          placeholder={tab === 'people' ? 'Search AI-supported people' : 'Search AI-supported contacts'}
          aria-label={tab === 'people' ? 'Search AI-supported people' : 'Search AI-supported contacts'} />
        <div id="net-tabpanel" role="tabpanel" aria-labelledby={`net-tab-${tab}`} className="net-list no-scrollbar">
          {tab === 'people' ? <>
            {shownPeople.length ? <ul className="net-contact-rows">{shownPeople.map(personRow)}</ul> : empty('AI-supported people')}
            {shownUnverifiedPeople.length > 0 && <details className="net-unverified"><summary>Unverified people ({shownUnverifiedPeople.length})</summary>
              <ul className="net-contact-rows">{shownUnverifiedPeople.map(personRow)}</ul></details>}
          </> : <>
            {shownContacts.length ? <ul className="net-contact-rows">{shownContacts.map(contactRow)}</ul> : empty('AI-supported contacts')}
            {UNVERIFIED_GROUPS.map(([status, label]) => {
              const items = shownUnverifiedContacts(status);
              return items.length > 0 && <details key={status} className="net-unverified"><summary>{label} contacts ({items.length})</summary>
                <ul className="net-contact-rows">{items.map(contactRow)}</ul></details>;
            })}
          </>}
        </div>
      </>}
    </div>
    {session && !session.persistent && <p className="connection-explorer-storage">This exploration is available in this session. Saving across reloads is unavailable.</p>}
  </aside>;
};
export default NetworkInspector;
