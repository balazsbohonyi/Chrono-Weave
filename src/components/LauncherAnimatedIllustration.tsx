import React, { useEffect, useId, useRef, useState } from 'react';

interface LauncherAnimatedIllustrationProps {
  src: string;
  height: number;
  variant?: 'focused' | 'card';
}

// Fixed positions and staggered cycles keep the atmosphere consistent on rerenders.
const DUST_PARTICLES = [
  [12, 78, 7, -4, 2], [26, 92, 9, -6, 3], [39, 65, 6, -3, 2.5],
  [51, 88, 10, -8, 2], [63, 73, 8, -5, 3.5], [76, 95, 7, -2, 2],
  [87, 61, 9, -7, 3], [18, 48, 8, -4, 2.5], [58, 42, 7, -1, 2],
  [7, 94, 10, -6, 3], [33, 81, 8, -2, 2], [71, 53, 6, -4, 2.5],
  [94, 84, 9, -5, 2], [46, 56, 7, -3, 3.5], [22, 69, 11, -8, 2],
  [81, 37, 8, -6, 2.5], [54, 97, 6, -2, 3], [66, 89, 10, -7, 2],
  [36, 39, 9, -4, 2], [9, 57, 7, -5, 3], [91, 96, 8, -3, 2.5],
  [15, 86, 8, -3, 2.5], [43, 93, 10, -7, 2], [74, 76, 7, -4, 3],
  [29, 54, 9, -5, 2], [61, 62, 8, -6, 2.5], [85, 46, 10, -2, 2],
];

const LauncherAnimatedIllustration: React.FC<LauncherAnimatedIllustrationProps> = ({ src, height, variant = 'focused' }) => {
  const waveFilterId = `launcher-wave-${useId().replace(/:/g, '')}`;
  const waveSvgRef = useRef<SVGSVGElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(() => document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setIsPageHidden(document.hidden);
    preference.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  // SVG distortion has its own animation clock; pause it along with the CSS layers.
  useEffect(() => {
    if (isPaused || isPageHidden || reducedMotion) waveSvgRef.current?.pauseAnimations();
    else waveSvgRef.current?.unpauseAnimations();
  }, [isPaused, isPageHidden, reducedMotion]);

  return (
    <div
      className={`${variant === 'card' ? 'launcher-card-illustration' : 'launcher-focused-illustration'}${isPaused || isPageHidden ? ' launcher-illustration--paused' : ''}`}
      aria-hidden={variant === 'card' ? true : undefined}
      style={{ '--launcher-wave-filter': `url(#${waveFilterId})` } as React.CSSProperties}
    >
      <svg ref={waveSvgRef} className="launcher-illustration-filters" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id={waveFilterId} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="7" result="waves">
              <animate attributeName="baseFrequency" values="0.006 0.009;0.009 0.0135;0.006 0.009" dur="11s" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="waves" scale={variant === 'card' ? 9 : 20} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div className="launcher-illustration-scene" aria-hidden="true">
        <div className="launcher-illustration-artwork">
          <img src={src} alt="" width={687} height={height} decoding="async" draggable={false} />
        </div>
        {variant === 'card' && (
          <div className="launcher-illustration-artwork launcher-illustration-artwork--animated">
            <img src={src} alt="" width={687} height={height} decoding="async" draggable={false} />
          </div>
        )}
        <div className="launcher-illustration-atmosphere">
          <div className="launcher-illustration-haze launcher-illustration-haze--distant" />
          <div className="launcher-illustration-haze launcher-illustration-haze--near" />
          <div className="launcher-illustration-light" />
          {DUST_PARTICLES.map(([left, top, duration, delay, size], index) => (
            <span
              key={index}
              className="launcher-illustration-dust"
              style={{ left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px`, animationDuration: `${duration * 1.25}s`, animationDelay: `${delay * 1.25}s` }}
            />
          ))}
        </div>
      </div>
      {variant === 'focused' && !reducedMotion && (
        <button
          type="button"
          className="launcher-illustration-motion-toggle"
          onClick={() => setIsPaused(paused => !paused)}
          aria-label={isPaused ? 'Play image animation' : 'Pause image animation'}
          title={isPaused ? 'Play image animation' : 'Pause image animation'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {isPaused ? <path d="m8 5 11 7-11 7V5Z" /> : <path d="M6 5h4v14H6zm8 0h4v14h-4z" />}
          </svg>
        </button>
      )}
    </div>
  );
};

export default LauncherAnimatedIllustration;
