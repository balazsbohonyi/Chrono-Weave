// What the full-screen explorer's compact bar shows is decided by one value, derived from what the header and footer already read.
export type BarPhase = 'opening' | 'searching' | 'paused' | 'found' | 'solved';

export function barPhase(state: { hasSession: boolean; busy: boolean; success: boolean; solved: boolean }): BarPhase {
  if (!state.hasSession) return 'opening';
  if (state.solved) return 'solved';
  if (state.success) return 'found';
  return state.busy ? 'searching' : 'paused';
}

// The phase text of the header. The bar does not display it: it is the clock's hover text and the bar's hidden live region.
export function phaseText(busy: boolean, sessionPhase: string | undefined, progressLabel: string | undefined): string {
  return busy ? sessionPhase ?? progressLabel ?? 'Identifying endpoint' : sessionPhase ?? 'Paused';
}
