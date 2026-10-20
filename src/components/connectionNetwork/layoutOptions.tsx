import React from 'react';
import type { LayoutMode } from '../../services/connectionNetworkLayout';

// One icon of the layout menu (and of its button, which shows the current layout): 24x24 strokes that take the text colour.
export const LayoutIcon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 20 }) =>
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export interface LayoutOption { mode: LayoutMode; label: string; icon: React.ReactNode }

// Every way to arrange the graph, in the order the menu lists them.
export const LAYOUT_OPTIONS: LayoutOption[] = [
  { mode: 'time', label: 'Timeline', icon: <>
    <path d="M3 20h18M6 18v3M12 18v3M18 18v3" />
    <rect x="3" y="3" width="11" height="3" rx="1" fill="currentColor" stroke="none" />
    <rect x="8" y="8" width="13" height="3" rx="1" fill="currentColor" stroke="none" />
    <rect x="5" y="13" width="10" height="3" rx="1" fill="currentColor" stroke="none" />
  </> },
  { mode: 'free', label: 'Free', icon: <>
    <circle cx="6" cy="7" r="2.6" /><circle cx="18" cy="6" r="2.6" /><circle cx="12" cy="18" r="2.6" />
    <path d="M8.5 7h7M7.4 9.3l3.3 6.4M16.7 8.4l-3.4 7.2" />
  </> },
  { mode: 'cluster', label: 'Rings', icon: <>
    <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="8.2" strokeDasharray="2 3.2" />
    <circle cx="12" cy="3.8" r="1.7" fill="currentColor" stroke="none" /><circle cx="19.1" cy="16.1" r="1.7" fill="currentColor" stroke="none" /><circle cx="4.9" cy="16.1" r="1.7" fill="currentColor" stroke="none" />
  </> },
  { mode: 'columns', label: 'Columns', icon: <>
    <circle cx="3.2" cy="12" r="2.2" fill="currentColor" stroke="none" /><circle cx="20.8" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="8.6" cy="8" r="1.5" fill="currentColor" stroke="none" /><circle cx="8.6" cy="16" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="5.4" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="18.6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15.4" cy="8" r="1.5" fill="currentColor" stroke="none" /><circle cx="15.4" cy="16" r="1.5" fill="currentColor" stroke="none" />
  </> },
  { mode: 'category', label: 'Categories', icon: <>
    <rect x="2.5" y="3" width="11" height="8" rx="2" /><rect x="15.5" y="3" width="6" height="8" rx="2" />
    <rect x="2.5" y="13.5" width="6.5" height="7.5" rx="2" /><rect x="11" y="13.5" width="10.5" height="7.5" rx="2" />
    <circle cx="6" cy="7" r="1.1" fill="currentColor" stroke="none" /><circle cx="10" cy="7" r="1.1" fill="currentColor" stroke="none" /><circle cx="18.5" cy="7" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="5.75" cy="17.2" r="1.1" fill="currentColor" stroke="none" /><circle cx="14" cy="17.2" r="1.1" fill="currentColor" stroke="none" /><circle cx="18" cy="17.2" r="1.1" fill="currentColor" stroke="none" />
  </> },
  { mode: 'corridor', label: 'Corridor', icon: <>
    <path d="M5.5 12h13" /><circle cx="3.5" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="20.5" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M9 12V6.5M9 12v5.5M15 12V6.5M15 12v5.5" />
    <circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </> },
];

export const layoutOption = (mode: LayoutMode): LayoutOption => LAYOUT_OPTIONS.find(option => option.mode === mode) ?? LAYOUT_OPTIONS[1];
