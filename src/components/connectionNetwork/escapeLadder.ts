export type EscapeStep = 'hide-panel' | 'restore' | 'back' | 'dismiss-sheet' | 'clear-query' | 'close';

// Esc peels back one layer at a time.
// Full screen: the floating panel, then the full screen itself. Its selection, sheet and search steps are skipped: none of them is
// visible there (the panel hides without clearing the selection), so a press would look as if it did nothing.
// Otherwise: a contact -> its person -> the lists, a search -> clear, then close.
export function escapeStep(state: { maximized: boolean; panelOpen: boolean; hasSelection: boolean; sheetOpen: boolean; hasQuery: boolean }): EscapeStep {
  if (state.maximized) return state.panelOpen ? 'hide-panel' : 'restore';
  if (state.hasSelection) return 'back';
  if (state.sheetOpen) return 'dismiss-sheet';
  if (state.hasQuery) return 'clear-query';
  return 'close';
}
