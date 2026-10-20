import type { LayoutMode } from '../services/connectionNetworkLayout';

// The Six Degrees explorer remembers how the person last looked at the network: the layout, whether connection lines are drawn and whether the graph fills the overlay.
// It is a viewing preference, not canvas data, so it lives outside the canvas caches and survives switching canvases.
export const NETWORK_VIEW_PREFS_KEY = 'chrono_sd2_network_view';

export interface NetworkViewPrefs { mode: LayoutMode; showLines: boolean; maximized: boolean }

const LAYOUT_MODES: readonly LayoutMode[] = ['time', 'free', 'cluster', 'columns', 'category', 'corridor'];
export const DEFAULT_NETWORK_VIEW_PREFS: NetworkViewPrefs = { mode: 'time', showLines: true, maximized: false };

const defaultStorage = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

// Storage can be missing or throw, and a stored value can be stale or hand-edited: every field falls back on its own.
export function readNetworkViewPrefs(storage: Storage | null = defaultStorage()): NetworkViewPrefs {
  try {
    const saved = JSON.parse(storage?.getItem(NETWORK_VIEW_PREFS_KEY) ?? 'null');
    return {
      mode: LAYOUT_MODES.includes(saved?.mode) ? saved.mode : DEFAULT_NETWORK_VIEW_PREFS.mode,
      showLines: typeof saved?.showLines === 'boolean' ? saved.showLines : DEFAULT_NETWORK_VIEW_PREFS.showLines,
      maximized: typeof saved?.maximized === 'boolean' ? saved.maximized : DEFAULT_NETWORK_VIEW_PREFS.maximized,
    };
  } catch { return { ...DEFAULT_NETWORK_VIEW_PREFS }; }
}

export function saveNetworkViewPrefs(changes: Partial<NetworkViewPrefs>, storage: Storage | null = defaultStorage()): void {
  try { storage?.setItem(NETWORK_VIEW_PREFS_KEY, JSON.stringify({ ...readNetworkViewPrefs(storage), ...changes })); } catch { /* Not remembering is harmless. */ }
}
