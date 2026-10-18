import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Tooltip from './Tooltip';

interface ControlPanelProps {
  canvasPrompt: string;
  searchQuery: string;
  onOpenLauncher: () => void;
  isBuilding: boolean;
  hasFigures: boolean;
  hasCategoryFilters: boolean;
  selectedCategoryCount: number;
  onSearch: (query: string) => void;
  searchResultCount: number;
  currentResultIndex: number;
  onNextResult: () => void;
  onPrevResult: () => void;
  onOpenSettings: () => void;
  onToggleLegend: () => void;
  isLegendOpen: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  canvasPrompt, searchQuery, onOpenLauncher, isBuilding, hasFigures, hasCategoryFilters, selectedCategoryCount,
  onSearch, searchResultCount, currentResultIndex, onNextResult, onPrevResult,
  onOpenSettings, onToggleLegend, isLegendOpen
}) => {
  const { theme, toggleTheme } = useTheme();
  const themeLabel = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  const filterLabel = `${isLegendOpen ? 'Hide filters' : 'Show filters'}${selectedCategoryCount > 0
    ? ` (${selectedCategoryCount} ${selectedCategoryCount === 1 ? 'category' : 'categories'} selected)` : ''}`;
  const [isSearchOpen, setIsSearchOpen] = useState(() => !!searchQuery);
  const header = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (isSearchOpen) searchInput.current?.focus({ preventScroll: true });
  }, [isSearchOpen]);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    onSearch('');
    searchToggle.current?.focus({ preventScroll: true });
  }, [onSearch]);

  const toggleSearch = useCallback(() => {
    if (isSearchOpen) closeSearch();
    else setIsSearchOpen(true);
  }, [isSearchOpen, closeSearch]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const slash = event.key === '/' || (event.code === 'Slash' && !event.shiftKey);
      if (event.defaultPrevented || !slash || !(event.ctrlKey || event.metaKey) || event.altKey
        || !hasFigures || isBuilding || header.current?.closest('[inert]')) return;
      event.preventDefault();
      if (!event.repeat) toggleSearch();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [hasFigures, isBuilding, toggleSearch]);

  return (
    <header ref={header} data-canvas-controls className="canvas-header">
      <div className="canvas-header-actions" role="group" aria-label="Canvas actions">
        <Tooltip text="Weave New Canvas" placement="bottom">
          <button type="button" onClick={onOpenLauncher} disabled={isBuilding}
            className="canvas-control-button" aria-label="Weave New Canvas">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4 20 1-5L15 5l4 4L9 19l-5 1ZM14 6l4 4M5 3v4M3 5h4M19 2v3M17.5 3.5h3M21 17v4M19 19h4" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip text={filterLabel} placement="bottom">
          <button id="canvas-filter-toggle" type="button" onClick={onToggleLegend}
            disabled={!hasCategoryFilters || isBuilding} className="canvas-control-button canvas-filter-toggle"
            aria-label={filterLabel}
            aria-pressed={isLegendOpen} aria-expanded={isLegendOpen} aria-controls="canvas-category-filters">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />
            </svg>
            {selectedCategoryCount > 0 && <span className="canvas-filter-badge" aria-hidden="true">{selectedCategoryCount}</span>}
          </button>
        </Tooltip>
        <Tooltip text={`${isSearchOpen ? 'Hide search' : 'Search names and events'} (Ctrl/Cmd + /)`} placement="bottom">
          <button ref={searchToggle} type="button" onClick={toggleSearch}
            disabled={!hasFigures || isBuilding} className="canvas-control-button" aria-label={isSearchOpen ? 'Hide search' : 'Search names and events'}
            aria-pressed={isSearchOpen} aria-expanded={isSearchOpen} aria-controls="canvas-search" aria-keyshortcuts="Control+/ Meta+/">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" /><path strokeLinecap="round" d="m16 16 5 5" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div className="canvas-header-center">
        {isSearchOpen ? (
          <div id="canvas-search" className="canvas-header-search" onKeyDown={event => {
            if (event.defaultPrevented || searchResultCount <= 1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.key === 'ArrowDown' ? onNextResult() : onPrevResult();
            }
          }}>
            <div className="canvas-header-search-input">
              <svg className="canvas-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" /><path strokeLinecap="round" d="m16 16 5 5" />
              </svg>
              <input ref={searchInput} type="text" aria-label="Search names and events" placeholder="Search names and events..."
                value={searchQuery} onChange={event => onSearch(event.target.value)} disabled={!hasFigures}
                onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
                  if (event.key === 'Enter') {
                    if (searchResultCount > 0) event.shiftKey ? onPrevResult() : onNextResult();
                    else onSearch(searchQuery);
                  }
                }} />
              <div className="canvas-search-field-actions">
                {searchResultCount > 1 && <div className="canvas-search-results">
                  <span aria-live="polite">{currentResultIndex + 1} of {searchResultCount}</span>
                  <Tooltip text="Previous result (↑)" placement="bottom">
                    <button type="button" className="canvas-control-button" aria-label="Previous result" onClick={onPrevResult}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                  </Tooltip>
                  <Tooltip text="Next result (↓)" placement="bottom">
                    <button type="button" className="canvas-control-button" aria-label="Next result" onClick={onNextResult}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  </Tooltip>
                </div>}
                {searchQuery && <Tooltip text="Clear search" placement="bottom">
                  <button type="button" className="canvas-control-button canvas-search-clear" aria-label="Clear search"
                    onClick={() => { onSearch(''); searchInput.current?.focus({ preventScroll: true }); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
                  </button>
                </Tooltip>}
              </div>
            </div>
          </div>
        ) : <p className="canvas-header-prompt">{canvasPrompt || 'ChronoWeave'}</p>}
      </div>

      <div className="canvas-header-settings" role="group" aria-label="Appearance and settings">
        <Tooltip text={themeLabel} placement="bottom">
          <button type="button" onClick={toggleTheme} className="canvas-control-button" aria-label={themeLabel}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              {theme === 'light' ? <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
                : <><circle cx="12" cy="12" r="4" /><path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3l1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3l1.42-1.42" /></>}
            </svg>
          </button>
        </Tooltip>
        <Tooltip text="Settings" placement="bottom">
          <button type="button" onClick={onOpenSettings} disabled={isBuilding} className="canvas-control-button" aria-label="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <g strokeLinecap="round"><path d="M20 7h-9" /><path d="M14 17H4" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></g>
            </svg>
          </button>
        </Tooltip>
      </div>
    </header>
  );
};

export default ControlPanel;
