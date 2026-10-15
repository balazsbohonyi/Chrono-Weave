import React, { useEffect, useId, useRef } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import Tooltip from './Tooltip';
import '../styles/sixDegreesInfo.css';

export const SIX_DEGREES_INFO_LABEL = 'What is Six Degrees of Separation?';

// What the dialog says. Kept as data so the wording is one thing, shown the same from every button that opens it.
export const SIX_DEGREES_INFO = {
  title: 'Six Degrees of Separation',
  sections: [
    {
      title: 'The original idea',
      body: [
        'In 1929 the Hungarian writer Frigyes Karinthy imagined that any two people on Earth are joined by a chain of no more than five acquaintances: six steps. In the 1960s Stanley Milgram’s letter-forwarding experiments put numbers on the idea, and the “Six Degrees of Kevin Bacon” game made it a pastime. The six is a rule of thumb, not a law.',
      ],
    },
    {
      title: 'The twist here',
      body: [
        'The two ends do not have to belong to the same era. They can be centuries apart, and most of the people on the way are no longer alive. That works because every single link joins two people who were alive at the same time and had a documented, concrete interaction: they met, taught, corresponded, collaborated, served together, or faced each other as exact opponents in a named battle or campaign.',
        'Time is crossed by a chain of overlapping lives, not by one impossible meeting. Admiration from afar, influence through a book, and family ties alone do not count.',
      ],
    },
    {
      title: 'How a link is accepted',
      body: [
        'The AI proposes people who may have known each other, and every pair is then checked on its own. Only accepted contacts become links. Each one keeps the evidence that justified it, and the Why? button tells the story behind it. Whatever is not confirmed stays out of the chain.',
      ],
    },
    {
      title: 'Reading the result',
      body: [
        '“N degrees apart” is the number of links in the chain that was found. The app reports the real length instead of promising six, and the chain is not proven to be the shortest. A search that ends without a connection does not prove there is none: it only means none was found yet, and you can carry on searching.',
      ],
    },
  ],
  example: {
    caption: 'Newton and Euler never exchanged a word, yet three links join them:',
    people: [
      { name: 'Isaac Newton', birth: 1643, death: 1727 },
      { name: 'Gottfried Wilhelm Leibniz', birth: 1646, death: 1716 },
      { name: 'Johann Bernoulli', birth: 1667, death: 1748 },
      { name: 'Leonhard Euler', birth: 1707, death: 1783 },
    ],
    links: ['exchanged letters on calculus', 'long scientific correspondence', 'taught the young Euler in Basel'],
    note: 'Each pair overlapped in time and has a documented tie, so 3 degrees apart.',
  },
} as const;

interface ButtonProps {
  onOpen: () => void;
  // The compact size, for tight headers.
  small?: boolean;
  // Just the icon, without the round button around it, a little larger.
  plain?: boolean;
  // Marks it so that dragging the stage ignores a press on it.
  stageControl?: boolean;
  placement?: 'top' | 'bottom';
}

// A round “?” that opens the explanation, the same wherever it appears.
export const SixDegreesInfoButton: React.FC<ButtonProps> = ({ onOpen, small = false, plain = false, stageControl = false, placement = 'bottom' }) => (
  <Tooltip text={SIX_DEGREES_INFO_LABEL} placement={placement}>
    <button type="button" className={plain ? 'six-info-button is-plain' : `close-button six-info-button ${small ? 'is-small' : ''}`} aria-label={SIX_DEGREES_INFO_LABEL}
      aria-haspopup="dialog" onClick={onOpen} {...(stageControl ? { 'data-stage-control': '' } : {})}>
      <svg viewBox="0 0 24 24" width={plain ? 22 : small ? 16 : 20} height={plain ? 22 : small ? 16 : 20} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9" /><path d="M12 17.2h.01" />
      </svg>
    </button>
  </Tooltip>
);

// A text link for places with room, such as an empty tab.
export const SixDegreesInfoLink: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button type="button" className="six-info-link" aria-haspopup="dialog" onClick={onOpen}>How does this work?</button>
);

// The two small pictures: a chain of acquaintances, and the same chain as lives that overlap along a timeline.
const Diagrams: React.FC = () => (
  <div className="sdi-diagrams" aria-hidden="true">
    <figure>
      <svg viewBox="0 0 220 64" role="presentation">
        {[28, 84, 140, 196].map((x, index) => <React.Fragment key={x}>
          {index > 0 && <line x1={x - 56 + 9} x2={x - 9} y1="26" y2="26" className="sdi-line" />}
          <circle cx={x} cy="26" r="9" className={index === 0 || index === 3 ? 'sdi-end' : 'sdi-dot'} />
        </React.Fragment>)}
        <text x="110" y="58" textAnchor="middle" className="sdi-label">people who know each other</text>
      </svg>
      <figcaption>The original: a chain of acquaintances</figcaption>
    </figure>
    <figure>
      <svg viewBox="0 0 220 64" role="presentation">
        <line x1="8" x2="212" y1="52" y2="52" className="sdi-axis" />
        {[[10, 64], [34, 98], [70, 140], [118, 200]].map(([from, to], index) => (
          <rect key={from} x={from} y={6 + index * 11} width={to - from} height="7" rx="3.5" className={index === 0 || index === 3 ? 'sdi-end' : 'sdi-dot'} />
        ))}
        <text x="110" y="63" textAnchor="middle" className="sdi-label">centuries</text>
      </svg>
      <figcaption>Here: lives that overlap, one after another</figcaption>
    </figure>
  </div>
);

// The explanation itself, as a dialog over whatever is on screen.
export const SixDegreesInfoDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(dialog, true, onClose);
  // Escape is this dialog's own, ahead of any overlay or banner underneath that also listens for it.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose]);
  const { example } = SIX_DEGREES_INFO;
  return (
    <div className="sdi-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="sdi-dialog">
        <button type="button" className="close-button sdi-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" /></svg>
        </button>
        <div className="sdi-scroll no-scrollbar">
          <p className="sdi-kicker">How it works</p>
          <h2 id={titleId} className="sdi-title">{SIX_DEGREES_INFO.title}</h2>
          {SIX_DEGREES_INFO.sections.map(section => (
            <section key={section.title} className="sdi-section">
              <h3>{section.title}</h3>
              {section.body.map((paragraph, index) => <React.Fragment key={paragraph}>
                {/* The two pictures belong to the twist: they come before the paragraph that says time is crossed by a chain of overlapping lives. */}
                {section.title === 'The twist here' && index === 1 && <Diagrams />}
                <p>{paragraph}</p>
              </React.Fragment>)}
              {section.title === 'The twist here' && (
                <div className="sdi-example">
                  <p>{example.caption}</p>
                  <ol className="sdi-chain">
                    {example.people.map((person, index) => (
                      <li key={person.name}>
                        <span className="sdi-person"><b>{person.name}</b><small>{person.birth}–{person.death}</small></span>
                        {index < example.links.length && <span className="sdi-link">{example.links[index]}</span>}
                      </li>
                    ))}
                  </ol>
                  <p className="sdi-note">{example.note}</p>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SixDegreesInfoDialog;
