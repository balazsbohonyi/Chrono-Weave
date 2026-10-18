import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { WeaveMode, WeaveRequest, WeaveValidationResult } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useModalFocus } from '../hooks/useModalFocus';
import { validateWeaveRequestLocally } from '../utils/weave';
import { EmptyCanvasError, getUserErrorMessage } from '../utils/userErrors';
import { glyphStackHTML } from './launcher/glyphs';
import LauncherHero, { type HeroHandle } from './launcher/LauncherHero';
import { animate, isReducedMotion, spring, stagger, tween, wait } from './launcher/motion';
import PaperGround from './launcher/PaperGround';
import PromptStage, { type Years } from './launcher/PromptStage';
import StrategyGrid, { type MorphRect, type StrategyGridHandle } from './launcher/StrategyGrid';
import { buildPhasesFor, clamp, formatLauncherYear, MAX_YEAR, MIN_YEAR } from './launcher/strategies';
import type { Span } from './launcher/EraBand';
import SurpriseCard, { type SurpriseState } from './launcher/SurpriseCard';
import { ThreadField } from './launcher/ThreadField';
import Tooltip from './Tooltip';
import './launcher/launcher.css';

interface WeaveLauncherOverlayProps {
  historyControl?: React.ReactNode;
  onClose: () => void;
  onSubmit: (request: WeaveRequest) => Promise<void>;
  onSurprise: (excludedTopics: string[], broadenTopic?: string) => Promise<WeaveValidationResult>;
  initialStartYear: number;
  initialEndYear: number;
  phase?: 'idle' | 'validating' | 'building' | 'verifying';
  onOpenSettings: () => void;
  /** Returns how to open an existing canvas woven as this strict time span, or null when there is none. */
  findTimeSpanCanvas?: (start: number, end: number) => (() => void) | null;
}

const ICONS = {
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-9" /><path d="M14 17H4" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 18 18 6M6 6l12 12" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" /></svg>,
  die: <svg className="lx-die" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5" strokeWidth={1.8} /><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" /></svg>,
  mark: <svg className="lx-brand-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true"><path d="M2 11c6 0 8 10 14 10s8-10 14-10" /><path d="M2 21c6 0 8-10 14-10s8 10 14 10" opacity=".55" /><circle cx="16" cy="16" r="2.2" fill="currentColor" stroke="none" /></svg>,
};

const ROLL_ERROR = 'We could not find a historical topic this time. Please roll again.';
const BUILD_ERROR = 'We could not create your canvas. Please try again.';

type Pending = { kind: 'select'; mode: WeaveMode; from: MorphRect } | { kind: 'back'; mode: WeaveMode; from: DOMRect } | { kind: 'switch' };
interface Consult { settled: boolean; done: Promise<void>; finish: () => void }

const spanOf = (start: number, end: number): Span => ({ s: clamp(start, MIN_YEAR, MAX_YEAR), e: clamp(end, MIN_YEAR, MAX_YEAR) });

const WeaveLauncherOverlay: React.FC<WeaveLauncherOverlayProps> = ({
  historyControl, onClose, onSubmit, onSurprise, initialStartYear, initialEndYear, phase = 'idle', onOpenSettings, findTimeSpanCanvas,
}) => {
  const { theme, toggleTheme } = useTheme();
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  // views: the strategy grid ('launcher') and the prompt stage
  const [view, setView] = useState<'launcher' | 'stage'>('launcher');
  const [mode, setMode] = useState<WeaveMode | null>(null);
  const [launcherHidden, setLauncherHidden] = useState(false);
  const [launcherInert, setLauncherInert] = useState(false);
  const [stageHidden, setStageHidden] = useState(true);
  const [sync, setSync] = useState(0);

  // the prompt
  const [query, setQuery] = useState('');
  const [years, setYears] = useState<Years>({ start: String(initialStartYear), end: String(initialEndYear) });
  const [span, setSpan] = useState<Span>(() => spanOf(initialStartYear, initialEndYear));
  const [inputError, setInputError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ start: number; end: number; open: () => void } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [buildShown, setBuildShown] = useState(false);

  // Surprise Me
  const [surpriseState, setSurpriseState] = useState<SurpriseState>('idle');
  const [surpriseResult, setSurpriseResult] = useState<WeaveValidationResult | null>(null);
  const [surpriseError, setSurpriseError] = useState<string | null>(null);
  const [surpriseNotice, setSurpriseNotice] = useState<string | null>(null);
  const [scrimOpen, setScrimOpen] = useState(false);
  const excludedTopics = useRef<string[]>([]);
  const surpriseRequest = useRef(0);
  const consult = useRef<Consult | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const field = useRef<ThreadField | null>(null);
  const hero = useRef<HeroHandle>(null);
  const grid = useRef<StrategyGridHandle>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const medallionRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const stageBuildRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  const suggestionRef = useRef<HTMLHeadingElement>(null);
  const weaveRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const surpriseBuildRef = useRef<HTMLDivElement>(null);
  const surpriseTrigger = useRef<HTMLButtonElement>(null);
  const parallax = useRef(true);
  const pending = useRef<Pending | null>(null);
  const morphing = useRef(false);
  const ghosts = useRef(new Set<HTMLElement>());
  const isMounted = useRef(true);
  const operation = useRef(false);
  const buildContext = useRef<'stage' | 'surprise'>('stage');
  const submitting = useRef(false);
  const fade = useRef<{ stop(): void } | null>(null);
  const collapsing = useRef(false);

  const isBuildInProgress = isSubmitting || phase !== 'idle';
  const isBusy = isBuildInProgress || surpriseState === 'consulting';

  useEffect(() => {
    setYears({ start: String(initialStartYear), end: String(initialEndYear) });
    setSpan(spanOf(initialStartYear, initialEndYear));
  }, [initialStartYear, initialEndYear]);

  /* ---------- the thread field and the intro ---------- */
  useLayoutEffect(() => {
    isMounted.current = true;
    const f = new ThreadField(canvasRef.current!, dialogRef.current!);
    field.current = f;
    f.playIntro();
    const panes = grid.current?.panes() ?? [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    if (!isReducedMotion()) {
      const h = hero.current!;
      const words = h.words();
      const others = [h.root?.querySelector('.lx-eyebrow'), h.root?.querySelector('.lx-sub')].filter((e): e is HTMLElement => !!e);
      const dock = dockRef.current!;
      [...words, ...others, dock, ...panes].forEach(el => { el.style.opacity = '0'; });
      const raf = requestAnimationFrame(() => {
        animate(others[0], { opacity: [0, 1], y: [10, 0] }, tween(0.8, { delay: 0.1 }));
        animate(words, { opacity: [0, 1], y: [34, 0], filter: ['blur(10px)', 'blur(0px)'] }, tween(1.1, { delay: stagger(0.07, { startDelay: 0.2 }) }));
        animate(others[1], { opacity: [0, 1], y: [10, 0] }, tween(0.9, { delay: 0.55 }));
        animate(dock, { opacity: [0, 1], y: [16, 0] }, tween(0.9, { delay: 1.1 }));
        timers.push(setTimeout(() => grid.current?.intro(), 380));
      });
      timers.push(raf as unknown as ReturnType<typeof setTimeout>);
    }
    return () => {
      isMounted.current = false;
      timers.forEach(t => { clearTimeout(t); cancelAnimationFrame(t as unknown as number); });
      ghosts.current.forEach(g => g.remove());
      f.destroy();
      field.current = null;
    };
  }, []);

  useEffect(() => { field.current?.refreshColors(); }, [theme]);

  useEffect(() => { parallax.current = view === 'launcher' && !scrimOpen; }, [view, scrimOpen]);

  /* ---------- launcher ⇄ stage morph ---------- */
  const makeGhost = (m: WeaveMode, rect: DOMRect, radius: string) => {
    const g = document.createElement('div');
    g.className = 'lx-ghost';
    Object.assign(g.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: radius });
    g.innerHTML = glyphStackHTML(m, true);
    dialogRef.current!.append(g);
    ghosts.current.add(g);
    return g;
  };
  const dropGhost = (g: HTMLElement) => { g.remove(); ghosts.current.delete(g); };
  const reveals = () => [...(stageRef.current?.querySelectorAll<HTMLElement>('.lx-reveal') ?? [])];

  const afterStageIn = () => {
    stageRef.current?.querySelector<HTMLElement>('.lx-input, .lx-yin')?.focus({ preventScroll: true });
    setSync(n => n + 1);
  };

  const select = (m: WeaveMode) => {
    if (view !== 'launcher' || isBusy || morphing.current || scrimOpen) return;
    morphing.current = true;
    const from = grid.current!.leave(m);
    field.current?.pulse(from.rect.left + from.rect.width / 2, from.rect.top + from.rect.height / 2);
    const h = hero.current?.root;
    if (h) animate(h, { opacity: 0, y: -24, filter: 'blur(8px)' }, tween(0.5));
    if (dockRef.current) animate(dockRef.current, { opacity: 0, y: 20 }, tween(0.4));
    pending.current = { kind: 'select', mode: m, from };
    setQuery('');
    setInputError(null);
    setMode(m);
    setView('stage');
    setLauncherInert(true);
    setStageHidden(false);
  };

  const back = () => {
    if (view !== 'stage' || isBusy || morphing.current || !mode) return;
    morphing.current = true;
    field.current?.setHighlight(null);
    const from = medallionRef.current!.getBoundingClientRect();
    reveals().forEach(el => el.classList.remove('is-in'));
    stageRef.current?.classList.remove('is-in');
    pending.current = { kind: 'back', mode, from };
    setInputError(null);
    setExisting(null);
    setView('launcher');
    setLauncherHidden(false);
  };

  const switchMode = (next: WeaveMode) => {
    if (view !== 'stage' || isBusy || morphing.current || next === mode) return;
    field.current?.setHighlight(null);
    pending.current = { kind: 'switch' };
    setInputError(null);
    setExisting(null);
    setMode(next);
  };

  // Runs a morph once React has committed the views it needs to measure.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const stage = stageRef.current!;
    const medallion = medallionRef.current!;
    const f = field.current;

    if (p.kind === 'switch') {
      void stage.offsetWidth;
      reveals().forEach(el => el.classList.add('is-in'));
      if (!isReducedMotion()) animate(medallion, { opacity: [0, 1], scale: [0.8, 1] }, spring({ stiffness: 220, damping: 20 }));
      f?.converge(medallion.getBoundingClientRect());
      requestAnimationFrame(afterStageIn);
      return;
    }

    if (p.kind === 'select') {
      const target = medallion.getBoundingClientRect();
      f?.converge(target);
      if (isReducedMotion()) {
        setLauncherHidden(true);
        stage.classList.add('is-in');
        reveals().forEach(el => el.classList.add('is-in'));
        morphing.current = false;
        afterStageIn();
        return;
      }
      medallion.style.opacity = '0';
      const ghost = makeGhost(p.mode, p.from.rect, p.from.radius);
      requestAnimationFrame(() => { ghost.classList.add('is-iconic'); stage.classList.add('is-in'); });
      animate(ghost, {
        left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, borderRadius: '50%',
      }, spring({ stiffness: 120, damping: 19 })).then(() => {
        dropGhost(ghost);
        if (!isMounted.current) return;
        medallion.style.opacity = '1';
        setLauncherHidden(true);
        reveals().forEach(el => el.classList.add('is-in'));
        morphing.current = false;
        afterStageIn();
      });
      return;
    }

    // back to the grid: the ghost flies from the stage icon to the card where it rests
    const g = grid.current!;
    const { rect, radius } = g.rectOf(p.mode);
    f?.release();
    const h = hero.current?.root;
    if (h) animate(h, { opacity: 1, y: 0, filter: 'blur(0px)' }, tween(0.7, { delay: 0.15 }));
    if (dockRef.current) animate(dockRef.current, { opacity: 1, y: 0 }, tween(0.6, { delay: 0.25 }));
    const finish = () => {
      g.reveal(p.mode);
      // the grid must leave inert before its card can take focus
      flushSync(() => { setStageHidden(true); setLauncherInert(false); });
      morphing.current = false;
      g.focus(p.mode);
    };
    if (isReducedMotion()) { g.enter(p.mode); queueMicrotask(finish); return; }
    const ghost = makeGhost(p.mode, p.from, '50%');
    ghost.classList.add('is-iconic');
    void ghost.offsetWidth;
    requestAnimationFrame(() => ghost.classList.remove('is-iconic'));
    medallion.style.opacity = '0';
    g.enter(p.mode);
    wait(120).then(() => animate(ghost, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: radius,
    }, spring({ stiffness: 140, damping: 21 }))).then(() => {
      dropGhost(ghost);
      if (isMounted.current) finish();
    });
  });

  /* ---------- build progress: the form makes way, and the threads tighten into a timeline ---------- */
  const startBuild = async (context: 'stage' | 'surprise') => {
    buildContext.current = context;
    submitting.current = true;
    const out = context === 'stage' ? formRef.current : actionsRef.current;
    if (out && !isReducedMotion()) {
      const controls = animate(out, { opacity: 0, y: 12, filter: 'blur(6px)' }, tween(0.35));
      fade.current = controls;
      await controls;
    }
    if (submitting.current && isMounted.current) setBuildShown(true);
  };
  const endBuild = () => {
    submitting.current = false;
    setBuildShown(false);
    field.current?.setTimeline(false);
    fade.current?.stop();
    fade.current = null;
    // motion commits its last frame a frame late, so clear once now and once after it
    const clear = () => {
      for (const el of [formRef.current, actionsRef.current, stageBuildRef.current, surpriseBuildRef.current]) {
        if (el) { el.style.opacity = ''; el.style.transform = ''; el.style.filter = ''; }
      }
    };
    clear();
    requestAnimationFrame(clear);
  };

  useLayoutEffect(() => {
    if (!buildShown) return;
    const build = buildContext.current === 'stage' ? stageBuildRef.current : surpriseBuildRef.current;
    if (!build) return;
    if (!isReducedMotion()) animate(build, { opacity: [0, 1], y: [10, 0] }, tween(0.5));
    const steps = build.querySelector('.lx-steps')!.getBoundingClientRect();
    const f = field.current;
    f?.release();
    f?.setHighlight(null);
    f?.setTimeline(true, steps.top - 44);
  }, [buildShown]);

  useEffect(() => {
    if (!buildShown) return;
    const phases = buildPhasesFor(buildContext.current === 'stage' && mode ? mode : 'freeform');
    const i = phase === 'idle' ? -1 : phases.indexOf(phase);
    field.current?.setTimelineProgress(i < 0 ? 0.06 : (i + 0.85) / phases.length * 0.92);
  }, [buildShown, phase, mode]);

  const runSubmit = async (request: WeaveRequest) => {
    try {
      operation.current = true;
      setIsSubmitting(true);
      void startBuild('stage');
      await onSubmit(request);
    } catch (err: unknown) {
      if (isMounted.current) {
        endBuild();
        setInputError(getUserErrorMessage(err, BUILD_ERROR));
      }
    } finally {
      operation.current = false;
      if (isMounted.current) setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!mode || isBusy || operation.current) return;
    setInputError(null);
    setExisting(null);
    if (mode === 'time-span') {
      const INT = /^-?\d+$/;
      const start = years.start.trim().replace(/[−–]/g, '-');
      const end = years.end.trim().replace(/[−–]/g, '-');
      if (!start || !end) return setInputError('Please specify both a start year and an end year.');
      if (!INT.test(start) || !INT.test(end)) return setInputError('Years must be valid whole numbers (e.g. -500, 1400, 1945).');
      const s = Number(start), e = Number(end);
      if (!Number.isSafeInteger(s) || !Number.isSafeInteger(e)) return setInputError('These years are too large. Please enter a smaller historical year range.');
      if (s >= e) return setInputError('The start year must come before the end year.');
      const request: WeaveRequest = { mode: 'time-span', query: `${s} to ${e}`, startYear: s, endYear: e };
      const rejection = validateWeaveRequestLocally(request);
      if (rejection) return setInputError(rejection.errorMessage);
      const open = findTimeSpanCanvas?.(s, e);
      if (open) return setExisting({ start: s, end: e, open });
      void runSubmit(request);
    } else {
      const trimmed = query.trim();
      if (!trimmed) return setInputError('Please enter a query or choose an example.');
      void runSubmit({ mode, query: trimmed });
    }
  };

  /* ---------- Surprise Me ---------- */
  // Glass panes dim themselves, never through their wrapper: an opacity or filter on the wrapper flattens the glass
  // while it fades. Opacity on the pane keeps it frosted; the blur goes on its contents.
  const dimTargets = () => {
    const panes = grid.current?.panes() ?? [];
    const soft = [hero.current?.root, dockRef.current].filter((e): e is HTMLDivElement => !!e);
    return { panes, contents: panes.flatMap(el => [...el.children] as HTMLElement[]), soft };
  };

  useLayoutEffect(() => {
    if (!scrimOpen) return;
    const { soft, panes, contents } = dimTargets();
    animate(soft, { opacity: 0.18, filter: 'blur(4px)' }, tween(0.5));
    if (panes.length) {
      animate(panes, { opacity: 0.18 }, tween(0.5));
      animate(contents, { filter: 'blur(4px)' }, tween(0.5));
    }
    if (!isReducedMotion() && cardRef.current) animate(cardRef.current, { opacity: [0, 1], scale: [0.94, 1], y: [16, 0] }, spring({ stiffness: 200, damping: 22 }));
  }, [scrimOpen]);

  // the ticker: year ranges flicker fast while the archives are consulted, then decelerate once they answer
  useEffect(() => {
    const c = consult.current;
    if (surpriseState !== 'consulting' || !c) return;
    const dur = isReducedMotion() ? 0 : 1700;
    const t0 = performance.now();
    let settledAt = 0, settledP = 0, timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const now = performance.now();
      let p = Math.min((now - t0) / (dur || 1), 0.6);
      if (c.settled) {
        if (!settledAt) { settledAt = now; settledP = dur ? Math.min((now - t0) / dur, 0.6) : 1; }
        p = settledP + (now - settledAt) / (dur || 1);
      }
      if (p >= 1) { c.finish(); return; }
      if (dur) {
        const snap = p > 0.7 ? 50 : 1;
        const a = Math.round((Math.random() * 4400 - 2500) / snap) * snap;
        const b = Math.min(2025, a + Math.round((20 + Math.random() * 230) / snap) * snap);
        const text = tickerRef.current?.firstChild;
        if (text) text.textContent = `${formatLauncherYear(a)} – ${formatLauncherYear(b)}`;
      }
      timer = setTimeout(step, dur ? 30 + p * p * 160 : 60);
    };
    step();
    return () => { clearTimeout(timer); c.finish(); };
  }, [surpriseState]);

  /** Asks for a topic while the ticker runs; resolves once both are done. Throws what onSurprise threw. */
  const consultArchives = async (broadenTopic?: string) => {
    let finish = () => {};
    const done = new Promise<void>(resolve => { finish = resolve; });
    const c: Consult = { settled: false, done, finish };
    consult.current = c;
    setSurpriseState('consulting');
    setScrimOpen(true);
    field.current?.release();
    field.current?.setSpeed(9);
    try {
      return await onSurprise(excludedTopics.current, broadenTopic);
    } finally {
      c.settled = true;
      await c.done;
      field.current?.setSpeed(1);
    }
  };

  const showSuggestion = (result: WeaveValidationResult, notice: string | null) => {
    excludedTopics.current = [...excludedTopics.current, result.themeDescription];
    setSurpriseResult(result);
    setSurpriseNotice(notice);
    setSurpriseState('suggested');
  };

  const roll = async () => {
    if (isBusy || operation.current) return;
    const request = ++surpriseRequest.current;
    operation.current = true;
    setSurpriseError(null);
    setSurpriseNotice(null);
    setSurpriseResult(null);
    try {
      const result = await consultArchives();
      if (!isMounted.current || request !== surpriseRequest.current) return;
      if (result.isValid && result.themeDescription) showSuggestion(result, null);
      else { setSurpriseError(ROLL_ERROR); setSurpriseState('error'); }
    } catch (err: unknown) {
      if (!isMounted.current || request !== surpriseRequest.current) return;
      setSurpriseError(getUserErrorMessage(err, ROLL_ERROR));
      setSurpriseState('error');
    } finally {
      if (request === surpriseRequest.current) operation.current = false;
    }
  };

  // a new suggestion rises in, and the threads gather around the card
  useLayoutEffect(() => {
    if (surpriseState !== 'suggested' || !surpriseResult) return;
    if (!isReducedMotion()) {
      if (suggestionRef.current) animate(suggestionRef.current, { opacity: [0, 1], y: [18, 0], filter: ['blur(8px)', 'blur(0px)'] }, tween(0.8));
      const meta = cardRef.current?.querySelectorAll('.lx-meta :is(.lx-pill, .lx-cat, .lx-range)');
      if (meta?.length) animate(meta, { opacity: [0, 1], y: [8, 0] }, tween(0.5, { delay: stagger(0.05) }));
    }
    if (cardRef.current) field.current?.converge(cardRef.current.getBoundingClientRect(), 0.55);
    weaveRef.current?.focus({ preventScroll: true });
  }, [surpriseState, surpriseResult]);

  const weaveSuggestion = async () => {
    const suggestion = surpriseResult;
    if (!suggestion?.isValid || isBusy || operation.current) return;
    const request = ++surpriseRequest.current;
    try {
      operation.current = true;
      setIsSubmitting(true);
      setSurpriseError(null);
      setSurpriseNotice(null);
      void startBuild('surprise');
      await onSubmit({ mode: 'freeform', query: suggestion.themeDescription });
    } catch (err: unknown) {
      if (!isMounted.current || request !== surpriseRequest.current) return;
      endBuild();
      if (err instanceof EmptyCanvasError) {
        // the topic came back empty: offer a broader one to review before weaving again
        setIsSubmitting(false);
        setSurpriseResult(null);
        try {
          const result = await consultArchives(suggestion.themeDescription);
          if (!isMounted.current || request !== surpriseRequest.current) return;
          if (!result.isValid || !result.themeDescription) throw new Error('No broader topic was suggested.');
          showSuggestion(result, 'The previous topic returned no people or events. Here is a broader related suggestion. Review it before weaving again.');
        } catch (recoveryError: unknown) {
          if (!isMounted.current || request !== surpriseRequest.current) return;
          setSurpriseState('error');
          setSurpriseError(getUserErrorMessage(recoveryError, 'That topic returned no people or events, and we could not find a broader suggestion. Try Spin Again.'));
        }
      } else {
        setSurpriseError(getUserErrorMessage(err, 'We could not create a canvas for this topic. Please try again.'));
      }
    } finally {
      if (isMounted.current && request === surpriseRequest.current) {
        operation.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const collapseSurprise = async () => {
    if (!scrimOpen || isBuildInProgress || collapsing.current) return;
    collapsing.current = true;
    ++surpriseRequest.current;
    operation.current = false;
    consult.current?.finish();
    field.current?.setSpeed(1);
    field.current?.release();
    const { soft, panes, contents } = dimTargets();
    // motion commits its final inline styles (and re-writes any earlier transform as "none") a frame
    // after the promise resolves; clear them so the items' CSS transforms and glass work again
    const restore = (els: HTMLElement[]) => () => requestAnimationFrame(() => {
      els.forEach(el => { el.style.filter = ''; el.style.opacity = ''; el.style.transform = ''; });
    });
    if (panes.length) {
      animate(panes, { opacity: 1 }, tween(0.5)).then(restore(panes));
      animate(contents, { filter: 'blur(0px)' }, tween(0.5)).then(restore(contents));
    }
    animate(soft, { opacity: 1, filter: 'blur(0px)' }, tween(0.5)).then(restore(soft));
    const card = cardRef.current;
    if (card) await animate(card, { opacity: 0, scale: 0.96 }, tween(0.25));
    collapsing.current = false;
    if (!isMounted.current) return;
    if (card) { card.style.opacity = ''; card.style.transform = ''; }
    // the grid leaves inert before the Surprise button takes focus back
    flushSync(() => {
      setSurpriseState('idle');
      setSurpriseResult(null);
      setSurpriseError(null);
      setSurpriseNotice(null);
      setScrimOpen(false);
    });
    surpriseTrigger.current?.focus({ preventScroll: true });
  };

  /* ---------- Escape: Surprise card, then a build (cancels it), then the stage, then the launcher ---------- */
  const latest = useRef({ collapse: collapseSurprise, back, onClose, surpriseState, isBuildInProgress, isBusy, view });
  latest.current = { collapse: collapseSurprise, back, onClose, surpriseState, isBuildInProgress, isBusy, view };
  const handleModalClose = useCallback(() => {
    const l = latest.current;
    if (!l.isBuildInProgress && l.surpriseState !== 'idle') l.collapse();
    else if (l.isBusy) l.onClose();
    else if (l.view === 'stage') l.back();
    else l.onClose();
  }, []);
  useModalFocus(dialogRef, true, handleModalClose, undefined, 'container');

  const building = buildShown && isBuildInProgress;
  const stageBuilding = building && buildContext.current === 'stage';
  const surpriseBuilding = building && buildContext.current === 'surprise';

  return (
    <div className="lx-root" role="dialog" aria-modal="true" aria-labelledby="lx-heading" ref={dialogRef} tabIndex={-1}>
      <PaperGround />
      <canvas className="lx-field" aria-hidden="true" ref={canvasRef} />
      <header className="lx-header" data-canvas-controls>
        <div className="lx-brand">{ICONS.mark}<div><h2 id="lx-heading">Weave New Canvas</h2><p>Choose your historical exploration strategy</p></div></div>
        <div className="lx-header-actions">
          {historyControl && <div className="lx-hist">{historyControl}</div>}
          <Tooltip text={themeLabel} placement="bottom">
            <button className="lx-icon-btn" type="button" onClick={toggleTheme} aria-label={themeLabel}>{theme === 'dark' ? ICONS.sun : ICONS.moon}</button>
          </Tooltip>
          <Tooltip text="Settings" placement="bottom">
            <button className="lx-icon-btn" type="button" onClick={onOpenSettings} disabled={isBuildInProgress} aria-label="Settings">{ICONS.settings}</button>
          </Tooltip>
          <Tooltip text="Close (Esc)" placement="bottom">
            <button className="lx-icon-btn" type="button" onClick={onClose} aria-label="Close launcher">{ICONS.close}</button>
          </Tooltip>
        </div>
      </header>
      <main className="lx-main">
        <section className="lx-view lx-launcher" aria-label="Choose how to explore" hidden={launcherHidden} inert={launcherInert || scrimOpen || undefined}>
          <LauncherHero ref={hero} />
          <div className="lx-launcher-body">
            <StrategyGrid ref={grid} field={field} disabled={isBusy} parallax={parallax}
              onHover={m => (m ? hero.current?.hold(m) : hero.current?.release())} onSelect={select} />
          </div>
          <div className="lx-surprise-dock" ref={dockRef}>
            <button className="lx-surprise-btn" type="button" ref={surpriseTrigger} disabled={isBusy} onClick={roll}>{ICONS.die}<span>Surprise me</span></button>
            <span className="lx-surprise-hint">An unexpected chapter of history</span>
          </div>
        </section>
        <section className="lx-view lx-stage" hidden={stageHidden} aria-labelledby="lx-stage-title" ref={stageRef}>
          <button className="lx-back" type="button" disabled={isBusy} onClick={back} title="Back to the strategies (Esc)">{ICONS.back}<span>Back</span></button>
          {mode && <PromptStage mode={mode} busy={isBusy} building={stageBuilding} phase={phase} field={field}
            query={query} years={years} span={span} error={inputError} sync={sync}
            medallionRef={medallionRef} formRef={formRef} buildRef={stageBuildRef}
            existing={existing}
            onQuery={setQuery} onYears={(y, s) => { setYears(y); setSpan(s); setExisting(null); }} onClearError={() => setInputError(null)}
            onSubmit={handleSubmit} onSwitchMode={switchMode} />}
        </section>
        <div className="lx-scrim" hidden={!scrimOpen}>
          <div className="lx-card" role="region" aria-label="Surprise Me" ref={cardRef}>
            {surpriseState !== 'idle' && <SurpriseCard state={surpriseState} result={surpriseResult} error={surpriseError} notice={surpriseNotice}
              building={surpriseBuilding} phase={phase} busy={isBusy}
              tickerRef={tickerRef} suggestionRef={suggestionRef} weaveRef={weaveRef} actionsRef={actionsRef} buildRef={surpriseBuildRef}
              onClose={collapseSurprise} onSpin={roll} onWeave={weaveSuggestion} />}
          </div>
        </div>
      </main>
      <div className="sr-only" role="status" aria-live="polite">{surpriseState === 'consulting' ? 'Consulting the archives...' : ''}</div>
    </div>
  );
};

export default WeaveLauncherOverlay;
