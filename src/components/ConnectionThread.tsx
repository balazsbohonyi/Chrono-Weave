import React, { useId } from 'react';

interface Props {
  // One path per link, in the coordinates of the surrounding SVG.
  segments: string[];
  // Links drawn so far; the fraction draws the next link part-way.
  progress: number;
  // Line width in the SVG's units; dashes scale with it so the pattern looks the same at every zoom.
  strokeWidth: number;
  // The box the paths lie in, in their own coordinates. The mask of a link that is being drawn only needs to cover that;
  // without it the mask is made huge, which a browser has to rasterise again on every zoom step.
  extent?: { x: number; y: number; width: number; height: number };
}

const MASK_MARGIN = 200;

// The thread is a dashed line. Drawing it in is done with a mask: a solid copy of each path grows from
// its start and uncovers the dashes, so the dashes themselves never crawl while a link is being drawn.
// Only the link in progress needs a mask: one that is finished is drawn plain, which keeps zooming cheap.
const ConnectionThread: React.FC<Props> = ({ segments, progress, strokeWidth, extent }) => {
  const prefix = `thread${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Round caps add half a width at each end, so the dash and gap are shortened and lengthened to match.
  const dashes = `${strokeWidth * 2} ${strokeWidth * 3.4}`;
  const region = extent
    ? { x: extent.x - MASK_MARGIN, y: extent.y - MASK_MARGIN, width: extent.width + MASK_MARGIN * 2, height: extent.height + MASK_MARGIN * 2 }
    : { x: -100000, y: -100000, width: 200000, height: 200000 };
  const amountOf = (index: number) => Math.max(0, Math.min(1, progress - index));
  const inProgress = (index: number) => { const amount = amountOf(index); return amount > 0 && amount < 1; };
  return (
    <g data-connection-thread>
      <defs>
        {segments.map((d, index) => inProgress(index) && (
          <mask key={index} id={`${prefix}-${index}`} maskUnits="userSpaceOnUse" {...region}>
            <path d={d} pathLength={1} fill="none" stroke="white" strokeWidth={strokeWidth * 4} strokeLinecap="butt"
              strokeDasharray="1 1" strokeDashoffset={1 - amountOf(index)} />
          </mask>
        ))}
      </defs>
      {segments.map((d, index) => progress - index > 0 && (
        <path key={index} d={d} fill="none" className="connection-thread-line" strokeWidth={strokeWidth}
          strokeDasharray={dashes} mask={inProgress(index) ? `url(#${prefix}-${index})` : undefined} />
      ))}
    </g>
  );
};

export default ConnectionThread;
