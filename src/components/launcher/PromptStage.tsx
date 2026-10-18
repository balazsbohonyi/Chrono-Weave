import React, { useEffect, useLayoutEffect, useRef } from 'react';
import type { WeaveMode } from '../../types';
import BuildProgress from './BuildProgress';
import EraBand, { type Span } from './EraBand';
import { Glyph, GlyphStack } from './glyphs';
import { animate, isReducedMotion, tween } from './motion';
import { buildPhasesFor, clamp, eraOf, formatLauncherYear, MAX_YEAR, MIN_YEAR, parseYear, PRESETS, STRATEGIES, strategyOf, type BuildPhase } from './strategies';
import type { ThreadField } from './ThreadField';
import { eraSpan } from '../../utils/eras';

export const WEAVE_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M4 7c4-4 12 4 16 0M4 12c4-4 12 4 16 0M4 17c4-4 12 4 16 0M7 4c-4 4 4 12 0 16M12 4c-4 4 4 12 0 16M17 4c-4 4 4 12 0 16" /></svg>;
const ARROW = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;

export interface Years { start: string; end: string }

interface Props {
  mode: WeaveMode;
  busy: boolean;
  /** The form has made way for build progress. */
  building: boolean;
  phase: BuildPhase | 'idle';
  field: React.RefObject<ThreadField | null>;
  query: string;
  years: Years;
  span: Span;
  error: string | null;
  /** A canvas already woven over these years: the stage offers to open it instead. */
  existing: { start: number; end: number; open(): void } | null;
  sync: number;
  medallionRef: React.Ref<HTMLDivElement>;
  formRef: React.Ref<HTMLFormElement>;
  buildRef: React.Ref<HTMLDivElement>;
  onQuery(query: string): void;
  onYears(years: Years, span: Span): void;
  onClearError(): void;
  onSubmit(): void;
  onSwitchMode(mode: WeaveMode): void;
}

/** The prompt stage: mode tabs over a glass card with the strategy's icon, its prompt, and build progress. */
const PromptStage: React.FC<Props> = props => {
  const { mode, busy, building, phase, field, query, years, span, error, existing, sync, medallionRef, formRef, buildRef,
    onQuery, onYears, onClearError, onSubmit, onSwitchMode } = props;
  const s = strategyOf(mode);
  const isSpan = mode === 'time-span';
  const tabs = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placedOnce = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement | null>(null);

  // a pill slides under the active tab
  useLayoutEffect(() => {
    const place = (animated: boolean) => {
      const on = tabs.current?.querySelector<HTMLElement>('.lx-tab[aria-pressed="true"]');
      const p = pill.current;
      if (!on || !p) return;
      if (!animated) p.style.transition = 'none';
      p.style.width = `${on.offsetWidth}px`; p.style.transform = `translateX(${on.offsetLeft}px)`;
      if (!animated) { void p.offsetWidth; p.style.transition = ''; }
    };
    place(placedOnce.current);
    placedOnce.current = true;
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode]);

  // the textarea grows with its text
  useLayoutEffect(() => {
    const ta = textarea.current;
    if (!ta) return;
    // an empty field keeps its one row (a long placeholder is clipped, not grown into)
    ta.style.height = 'auto';
    if (query) ta.style.height = `${ta.scrollHeight}px`;
  }, [query, mode]);

  // marquee speed: a constant ~38px/s whatever the list length
  useEffect(() => {
    const t = track.current;
    if (t) t.style.setProperty('--dur', `${Math.max(18, t.scrollWidth / 2 / 38)}s`);
  }, [mode]);

  const pulseAt = (el: Element) => { const r = el.getBoundingClientRect(); field.current?.pulse(r.left + r.width / 2, r.top + r.height / 2); };

  const chooseExample = (example: string, chip: HTMLElement) => {
    if (busy) return;
    onQuery(example); onClearError();
    textarea.current?.focus({ preventScroll: true });
    pulseAt(chip);
    if (!isReducedMotion() && textarea.current) animate(textarea.current, { opacity: [0.2, 1], y: [8, 0] }, tween(0.5));
  };

  const setYear = (k: 'start' | 'end', value: string) => {
    onClearError();
    const v = parseYear(value);
    const next = { ...span };
    if (v != null && Number.isSafeInteger(v)) next[k === 'start' ? 's' : 'e'] = clamp(v, MIN_YEAR, MAX_YEAR);
    onYears({ ...years, [k]: value }, next);
  };
  const setSpan = (next: Span) => { onClearError(); onYears({ start: String(next.s), end: String(next.e) }, next); };

  // the end year closes the span, so 1450–1600 ends in the Renaissance, as the band and the canvas title read it
  const ys = parseYear(years.start), ye = parseYear(years.end);
  const lo = Math.min(span.s, span.e), hi = Math.max(span.s, span.e);
  const describedBy = error ? 'lx-help lx-input-error' : 'lx-help';
  const examples = (hidden: boolean) => s.examples.map(e => (
    <button key={e} type="button" className="lx-chip" tabIndex={hidden ? -1 : undefined} disabled={busy}
      onClick={ev => chooseExample(e, ev.currentTarget)}>{e}</button>
  ));

  return (
    <div className="lx-stage-inner">
      <div className="lx-tabs" role="group" aria-label="Exploration strategy" ref={tabs}>
        <span className="lx-tabs-pill" aria-hidden="true" ref={pill} />
        {STRATEGIES.map(x => (
          <button key={x.mode} type="button" className="lx-tab" data-mode={x.mode} aria-pressed={x.mode === mode} title={x.title}
            disabled={busy} onClick={() => onSwitchMode(x.mode)}>
            <Glyph mode={x.mode} className="lx-tab-icon" /><span>{x.title}</span>
          </button>
        ))}
      </div>
      <div className="lx-stage-card" key={mode}>
        <div className="lx-stage-head">
          <div className="lx-medallion" ref={medallionRef}><GlyphStack mode={mode} traced /></div>
          <div className="lx-stage-text lx-reveal">
            <div className="lx-stage-titlerow" style={{ '--d': 0 } as React.CSSProperties}>
              <h2 className="lx-stage-title" id="lx-stage-title">{s.title}</h2><span className="lx-pill lx-stage-kicker">{s.badge}</span>
            </div>
            <p className="lx-stage-desc" style={{ '--d': 1 } as React.CSSProperties}>{s.description}</p>
          </div>
        </div>
        <div className="lx-reveal" style={{ display: 'contents' }}>
          <form className="lx-form" noValidate style={{ '--d': 3 } as React.CSSProperties} hidden={building}
            ref={el => { form.current = el; if (typeof formRef === 'function') formRef(el); else if (formRef) (formRef as React.MutableRefObject<HTMLFormElement | null>).current = el; }}
            onSubmit={e => { e.preventDefault(); onSubmit(); }}>
            {isSpan ? <>
              <p className="lx-field-label" id="lx-ylabel">{s.inputLabel}</p>
              <div className="lx-span-years" role="group" aria-labelledby="lx-ylabel">
                <label className="lx-yf">
                  <input id="lx-start" className="lx-yin" inputMode="numeric" autoComplete="off" spellCheck={false} aria-label="Start year"
                    aria-describedby={describedBy} aria-invalid={error ? true : undefined} disabled={busy}
                    value={years.start} onChange={e => setYear('start', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); form.current?.requestSubmit(); } }} />
                  <em className="lx-yera">{ys == null ? '—' : eraOf(ys)}</em>
                </label>
                <span className="lx-yto" aria-hidden="true">{ARROW}</span>
                <label className="lx-yf">
                  <input id="lx-end" className="lx-yin" inputMode="numeric" autoComplete="off" spellCheck={false} aria-label="End year"
                    aria-describedby={describedBy} aria-invalid={error ? true : undefined} disabled={busy}
                    value={years.end} onChange={e => setYear('end', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); form.current?.requestSubmit(); } }} />
                  <em className="lx-yera">{ye == null ? '—' : eraOf(ys != null && ye > ys ? ye - 1 : ye)}</em>
                </label>
                <div className="lx-presets" role="group" aria-labelledby="lx-presets-k">
                  <span className="lx-presets-k" id="lx-presets-k">Quick picks</span>
                  <div className="lx-presets-list">
                    {PRESETS.map(([name, a, b]) => (
                      <button key={name} type="button" className="lx-chip lx-preset" aria-pressed={a === lo && b === hi} disabled={busy}
                        title={`${formatLauncherYear(a)} – ${formatLauncherYear(b)}`}
                        onClick={e => { setSpan({ s: a, e: b }); pulseAt(e.currentTarget); }}>{name}</button>
                    ))}
                  </div>
                </div>
                <p className="lx-ylen" aria-live="polite"><b>{ys != null && ye != null && ye > ys ? (ye - ys).toLocaleString('en-US') : '—'}</b> <span>years</span></p>
              </div>
              <EraBand span={span} disabled={busy} field={field} onChange={setSpan} sync={sync} />
            </> : <>
              <label className="lx-field-label" htmlFor="lx-query">{s.inputLabel}</label>
              <div className="lx-input-wrap">
                <textarea id="lx-query" className="lx-input" rows={1} placeholder={s.placeholder} ref={textarea}
                  aria-describedby={describedBy} aria-invalid={error ? true : undefined} disabled={busy}
                  value={query} onChange={e => { onQuery(e.target.value); onClearError(); }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.current?.requestSubmit(); } }} />
                <span className="lx-underline" />
              </div>
              <div className="lx-chips" role="group" aria-label="Examples">
                <div className="lx-chips-track" ref={track}>
                  {examples(false)}
                  <span aria-hidden="true" style={{ display: 'contents' }}>{examples(true)}</span>
                </div>
              </div>
            </>}
            {error && <div key={error} className="lx-error" id="lx-input-error" role="alert">{error}</div>}
            {existing && (
              <div className="lx-exists" role="status">
                <span>You already have a canvas for <b>{formatLauncherYear(existing.start)} – {formatLauncherYear(existing.end)}</b> · {eraSpan(existing.start, existing.end)}.</span>
                <button type="button" className="lx-btn lx-exists-open" onClick={existing.open}>Open it</button>
              </div>
            )}
            <div className="lx-form-foot">
              <p className="lx-help" id="lx-help">
                {isSpan ? 'Drag the window or its edges, click an era, or type the years. Negative numbers are BCE (−500 is 500 BCE).'
                  : <><kbd>Enter</kbd> to weave · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line · <kbd>Esc</kbd> to go back</>}
              </p>
              <button className="lx-btn lx-weave" type="submit" disabled={busy} aria-busy={building || undefined}>{WEAVE_ICON}<span>Weave</span></button>
            </div>
          </form>
          <BuildProgress phases={buildPhasesFor(mode)} phase={phase} hidden={!building} ref={buildRef} />
        </div>
      </div>
    </div>
  );
};

export default PromptStage;
