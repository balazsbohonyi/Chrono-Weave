import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { nextTheme, parseTheme, saveTheme, Theme } from '../utils/theme';

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: 'light',
  toggleTheme: () => undefined,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() =>
    parseTheme(document.documentElement.dataset.theme));

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    root.setAttribute('data-theme-switching', '');
    // Commit the transition override before changing palette variables.
    void root.offsetWidth;
    root.dataset.theme = theme;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => root.removeAttribute('data-theme-switching'));
    });
    return () => {
      cancelAnimationFrame(frame);
      root.removeAttribute('data-theme-switching');
    };
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(previous => nextTheme(previous)), []);
  useEffect(() => saveTheme(theme), [theme]);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
