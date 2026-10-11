import React from 'react';

interface Props {
  // One path per link, in the coordinates of the surrounding SVG.
  segments: string[];
  // Links drawn so far; the fraction draws the next link part-way.
  progress: number;
  strokeWidth: number;
}

// Draws the thread by revealing each path from its start, so a link grows from one person to the next.
const ConnectionThread: React.FC<Props> = ({ segments, progress, strokeWidth }) => (
  <g data-connection-thread>
    {segments.map((d, index) => {
      const amount = Math.max(0, Math.min(1, progress - index));
      if (amount <= 0) return null;
      const dash = { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - amount } as const;
      return (
        <g key={index}>
          <path d={d} {...dash} className="connection-thread-glow" strokeWidth={strokeWidth * 4} />
          <path d={d} {...dash} className="connection-thread-line" strokeWidth={strokeWidth} />
        </g>
      );
    })}
  </g>
);

export default ConnectionThread;
