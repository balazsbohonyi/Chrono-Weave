import React, { useState } from 'react';
import { CATEGORY_BAR_TEXT_COLORS, CATEGORY_COLORS } from '../../constants';
import type { ContactPerson } from '../../services/connectionGraph';
import { initials } from '../../services/connectionNetworkView';
import { sizedPortrait } from '../../utils/portraitSize';

// Anyone with a name and a category: contact people and canvas figures alike.
interface Props { person: Pick<ContactPerson, 'name' | 'category'>; url?: string; size: number; tentative?: boolean }

// A round portrait for the panels and lists; initials on the category colour when there is no image (or it fails). `tentative` (a person
// who is not AI-supported) only changes how it looks (dashed, dimmed): whether they get a picture is decided by whoever gives the `url`
// (see `portraitSubjects`), so a tentative person has one only when their identity is confirmed, and the initials otherwise.
const NetworkPortrait: React.FC<Props> = ({ person, url, size, tentative }) => {
  // What failed is the picture at this address, not whoever stands in this slot: the two portraits of a contact's header (and the one of a
  // person's) are reused for the next contact, so a plain "failed" flag would leave the next person on initials after one image failed.
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const showImage = !!url && failedUrl !== url;
  return <span className={`net-portrait ${tentative ? 'is-tentative' : ''}`} aria-hidden="true"
    style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: CATEGORY_COLORS[person.category], color: CATEGORY_BAR_TEXT_COLORS[person.category] }}>
    {showImage ? <img src={sizedPortrait(url, size)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : initials(person.name)}
  </span>;
};
export default NetworkPortrait;
