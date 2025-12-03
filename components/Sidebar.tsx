
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { HistoricalFigure, FigureCategory } from '../types';
import { fetchBatchFigureDetails } from '../services/wikiService';
import { formatYear } from '../utils/formatters';

interface SidebarProps {
  selectedFigures: HistoricalFigure[];
  currentYear: number | null;
  onTraceRelationships: (figure: HistoricalFigure, mouseY: number) => Promise<void>;
  activeTracingFigureId?: string;
  onUpdateSourceY?: (y: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  selectedCategories: Set<FigureCategory>;
  isLegendOpen: boolean;
  isGlobalView?: boolean;
}

type ViewMode = 'FIGURES' | 'EVENTS';

const Sidebar: React.FC<SidebarProps> = ({
  selectedFigures,
  currentYear,
  onTraceRelationships,
  activeTracingFigureId,
  onUpdateSourceY,
  isCollapsed,
  onToggleCollapse,
  selectedCategories,
  isLegendOpen,
  isGlobalView = false
}) => {
  const [detailsMap, setDetailsMap] = useState<Map<string, { description: string; imageUrl: string | null }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [tracingId, setTracingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('FIGURES');
  const [scrollPositions, setScrollPositions] = useState<{ FIGURES: number; EVENTS: number }>({ FIGURES: 0, EVENTS: 0 });

  // Refs for tracking positions
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Filter selected figures based on Global Categories First
  const categoryFilteredFigures = useMemo(() => {
    if (selectedCategories.size === 0) return selectedFigures;
    return selectedFigures.filter(f => selectedCategories.has(f.category));
  }, [selectedFigures, selectedCategories]);

  // Calculate Counts based on Category Filtered List
  const figuresCount = useMemo(() => categoryFilteredFigures.filter(f => f.category !== 'EVENTS').length, [categoryFilteredFigures]);
  const eventsCount = useMemo(() => categoryFilteredFigures.filter(f => f.category === 'EVENTS').length, [categoryFilteredFigures]);

  // Determine Final Display List based on View Mode with Alphabetical Sorting
  const displayFigures = useMemo(() => {
    const filtered = categoryFilteredFigures.filter(f =>
      viewMode === 'FIGURES' ? f.category !== 'EVENTS' : f.category === 'EVENTS'
    );
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [categoryFilteredFigures, viewMode]);

  useEffect(() => {
    let isMounted = true;

    const fetchDetails = async () => {
      if (displayFigures.length === 0) return;

      setIsLoading(true);
      // Batch fetch for displayed figures
      const results = await fetchBatchFigureDetails(displayFigures);

      if (isMounted) {
        setDetailsMap(prev => new Map([...prev, ...results]));
        setIsLoading(false);
      }
    };

    fetchDetails();

    return () => {
      isMounted = false;
    };
  }, [displayFigures]); // Fetch when the displayed list changes

  // Reset scroll position when content changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [displayFigures]);

  // Track scroll position when scrolling and restore when switching view modes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollPositions(prev => ({
        ...prev,
        [viewMode]: container.scrollTop
      }));
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [viewMode]);

  // Restore scroll position when switching view modes
  useEffect(() => {
    if (scrollContainerRef.current) {
      const savedPosition = scrollPositions[viewMode];
      scrollContainerRef.current.scrollTop = savedPosition;
    }
  }, [viewMode]);

  // Scroll tracking effect
  useEffect(() => {
    if (!activeTracingFigureId || !onUpdateSourceY) return;

    const container = scrollContainerRef.current;
    
    let rAF: number;

    const handleUpdate = () => {
      const card = cardRefs.current.get(activeTracingFigureId);
      if (!card) return;

      const rect = card.getBoundingClientRect();
      let y = rect.top + rect.height / 2;

      const minY = 80; 
      const maxY = window.innerHeight - 80;
      
      y = Math.max(minY, Math.min(maxY, y));

      onUpdateSourceY(y);
    };

    const onScroll = () => {
      cancelAnimationFrame(rAF);
      rAF = requestAnimationFrame(handleUpdate);
    };

    if (container) {
        container.addEventListener('scroll', onScroll);
    }
    window.addEventListener('resize', onScroll);
    handleUpdate();

    return () => {
      if (container) {
          container.removeEventListener('scroll', onScroll);
      }
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(rAF);
    };
  }, [activeTracingFigureId, onUpdateSourceY, displayFigures]);

  const handleRelationClick = async (e: React.MouseEvent, fig: HistoricalFigure) => {
    if (tracingId) return; 
    setTracingId(fig.id);
    try {
        await onTraceRelationships(fig, e.clientY);
    } finally {
        setTracingId(null);
    }
  };

  useEffect(() => {
    setTracingId(null);
  }, [selectedFigures]);

  const hasSelection = selectedFigures.length > 0;
  const transformClass = (hasSelection && !isCollapsed) ? 'translate-x-0' : 'translate-x-full';

  // Dynamic Top Offset: Align sidebar top with the bottom of the filters bar
  const topClass = isLegendOpen ? 'top-[120px]' : 'top-[52px]';
  const heightClass = isLegendOpen ? 'h-[calc(100vh-120px)]' : 'h-[calc(100vh-52px)]';

  return (
    <div className={`absolute right-0 w-[34rem] bg-white/50 backdrop-blur-xl border-l border-gray-200 shadow-2xl flex flex-col z-40 transition-all duration-300 ease-in-out font-sans ${transformClass} ${topClass} ${heightClass}`}>

        {/* Toggle Slide Button with Plain White Background */}
        {hasSelection && (
            <button
                onClick={onToggleCollapse}
                className="absolute top-1/2 -left-6 w-6 h-16 bg-white border border-gray-200 shadow-lg rounded-l-xl flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-white transition-all z-50 focus:outline-none group"
                style={{ transform: 'translateY(-50%)' }}
                title={isCollapsed ? "Show Sidebar" : "Hide Sidebar"}
            >
                {isCollapsed ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-70 group-hover:opacity-100" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-70 group-hover:opacity-100" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                )}
            </button>
        )}

        <div className="p-6 border-b border-gray-200/50 bg-white/30 flex items-center justify-between">
            <h2 className="text-3xl font-serif font-light text-gray-900 leading-none">
                {currentYear ? `Year ${formatYear(Math.floor(currentYear))}` : "Timeline Inspector"}
            </h2>

            {/* View Mode Toggle */}
            <div className="flex bg-gray-100/50 p-1 rounded-lg">
                <button
                    onClick={() => setViewMode('FIGURES')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${viewMode === 'FIGURES' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 bg-transparent'}`}
                >
                    Figures
                    <span className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] leading-none ${viewMode === 'FIGURES' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'}`}>
                        {figuresCount}
                    </span>
                </button>
                <button
                    onClick={() => setViewMode('EVENTS')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${viewMode === 'EVENTS' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 bg-transparent'}`}
                >
                    Events
                    <span className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] leading-none ${viewMode === 'EVENTS' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'}`}>
                        {eventsCount}
                    </span>
                </button>
            </div>
        </div>
        
        <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar"
        >
            {categoryFilteredFigures.length === 0 && selectedCategories.size > 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-center">
                    <p>Selection hidden by category filters.</p>
                </div>
            )}

            {displayFigures.length === 0 && categoryFilteredFigures.length > 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-center">
                    <p>No {viewMode.toLowerCase()} {isGlobalView ? "found in timeline" : "selected for this year"}.</p>
                </div>
            )}
            
            {displayFigures.map((fig) => {
                const detail = detailsMap.get(fig.id);
                const isTracing = tracingId === fig.id;
                const isActiveSource = activeTracingFigureId === fig.id;
                const isEvent = fig.category === 'EVENTS';
                
                return (
                    <div 
                        key={fig.id} 
                        ref={(el) => { if (el) cardRefs.current.set(fig.id, el); else cardRefs.current.delete(fig.id); }}
                        className={`relative bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-500 group transition-colors hover:bg-white ${isActiveSource ? 'ring-2 ring-blue-500' : ''}`}
                    >
                        <div className="p-4">
                            <div className="flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-baseline gap-x-2">
                                        <h3 className="font-bold text-gray-900 text-xl leading-tight">{fig.name}</h3>
                                        <span className="text-sm text-gray-500 font-mono font-semibold whitespace-nowrap">
                                            ({formatYear(fig.birthYear)} — {formatYear(fig.deathYear)})
                                        </span>
                                    </div>
                                    <p className="text-xs text-emerald-800 font-bold uppercase tracking-wide mt-0.5 mb-2">{fig.occupation}</p>
                                    
                                    <div className="text-sm text-gray-800 leading-relaxed font-serif">
                                        {detail ? detail.description : (
                                            <span className="text-gray-400 italic">Loading insights...</span>
                                        )}
                                    </div>
                                </div>
                                
                                {detail?.imageUrl && (
                                    <div className="w-20 h-20 bg-gray-200 rounded-[10px] flex-shrink-0 overflow-hidden shadow-sm border border-gray-100 mt-1">
                                        <img src={detail.imageUrl} alt={fig.name} className="w-full h-full object-cover object-top" />
                                    </div>
                                )}
                            </div>
                        </div>

                        {!isEvent && (
                            <div className="absolute bottom-0 left-0 right-0 p-3 bg-white/95 backdrop-blur-sm border-t border-gray-100 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-b-xl z-10 shadow-sm">
                                <button 
                                    onClick={(e) => handleRelationClick(e, fig)}
                                    disabled={isTracing}
                                    className={`text-xs font-bold uppercase tracking-wider py-1.5 px-3 rounded-lg transition-all flex items-center gap-2 shadow-sm border
                                        ${isTracing 
                                            ? 'bg-blue-50 text-blue-400 cursor-wait border-blue-100' 
                                            : 'bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border-gray-200'
                                        }`}
                                >
                                    {isTracing ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                            Tracing...
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                            </svg>
                                            Map Relationships
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
            
            {isLoading && (
                <div className="flex justify-center p-8">
                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}
        </div>
        
        <div className="p-4 text-center text-xs text-gray-400 border-t border-gray-200/50 bg-white/30">
            AI-Generated Descriptions • Images via Wikipedia
        </div>
    </div>
  );
};

export default Sidebar;
