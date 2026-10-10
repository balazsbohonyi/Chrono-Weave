
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { HistoricalFigure, FigureCategory, SidebarViewState } from '../types';
import { fetchBatchFigureDetails } from '../services/wikiService';
import { formatYear } from '../utils/formatters';

import SidebarCardActions from './SidebarCardActions';

interface SidebarProps {
    initialView?: SidebarViewState;
    onViewChange?: (view: SidebarViewState) => void;
    selectedFigures: HistoricalFigure[];
    currentYear: number | null;
    onTraceRelationships: (figure: HistoricalFigure) => Promise<void>;
    onDiscover: (figure: HistoricalFigure) => void;
    onInspect: (figure: HistoricalFigure) => void;
    activeTracingFigureId?: string;
    focusFigureId?: string;
    isFollowingFigure?: boolean;
    onRelationship?: (figure: HistoricalFigure) => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    selectedCategories: Set<FigureCategory>;
    isLegendOpen: boolean;
    isGlobalView?: boolean;
}



type ViewMode = 'FIGURES' | 'EVENTS';

const Sidebar: React.FC<SidebarProps> = ({
    initialView,
    onViewChange,
    selectedFigures,
    currentYear,
    onTraceRelationships,
    onDiscover,
    onInspect,
    activeTracingFigureId,
    focusFigureId,
    isFollowingFigure = false,
    onRelationship,
    isCollapsed,
    onToggleCollapse,
    selectedCategories,
    isLegendOpen,
    isGlobalView = false
}) => {
    const [detailsMap, setDetailsMap] = useState<Map<string, { description: string; imageUrl: string | null }>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [tracingId, setTracingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(initialView?.mode ?? 'FIGURES');
    const [scrollPositions, setScrollPositions] = useState<{ FIGURES: number; EVENTS: number }>(initialView?.scrollPositions ?? { FIGURES: 0, EVENTS: 0 });
    const firstDisplay = useRef(true);
    useEffect(() => { onViewChange?.({ mode: viewMode, scrollPositions }); }, [viewMode, scrollPositions, onViewChange]);

    // Refs for tracking positions
    const scrollContainerRef = useRef<HTMLDivElement>(null);

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
        if (firstDisplay.current) { firstDisplay.current = false; return; }
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

    const handleTrace = async (fig: HistoricalFigure) => {
        if (tracingId) return;
        setTracingId(fig.id);
        try {
            await onTraceRelationships(fig);
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
    const topClass = isLegendOpen ? 'top-[114px]' : 'top-[52px]';
    const heightClass = isLegendOpen ? 'h-[calc(100vh-114px)]' : 'h-[calc(100vh-52px)]';

    return (
        <div className={`absolute right-0 w-[34rem] bg-surface/50 backdrop-blur-xl border-l border-border shadow-2xl flex flex-col z-40 transition-all duration-300 ease-in-out font-sans ${transformClass} ${topClass} ${heightClass}`}>

            {/* Toggle Slide Button with Plain White Background */}
            {hasSelection && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute top-1/2 -left-6 w-6 h-16 bg-surface border border-border shadow-lg rounded-l-xl flex items-center justify-center text-content-secondary hover:text-accent-text hover:bg-surface transition-all z-50 focus:outline-none group"
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

            <div className="p-6 border-b border-border/50 bg-surface/30 flex items-center justify-between">
                <h2 className="text-3xl font-bold text-content-primary leading-none">
                    {currentYear ? `Year ${formatYear(Math.floor(currentYear))}` : "Timeline Inspector"}
                </h2>

                {/* View Mode Toggle */}
                <div className="flex bg-surface-muted/50 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('FIGURES')}
                        aria-pressed={viewMode === 'FIGURES'}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${viewMode === 'FIGURES' ? 'bg-tab-selected text-content-primary shadow-sm' : 'text-content-muted hover:text-content-body bg-transparent'}`}
                    >
                        Figures
                        <span className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] leading-none ${viewMode === 'FIGURES' ? 'bg-tab-badge text-tab-badge-text' : 'bg-surface-placeholder text-content-secondary'}`}>
                            {figuresCount}
                        </span>
                    </button>
                    <button
                        onClick={() => setViewMode('EVENTS')}
                        aria-pressed={viewMode === 'EVENTS'}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${viewMode === 'EVENTS' ? 'bg-tab-selected text-content-primary shadow-sm' : 'text-content-muted hover:text-content-body bg-transparent'}`}
                    >
                        Events
                        <span className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] leading-none ${viewMode === 'EVENTS' ? 'bg-tab-badge text-tab-badge-text' : 'bg-surface-placeholder text-content-secondary'}`}>
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
                    <div className="flex flex-col items-center justify-center h-48 text-content-faint text-center">
                        <p>Selection hidden by category filters.</p>
                    </div>
                )}

                {displayFigures.length === 0 && categoryFilteredFigures.length > 0 && (
                    <div className="flex flex-col items-center justify-center h-48 text-content-faint text-center">
                        <p>No {viewMode.toLowerCase()} {isGlobalView ? "found in timeline" : "selected for this year"}.</p>
                    </div>
                )}

                {displayFigures.map((fig) => {
                    const detail = detailsMap.get(fig.id);
                    const isTracing = tracingId === fig.id;
                    const isActiveSource = activeTracingFigureId === fig.id;

                    return (
                        <div
                            key={fig.id}
                            className={`relative bg-surface-card/90 backdrop-blur-sm rounded-xl shadow-sm border border-card-border animate-in fade-in slide-in-from-right-4 duration-500 group transition-colors hover:bg-surface-card-hover ${isActiveSource ? 'ring-2 ring-accent-marker' : ''}`}
                        >
                            <div className="p-4">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                            <h3 className="font-bold text-content-primary text-xl leading-tight">{fig.name}</h3>
                                            <span className="text-sm text-card-muted font-mono font-semibold whitespace-nowrap">
                                                {formatYear(fig.birthYear)} — {formatYear(fig.deathYear)}
                                            </span>
                                        </div>
                                        <p className="text-xs text-success-heading font-bold uppercase tracking-wide mt-0.5 mb-2">{fig.occupation}</p>

                                        <div className="text-sm text-content-heading leading-relaxed">
                                            {detail ? detail.description : (
                                                <span className="text-content-faint italic">Loading insights...</span>
                                            )}
                                        </div>
                                    </div>

                                    {detail?.imageUrl && (
                                        <div className="w-20 h-20 bg-surface-placeholder rounded-[10px] flex-shrink-0 overflow-hidden shadow-sm border border-border-subtle mt-1">
                                            <img src={detail.imageUrl} alt={fig.name} className="w-full h-full object-cover object-top" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <SidebarCardActions
                                figure={fig}
                                onDiscover={onDiscover}
                                onInspect={onInspect}
                                onTrace={handleTrace}
                                isTracing={isTracing}
                                isFollowingFigure={isFollowingFigure}
                                focusFigureId={focusFigureId}
                                onRelationship={onRelationship}
                            />
                        </div>
                    );
                })}

                {isLoading && (
                    <div className="flex justify-center p-8">
                        <div className="w-8 h-8 border-2 border-success-marker border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}
            </div>

            <div className="p-4 text-center text-xs text-content-faint border-t border-border/50 bg-surface/30">
                AI-Generated Descriptions • Images via Wikipedia
            </div>
        </div>
    );
};

export default Sidebar;
