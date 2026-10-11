import React from 'react';
import Tooltip from './Tooltip';

interface CanvasZoomResetProps {
  scale: number;
  onReset: () => void;
  disabled?: boolean;
}

const CanvasZoomReset: React.FC<CanvasZoomResetProps> = ({ scale, onReset, disabled }) => {
  const atDefaultZoom = Math.abs(scale - 1) < 0.0001;
  return (
    <Tooltip text="Reset zoom to 100%"><button type="button" className="canvas-floating-button canvas-zoom-reset" disabled={disabled || atDefaultZoom}
      aria-label="Reset zoom to 100%" onClick={event => {
        if (event.detail > 0) event.currentTarget.blur();
        onReset();
      }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
        <text x="10" y="12.5" textAnchor="middle" fontSize="7" fontWeight="700"
          fontFamily="sans-serif" fill="currentColor" stroke="none">1:1</text>
      </svg>
    </button></Tooltip>
  );
};

export default CanvasZoomReset;
