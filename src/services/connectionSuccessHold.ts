interface Timers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

// The short pause between a verified chain and the canvas reveal, while the overlay lights the chain.
// Settlement has already happened by the time a hold begins; this only decides when the overlay lets go.
// Finishing (the timer, or the user skipping) runs the hand-off once; abandoning drops it for good.
export function createSuccessHold(timers: Timers = { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }) {
  let pending: { handle: unknown; finish: () => void } | null = null;
  const release = () => {
    const current = pending;
    pending = null;
    if (current) timers.clear(current.handle);
    return current;
  };
  return {
    get active() { return pending !== null; },
    begin(ms: number, finish: () => void) {
      release();
      const entry = { handle: undefined as unknown, finish };
      pending = entry;
      entry.handle = timers.set(() => { if (pending === entry) { pending = null; finish(); } }, ms);
    },
    // Hand over now. False when nothing was holding.
    skip(): boolean {
      const current = release();
      current?.finish();
      return !!current;
    },
    // The canvas or search moved on: the hand-off must not happen.
    abandon() { release(); },
  };
}
export type SuccessHold = ReturnType<typeof createSuccessHold>;
