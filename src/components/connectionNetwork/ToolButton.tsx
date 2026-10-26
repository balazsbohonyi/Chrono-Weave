import React from 'react';
import Tooltip from '../Tooltip';

interface Props {
  tip: string; label?: string; pressed?: boolean; disabled?: boolean; haspopup?: boolean;
  // The one action of a phase that the eye should find (Stop, Continue, Reveal), filled in the connection colour.
  accent?: boolean;
  onClick: () => void; children: React.ReactNode;
}

// One icon button of the view controls and of the full-screen bar. A state is shown with `pressed`, an action with just its label.
const ToolButton: React.FC<Props> = ({ tip, label, pressed, disabled, haspopup, accent, onClick, children }) =>
  <Tooltip text={tip}><button type="button" className={accent ? 'canvas-floating-button is-accent' : 'canvas-floating-button'} aria-label={label ?? tip} aria-pressed={pressed} disabled={disabled} aria-haspopup={haspopup ? 'dialog' : undefined}
    onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onClick(); }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  </button></Tooltip>;
export default ToolButton;
