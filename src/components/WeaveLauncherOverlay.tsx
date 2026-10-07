import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { WeaveMode, WeaveRequest, WeaveValidationResult } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useModalFocus } from '../hooks/useModalFocus';
import { formatYear } from '../utils/formatters';

interface WeaveLauncherOverlayProps {
  onClose: () => void;
  onSubmit: (request: WeaveRequest) => Promise<void>;
  onSurprise: (excludedTopics: string[]) => Promise<WeaveValidationResult>;
  initialStartYear: number;
  initialEndYear: number;
  phase?: 'idle' | 'validating' | 'building';
  onOpenSettings: () => void;
}

interface StrategyConfig {
  mode: WeaveMode;
  title: string;
  badge: string;
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
    description: 'Explore a specific century or span of years.',
    placeholder: 'e.g. 1400 to 1500',
    inputLabel: 'Specify Start and End Years',
    examples: ['1400 to 1500', '1880 to 1914', '1945 to 1991', '-500 to -300']
  },
  {
    mode: 'era',
    title: 'Historical Era',
    badge: 'Epoch & Civilization',
    description: 'Dive into a historical period, civilization, or dynasty.',
    placeholder: 'e.g. Golden Age of Piracy, Meiji Restoration, Weimar Republic',
    inputLabel: 'Era or Period Name',
    examples: ['Golden Age of Piracy', 'Meiji Restoration', 'Weimar Republic', 'Hellenistic Period']
  },
  {
    mode: 'figure',
    title: 'Follow a Figure',
    badge: 'Biography & World',
    description: 'Explore a person’s life and the people around them.',
    placeholder: 'e.g. Leonardo da Vinci, Cleopatra VII, Ada Lovelace',
    inputLabel: 'Historical Figure Name',
    examples: ['Leonardo da Vinci', 'Cleopatra VII', 'Ada Lovelace', 'Ibn Battuta']
  },
  {
    mode: 'region',
    title: 'Region & Culture',
    badge: 'Geographic History',
    description: 'Focus on a region, civilization, or culture.',
    placeholder: 'e.g. Song Dynasty China, Mughal Empire, Viking Age Scandinavia',
    inputLabel: 'Region, Empire, or Culture',
    examples: ['Song Dynasty China', 'Mesoamerica before Spanish conquest', 'Mughal Empire', 'Viking Age Scandinavia']
  },
  {
    mode: 'theme',
    title: 'Theme or Discipline',
    badge: 'Ideas & Disciplines',
    description: 'Trace the history of a field, discipline, or idea.',
    placeholder: 'e.g. Early History of Computing, Astronomy in the Islamic Golden Age',
    inputLabel: 'Theme, Movement, or Idea',
    examples: ['Early History of Computing', 'Astronomy in the Islamic Golden Age', 'Impressionism & Post-Impressionism', 'Development of Modern Surgery']
  },
  {
    mode: 'freeform',
    title: 'Freeform / Custom',
    badge: 'Custom Synthesis',
    description: 'Combine periods, places, people, and ideas in your own prompt.',
    placeholder: 'e.g. Women pioneers in medicine before 1900, Space Race architects',
    inputLabel: 'Describe your historical canvas query',
    examples: [
      'Women pioneers in medicine before 1900',
      'Philosophers in Athens during the Peloponnesian War',
      'Key inventors of the Industrial Revolution',
      'Navigators of the Age of Exploration'
    ]
  }
];

function parseTimeSpanExample(example: string): { start: string; end: string } | null {
  const match = example.match(/^(-?\d+)\s+to\s+(-?\d+)$/);
  if (match) {
    return { start: match[1], end: match[2] };
  }
  return null;
}

const WeaveLauncherOverlay: React.FC<WeaveLauncherOverlayProps> = ({
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

  // Refs for FLIP animations & focus restoration
  const dialogRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef<boolean>(true);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusedCardRef = useRef<HTMLDivElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  const initialRectRef = useRef<DOMRect | null>(null);
  const exitRectRef = useRef<DOMRect | null>(null);
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

  // Track focused mode changes for return FLIP
  useEffect(() => {
    if (focusedMode) {
      lastFocusedModeRef.current = focusedMode;
    }
  }, [focusedMode]);

  const isBusy = isSubmitting || phase === 'building' || phase === 'validating' || surpriseState === 'consulting';
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  // Stable callbacks for focus trap
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const focusedModeRef = useRef<WeaveMode | null>(focusedMode);
  focusedModeRef.current = focusedMode;

  const handleBackToGrid = useCallback(() => {
    if (isSubmitting || phase === 'building' || phase === 'validating') return;
    const currentMode = focusedModeRef.current;
    if (!currentMode) return;

    if (focusedCardRef.current) {
      exitRectRef.current = focusedCardRef.current.getBoundingClientRect();
    }

    setFocusedMode(null);
    setInputError(null);
  }, [isSubmitting, phase]);

  const handleBackRef = useRef<() => void>(handleBackToGrid);
  handleBackRef.current = handleBackToGrid;

  // Stable escape callback passed to useModalFocus:
  // When inside a focused card, Escape returns to the grid.
  // When already at grid level, Escape closes the overlay.
  const handleModalClose = useCallback(() => {
    if (isBusyRef.current) {
      onCloseRef.current();
    } else if (focusedModeRef.current !== null) {
      handleBackRef.current();
    } else {
      onCloseRef.current();
    }
  }, []);

  useModalFocus(dialogRef, true, handleModalClose);

  // FLIP animation: Grid -> Focused Card
  useLayoutEffect(() => {
    if (focusedMode && initialRectRef.current && focusedCardRef.current) {
      const isReducedMotion = typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!isReducedMotion) {
        const first = initialRectRef.current;
        const last = focusedCardRef.current.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        const deltaW = first.width / Math.max(last.width, 1);
        const deltaH = first.height / Math.max(last.height, 1);

        const anim = focusedCardRef.current.animate(
          [
            {
              transformOrigin: 'top left',
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${deltaW}, ${deltaH})`,
              opacity: 0.95
            },
            {
              transformOrigin: 'top left',
              transform: 'none',
              opacity: 1
            }
          ],
          {
            duration: 320,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'both'
          }
        );

        anim.onfinish = () => {
          if (focusedMode === 'time-span') {
            startInputRef.current?.focus();
          } else {
            queryInputRef.current?.focus();
          }
        };
        initialRectRef.current = null;
        return () => anim.cancel();
      } else {
        if (focusedMode === 'time-span') {
          startInputRef.current?.focus();
        } else {
          queryInputRef.current?.focus();
        }
      }
      initialRectRef.current = null;
    }
  }, [focusedMode]);

  // FLIP animation: Focused Card -> Grid
  useLayoutEffect(() => {
    if (focusedMode === null && exitRectRef.current && lastFocusedModeRef.current) {
      const returningMode = lastFocusedModeRef.current;
      const cardEl = cardRefs.current[returningMode];
      const isReducedMotion = typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!isReducedMotion && cardEl) {
        const first = exitRectRef.current;
        const last = cardEl.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        const deltaW = first.width / Math.max(last.width, 1);
        const deltaH = first.height / Math.max(last.height, 1);

        const anim = cardEl.animate(
          [
            {
              transformOrigin: 'top left',
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${deltaW}, ${deltaH})`
            },
            {
              transformOrigin: 'top left',
              transform: 'none'
            }
          ],
          {
            duration: 280,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
          }
        );

        anim.onfinish = () => {
          cardTriggerRefs.current[returningMode]?.focus();
        };
        exitRectRef.current = null;
        return () => anim.cancel();
      } else {
        cardTriggerRefs.current[returningMode]?.focus();
      }
      exitRectRef.current = null;
    }
  }, [focusedMode]);

  const handleSelectStrategy = (mode: WeaveMode) => {
    if (isBusy) return;
    const cardEl = cardRefs.current[mode];
    if (cardEl) {
      initialRectRef.current = cardEl.getBoundingClientRect();
    }
    setInputError(null);
    lastFocusedModeRef.current = mode;
    setFocusedMode(mode);
  };

  const handleSelectExample = (mode: WeaveMode, example: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBusy) return;

    if (mode === 'time-span') {
      const parsed = parseTimeSpanExample(example);
      if (parsed) {
        setStartYearStr(parsed.start);
        setEndYearStr(parsed.end);
      }
    } else {
      setQueryInput(example);
    }

    if (focusedMode !== mode) {
      const cardEl = cardRefs.current[mode];
      if (cardEl) {
        initialRectRef.current = cardEl.getBoundingClientRect();
      }
      setInputError(null);
      lastFocusedModeRef.current = mode;
      setFocusedMode(mode);
    }
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
        setInputError('Years must be safe integer numbers.');
        return;
      }

      if (s >= e) {
        setInputError('Start year must be strictly earlier than end year.');
        return;
      }

      const request: WeaveRequest = {
        mode: 'time-span',
        query: `${s} to ${e}`,
        startYear: s,
        endYear: e
      };

      try {
        operationRef.current = true;
        setIsSubmitting(true);
        await onSubmit(request);
      } catch (err: unknown) {
        if (isMountedRef.current) {
          setInputError(err instanceof Error ? err.message : 'Failed to weave timeline. Please try again.');
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
          setInputError(err instanceof Error ? err.message : 'Failed to weave timeline. Please try again.');
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
    try {
      operationRef.current = true;
      setSurpriseState('consulting');
      setSurpriseError(null);
      const result = await onSurprise(excludedTopics);
      if (!isMountedRef.current) return;

      if (result.isValid && result.themeDescription) {
        setSurpriseResult(result);
        setExcludedTopics(prev => [...prev, result.themeDescription]);
        setSurpriseState('suggested');
      } else {
        setSurpriseError(result.errorMessage || 'Unable to uncover an unexpected era. Please roll again.');
        setSurpriseState('error');
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setSurpriseError(err instanceof Error ? err.message : 'Error consulting the archives. Please try again.');
      setSurpriseState('error');
    } finally {
      operationRef.current = false;
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
      setSurpriseError(err instanceof Error ? err.message : 'Failed to build timeline from suggestion.');
    } finally {
      operationRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const focusedStrategy = STRATEGIES.find(s => s.mode === focusedMode);

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
        {surpriseState === 'consulting' ? 'Consulting the archives...' : phase === 'validating' ? 'Checking your historical query...' : phase === 'building' ? 'Building your timeline...' : ''}
      </div>
      <div className="launcher-dialog">
        {/* Header with Theme, Settings, Close */}
        <header className="launcher-header">
          <div className="flex items-center gap-3">
            <div className="launcher-brand-icon" aria-hidden="true">
              <svg className="w-5 h-5 text-on-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c-.75-.75-1.5-1.5-3-1.5s-2.25.75-3 1.5l-9 9a2.121 2.121 0 003 3l9-9c.75-.75 1.5-1.5 1.5-3s-.75-2.25-1.5-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 4l.5 1.5L20 6l-1.5.5L18 8l-.5-1.5L16 6l1.5-.5L18 4z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 3l.3 1L7.5 4.3 6.3 4.7 6 6l-.3-1.3L4.5 4.3l1.2-.3L6 3z" />
              </svg>
            </div>
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
              className="p-2 text-content-muted hover:text-content-heading hover:bg-interaction/5 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-marker focus-visible:outline-offset-2"
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
        </header>

        {/* Scrollable Main Area */}
        <div className={`launcher-scroll ${focusedMode ? 'launcher-scroll--focused' : ''}`}>
          {/* Hero Section */}
          <div className="launcher-hero">
            <span className="launcher-pill-tag">Explore history</span>
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
                ref={el => { cardRefs.current[strat.mode] = el; }}
                className="launcher-card group"
              >
                <button
                  type="button"
                  ref={el => { cardTriggerRefs.current[strat.mode] = el; }}
                  onClick={() => handleSelectStrategy(strat.mode)}
                  disabled={isBusy || focusedMode !== null}
                  className="w-full text-left p-0 bg-transparent border-0 cursor-pointer focus:outline-none"
                  aria-label={`${strat.title}: ${strat.description}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="launcher-card-icon">
                      {strat.mode === 'time-span' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                      {strat.mode === 'era' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      )}
                      {strat.mode === 'figure' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      )}
                      {strat.mode === 'region' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {strat.mode === 'theme' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      )}
                      {strat.mode === 'freeform' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      )}
                    </div>
                    <span className="text-[11px] font-semibold text-accent-marker uppercase tracking-wider">
                      {strat.badge}
                    </span>
                  </div>

                  <h3 className="launcher-card-title mt-3">
                    {strat.title}
                  </h3>
                  <p className="launcher-card-desc">
                    {strat.description}
                  </p>
                </button>

                <div className="launcher-example-chips" aria-label="Example queries">
                  {strat.examples.map(ex => (
                    <button
                      key={ex}
                      type="button"
                      onClick={(e) => handleSelectExample(strat.mode, ex, e)}
                      disabled={isBusy || focusedMode !== null}
                      className="launcher-example-chip"
                      title={`Use example: ${ex}`}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Focused Stage (Option A: Real FLIP / Geometry Transition) */}
          {focusedMode && focusedStrategy && (
            <div className="launcher-focused-stage">
              <div
                ref={focusedCardRef}
                className="launcher-focused-card"
                role="region"
                aria-labelledby="focused-card-title"
              >
                <div className="flex items-center justify-between pb-4 border-b border-border/40">
                  <div className="flex items-center gap-3">
                    <div className="launcher-card-icon">
                      {focusedMode === 'time-span' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                      {focusedMode === 'era' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      )}
                      {focusedMode === 'figure' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      )}
                      {focusedMode === 'region' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {focusedMode === 'theme' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      )}
                      {focusedMode === 'freeform' && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <h2 id="focused-card-title" className="text-xl font-bold text-content-primary">
                        {focusedStrategy.title}
                      </h2>
                      <p className="text-xs text-content-muted">{focusedStrategy.description}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleBackToGrid}
                    disabled={isBusy}
                    className="launcher-btn-secondary text-xs py-1.5 px-3"
                    title="Return to strategy grid (Esc)"
                  >
                    Back to Grid
                  </button>
                </div>

                <form onSubmit={handleSubmitForm} className="mt-6">
                  {focusedMode === 'time-span' ? (
                    <div>
                      <label className="block text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2">
                        {focusedStrategy.inputLabel}
                      </label>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label htmlFor="launcher-start-year" className="sr-only">Start Year</label>
                          <input
                            id="launcher-start-year"
                            ref={startInputRef}
                            type="text"
                            inputMode="numeric"
                            placeholder="Start year (e.g. 1400)"
                            value={startYearStr}
                            onChange={(e) => {
                              setStartYearStr(e.target.value);
                              setInputError(null);
                            }}
                            disabled={isBusy}
                            aria-invalid={inputError !== null}
                            aria-describedby={inputError ? 'launcher-input-error' : undefined}
                            className="launcher-input text-center font-mono"
                          />
                        </div>
                        <span className="text-content-muted font-bold">to</span>
                        <div className="flex-1">
                          <label htmlFor="launcher-end-year" className="sr-only">End Year</label>
                          <input
                            id="launcher-end-year"
                            type="text"
                            inputMode="numeric"
                            placeholder="End year (e.g. 1500)"
                            value={endYearStr}
                            onChange={(e) => {
                              setEndYearStr(e.target.value);
                              setInputError(null);
                            }}
                            disabled={isBusy}
                            aria-invalid={inputError !== null}
                            aria-describedby={inputError ? 'launcher-input-error' : undefined}
                            className="launcher-input text-center font-mono"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-content-faint mt-1.5">
                        Negative numbers represent BCE (e.g. -500 for 500 BCE).
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="launcher-query-input" className="block text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2">
                        {focusedStrategy.inputLabel}
                      </label>
                      <input
                        id="launcher-query-input"
                        ref={queryInputRef}
                        type="text"
                        placeholder={focusedStrategy.placeholder}
                        value={queryInput}
                        onChange={(e) => {
                          setQueryInput(e.target.value);
                          setInputError(null);
                        }}
                        disabled={isBusy}
                        aria-invalid={inputError !== null}
                        aria-describedby={inputError ? 'launcher-input-error' : undefined}
                        className="launcher-input"
                      />
                    </div>
                  )}

                  {/* Inline Error Message */}
                  {inputError && (
                    <div
                      id="launcher-input-error"
                      role="alert"
                      aria-live="assertive"
                      className="launcher-error-banner mt-4"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{inputError}</span>
                    </div>
                  )}

                  {/* Accessible Example Chips for Fast Filling */}
                  <div className="mt-4">
                    <span className="text-xs text-content-muted font-medium mr-2">Quick examples:</span>
                    <div className="inline-flex flex-wrap gap-1.5 mt-1 align-middle">
                      {focusedStrategy.examples.map(ex => (
                        <button
                          key={ex}
                          type="button"
                          onClick={(e) => handleSelectExample(focusedStrategy.mode, ex, e)}
                          disabled={isBusy}
                          className="launcher-example-chip"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border/40">
                    <button
                      type="button"
                      onClick={handleBackToGrid}
                      disabled={isBusy}
                      className="launcher-btn-secondary"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="launcher-btn-primary"
                    >
                      {isSubmitting || phase === 'building' || phase === 'validating' ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-on-accent" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>
                            {phase === 'validating'
                              ? 'Checking your historical query...'
                              : phase === 'building'
                              ? 'Building your timeline...'
                              : 'Submitting request...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          <span>Begin Weaving</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
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
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="launcher-pill-tag">Historical Suggestion</span>
                    <span className="text-xs font-mono font-bold text-accent-marker">
                      {formatYear(surpriseResult.inferredStartYear)} – {formatYear(surpriseResult.inferredEndYear)}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-content-primary">
                    {surpriseResult.themeDescription}
                  </h3>

                  {surpriseResult.activeCategories && surpriseResult.activeCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {surpriseResult.activeCategories.map(cat => (
                        <span key={cat} className="launcher-category-tag">
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}

                  {surpriseError && (
                    <div className="launcher-error-banner mt-3" role="alert">
                      <span>{surpriseError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 mt-5 pt-3 border-t border-border/40">
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
                      className="launcher-btn-primary"
                    >
                      {isSubmitting || phase === 'building' || phase === 'validating' ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-on-accent" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>
                            {phase === 'validating'
                              ? 'Checking your historical query...'
                              : phase === 'building'
                              ? 'Building your timeline...'
                              : 'Submitting request...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>Build Timeline</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {surpriseState === 'error' && !surpriseResult && (
                <div className="py-2 text-left">
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
