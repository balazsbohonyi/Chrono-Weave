import React from 'react';
import type { CandidateContact, ConnectionSession, ContactPerson } from '../../services/connectionGraph';
import {
  closestApproachLabel, describeSide, edgeId, personContacts, STATUS_LABELS, years, type NetworkNode, type NetworkSelection, type NetworkView,
} from '../../services/connectionNetworkView';
import NetworkPortrait from './NetworkPortrait';

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
}

const excerpt = (text: string, max = 96) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const interaction = (contact: CandidateContact) => contact.assessment?.interactionType?.replace(/-/g, ' ') ?? '';
const detailOf = (contact: CandidateContact) => contact.assessment?.evidence || contact.assessment?.uncertainty || contact.blockedReason || contact.claim || 'Awaiting assessment';

const NetworkInspector: React.FC<Props> = ({ session, view, selection, portraits, pinned, narrow, open, onSelect, onUnpin, onDismiss }) => {
  const people = new Map((session?.people ?? []).map(person => [person.id, person]));
  const name = (id: string) => people.get(id)?.name ?? id;
  const endpointNames: [string, string] = [name(session?.endpoints[0] ?? ''), name(session?.endpoints[1] ?? '')];
  const supported = (id: string) => !!view?.nodes.find(node => node.id === id)?.supported || (session?.endpoints.includes(id) ?? false)
    || !!session?.candidates.some(c => c.status === 'accepted' && (c.from === id || c.to === id));
  const portrait = (person: ContactPerson, size: number) => <NetworkPortrait person={person} size={size} url={portraits.get(person.id)} tentative={!supported(person.id)} />;

  const person = selection.person ? people.get(selection.person) : undefined;
  const edge = selection.edge ? session?.candidates.find(c => edgeId(c) === selection.edge) : undefined;

  const renderPerson = (target: ContactPerson) => {
    const node: NetworkNode | undefined = view?.nodes.find(item => item.id === target.id);
    const isSupported = supported(target.id);
    const { accepted, unverified } = personContacts(session!, target.id);
    const side = node ? describeSide(node, endpointNames) : isSupported ? 'AI-supported' : 'Tentative';
    return <>
      <div className="net-person-head">{portrait(target, 72)}<div><h4>{target.name}</h4>
        {isSupported ? <p>{years(target)} · {target.occupation}</p> : <p>Tentative person · identity details are not yet checked.</p>}</div></div>
      <p className="net-side-line">{side}</p>
      {target.aliases.length > 0 && isSupported && <p>Explicit aliases: {target.aliases.join(', ')}</p>}
      {pinned.has(target.id) && <p><button type="button" onClick={() => onUnpin(target.id)}>Unpin</button></p>}
      {isSupported && <section aria-label="AI-supported contacts"><h5>AI-supported contacts ({accepted.length})</h5>
        {accepted.length === 0 ? <p>No accepted contacts yet.</p> : <ul className="net-contact-rows">{accepted.map(({ other, candidate }) =>
          <li key={edgeId(candidate)}><button type="button" onClick={() => onSelect({ edge: edgeId(candidate) })}>
            {portrait(other, 34)}<span><strong>{other.name}</strong>{interaction(candidate) && <em> · {interaction(candidate)}</em>}<small>{excerpt(candidate.assessment?.evidence ?? '')}</small></span>
          </button></li>)}</ul>}
      </section>}
      {unverified.length > 0 && <details className="net-unverified"><summary>Unverified around this person ({unverified.length})</summary>
        <ul className="net-contact-rows">{unverified.map(({ other, candidate }) => <li key={edgeId(candidate)}><button type="button" onClick={() => onSelect({ edge: edgeId(candidate) })}>
          <span><strong>{other.name}</strong><em> · {STATUS_LABELS[candidate.status]}</em><small>{excerpt(detailOf(candidate))}</small></span>
        </button></li>)}</ul></details>}
    </>;
  };

  const renderEdge = (contact: CandidateContact) => {
    const a = people.get(contact.from), b = people.get(contact.to);
    const assessment = contact.assessment;
    return <>
      <div className="net-edge-head">{a && portrait(a, 56)}<span aria-hidden="true">↔</span>{b && portrait(b, 56)}</div>
      <h4>{name(contact.from)} ↔ {name(contact.to)}</h4>
      <p className={`connection-inspection-verdict is-${contact.status}`}>{STATUS_LABELS[contact.status]}{interaction(contact) && ` · ${interaction(contact)}`}{assessment?.year !== undefined && ` · ${assessment.year}`}</p>
      {contact.status === 'accepted'
        ? <p>{assessment?.evidence}</p>
        : <p>{contact.status === 'blocked' ? contact.blockedReason : assessment?.uncertainty || `Unverified proposal: ${contact.claim || 'awaiting assessment'}`}</p>}
      {assessment?.episode && <p>Episode: {assessment.episode}</p>}
      {assessment && <small>AI assessment · {assessment.provenance.provider} / {assessment.provenance.model} · {new Date(assessment.provenance.assessedAt).toLocaleDateString()}</small>}
    </>;
  };

  const list = view?.list;
  const summary = view && session ? <>
    <p className="net-summary"><strong>{view.counts.people}</strong> AI-supported {view.counts.people === 1 ? 'person' : 'people'} · <strong>{view.counts.contacts}</strong> {view.counts.contacts === 1 ? 'contact' : 'contacts'}</p>
    {view.chain ? <p>A chain of accepted contacts connects both ends.</p> : view.closest && <p className="net-closest">{closestApproachLabel(view.closest, name)}</p>}
    <p>Select a person or contact to read the stored evidence. Inspection does not make additional AI requests.</p>
  </> : <p>Select a person or contact to read the stored evidence. Inspection does not make additional AI requests.</p>;

  const personButton = (p: ContactPerson) => <li key={p.id}><button type="button" onClick={() => onSelect({ person: p.id })}>{p.name}</button></li>;
  const edgeButton = (e: { id: string; from: string; to: string; status: CandidateContact['status'] }) =>
    <li key={e.id}><button type="button" onClick={() => onSelect({ edge: e.id })}>{name(e.from)} ↔ {name(e.to)} · {STATUS_LABELS[e.status]}</button></li>;

  return <aside className={`connection-explorer-inspection ${narrow ? 'is-sheet' : ''} ${narrow && open ? 'is-open' : ''}`} aria-label="Network inspection" hidden={narrow && !open}>
    {narrow && <button type="button" className="net-sheet-close" onClick={onDismiss} aria-label="Close inspection">×</button>}
    <h3>Inspect the exploration</h3>
    {person && session ? renderPerson(person) : edge ? renderEdge(edge) : summary}
    {session?.error && <p role="alert">{session.error}</p>}
    {session && !session.persistent && <p className="connection-explorer-storage">This exploration is available in this session. Saving across reloads is unavailable.</p>}
    <details className="connection-explorer-list"><summary>People and contacts · readable list</summary>
      {list && <>
        <h4>Endpoints</h4><ul>{list.endpoints.map(personButton)}</ul>
        <h4>AI-supported people</h4>{list.people.length ? <ul>{list.people.map(personButton)}</ul> : <p>None beyond the endpoints yet.</p>}
        {list.unverified.length > 0 && <><h4>Unverified people</h4><ul>{list.unverified.map(personButton)}</ul></>}
        <h4>AI-supported contacts</h4>{list.contacts.accepted.length ? <ul>{list.contacts.accepted.map(edgeButton)}</ul> : <p>None yet.</p>}
        {(['unresolved', 'proposed', 'blocked'] as const).filter(status => list.contacts[status].length > 0).map(status => <React.Fragment key={status}>
          <h4>{status === 'proposed' ? 'Proposed / checking' : STATUS_LABELS[status]} contacts</h4><ul>{list.contacts[status].map(edgeButton)}</ul></React.Fragment>)}
      </>}
    </details>
  </aside>;
};
export default NetworkInspector;
