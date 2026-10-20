import React from 'react';
import type { WeaveValidationResult } from '../../types';
import BuildProgress from './BuildProgress';
import { WEAVE_ICON } from './PromptStage';
import { buildPhasesFor, formatLauncherYear, type BuildPhase } from './strategies';

export type SurpriseState = 'idle' | 'consulting' | 'suggested' | 'error';

interface Props {
  state: SurpriseState;
  result: WeaveValidationResult | null;
  error: string | null;
  notice: string | null;
  building: boolean;
  phase: BuildPhase | 'idle';
  busy: boolean;
  tickerRef: React.Ref<HTMLDivElement>;
  suggestionRef: React.Ref<HTMLHeadingElement>;
  weaveRef: React.Ref<HTMLButtonElement>;
  actionsRef: React.Ref<HTMLDivElement>;
  buildRef: React.Ref<HTMLDivElement>;
  onClose(): void;
  onSpin(): void;
  onWeave(): void;
}

const CLOSE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 18 18 6M6 6l12 12" /></svg>;

/** The Surprise Me card: a ticker of year ranges while the archives are consulted, then the suggestion. */
const SurpriseCard: React.FC<Props> = ({ state, result, error, notice, building, phase, busy, tickerRef, suggestionRef, weaveRef, actionsRef, buildRef, onClose, onSpin, onWeave }) => <>
  <button className="lx-icon-btn lx-card-close" type="button" aria-label="Close Surprise Me" title="Close Surprise Me (Esc)" disabled={building} onClick={onClose}>{CLOSE}</button>
  {state === 'consulting' && (
    <div className="lx-ticker" aria-hidden="true" ref={tickerRef}>1400 – 1500<small>Consulting the archives…</small></div>
  )}
  {state === 'error' && !result && <>
    <p className="lx-error" role="alert">{error || 'We could not find a historical topic this time. Please roll again.'}</p>
    <div className="lx-actions"><button className="lx-btn" type="button" disabled={busy} onClick={onSpin}>Try again</button></div>
  </>}
  {(state === 'suggested' || state === 'error') && result && <>
    <div className="lx-meta">
      <span className="lx-pill">Historical suggestion</span>
      <div className="lx-meta-end">
        {result.activeCategories.map(c => <span key={c} className="lx-cat">{c.charAt(0) + c.slice(1).toLowerCase()}</span>)}
        <span className="lx-range">{formatLauncherYear(result.inferredStartYear)} – {formatLauncherYear(result.inferredEndYear)}</span>
      </div>
    </div>
    <h3 className="lx-suggestion" ref={suggestionRef}>{result.themeDescription}</h3>
    {error && <p className="lx-error" role="alert">{error}</p>}
    {notice && <p className="lx-notice" role="status">{notice}</p>}
    <div className="lx-actions" hidden={building} ref={actionsRef}>
      <button className="lx-btn" type="button" disabled={busy} onClick={onSpin}>Spin again</button>
      <button className="lx-btn lx-weave" type="button" disabled={busy} aria-busy={building || undefined} ref={weaveRef} onClick={onWeave}>{WEAVE_ICON}<span>Weave this</span></button>
    </div>
    <BuildProgress phases={buildPhasesFor('freeform')} phase={phase} hidden={!building} ref={buildRef} />
  </>}
</>;

export default SurpriseCard;
