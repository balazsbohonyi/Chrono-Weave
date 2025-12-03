
import React from 'react';
import { HistoricalFigure } from '../types';

interface ActionBarProps {
  figure: HistoricalFigure;
  onDiscover: (figure: HistoricalFigure) => void;
  onTrace: (figure: HistoricalFigure, clientY: number) => void;
  onInspect: (figure: HistoricalFigure) => void;
  isDiscovering: boolean;
  style: React.CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const ActionBar: React.FC<ActionBarProps> = ({ 
    figure, 
    onDiscover, 
    onTrace, 
    onInspect, 
    isDiscovering, 
    style, 
    onMouseEnter, 
    onMouseLeave 
}) => {
  
  // Prevent events from reaching the canvas
  const preventCanvasInteraction = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleAction = (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      action();
  };

  const isEvent = figure.category === 'EVENTS';

  // Build menu items based on category
  const menuItems = [
      {
          label: isEvent ? "Read Details" : "Read Biography",
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          ),
          onClick: (e: React.MouseEvent) => handleAction(e, () => onInspect(figure)),
          isLoading: false
      },
      !isEvent ? {
          label: "Map Relationships",
          icon: (
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
             </svg>
          ),
          onClick: (e: React.MouseEvent) => handleAction(e, () => onTrace(figure, e.clientY)),
          isLoading: false
      } : null,
      !isEvent ? {
          label: "Expand Timeline",
          icon: (
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
             </svg>
          ),
          onClick: (e: React.MouseEvent) => handleAction(e, () => onDiscover(figure)),
          isLoading: isDiscovering
      } : null
  ].filter((item): item is typeof item & {} => item !== null);

  return (
    <div 
        className="absolute z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top-left cursor-default"
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onPointerDown={preventCanvasInteraction}
        onPointerUp={preventCanvasInteraction}
        onClick={preventCanvasInteraction}
        onMouseDown={preventCanvasInteraction}
        onMouseUp={preventCanvasInteraction}
    >
        <div className="bg-white/60 backdrop-blur-xl border border-blue-200/50 shadow-2xl rounded-lg overflow-hidden min-w-[140px] flex flex-col">
            {menuItems.map((item, idx) => (
                <button
                    key={idx}
                    type="button"
                    onClick={item.onClick}
                    disabled={item.isLoading}
                    className={`
                        w-full flex items-center gap-3 px-3 py-1.5 text-base font-normal transition-all text-left group
                        disabled:opacity-50 disabled:cursor-not-allowed
                        text-blue-800 hover:bg-blue-100/40 hover:text-blue-900 border-b border-gray-100/30 last:border-b-0
                    `}
                >
                    <div className="flex-shrink-0 text-blue-600 group-hover:text-blue-700 transition-colors">
                        {item.isLoading ? (
                             <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            item.icon
                        )}
                    </div>
                    <span className="flex-1 whitespace-nowrap">{item.isLoading ? "Analyzing..." : item.label}</span>
                </button>
            ))}
        </div>
    </div>
  );
};

export default ActionBar;
