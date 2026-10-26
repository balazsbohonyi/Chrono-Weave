import React from 'react';

// Two linked rings: the mark of people a Six Degrees connection brought onto the canvas.
export const GuestLinkIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </svg>
);

// The header of the guests' section, in world space on either canvas: a dashed rule with the title in the middle,
// or at its start on the timeline, whose band can be far wider than the screen.
const GuestSectionHeader: React.FC<{ label: string; count: number; left: number; top: number; width: number; fontSize: number; align?: 'center' | 'start' }> = ({ label, count, left, top, width, fontSize, align = 'center' }) => (
  <div className={`canvas-section-header ${align === 'start' ? 'canvas-section-header--start' : ''}`} style={{ left, top, width, fontSize }} data-guest-section>
    <span className="canvas-section-title"><GuestLinkIcon size={fontSize * 1.2} />{label}<span className="canvas-section-count">{count}</span></span>
  </div>
);

export default GuestSectionHeader;
