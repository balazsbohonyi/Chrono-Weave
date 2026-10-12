import React, { useId } from 'react';

interface Props {
  // One path per link, in the coordinates of the surrounding SVG.
  segments: string[];
  // Links drawn so far; the fraction draws the next link part-way.
  progress: number;
  // Line width in the SVG's units; dashes scale with it so the pattern looks the same at every zoom.
  strokeWidth: number;
}

// The thread is a dashed line. Drawing it in is done with a mask: a solid copy of each path grows from
// its start and uncovers the dashes, so the dashes themselves never crawl while a link is being drawn.
const ConnectionThread: React.FC<Props> = ({ segments, progress, strokeWidth }) => {
  const prefix = `thread${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Round caps add half a width at each end, so the dash and gap are shortened and lengthened to match.
  const dashes = `${strokeWidth * 2} ${strokeWidth * 3.4}`;
  return (
    <g data-connection-thread>
      <defs>
        {segments.map((d, index) => {
          const amount = Math.max(0, Math.min(1, progress - index));
          return (
            <mask key={index} id={`${prefix}-${index}`} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
              <path d={d} pathLength={1} fill="none" stroke="white" strokeWidth={strokeWidth * 4} strokeLinecap="butt"
                strokeDasharray="1 1" strokeDashoffset={1 - amount} />
            </mask>
          );
        })}
      </defs>
      {segments.map((d, index) => progress - index > 0 && (
        <path key={index} d={d} fill="none" className="connection-thread-line" strokeWidth={strokeWidth}
          strokeDasharray={dashes} mask={`url(#${prefix}-${index})`} />
      ))}
    </g>
  );
};

export default ConnectionThread;
