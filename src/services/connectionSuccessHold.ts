// A verified chain waits in the explorer, lit, until the user asks to see it. Settlement has already
// happened by the time a hold begins; this only decides when the overlay lets go.
// Revealing runs the hand-off once; abandoning drops it for good.
export function createSuccessHold() {
  let pending: (() => void) | null = null;
  return {
    get active() { return pending !== null; },
    begin(finish: () => void) { pending = finish; },
    // Hand over now. False when nothing was holding.
    reveal(): boolean {
      const current = pending;
      pending = null;
      current?.();
      return !!current;
    },
    // The canvas or search moved on, or the user left without revealing: the hand-off must not happen.
    abandon() { pending = null; },
  };
}
export type SuccessHold = ReturnType<typeof createSuccessHold>;
