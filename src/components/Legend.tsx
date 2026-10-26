
import React from 'react';
import { FigureCategory } from '../types';
import { CATEGORY_COLORS, CATEGORY_LIST } from '../constants';
import Tooltip from './Tooltip';
import { GuestLinkIcon } from './GuestSectionHeader';
import { GUEST_VISIBILITIES, type GuestVisibility } from '../utils/connectionGuests';

interface LegendProps {
  selectedCategories: Set<FigureCategory>;
  availableCategories?: FigureCategory[];
  onToggleCategory: (category: FigureCategory) => void;
  isOpen: boolean;
  onToggleOpen?: () => void;
  // People Six Degrees connections brought in: how many, and whether they are shown, dimmed or hidden.
  guestCount?: number;
  guestVisibility?: GuestVisibility;
  onGuestVisibility?: (visibility: GuestVisibility) => void;
  // Stepped away while a connection plays on the stage, which takes the whole height.
  away?: boolean;
}

const GUEST_VISIBILITY_LABELS: Record<GuestVisibility, string> = { show: 'Show', dim: 'Dim', hide: 'Hide' };

const Legend: React.FC<LegendProps> = ({ selectedCategories, availableCategories = CATEGORY_LIST, onToggleCategory, isOpen, onToggleOpen,
  guestCount = 0, guestVisibility = 'show', onGuestVisibility, away = false }) => {
  return (
    <div id="canvas-category-filters" data-canvas-controls aria-label="Category filters" aria-hidden={!isOpen || away} inert={!isOpen || away}
      className={`fixed top-[52px] left-0 w-full z-[45] flex flex-col items-center pointer-events-none${away ? ' is-away' : ''}`}>
      
      {/* Collapsible Content Area */}
      <div
        className={`
          relative w-full bg-surface/60 backdrop-blur-xl border-border/50
          transition-all duration-300 ease-in-out overflow-hidden pointer-events-auto
          ${isOpen ? 'max-h-40 opacity-100 border-b' : 'max-h-0 opacity-0 border-none'}
        `}
      >
        <div data-canvas-scroll className="legend-category-scroll px-6 py-4 overflow-x-auto no-scrollbar">
            <div className="flex items-center justify-start gap-4 min-w-max">
                {availableCategories.length > 1 && availableCategories.map((category) => {
                    const isSelected = selectedCategories.has(category);
                    const isDimmed = selectedCategories.size > 0 && !isSelected;
                    const color = CATEGORY_COLORS[category];

                    return (
                    <button
                        key={category}
                        onClick={() => onToggleCategory(category)}
                        className={`flex items-center gap-2 transition-all duration-300 group outline-none rounded-md p-1.5 border border-transparent ${isDimmed ? 'opacity-30 hover:opacity-60' : 'opacity-100 bg-surface/30 border-border/30'}`}
                    >
                        <div 
                        className="h-4 w-8 rounded-sm"
                        style={{ backgroundColor: color }}
                        />
                        <span className="text-[10px] font-bold tracking-widest text-content-heading uppercase whitespace-nowrap">
                        {category}
                        </span>
                    </button>
                    );
                })}
                
                {selectedCategories.size > 0 && (
                    <>
                    <div className="h-6 w-px bg-separator-muted/30 mx-2"></div>
                    <button
                        onClick={() => selectedCategories.forEach(c => onToggleCategory(c))} 
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-softest hover:bg-accent-soft text-accent-text rounded-md transition-colors text-xs font-bold uppercase tracking-wider outline-none border border-accent-soft"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Reset
                    </button>
                    </>
                )}

                {guestCount > 0 && onGuestVisibility && (
                    <>
                    {availableCategories.length > 1 && <div className="h-6 w-px bg-separator-muted/30 mx-2"></div>}
                    <div role="group" aria-label="People from connections" className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-content-heading uppercase whitespace-nowrap">
                            <span style={{ color: 'rgb(var(--color-connection))' }}><GuestLinkIcon size={14} /></span>
                            From connections <span className="font-mono tracking-normal opacity-70">{guestCount}</span>
                        </span>
                        <div className="flex rounded-md border border-border/40 overflow-hidden">
                            {GUEST_VISIBILITIES.map(option => (
                                <button key={option} type="button" aria-pressed={guestVisibility === option} onClick={() => onGuestVisibility(option)}
                                    className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider outline-none transition-colors ${guestVisibility === option ? 'bg-accent-soft text-accent-text' : 'text-content-muted hover:bg-surface/40'}`}>
                                    {GUEST_VISIBILITY_LABELS[option]}
                                </button>
                            ))}
                        </div>
                    </div>
                    </>
                )}
            </div>
        </div>
        <div className="legend-close-control">
          <Tooltip text="Hide filters" placement="bottom">
            <button type="button" className="canvas-control-button" aria-label="Close filters" disabled={!onToggleOpen}
              onClick={() => {
                onToggleOpen?.();
                document.getElementById('canvas-filter-toggle')?.focus({ preventScroll: true });
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default Legend;
