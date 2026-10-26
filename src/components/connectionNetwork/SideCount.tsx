import React from 'react';
import type { ContactPerson } from '../../services/connectionGraph';
import Tooltip from '../Tooltip';
import NetworkPortrait from './NetworkPortrait';

interface Props {
  index: 0 | 1; person: ContactPerson; count: number; otherName: string; url?: string;
  // What the hover text starts with (the full-screen bar names who the portrait is: the footer's text already holds the names).
  lead?: string;
}

// How many people an endpoint has gathered (the endpoints themselves not counted), with the endpoint's portrait. Hovering explains the number
// (the shared Tooltip); the same text is the accessible name.
const SideCount: React.FC<Props> = ({ index, person, count, otherName, url, lead }) => {
  const sentence = `${count} ${count === 1 ? 'person' : 'people'} closer to ${person.name} than to ${otherName}, through accepted contacts. The two endpoints are not counted.`;
  const text = lead ? `${lead} — ${sentence}` : sentence;
  return <Tooltip text={text} multiline>
    <span className={`ce-side is-${index === 0 ? 'a' : 'b'}`} role="img" tabIndex={0} aria-label={text}>
      <span className="ce-side-portrait"><NetworkPortrait person={person} size={32} url={url} /><b className="net-end-badge" aria-hidden="true">{index === 0 ? 'A' : 'B'}</b></span>
      <strong className="ce-side-count" aria-hidden="true">{count}</strong>
    </span>
  </Tooltip>;
};
export default SideCount;
