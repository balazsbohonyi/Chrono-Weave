import React, { useEffect, useId, useRef } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import type { LayoutMode } from '../services/connectionNetworkLayout';
import { LayoutIcon, layoutOption } from './connectionNetwork/layoutOptions';
import '../styles/sixDegreesInfo.css';

export const layoutInfoLabel = (mode: LayoutMode) => `About the ${layoutOption(mode).label} layout`;

interface Section { title: string; body: readonly string[]; chips?: readonly Chip[] }
// A colour sample with its meaning: a strip colour (`a`, `b`), the two blended (`both`), or none.
interface Chip { kind: 'a' | 'b' | 'both' | 'none'; text: string }
interface Info { summary: string; sections: readonly Section[] }

// What the dialog says about each way of arranging the graph. Kept as data so the wording is one thing.
export const LAYOUT_INFO: Record<LayoutMode, Info> = {
  time: {
    summary: 'People stand along a time axis: earlier on the left, later on the right.',
    sections: [
      {
        title: 'The coloured strips',
        body: [
          'Two tall strips run the full height of the graph. Each one covers the lifetime of one end of the connection, from the year that person was born to the year they died: teal-green for the person marked A, violet for the person marked B.',
          'Where the strips overlap the colours blend. Those are the years when both of them were alive. Where only one colour shows, only that person was alive. If the strips do not touch at all, the two lived in different eras, which is exactly the case Six Degrees is for: the chain has to cross that stretch of time through lives that overlap one after another.',
          'A strip may begin or end beyond the edge of the screen. Use Fit to see the whole of it.',
        ],
        chips: [
          { kind: 'a', text: 'Only A was alive' },
          { kind: 'both', text: 'Both were alive' },
          { kind: 'b', text: 'Only B was alive' },
        ],
      },
      {
        title: 'Where people stand',
        body: [
          'Across the graph, a person stands at the middle of their life, halfway between birth and death. That is why each endpoint sits in the middle of its own strip, not at its left edge. The year labels along the top and bottom edges tell you which year a spot stands for.',
          'The height means nothing. It only keeps people from landing on top of each other, and people who are linked are pulled gently toward each other. A contact standing inside a strip lived around the middle of their life while that endpoint was alive, which is a good sign that their lives overlapped.',
        ],
      },
      {
        title: 'Moving people',
        body: [
          'The two endpoints can only slide up and down: their place along the axis is fixed by their years. Everybody else can be dragged anywhere, but once dropped a person keeps the height you gave them and drifts back sideways to their own year. In practice, you rearrange people vertically.',
          'A moved person is pinned and shows a pin badge. Double-click them to let go, or use the unpin button in the toolbar to release everyone. Nobody can be dropped inside the clear zone around an endpoint: they are pushed straight up or down to its edge.',
        ],
      },
      {
        title: 'What it is good for',
        body: [
          'The timeline shows when. It reveals how many generations a chain spans, who lived in the same era as whom, where the network is crowded and where it is empty. An empty stretch between the two sides is the part of history the search still has to bridge, and, with the lines shown, a dotted line joins the closest the two sides have come to each other.',
          'Use it to judge whether a link is plausible (do these lives overlap?), to see which era the next link has to come from, and to notice when a search has wandered far in time from both ends. It says little about how closely people are connected: for that, use Rings or Columns.',
        ],
      },
    ],
  },
  free: {
    summary: 'A force layout: the shape of the network decides where people stand.',
    sections: [
      {
        title: 'How people are placed',
        body: [
          'Think of magnets on a table. Everybody pushes everybody else away, and two people who are linked pull toward each other. Tight groups of contacts end up as clumps, and a person who links two groups ends up stretched between them. The endpoints start on opposite sides, with a clear zone kept around each of them.',
          'Neither time nor category matters here. Distance on screen is only a loose hint of how closely people are connected.',
        ],
      },
      {
        title: 'Reading the colours',
        body: [
          'The ring around a person is teal-green when, through accepted links, they are nearer to A, and violet when they are nearer to B.',
        ],
      },
      {
        title: 'Moving people',
        body: [
          'Drag anybody, the endpoints included, to wherever you like. They stay where you drop them (pinned, with a pin badge) while everyone else rearranges around them. Double-click a pinned person to let go, or use the unpin button in the toolbar to release everyone. Nobody can be dropped inside the clear zone around an endpoint.',
        ],
      },
      {
        title: 'What it is good for',
        body: [
          'The free layout shows the real shape of the network: communities, hubs with many contacts and the bridge people who hold groups together. Use it to find who connects whom, to see whether the two sides are drifting toward each other, or to pull one part apart by hand and look at it closely.',
        ],
      },
    ],
  },
  cluster: {
    summary: 'Rings of people around each endpoint, one ring for every link of distance.',
    sections: [
      {
        title: 'How people are placed',
        body: [
          'Each endpoint is the centre of its own dashed rings. The first ring holds its accepted contacts (1 link), the second holds their contacts (2 links), and so on, as the labels on the rings say. A person belongs to the rings of the endpoint they are nearest to, in the colour of that side.',
          'The rings fan out away from the other endpoint, so the space between the two stays free for people who are linked to neither. On a ring, contacts of the same person stay together and are ordered by year, which keeps most lines from crossing. Unverified contacts of a selected person stand beside that person.',
        ],
      },
      {
        title: 'Moving people',
        body: [
          'Drag an endpoint and its rings, with everyone on them, move along. Drag any other person and they stay where you drop them (pinned, with a pin badge). Double-click to let go, or use the unpin button in the toolbar to release everyone.',
        ],
      },
      {
        title: 'What it is good for',
        body: [
          'Rings show how far each end of the search has reached. Count the rings to see how many links deep each side is, and compare how crowded each ring is. Use it to judge the progress of a search, to see how balanced the two sides are, and to tell at a glance who is close to which endpoint.',
        ],
      },
    ],
  },
  columns: {
    summary: 'Columns of people by the number of links from the nearest endpoint.',
    sections: [
      {
        title: 'How people are placed',
        body: [
          'The endpoint marked A stands on the left, with the people one link away in the first column to its right, two links away in the next, and so on. The endpoint marked B is the mirror image on the right. The two sets of columns meet in the middle, and the labels at the top of each column say how many links it stands for.',
          'Inside a column people follow the order of whoever introduced them in the previous column, which keeps lines from crossing. A full column widens into several lanes. Unverified contacts stand behind the endpoint they are tied to, and people linked to nobody gather in the middle.',
        ],
      },
      {
        title: 'Moving people',
        body: [
          'Drag an endpoint and its columns move along. Drag any other person and they stay where you drop them (pinned, with a pin badge). Double-click to let go, or use the unpin button in the toolbar to release everyone.',
        ],
      },
      {
        title: 'What it is good for',
        body: [
          'Columns turn the network into stages. They show how many people stand at each degree of separation from each end, how fast the network widens, and where the two sides meet. Use it to read a result in degrees, to compare the two sides, and to find who is the nearest contact to each end.',
        ],
      },
    ],
  },
  category: {
    summary: 'People grouped by category, between the two endpoints.',
    sections: [
      {
        title: 'How people are placed',
        body: [
          'Each category (Scientists, Leaders & Baddies, Artists, Thinkers and so on) gets a labelled box with its people inside and a count in the title. The boxes are cut out of one big rectangle that they fill edge to edge, so a category with just a few people may get a box with a lot of empty room while the large ones take the most space. The biggest categories come first, and inside a box people go from the earliest to the latest. The endpoints stand outside the big rectangle, A on the left and B on the right, as landmarks.',
          'The rings around people still show the side, teal-green for nearer to A and violet for nearer to B, and the lines still show who knows whom, now running between the boxes.',
        ],
      },
      {
        title: 'Moving people',
        body: [
          'Drag anybody, the endpoints included. They stay where you drop them (pinned, with a pin badge) and the boxes do not move. Double-click to let go, or use the unpin button in the toolbar to release everyone.',
        ],
      },
      {
        title: 'What it is good for',
        body: [
          'Categories reveal what kinds of people the network passes through: which categories dominate, and which categories link to which. A chain that runs from a Scientist through a Thinker to a Leader shows up as lines crossing from one box to the next. Use it to understand what sort of people bridge the two ends, and to find a category you want to look at.',
        ],
      },
    ],
  },
  corridor: {
    summary: 'The route between the two endpoints as a straight line, with everyone else hanging from it.',
    sections: [
      {
        title: 'How people are placed',
        body: [
          'A line runs from A to B through the people of the chain. Once a connection is found, that is the chain itself. While the search is still going, it is the best known way from each endpoint to the point where the two sides come closest, and the gap between them stays open.',
          'Everybody else hangs above or below the person on the line they are fewest links from: the first contacts alternate above and below, and deeper ones carry on on their parent’s side, one row per link. People linked to nobody on the line wait in rows underneath.',
        ],
      },
      {
        title: 'Moving people',
        body: [
          'Move an endpoint and the whole corridor moves with it, stretching or shrinking. Move a person on the line and the people hanging from them follow. Drag any other person and they stay where you drop them (pinned, with a pin badge). Double-click to let go, or use the unpin button in the toolbar to release everyone.',
        ],
      },
      {
        title: 'What it is good for',
        body: [
          'The corridor makes the route itself easy to read: step by step, who leads to whom, with the other people each step knew hanging beside it. Use it to follow a found connection from one end to the other, to see what else surrounds each link, and, during a search, to see where the best known route breaks off.',
        ],
      },
    ],
  },
};

// A small picture of each arrangement: 240 x 96, drawn in the side colours.
const Diagram: React.FC<{ mode: LayoutMode }> = ({ mode }) => {
  const end = (x: number, y: number, side: 'a' | 'b', key?: string) => <circle key={key} cx={x} cy={y} r="8" className={`ldi-end ldi-${side}`} />;
  const dot = (x: number, y: number, side: 'a' | 'b' | 'n' = 'n') => <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" className={`ldi-dot ldi-${side}`} />;
  const line = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} className="ldi-line" />;
  switch (mode) {
    case 'time':
      return <svg viewBox="0 0 240 96" role="presentation">
        <rect x="14" y="4" width="132" height="74" className="ldi-band ldi-band-a" /><rect x="84" y="4" width="142" height="74" className="ldi-band ldi-band-b" />
        <line x1="8" x2="232" y1="86" y2="86" className="ldi-axis" />
        {[14, 84, 146, 226].map(x => <line key={x} x1={x} x2={x} y1="82" y2="90" className="ldi-axis" />)}
        {line(80, 26, 110, 18)}{line(80, 26, 120, 62)}{line(155, 52, 120, 62)}{line(155, 52, 185, 26)}{line(155, 52, 200, 60)}
        {end(80, 26, 'a')}{end(155, 52, 'b')}{dot(50, 60, 'a')}{dot(110, 18)}{dot(120, 62)}{dot(185, 26, 'b')}{dot(200, 60, 'b')}
      </svg>;
    case 'free':
      return <svg viewBox="0 0 240 96" role="presentation">
        {[[40, 48, 82, 26], [40, 48, 78, 70], [82, 26, 120, 44], [78, 70, 120, 44], [120, 44, 160, 24], [120, 44, 158, 72], [160, 24, 200, 48], [158, 72, 200, 48], [82, 26, 78, 70]].map(([a, b, c, d]) => line(a, b, c, d))}
        {end(40, 48, 'a')}{end(200, 48, 'b')}{dot(82, 26, 'a')}{dot(78, 70, 'a')}{dot(120, 44)}{dot(160, 24, 'b')}{dot(158, 72, 'b')}
      </svg>;
    case 'cluster':
      return <svg viewBox="0 0 240 96" role="presentation">
        <circle cx="56" cy="48" r="22" className="ldi-ring ldi-a" /><circle cx="56" cy="48" r="40" className="ldi-ring ldi-a" />
        <circle cx="184" cy="48" r="22" className="ldi-ring ldi-b" /><circle cx="184" cy="48" r="40" className="ldi-ring ldi-b" />
        {end(56, 48, 'a')}{end(184, 48, 'b')}
        {dot(36, 36, 'a')}{dot(36, 60, 'a')}{dot(18, 48, 'a')}{dot(22, 22, 'a')}{dot(22, 74, 'a')}
        {dot(204, 36, 'b')}{dot(204, 60, 'b')}{dot(222, 48, 'b')}{dot(218, 22, 'b')}{dot(218, 74, 'b')}
      </svg>;
    case 'columns':
      return <svg viewBox="0 0 240 96" role="presentation">
        {[[32, 'a'], [70, 'a'], [142, 'b'], [180, 'b']].map(([x, side]) => <rect key={x} x={x as number} y="8" width="28" height="80" rx="6" className={`ldi-column ldi-${side}`} />)}
        {end(12, 48, 'a')}{end(228, 48, 'b')}
        {dot(46, 28, 'a')}{dot(46, 48, 'a')}{dot(46, 68, 'a')}{dot(84, 20, 'a')}{dot(84, 38, 'a')}{dot(84, 56, 'a')}{dot(84, 74, 'a')}
        {dot(194, 28, 'b')}{dot(194, 48, 'b')}{dot(194, 68, 'b')}{dot(156, 20, 'b')}{dot(156, 38, 'b')}{dot(156, 56, 'b')}{dot(156, 74, 'b')}
        {[1, 2].map(n => <text key={`a${n}`} x={46 + (n - 1) * 38} y="94" textAnchor="middle" className="ldi-label">{n}</text>)}
        {[1, 2].map(n => <text key={`b${n}`} x={194 - (n - 1) * 38} y="94" textAnchor="middle" className="ldi-label">{n}</text>)}
      </svg>;
    case 'category':
      return <svg viewBox="0 0 240 96" role="presentation">
        <rect x="42" y="6" width="84" height="48" rx="8" className="ldi-pod" /><rect x="132" y="6" width="66" height="48" rx="8" className="ldi-pod" />
        <rect x="42" y="60" width="52" height="30" rx="8" className="ldi-pod" /><rect x="100" y="60" width="98" height="30" rx="8" className="ldi-pod" />
        {end(18, 48, 'a')}{end(222, 48, 'b')}
        {dot(58, 30, 'a')}{dot(76, 30)}{dot(94, 30, 'a')}{dot(112, 30)}{dot(150, 30, 'b')}{dot(170, 30)}{dot(60, 76)}{dot(78, 76, 'a')}{dot(120, 76, 'b')}{dot(140, 76)}{dot(160, 76, 'b')}{dot(180, 76)}
      </svg>;
    case 'corridor':
      return <svg viewBox="0 0 240 96" role="presentation">
        <line x1="18" x2="222" y1="48" y2="48" className="ldi-spine" />
        {[[72, 20], [72, 76], [120, 14], [120, 80], [120, 30], [168, 22], [168, 74]].map(([x, y]) => line(x, 48, x, y))}
        {end(18, 48, 'a')}{end(222, 48, 'b')}{dot(72, 48, 'a')}{dot(120, 48)}{dot(168, 48, 'b')}
        {dot(72, 20, 'a')}{dot(72, 76, 'a')}{dot(120, 14)}{dot(120, 80)}{dot(168, 22, 'b')}{dot(168, 74, 'b')}
      </svg>;
  }
};

// The explanation of one layout, as a dialog over whatever is on screen.
export const LayoutInfoDialog: React.FC<{ mode: LayoutMode; onClose: () => void }> = ({ mode, onClose }) => {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(dialog, true, onClose);
  // Escape is this dialog's own, ahead of the explorer underneath that also listens for it.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose]);
  const option = layoutOption(mode), info = LAYOUT_INFO[mode];
  return (
    <div className="sdi-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="sdi-dialog">
        <button type="button" className="close-button sdi-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" /></svg>
        </button>
        <div className="sdi-panel">
        <header className="sdi-header">
          <p className="sdi-kicker">Graph layout</p>
          <h2 id={titleId} className="sdi-title ldi-title"><LayoutIcon size={26}>{option.icon}</LayoutIcon>{option.label}</h2>
        </header>
        <div className="sdi-scroll no-scrollbar">
          <p className="ldi-summary">{info.summary}</p>
          <div className="sdi-diagrams ldi-diagram" aria-hidden="true"><figure><Diagram mode={mode} /></figure></div>
          {info.sections.map(section => (
            <section key={section.title} className="sdi-section">
              <h3>{section.title}</h3>
              {section.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              {section.chips && <ul className="ldi-chips">
                {section.chips.map(chip => <li key={chip.text}><span className={`ldi-swatch is-${chip.kind}`} aria-hidden="true" />{chip.text}</li>)}
              </ul>}
            </section>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutInfoDialog;
