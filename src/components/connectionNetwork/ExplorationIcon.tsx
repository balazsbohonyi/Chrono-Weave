import React from 'react';

// The icon of a connection's exploration (its graph): on the sidebar's connection cards, and on the stage that plays the connection.
const ExplorationIcon: React.FC<{ size?: number }> = ({ size = 18 }) =>
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" />
    <path d="M7.2 7l3.6 9M16.8 7l-3.6 9M7.6 6h8.8" />
  </svg>;
export default ExplorationIcon;
