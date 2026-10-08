import React from 'react';
import type { CanvasLayoutMode } from '../types';

interface CanvasLayoutToggleProps {
  mode: CanvasLayoutMode;
  onToggle: () => void;
  disabled: boolean;
}

const CanvasLayoutToggle: React.FC<CanvasLayoutToggleProps> = ({ mode, onToggle, disabled }) => {
  const showTimeline = mode === 'gallery';
  const label = showTimeline ? 'Switch to year-based timeline' : 'Switch to gallery card layout';

  return (
    <button type="button" className="canvas-floating-button canvas-layout-toggle" onClick={event => {
      if (event.detail > 0) event.currentTarget.blur();
      onToggle();
    }}
      disabled={disabled} aria-label={label} title={label}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {showTimeline ? <>
          <path d="M3 20h18M6 18v3M12 18v3M18 18v3" />
          <rect x="3" y="3" width="11" height="3" rx="1" fill="currentColor" stroke="none" />
          <rect x="8" y="8" width="13" height="3" rx="1" fill="currentColor" stroke="none" />
          <rect x="5" y="13" width="10" height="3" rx="1" fill="currentColor" stroke="none" />
        </> : <>
          <rect x="2" y="4" width="7" height="6" rx="1.5" />
          <rect x="12" y="4" width="7" height="6" rx="1.5" />
          <rect x="5" y="14" width="7" height="6" rx="1.5" />
          <rect x="15" y="14" width="7" height="6" rx="1.5" />
        </>}
      </svg>
    </button>
  );
};

export default CanvasLayoutToggle;
