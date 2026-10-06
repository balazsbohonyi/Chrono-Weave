export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'chrono_theme';

export const parseTheme = (value: string | null | undefined): Theme =>
  value === 'dark' ? 'dark' : 'light';

export const nextTheme = (theme: Theme): Theme => theme === 'light' ? 'dark' : 'light';

export const saveTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Switching still works when browser storage is unavailable.
  }
};
