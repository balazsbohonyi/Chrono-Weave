import React, { forwardRef } from 'react';
import { BUILD_PHASES, BUILD_STEP_LABELS, type BuildPhase } from './strategies';

interface Props {
  phases: BuildPhase[];
  /** The app's build phase; idle while a submit is still on its way to the first one. */
  phase: BuildPhase | 'idle';
  hidden: boolean;
}

/** Build progress under the form: the phase's title and description over Validate · Build (· Verify) steps.
 *  The thread field pulls into a timeline just above the steps (the launcher measures them through the ref). */
const BuildProgress = forwardRef<HTMLDivElement, Props>(({ phases, phase, hidden }, ref) => {
  const index = phase === 'idle' ? -1 : phases.indexOf(phase);
  const [title, description] = phase === 'idle' ? ['Preparing your timeline...', 'Getting your request ready.'] : BUILD_PHASES[phase];
  return (
    <div className="lx-build" role="status" aria-live="polite" aria-atomic="true" hidden={hidden} ref={ref}>
      <h3 className="lx-build-title">{title}</h3>
      <p className="lx-build-desc">{description}</p>
      <div className="lx-steps">
        {phases.map((p, j) => (
          <span key={p} className={`lx-step${j === index ? ' is-active' : ''}${j < index ? ' is-done' : ''}`}><i />{BUILD_STEP_LABELS[p]}</span>
        ))}
      </div>
    </div>
  );
});

export default BuildProgress;
