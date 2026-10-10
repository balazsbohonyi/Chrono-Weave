import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { WeaveMode, WeaveRequest, WeaveValidationResult } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useModalFocus } from '../hooks/useModalFocus';
import { formatYear } from '../utils/formatters';
import { validateWeaveRequestLocally } from '../utils/weave';
import { getUserErrorMessage } from '../utils/userErrors';
import LauncherExampleScroller from './LauncherExampleScroller';
import LauncherAnimatedIllustration from './LauncherAnimatedIllustration';

interface WeaveLauncherOverlayProps {
  historyControl?: React.ReactNode;
  onClose: () => void;
  onSubmit: (request: WeaveRequest) => Promise<void>;
  onSurprise: (excludedTopics: string[]) => Promise<WeaveValidationResult>;
  initialStartYear: number;
  initialEndYear: number;
  phase?: 'idle' | 'validating' | 'building' | 'verifying';
  onOpenSettings: () => void;
}

interface StrategyConfig {
  mode: WeaveMode;
  title: string;
  badge: string;
  illustration: string;
  illustrationHeight?: number;
  description: string;
  placeholder: string;
  inputLabel: string;
  examples: string[];
}

const STRATEGIES: StrategyConfig[] = [
  {
    mode: 'time-span',
    title: 'Strict Time Span',
    badge: 'Chronological Window',
    illustration: '1-chronological-window.jpg',
    description: 'Explore a specific century or span of years.',
    placeholder: 'e.g. 1400 to 1500',
    inputLabel: 'Specify Start and End Years',
    examples: []
  },
  {
    mode: 'era',
    title: 'Historical Era',
    badge: 'Epoch & Civilization',
    illustration: '2-epoch-civilization.jpg',
    description: 'Dive into a historical period, civilization, or dynasty.',
    placeholder: 'e.g. Golden Age of Piracy, Meiji Restoration, Weimar Republic',
    inputLabel: 'Era or Period Name',
    examples: [
      'Golden Age of Piracy', 'Meiji Restoration', 'Weimar Republic', 'Hellenistic Period',
      'Italian Renaissance', 'Islamic Golden Age', 'Tokugawa Period', 'Byzantine Empire'
    ]
  },
  {
    mode: 'figure',
    title: 'Follow a Figure',
    badge: 'Biography & World',
    illustration: '3-biography-history.jpg',
    description: 'Explore a person’s life and the people around them.',
    placeholder: 'e.g. Leonardo da Vinci, Cleopatra VII, Ada Lovelace',
    inputLabel: 'Historical Figure Name',
    examples: [
      'Leonardo da Vinci', 'Cleopatra VII', 'Ada Lovelace', 'Ibn Battuta',
      'Marie Curie', 'Mansa Musa', 'Zheng He', 'Hypatia'
    ]
  },
  {
    mode: 'region',
    title: 'Region & Culture',
    badge: 'Geographic History',
    illustration: '4-geographic-history.jpg',
    description: 'Focus on a region, civilization, or culture.',
    placeholder: 'e.g. Song Dynasty China, Mughal Empire, Viking Age Scandinavia',
    inputLabel: 'Region, Empire, or Culture',
    examples: [
      'Song Dynasty China', 'Mesoamerica before Spanish conquest', 'Mughal Empire', 'Viking Age Scandinavia',
      'Ancient Egypt', 'Kingdom of Kush', 'Inca Empire', 'Safavid Persia'
    ]
  },
  {
    mode: 'theme',
    title: 'Theme or Discipline',
    badge: 'Ideas & Disciplines',
    illustration: '5-ideas-discipline.jpg',
    description: 'Trace the history of a field, discipline, or idea.',
    placeholder: 'e.g. Early History of Computing, Astronomy in the Islamic Golden Age',
    inputLabel: 'Theme, Movement, or Idea',
    examples: [
      'Early History of Computing', 'Astronomy in the Islamic Golden Age', 'Impressionism & Post-Impressionism', 'Development of Modern Surgery',
      'History of Aviation', 'Silk Road Trade', 'History of Printing', 'Origins of Democracy'
    ]
  },
  {
    mode: 'freeform',
    title: 'Freeform / Custom',
    badge: 'Custom Synthesis',
    illustration: '6-custom-synthesis.jpg',
    illustrationHeight: 1024,
    description: 'Combine periods, places, people, and ideas in your own prompt.',
    placeholder: 'e.g. Women pioneers in medicine before 1900, Space Race architects',
    inputLabel: 'Describe your historical canvas query',
    examples: [
      'Women pioneers in medicine before 1900',
      'Philosophers in Athens during the Peloponnesian War',
      'Key inventors of the Industrial Revolution',
      'Navigators of the Age of Exploration',
      'Women mathematicians in the 19th century',
      'Architects and patrons of Renaissance Florence',
      'Scholars and translators in medieval Baghdad',
      'Artists and writers of the Harlem Renaissance'
    ]
  }
];

const WeaveLauncherOverlay: React.FC<WeaveLauncherOverlayProps> = ({
  historyControl,
  onClose,
  onSubmit,
  onSurprise,
  initialStartYear,
  initialEndYear,
  phase = 'idle',
  onOpenSettings
}) => {
  const { theme, toggleTheme } = useTheme();
  const themeLabel = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

  // Strategy Card State
  const [focusedMode, setFocusedMode] = useState<WeaveMode | null>(null);
  const [startYearStr, setStartYearStr] = useState<string>(initialStartYear.toString());
  const [endYearStr, setEndYearStr] = useState<string>(initialEndYear.toString());
  const [queryInput, setQueryInput] = useState<string>('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Surprise State
  const [surpriseState, setSurpriseState] = useState<'idle' | 'consulting' | 'suggested' | 'error'>('idle');
  const [surpriseResult, setSurpriseResult] = useState<WeaveValidationResult | null>(null);
  const [surpriseError, setSurpriseError] = useState<string | null>(null);
  const [excludedTopics, setExcludedTopics] = useState<string[]>([]);
  const surpriseRequestRef = useRef(0);
  const surpriseTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreSurpriseFocusRef = useRef(false);

  // Refs for form focus and restoring the selected card.
  const dialogRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef<boolean>(true);
  const cardTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const startInputRef = useRef<HTMLInputElement>(null);
  const queryInputRef = useRef<HTMLTextAreaElement>(null);

  const lastFocusedModeRef = useRef<WeaveMode | null>(null);
  const operationRef = useRef(false);

  // Track mount lifecycle
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync initial years if changed externally
  useEffect(() => {
    setStartYearStr(initialStartYear.toString());
    setEndYearStr(initialEndYear.toString());
  }, [initialStartYear, initialEndYear]);

  const isBusy = isSubmitting || phase !== 'idle' || surpriseState === 'consulting';
  const isBuildInProgress = isSubmitting || phase !== 'idle';
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const isBuildInProgressRef = useRef(isBuildInProgress);
  isBuildInProgressRef.current = isBuildInProgress;
  const surpriseStateRef = useRef(surpriseState);
  surpriseStateRef.current = surpriseState;

  // Stable callbacks for focus trap
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const focusedModeRef = useRef<WeaveMode | null>(focusedMode);
  focusedModeRef.current = focusedMode;

  const handleBackToGrid = useCallback(() => {
    if (isSubmitting || phase !== 'idle') return;
    const currentMode = focusedModeRef.current;
    if (!currentMode) return;

    setFocusedMode(null);
    setInputError(null);
  }, [isSubmitting, phase]);

  const handleBackRef = useRef<() => void>(handleBackToGrid);
  handleBackRef.current = handleBackToGrid;

  const handleCollapseSurprise = useCallback(() => {
    if (isSubmitting || phase !== 'idle') return;
    ++surpriseRequestRef.current;
    operationRef.current = false;
    restoreSurpriseFocusRef.current = true;
    setSurpriseState('idle');
    setSurpriseResult(null);
    setSurpriseError(null);
  }, [isSubmitting, phase]);
  const collapseSurpriseRef = useRef(handleCollapseSurprise);
  collapseSurpriseRef.current = handleCollapseSurprise;

  useLayoutEffect(() => {
    if (surpriseState === 'idle' && restoreSurpriseFocusRef.current) {
      restoreSurpriseFocusRef.current = false;
      surpriseTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [surpriseState]);

  // Stable escape callback passed to useModalFocus:
  // When inside a focused card, Escape returns to the grid.
  // At grid level, Escape collapses an open suggestion before closing the overlay.
  const handleModalClose = useCallback(() => {
    if (!isBuildInProgressRef.current && focusedModeRef.current === null && surpriseStateRef.current !== 'idle') {
      collapseSurpriseRef.current();
    } else if (isBusyRef.current) {
      onCloseRef.current();
    } else if (focusedModeRef.current !== null) {
      handleBackRef.current();
    } else {
      onCloseRef.current();
    }
  }, []);

  useModalFocus(dialogRef, true, handleModalClose);

  useLayoutEffect(() => {
    if (focusedMode === 'time-span') {
      startInputRef.current?.focus({ preventScroll: true });
    } else if (focusedMode) {
      queryInputRef.current?.focus({ preventScroll: true });
    } else if (lastFocusedModeRef.current) {
      cardTriggerRefs.current[lastFocusedModeRef.current]?.focus({ preventScroll: true });
    }
  }, [focusedMode]);

  const handleSelectStrategy = (mode: WeaveMode) => {
    if (isBusy) return;
    setInputError(null);
    lastFocusedModeRef.current = mode;
    setFocusedMode(mode);
  };

  const handleSelectExample = (example: string) => {
    if (isBusy) return;
    setQueryInput(example);
    setInputError(null);
    queryInputRef.current?.focus({ preventScroll: true });
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!focusedMode || isBusy || operationRef.current) return;

    setInputError(null);

    if (focusedMode === 'time-span') {
      const INT_REGEX = /^-?\d+$/;
      const trimmedStart = startYearStr.trim();
      const trimmedEnd = endYearStr.trim();

      if (!trimmedStart || !trimmedEnd) {
        setInputError('Please specify both a start year and an end year.');
        return;
      }

      if (!INT_REGEX.test(trimmedStart) || !INT_REGEX.test(trimmedEnd)) {
        setInputError('Years must be valid whole numbers (e.g. -500, 1400, 1945).');
        return;
      }

      const s = Number(trimmedStart);
      const e = Number(trimmedEnd);

      if (!Number.isSafeInteger(s) || !Number.isSafeInteger(e)) {
        setInputError('These years are too large. Please enter a smaller historical year range.');
        return;
      }

      if (s >= e) {
        setInputError('The start year must come before the end year.');
        return;
      }

      const request: WeaveRequest = {
        mode: 'time-span',
        query: `${s} to ${e}`,
        startYear: s,
        endYear: e
      };

      const rejection = validateWeaveRequestLocally(request);
      if (rejection) {
        setInputError(rejection.errorMessage);
        return;
      }

      try {
        operationRef.current = true;
        setIsSubmitting(true);
        await onSubmit(request);
      } catch (err: unknown) {
        if (isMountedRef.current) {
          setInputError(getUserErrorMessage(err, 'We could not create your canvas. Please try again.'));
        }
      } finally {
        operationRef.current = false;
        if (isMountedRef.current) setIsSubmitting(false);
      }
    } else {
      const trimmed = queryInput.trim();
      if (!trimmed) {
        setInputError('Please enter a query or choose an example.');
        return;
      }

      const request: WeaveRequest = {
        mode: focusedMode,
        query: trimmed
      };

      try {
        operationRef.current = true;
        setIsSubmitting(true);
        await onSubmit(request);
      } catch (err: unknown) {
        if (isMountedRef.current) {
          setInputError(getUserErrorMessage(err, 'We could not create your canvas. Please try again.'));
        }
      } finally {
        operationRef.current = false;
        if (isMountedRef.current) setIsSubmitting(false);
      }
    }
  };

  // Surprise roll handler
  const handleSurpriseRoll = async () => {
    if (isBusy || operationRef.current) return;
    const request = ++surpriseRequestRef.current;
    try {
      operationRef.current = true;
      setSurpriseState('consulting');
      setSurpriseError(null);
      const result = await onSurprise(excludedTopics);
      if (!isMountedRef.current || request !== surpriseRequestRef.current) return;

      if (result.isValid && result.themeDescription) {
        setSurpriseResult(result);
        setExcludedTopics(prev => [...prev, result.themeDescription]);
        setSurpriseState('suggested');
      } else {
        setSurpriseError('We could not find a historical topic this time. Please roll again.');
        setSurpriseState('error');
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || request !== surpriseRequestRef.current) return;
      setSurpriseError(getUserErrorMessage(err, 'We could not find a historical topic this time. Please roll again.'));
      setSurpriseState('error');
    } finally {
      if (request === surpriseRequestRef.current) operationRef.current = false;
    }
  };

  const handleBuildSurprise = async () => {
    if (!surpriseResult || !surpriseResult.isValid || isBusy || operationRef.current) return;
    try {
      operationRef.current = true;
      setIsSubmitting(true);
      setSurpriseError(null);
      await onSubmit({ mode: 'freeform', query: surpriseResult.themeDescription });
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setSurpriseError(getUserErrorMessage(err, 'We could not create a canvas for this topic. Please try again.'));
    } finally {
      operationRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const focusedStrategy = STRATEGIES.find(s => s.mode === focusedMode);
  const weaveButtonContent = (
    <>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" d="M4 7c4-4 12 4 16 0M4 12c4-4 12 4 16 0M4 17c4-4 12 4 16 0M7 4c-4 4 4 12 0 16M12 4c-4 4 4 12 0 16M17 4c-4 4 4 12 0 16" />
      </svg>
      <span>{isBuildInProgress ? 'Weaving...' : 'Weave'}</span>
    </>
  );
  const weaveButton = (
    <button
      type="submit"
      disabled={isBusy}
      aria-busy={isBuildInProgress}
      className="launcher-btn-primary launcher-weave-button"
    >
      {weaveButtonContent}
    </button>
  );
  const buildProgress = isBuildInProgress && (
    <div className="launcher-build-progress" role="status" aria-live="polite" aria-atomic="true" data-phase={phase}>
      <div className="launcher-build-progress-copy">
        <p className="launcher-build-progress-title">
          {phase === 'validating' ? 'Checking your historical query...'
            : phase === 'building' ? 'Building your timeline...'
            : phase === 'verifying' ? 'Checking historical connections...'
            : 'Preparing your timeline...'}
        </p>
        <p className="launcher-build-progress-description">
          {phase === 'validating' ? 'Confirming the subject, dates, and categories for your timeline.'
            : phase === 'building' ? 'Finding historical figures and events. Your timeline will open when it is ready.'
            : phase === 'verifying' ? 'Keeping figures with established connections to your focus figure.'
            : 'Getting your request ready.'}
        </p>
      </div>
      <span className="launcher-build-spinner" aria-hidden="true" />
    </div>
  );

  return (
    <div
      className="launcher-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="launcher-heading"
      ref={dialogRef}
      tabIndex={-1}
    >
      <div className="sr-only" role="status" aria-live="polite">
        {surpriseState === 'consulting' ? 'Consulting the archives...' : ''}
      </div>
      <div className="launcher-dialog">
        {/* Header with Theme, Settings, Close */}
        <header className="launcher-header" data-canvas-controls>
          <div className="flex items-center gap-3">
            <div>
              <h2 id="launcher-heading" className="text-base font-bold text-content-primary leading-tight">
                Weave New Canvas
              </h2>
              <p className="text-xs text-content-muted">Choose your historical exploration strategy</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 text-content-muted hover:text-content-heading hover:bg-interaction/5 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-marker focus-visible:outline-offset-2"
              aria-label={themeLabel}
              title={themeLabel}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                {theme === 'light' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                ) : (
                  <>
                    <circle cx="12" cy="12" r="4" />
                    <path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3l1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3l1.42-1.42" />
                  </>
                )}
              </svg>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              disabled={isBuildInProgress}
              className="p-2 text-content-muted enabled:hover:text-content-heading enabled:hover:bg-interaction/5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-marker focus-visible:outline-offset-2"
              title="Settings"
              aria-label="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="close-button"
              title="Close (Esc)"
              aria-label="Close launcher"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {historyControl}
        </header>

        {/* Scrollable Main Area */}
        <div className={`launcher-scroll ${focusedMode ? 'launcher-scroll--focused' : ''}`}>
          {/* Hero Section */}
          <div className="launcher-hero">
            <span className="launcher-eyebrow">Explore history</span>
            <h1 className="text-3xl font-extrabold text-content-primary mt-2">
              How would you like to explore history?
            </h1>
            <p className="text-sm text-content-secondary mt-2 max-w-xl mx-auto">
              Choose a period, place, person, or idea. We’ll weave a timeline around it.
            </p>
          </div>

          {/* Six Strategy Cards in Grid */}
          <div
            className={`launcher-grid ${focusedMode ? 'launcher-grid--dimmed' : ''}`}
            aria-hidden={focusedMode !== null}
            inert={focusedMode !== null ? true : undefined}
          >
            {STRATEGIES.map(strat => (
              <div
                key={strat.mode}
                className="launcher-card group"
              >
                <button
                  type="button"
                  ref={el => { cardTriggerRefs.current[strat.mode] = el; }}
                  onClick={() => handleSelectStrategy(strat.mode)}
                  disabled={isBusy || focusedMode !== null}
                  className="launcher-card-trigger w-full text-left bg-transparent border-0 cursor-pointer focus:outline-none"
                  aria-label={`${strat.title}: ${strat.description}`}
                >
                  <LauncherAnimatedIllustration
                    variant="card"
                    src={`/illustrations/${strat.illustration}`}
                    height={strat.illustrationHeight ?? 986}
                  />
                  <div className="launcher-card-overlay launcher-card-badges">
                    <span className="launcher-card-kicker">
                      {strat.badge}
                    </span>
                  </div>
                  <div className="launcher-card-overlay launcher-card-caption">
                    <h3 className="launcher-card-title">{strat.title}</h3>
                    <div className="launcher-card-description-reveal">
                      <div className="launcher-card-description-clip">
                        <p className="launcher-card-desc">{strat.description}</p>
                      </div>
                    </div>
                  </div>
                </button>

              </div>
            ))}
          </div>

          {/* Strategy details */}
          {focusedMode && focusedStrategy && (
            <div className="launcher-focused-stage">
              <LauncherAnimatedIllustration
                key={focusedMode}
                src={`/illustrations/${focusedStrategy.illustration}`}
                height={focusedStrategy.illustrationHeight ?? 986}
              />
              <div className="launcher-focused-panel">
                <div className={`launcher-focused-card${focusedMode === 'time-span' ? ' launcher-focused-card--time-span' : ''}`} role="region" aria-labelledby="focused-card-title">
                  <div className="launcher-focused-heading">
                    <h2 id="focused-card-title" className="text-2xl font-bold text-content-primary">
                      {focusedStrategy.title}
                    </h2>
                    <button
                      type="button"
                      onClick={handleBackToGrid}
                      disabled={isBusy}
                      className="launcher-back"
                      title="Return to strategy grid (Esc)"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0 6 6m-6-6 6-6" />
                      </svg>
                      <span>Back</span>
                    </button>
                  </div>
                  <p className="text-sm text-content-muted mt-1">{focusedStrategy.description}</p>

                  <form onSubmit={handleSubmitForm} className="launcher-focused-form">
                    {focusedMode === 'time-span' ? (
                      <div>
                        <p className="block text-xs font-semibold text-content-secondary uppercase tracking-wider mb-3">
                          {focusedStrategy.inputLabel}
                        </p>
                        <div className="launcher-years">
                          <label htmlFor="launcher-start-year" className="sr-only">Start Year</label>
                          <input
                            id="launcher-start-year"
                            ref={startInputRef}
                            type="text"
                            inputMode="numeric"
                            placeholder="1400"
                            value={startYearStr}
                            onChange={(e) => {
                              setStartYearStr(e.target.value);
                              setInputError(null);
                            }}
                            disabled={isBusy}
                            aria-invalid={inputError !== null}
                            aria-describedby={inputError ? 'launcher-year-help launcher-input-error' : 'launcher-year-help'}
                            className="launcher-input launcher-year-input"
                            style={{ width: `${Math.max(8, startYearStr.length + 4) * 2}ch` }}
                          />
                          <span className="text-content-muted font-bold">to</span>
                          <label htmlFor="launcher-end-year" className="sr-only">End Year</label>
                          <input
                            id="launcher-end-year"
                            type="text"
                            inputMode="numeric"
                            placeholder="1500"
                            value={endYearStr}
                            onChange={(e) => {
                              setEndYearStr(e.target.value);
                              setInputError(null);
                            }}
                            disabled={isBusy}
                            aria-invalid={inputError !== null}
                            aria-describedby={inputError ? 'launcher-year-help launcher-input-error' : 'launcher-year-help'}
                            className="launcher-input launcher-year-input"
                            style={{ width: `${Math.max(8, endYearStr.length + 4) * 2}ch` }}
                          />
                          {weaveButton}
                        </div>
                        <p id="launcher-year-help" className="text-xs text-content-faint mt-2">
                          Negative numbers represent BCE (e.g. -500 for 500 BCE).
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label htmlFor="launcher-query-input" className="block text-xs font-semibold text-content-secondary uppercase tracking-wider mb-3">
                          {focusedStrategy.inputLabel}
                        </label>
                        <div className="launcher-prompt">
                          <textarea
                            id="launcher-query-input"
                            ref={queryInputRef}
                            rows={3}
                            placeholder={focusedStrategy.placeholder}
                            value={queryInput}
                            onChange={(e) => {
                              setQueryInput(e.target.value);
                              setInputError(null);
                            }}
                            disabled={isBusy}
                            aria-invalid={inputError !== null}
                            aria-describedby={inputError ? 'launcher-input-error' : undefined}
                            className="launcher-textarea launcher-prompt-text"
                          />
                          <div className="launcher-prompt-footer">
                            <LauncherExampleScroller
                              key={focusedMode}
                              examples={focusedStrategy.examples}
                              disabled={isBusy}
                              onSelect={handleSelectExample}
                            />
                            {weaveButton}
                          </div>
                        </div>
                      </div>
                    )}

                    {inputError && (
                      <div id="launcher-input-error" role="alert" aria-live="assertive" className="launcher-input-error mt-4">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{inputError}</span>
                      </div>
                    )}

                    {buildProgress}
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* Surprise Me Module (Distinct from 6-card grid) */}
          <div
            className={`launcher-surprise-wrapper ${focusedMode ? 'launcher-surprise-wrapper--hidden' : ''}`}
            aria-hidden={focusedMode !== null}
            inert={focusedMode !== null ? true : undefined}
          >
            <div className="launcher-surprise-box">
              {surpriseState !== 'idle' && (
                <button
                  type="button"
                  onClick={handleCollapseSurprise}
                  disabled={isBuildInProgress}
                  className="close-button launcher-surprise-close"
                  aria-label="Close Surprise Me"
                  title="Close Surprise Me (Esc)"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              {surpriseState === 'idle' && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="launcher-dice-icon" aria-hidden="true">
                      <svg className="w-6 h-6 text-accent-marker" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="4" y="4" width="16" height="16" rx="3" strokeWidth="2" />
                        <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                        <circle cx="16" cy="8" r="1.25" fill="currentColor" />
                        <circle cx="12" cy="12" r="1.25" fill="currentColor" />
                        <circle cx="8" cy="16" r="1.25" fill="currentColor" />
                        <circle cx="16" cy="16" r="1.25" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-content-primary">
                        Unsure where to start? Surprise Me
                      </h3>
                      <p className="text-xs text-content-muted">
                        Discover an unexpected chapter of history.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSurpriseRoll}
                    ref={surpriseTriggerRef}
                    disabled={isBusy || focusedMode !== null}
                    className="launcher-btn-primary whitespace-nowrap"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <rect x="4" y="4" width="16" height="16" rx="3" strokeWidth="2" />
                      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                      <circle cx="16" cy="16" r="1.25" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
                    </svg>
                    <span>Surprise Me</span>
                  </button>
                </div>
              )}

              {surpriseState === 'consulting' && (
                <div className="py-4 flex flex-col items-center justify-center gap-3">
                  <svg className="animate-spin h-6 w-6 text-accent-marker" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-sm font-semibold text-content-primary">
                    Consulting the archives...
                  </p>
                  <p className="text-xs text-content-muted">
                    Finding a chapter of history to explore...
                  </p>
                </div>
              )}

              {(surpriseState === 'suggested' || surpriseState === 'error') && surpriseResult && (
                <div className="text-left">
                  <div className="launcher-suggestion-header">
                    <span className="launcher-pill-tag">Historical Suggestion</span>
                    <div className="launcher-suggestion-meta">
                      {surpriseResult.activeCategories?.map(cat => (
                        <span key={cat} className="launcher-category-tag">{cat}</span>
                      ))}
                      <span className="text-xs font-mono font-bold text-accent-marker whitespace-nowrap">
                        {formatYear(surpriseResult.inferredStartYear)} – {formatYear(surpriseResult.inferredEndYear)}
                      </span>
                    </div>
                  </div>

                  <h3 className="launcher-prompt-text text-content-primary">
                    {surpriseResult.themeDescription}
                  </h3>

                  {surpriseError && (
                    <div className="launcher-error-banner mt-3" role="alert">
                      <span>{surpriseError}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-3 mt-5 pt-3 border-t border-border/40">
                    <button
                      type="button"
                      onClick={handleSurpriseRoll}
                      disabled={isBusy || focusedMode !== null}
                      className="launcher-btn-secondary"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Spin Again</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleBuildSurprise}
                      disabled={isBusy || focusedMode !== null}
                      aria-busy={isBuildInProgress}
                      className="launcher-btn-primary launcher-weave-button"
                    >
                      {weaveButtonContent}
                    </button>
                  </div>
                  {buildProgress}
                </div>
              )}

              {surpriseState === 'error' && !surpriseResult && (
                <div className="py-2 pr-7 text-left">
                  <div className="launcher-error-banner" role="alert">
                    <span>{surpriseError || 'Unable to uncover a topic. Please roll again.'}</span>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSurpriseRoll}
                      disabled={isBusy || focusedMode !== null}
                      className="launcher-btn-secondary"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeaveLauncherOverlay;
