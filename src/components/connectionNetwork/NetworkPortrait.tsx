import React, { useState } from 'react';
import { CATEGORY_BAR_TEXT_COLORS, CATEGORY_COLORS } from '../../constants';
import type { ContactPerson } from '../../services/connectionGraph';
import { initials } from '../../services/connectionNetworkView';

// Anyone with a name and a category: contact people and canvas figures alike.
interface Props { person: Pick<ContactPerson, 'name' | 'category'>; url?: string; size: number; tentative?: boolean }

// A round portrait for the panels and lists; initials on the category colour when there is no image (or it fails).
const NetworkPortrait: React.FC<Props> = ({ person, url, size, tentative }) => {
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed && !tentative;
  return <span className={`net-portrait ${tentative ? 'is-tentative' : ''}`} aria-hidden="true"
    style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: CATEGORY_COLORS[person.category], color: CATEGORY_BAR_TEXT_COLORS[person.category] }}>
    {showImage ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials(person.name)}
  </span>;
};
export default NetworkPortrait;
