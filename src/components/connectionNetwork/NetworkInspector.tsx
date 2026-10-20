import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateContact, ConnectionSession, ContactPerson } from '../../services/connectionGraph';
import {
  closestApproachLabel, describeSide, edgeId, personContacts, STATUS_LABELS, years, type NetworkEdge, type NetworkNode, type NetworkSelection, type NetworkView,
} from '../../services/connectionNetworkView';
import NetworkPortrait from './NetworkPortrait';
import VirtualList from './VirtualList';
import { buildDetailRows, buildListRows, detailClass, detailHeight, detailKey, detailTabFor, rowClass, rowHeight, rowKey, type DetailRow, type DetailTab, type InspectorTab, type ListRow } from './inspectorRows';
import { backLabel, type DetailMemory, type Step } from './selectionHistory';
import Tooltip from '../Tooltip';
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
  // `detail` is what the reader had done in a person's lists when they opened a contact from there (see selectionHistory).
  onSelect: (selection: NetworkSelection, detail?: DetailMemory) => void;
  onUnpin: (id: string) => void;
  onDismiss: () => void;
  // One step back: to the person a contact was opened from, otherwise to the main lists (on narrow screens the sheet stays open).
  onBack: () => void;
  history: readonly Step[];
  // Set when Back returned to a person: their lists come back as they were left.
  restored: { n: number; person?: string; detail?: DetailMemory } | null;
  // The search text lives in the shell so that Escape can clear it before it closes the overlay.
  query: string;
  onQueryChange: (query: string) => void;
}

// A clamped excerpt: Markdown in the stored text would only show as stray symbols, so it is stripped before cutting.
const excerpt = (text: string, max = 96) => {
  const plain = stripMarkdown(text);
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
};
const interaction = (contact: CandidateContact) => contact.assessment?.interactionType?.replace(/-/g, ' ') ?? '';
const detailOf = (contact: CandidateContact) => contact.assessment?.evidence || contact.assessment?.uncertainty || contact.blockedReason || contact.claim || 'Awaiting assessment';

const NetworkInspector: React.FC<Props> = ({ session, view, selection, portraits, pinned, narrow, open, onSelect, onUnpin, onDismiss, onBack, history, restored, query, onQueryChange }) => {
  const [tab, setTab] = useState<InspectorTab>('people');
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  // A different exploration starts on the first tab with every group folded.
  const resetKey = session?.key ?? '';
  useEffect(() => { setTab('people'); setOpenGroups(new Set()); }, [resetKey]);
  const toggleGroup = (id: string) => setOpenGroups(open => { const next = new Set(open); if (!next.delete(id)) next.add(id); return next; });

  const people = useMemo(() => new Map((session?.people ?? []).map(person => [person.id, person])), [session?.people]);
  const name = (id: string) => people.get(id)?.name ?? id;
  const endpointNames: [string, string] = [name(session?.endpoints[0] ?? ''), name(session?.endpoints[1] ?? '')];
  const supportedIds = useMemo(() => new Set([...(view?.list.endpoints ?? []), ...(view?.list.people ?? [])].map(person => person.id)), [view]);
  const supported = (id: string) => supportedIds.has(id) || (session?.endpoints.includes(id) ?? false);
  const portrait = (person: ContactPerson, size: number) => <NetworkPortrait person={person} size={size} url={portraits.get(person.id)} tentative={!supported(person.id)} />;

  const selectedPerson = selection.person ? people.get(selection.person) : undefined;
  const selectedEdge = selection.edge ? session?.candidates.find(c => edgeId(c) === selection.edge) : undefined;
  const hasSelection = !!selectedPerson || !!selectedEdge;
  const personLinks = useMemo(() => selectedPerson && session ? personContacts(session, selectedPerson.id) : null, [session, selectedPerson]);
  const selectedId = selectedPerson?.id;
  // A person starts on their AI-supported contacts, unless Back just returned to them: then on the list they were on. Worked out while
  // rendering (not in an effect) so that the list below never shows the wrong tab, even for a frame, and is not reset afterwards.
  const restoredHere = restored && restored.person === selectedId ? restored : null;
  const detailIdentity = `${selectedId ?? ''}|${restoredHere?.n ?? 0}`;
  // Which list of a person's contacts is shown.
  const [detailTab, setDetailTab] = useState<DetailTab>(restoredHere?.detail?.tab ?? 'accepted');
  const [seenDetail, setSeenDetail] = useState(detailIdentity);
  if (seenDetail !== detailIdentity) { setSeenDetail(detailIdentity); setDetailTab(restoredHere?.detail?.tab ?? 'accepted'); }
  const detailScroller = useRef<HTMLDivElement | null>(null);
  const shownDetailTab = detailTabFor(detailTab, selectedId !== undefined && supported(selectedId));
  const detailRows = useMemo(() => personLinks ? buildDetailRows({ contacts: personLinks, tab: shownDetailTab }) : [], [personLinks, shownDetailTab]);

  const groupButton = (row: { id: string; label: string; count: number; open: boolean }) =>
    <button type="button" className="net-group" aria-expanded={row.open} onClick={() => toggleGroup(row.id)}>{row.label} ({row.count})</button>;
  const renderDetailRow = (row: DetailRow) => {
    if (row.kind === 'empty') return <p className="net-list-empty">{row.text}</p>;
    const { other, candidate } = row.contact;
    const kind = row.unverified ? STATUS_LABELS[candidate.status] : interaction(candidate);
    const text = excerpt(row.unverified ? detailOf(candidate) : candidate.assessment?.evidence ?? '');
    return <button type="button" className="net-detail-contact" title={`${other.name}${kind ? ` · ${kind}` : ''}${text ? ` — ${text}` : ''}`} onClick={() => onSelect({ edge: edgeId(candidate) }, { tab: shownDetailTab, top: detailScroller.current?.scrollTop ?? 0 })}>
      {portrait(other, 34)}<span><span className="net-detail-line"><strong>{other.name}</strong>{kind && <em> · {kind}</em>}</span><small>{text}</small></span>
    </button>;
  };

  const detailTabButton = (id: DetailTab, label: string, count: number) =>
    <button type="button" role="tab" id={`net-detail-tab-${id}`} aria-selected={shownDetailTab === id} aria-controls="net-detail-tabpanel" aria-label={`${label} contacts, ${count}`}
      className={`net-tab ${shownDetailTab === id ? 'is-selected' : ''}`} onClick={() => setDetailTab(id)}>{label}<span className="net-tab-badge">{count}</span></button>;

  const renderPerson = (target: ContactPerson) => {
    const node: NetworkNode | undefined = view?.nodes.find(item => item.id === target.id);
    const isSupported = supported(target.id);
    const side = node ? describeSide(node, endpointNames) : isSupported ? 'AI-supported' : 'Tentative';
    // The identity stays put; only the contacts below it scroll.
    return <>
      <div className="net-detail-fixed">
        <div className="net-person-head">{portrait(target, 48)}<div><h4>{target.name}</h4>
          {isSupported ? <p>{years(target)} · {target.occupation}</p> : <p>Tentative person · identity details are not yet checked.</p>}</div></div>
        <p className="net-side-line">{side}</p>
        {target.aliases.length > 0 && isSupported && <p className="net-aliases" title={target.aliases.join(', ')}>Explicit aliases: {target.aliases.join(', ')}</p>}
        {pinned.has(target.id) && <p><button type="button" onClick={() => onUnpin(target.id)}>Unpin</button></p>}
        {personLinks && <div className="net-tablist" role="tablist" aria-label="Contacts of this person">
          {isSupported && detailTabButton('accepted', 'AI-supported', personLinks.accepted.length)}
          {detailTabButton('unverified', 'Unverified', personLinks.unverified.length)}
        </div>}
      </div>
      <VirtualList id="net-detail-tabpanel" role="tabpanel" aria-labelledby={`net-detail-tab-${shownDetailTab}`} className="net-detail-scroll no-scrollbar" listClassName="net-contact-rows net-vlist"
        items={detailRows} itemKey={detailKey} itemHeight={detailHeight} itemClassName={detailClass} renderItem={renderDetailRow} resetKey={`${resetKey}|${target.id}|${shownDetailTab}`}
        scrollerRef={detailScroller} initialScrollTop={restoredHere?.detail?.top} />
    </>;
  };

  const renderEdge = (contact: CandidateContact) => {
    const a = people.get(contact.from), b = people.get(contact.to);
    const assessment = contact.assessment;
    return <>
      <div className="net-detail-fixed">
        <div className="net-edge-head">{a && portrait(a, 44)}<span aria-hidden="true">↔</span>{b && portrait(b, 44)}</div>
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
  const contactLabel = (edge: NetworkEdge) => `${name(edge.from)} ↔ ${name(edge.to)}`;
  const rows = useMemo(() => list ? buildListRows({ list, tab, query, people, open: openGroups }) : [], [list, tab, query, people, openGroups]);

  const personRow = (person: ContactPerson) => {
    const detail = supported(person.id) ? `${years(person)} · ${person.occupation}` : 'Tentative person';
    return <button type="button" className="net-row" title={`${person.name} · ${detail}`} onClick={() => onSelect({ person: person.id })}>
      {portrait(person, 36)}<span><strong>{person.name}</strong><small>{detail}</small></span>
    </button>;
  };
  const contactRow = (edge: NetworkEdge) => {
    const a = people.get(edge.from), b = people.get(edge.to);
    const detail = edge.status === 'accepted' ? interaction(edge.candidate) : STATUS_LABELS[edge.status];
    return <button type="button" className="net-row is-contact" title={detail ? `${contactLabel(edge)} · ${detail}` : contactLabel(edge)} onClick={() => onSelect({ edge: edge.id })}>
      <span className="net-pair">{a && portrait(a, 30)}{b && portrait(b, 30)}</span>
      <span><strong>{contactLabel(edge)}</strong>{detail && <small>{detail}</small>}</span>
    </button>;
  };
  const renderRow = (row: ListRow) => {
    switch (row.kind) {
      case 'person': return personRow(row.person);
      case 'contact': return contactRow(row.edge);
      case 'group': return groupButton(row);
      case 'empty': return <p className="net-list-empty" title={row.text}>{row.text}</p>;
    }
  };

  // The summary counts the endpoints among the AI-supported people, so the badge does too.
  const peopleCount = (list?.people.length ?? 0) + (list?.endpoints.length ?? 0), contactCount = list?.contacts.accepted.length ?? 0;
  const tabButton = (id: InspectorTab, label: string, aria: string, count: number) =>
    <button type="button" role="tab" id={`net-tab-${id}`} aria-selected={tab === id} aria-controls="net-tabpanel" aria-label={`${aria}, ${count}`} className={`net-tab ${tab === id ? 'is-selected' : ''}`} onClick={() => setTab(id)}>
      {label}<span className="net-tab-badge">{count}</span>
    </button>;

  const summary = view && session && <>
    <p className="net-summary"><strong>{view.counts.people}</strong> AI-supported {view.counts.people === 1 ? 'person' : 'people'} · <strong>{view.counts.contacts}</strong> {view.counts.contacts === 1 ? 'contact' : 'contacts'}</p>
    {view.chain ? <p className="net-closest">A chain of accepted contacts connects both ends.</p>
      : view.closest && <p className="net-closest" title={closestApproachLabel(view.closest, name)}>{closestApproachLabel(view.closest, name)}</p>}
  </>;
  const HINT = 'Select a person or contact to read the stored evidence. Inspection does not make additional AI requests.';
  const back = backLabel(history, tab, name);

  return <aside className={`connection-explorer-inspection ${narrow ? 'is-sheet' : ''} ${narrow && open ? 'is-open' : ''}`} aria-label="Network inspection" hidden={narrow && !open}>
    {narrow && <button type="button" className="net-sheet-close" onClick={onDismiss} aria-label="Close inspection">×</button>}
    <div className="net-inspect-head">
      <h3>Inspect the exploration</h3>
      {hasSelection
        ? <button type="button" className="net-back" onClick={onBack} title={back} aria-label={back.replace('←', 'Back to')}>{back}</button>
        : <Tooltip text={HINT} multiline placement="bottom"><button type="button" className="net-help" aria-label={HINT}>?</button></Tooltip>}
    </div>
    {hasSelection && <div className="net-detail">{selectedPerson && session ? renderPerson(selectedPerson) : selectedEdge ? renderEdge(selectedEdge) : null}</div>}
    <div className="net-browser" hidden={hasSelection}>
      {summary}
      {list && <>
        <section className="net-endpoints" aria-label="Endpoints">
          <ul>{list.endpoints.map((person, index) => <li key={person.id}><button type="button" className="net-row net-endpoint-chip" title={`${person.name} · ${years(person)} · ${person.occupation}`} onClick={() => onSelect({ person: person.id })}>
            <span className="net-chip-portrait">{portrait(person, 28)}<b className={`net-end-badge is-${index === 0 ? 'a' : 'b'}`}>{index === 0 ? 'A' : 'B'}</b></span>
            <span><strong>{person.name}</strong></span>
          </button></li>)}</ul>
        </section>
        <div className="net-tablist" role="tablist" aria-label="AI-supported people and contacts">
          {tabButton('people', 'People', 'AI-supported people', peopleCount)}
          {tabButton('contacts', 'Contacts', 'AI-supported contacts', contactCount)}
        </div>
        <input type="search" className="net-search" value={query} onChange={event => onQueryChange(event.target.value)} autoComplete="off" spellCheck={false}
          placeholder={tab === 'people' ? 'Search AI-supported people' : 'Search AI-supported contacts'}
          aria-label={tab === 'people' ? 'Search AI-supported people' : 'Search AI-supported contacts'} />
        <VirtualList id="net-tabpanel" role="tabpanel" aria-labelledby={`net-tab-${tab}`} className="net-list no-scrollbar" listClassName="net-contact-rows net-vlist"
          items={rows} itemKey={rowKey} itemHeight={rowHeight} itemClassName={rowClass} renderItem={renderRow}
          // The tab and the search start from the top; the network growing while a search runs does not (the row at the top stays put).
          resetKey={`${resetKey}|${tab}|${query}`} />
      </>}
    </div>
    {session && !session.persistent && <p className="connection-explorer-storage">This exploration is available in this session. Saving across reloads is unavailable.</p>}
  </aside>;
};
export default NetworkInspector;
