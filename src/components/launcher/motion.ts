import { animate, stagger } from 'framer-motion/dom';

export { animate, stagger };

export const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const spring = (o: Record<string, unknown> = {}) =>
  (isReducedMotion() ? { duration: 0.001 } : { type: 'spring' as const, stiffness: 150, damping: 22, ...o });

export const tween = (duration: number, o: Record<string, unknown> = {}) =>
  (isReducedMotion() ? { duration: 0.001 } : { duration, ease: EASE_OUT, ...o });

export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
