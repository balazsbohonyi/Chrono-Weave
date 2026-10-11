import React from 'react';
import type { CanvasLayoutMode } from '../types';
import CanvasLayoutToggle from './CanvasLayoutToggle';
import CanvasZoomReset from './CanvasZoomReset';

interface Props {
  mode: CanvasLayoutMode;
  scale: number;
  onToggleLayout?: () => void;
  onResetZoom: () => void;
  disabled: boolean;
}

const CanvasToolbar: React.FC<Props> = ({ mode, scale, onToggleLayout, onResetZoom, disabled }) => (
  <div data-canvas-controls className="canvas-view-toolbar" role="toolbar" aria-label="Canvas view controls">
    <CanvasLayoutToggle mode={mode} onToggle={onToggleLayout ?? (() => {})} disabled={disabled || !onToggleLayout} />
    <span className="canvas-toolbar-divider" aria-hidden="true" />
    <CanvasZoomReset scale={scale} onReset={onResetZoom} disabled={disabled} />
  </div>
);

export default CanvasToolbar;
