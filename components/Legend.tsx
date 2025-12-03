
import React from 'react';
import { CATEGORY_COLORS, CATEGORY_LIST } from '../constants';
import { FigureCategory } from '../types';

interface LegendProps {
  selectedCategories: Set<FigureCategory>;
  onToggleCategory: (category: FigureCategory) => void;
  isOpen: boolean;
  onToggleOpen?: () => void;
}

const Legend: React.FC<LegendProps> = ({ selectedCategories, onToggleCategory, isOpen, onToggleOpen }) => {
  return (
    <div className="fixed top-[52px] left-0 w-full z-[55] flex flex-col items-center pointer-events-none">
      
      {/* Collapsible Content Area */}
      <div 
        className={`
          w-full bg-white/60 backdrop-blur-xl border-gray-200/50
          transition-all duration-300 ease-in-out overflow-hidden pointer-events-auto
          ${isOpen ? 'max-h-40 opacity-100 border-b' : 'max-h-0 opacity-0 border-none'}
        `}
      >
        <div className="w-full px-6 py-4 overflow-x-auto no-scrollbar">
            <div className="flex items-center justify-start gap-4 min-w-max">
                {CATEGORY_LIST.map((category) => {
                    const isSelected = selectedCategories.has(category);
                    const isDimmed = selectedCategories.size > 0 && !isSelected;
                    const color = CATEGORY_COLORS[category];

                    return (
                    <button
                        key={category}
                        onClick={() => onToggleCategory(category)}
                        className={`flex items-center gap-2 transition-all duration-300 group outline-none rounded-md p-1.5 border border-transparent ${isDimmed ? 'opacity-40 grayscale-[0.8] hover:opacity-70' : 'opacity-100 bg-white/30 border-gray-200/30'}`}
                    >
                        <div 
                        className="h-4 w-8 rounded-sm"
                        style={{ backgroundColor: color }}
                        />
                        <span className="text-[10px] font-bold tracking-widest text-gray-800 uppercase whitespace-nowrap">
                        {category}
                        </span>
                    </button>
                    );
                })}
                
                {selectedCategories.size > 0 && (
                    <>
                    <div className="h-6 w-px bg-gray-400/30 mx-2"></div>
                    <button
                        onClick={() => selectedCategories.forEach(c => onToggleCategory(c))} 
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-md transition-colors text-xs font-bold uppercase tracking-wider outline-none border border-blue-100"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Reset
                    </button>
                    </>
                )}
            </div>
        </div>
      </div>

      {/* Toggle Handle - Statically positioned in flex column to move with content */}
      <button 
        onClick={onToggleOpen}
        className="h-6 px-6 bg-white/60 backdrop-blur-xl rounded-b-lg flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-white/80 transition-colors cursor-pointer pointer-events-auto shadow-sm border-none outline-none focus:outline-none focus:ring-0 ring-0"
        title="Toggle Filters"
      >
          {isOpen ? (
             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
               <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
             </svg>
          ) : (
             <div className="flex items-center gap-2">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
                 </svg>
                 <span className="text-[10px] font-bold uppercase tracking-wider">Filters</span>
             </div>
          )}
      </button>
    </div>
  );
};

export default Legend;
