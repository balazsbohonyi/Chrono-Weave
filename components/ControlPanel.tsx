
import React, { useState } from 'react';
import { useEnvironment } from '../contexts/EnvironmentContext';

interface ControlPanelProps {
  startYear: number;
  endYear: number;
  onBuild: (start: number, end: number) => void;
  isBuilding: boolean;
  hasFigures: boolean;
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
  startYear,
  endYear,
  onBuild,
  isBuilding,
  hasFigures,
  onSearch,
  searchResultCount,
  currentResultIndex,
  onNextResult,
  onPrevResult,
  onOpenSettings,
  onToggleLegend,
  isLegendOpen
}) => {
  const { isProduction } = useEnvironment();
  const [localStart, setLocalStart] = useState<string>(startYear.toString());
  const [localEnd, setLocalEnd] = useState<string>(endYear.toString());
  const [searchQuery, setSearchQuery] = useState("");

  const handleBuild = () => {
    const s = parseInt(localStart);
    const e = parseInt(localEnd);

    if (isNaN(s) || isNaN(e)) {
      alert("Please enter valid years.");
      return;
    }

    if (s >= e) {
      alert("Start year must be before end year.");
      return;
    }
    onBuild(s, e);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (searchResultCount > 0) {
        onNextResult();
      } else {
        onSearch(searchQuery);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    onSearch(val);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    onSearch("");
  };

  return (
    <div className="fixed top-0 left-0 w-full z-50 flex items-center gap-4 bg-white/60 backdrop-blur-xl px-6 py-2 border-b border-gray-200/50 shadow-sm transition-all h-[52px]">
      <div className="flex items-center gap-2">
        <input
          type="number"
          placeholder="Start"
          value={localStart}
          onChange={(e) => setLocalStart(e.target.value)}
          className="w-[3.25rem] h-8 px-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 outline-none bg-white/80 placeholder-gray-400 text-center transition-all"
        />
        <span className="text-gray-500 font-medium">–</span>
        <input
          type="number"
          placeholder="End"
          value={localEnd}
          onChange={(e) => setLocalEnd(e.target.value)}
          className="w-[3.25rem] h-8 px-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 outline-none bg-white/80 placeholder-gray-400 text-center transition-all"
        />
      </div>

      <div className="h-6 w-px bg-gray-400/30"></div>

      <div className="flex flex-col space-y-0">
        <button
          onClick={handleBuild}
          disabled={isBuilding}
          className="h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
        >
          {isBuilding ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Building...
            </>
          ) : (
            'WEAVE HISTORY'
          )}
        </button>
      </div>

      <div className="h-6 w-px bg-gray-400/30"></div>

      <div className={`relative flex items-center group flex-1 max-w-[250px] transition-opacity duration-300 ${!hasFigures ? 'opacity-50 grayscale' : 'opacity-100'}`}>
        <div className="absolute left-3 text-gray-400 pointer-events-none z-10">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="relative w-full">
          <input
            type="text"
            placeholder="Search names and events..."
            value={searchQuery}
            onChange={handleInputChange}
            onKeyDown={handleSearchKeyDown}
            disabled={!hasFigures}
            className="w-full h-8 pl-9 pr-10 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 outline-none bg-white/80 placeholder-gray-400 transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
          />

          {searchResultCount > 1 ? (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-gray-100/80 rounded px-1 py-0.5 border border-gray-200">
              <span className="text-xs text-gray-500 font-medium px-1 border-r border-gray-300 mr-1 min-w-[40px] text-center">
                {currentResultIndex + 1} of {searchResultCount}
              </span>
              <button
                onClick={onPrevResult}
                className="p-1 hover:bg-white hover:text-blue-600 rounded text-gray-500 transition-colors"
                title="Previous Result"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={onNextResult}
                className="p-1 hover:bg-white hover:text-blue-600 rounded text-gray-500 transition-colors"
                title="Next Result"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <div className="w-px h-3 bg-gray-300 mx-1"></div>

              <button
                onClick={handleClearSearch}
                className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50 transition-colors"
                title="Clear Search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                aria-label="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>

      {/* Settings Toggle (Always Visible) */}
      {!isProduction && (
        <div className="ml-auto flex items-center">
          <button
            onClick={onOpenSettings}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-black/5 rounded-lg transition-colors"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;
