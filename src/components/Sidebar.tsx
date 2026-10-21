
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { HistoricalFigure, FigureCategory, SidebarViewState } from '../types';
import { fetchBatchFigureDetails } from '../services/wikiService';
import { formatYear } from '../utils/formatters';

import SidebarCardActions from './SidebarCardActions';
import SidebarFigureCard from './SidebarFigureCard';
import ConnectionPanel, { ConnectionHeader, type ConnectionPanelProps } from './ConnectionPanel';
import Tooltip from './Tooltip';

// The Connection tab appears while a connection is active or the canvas has saved ones.
export type SidebarConnection = Omit<ConnectionPanelProps, 'renderActions'> & {
    isVisible: boolean;
    // Each increase selects the tab, for example when a new connection is revealed.
    tabRequest: number;
};

interface SidebarProps {
    initialView?: SidebarViewState;
    onViewChange?: (view: SidebarViewState) => void;
    selectedFigures: HistoricalFigure[];
    currentYear: number | null;
    onTraceRelationships: (figure: HistoricalFigure) => Promise<void>;
    onDiscover: (figure: HistoricalFigure) => void;
    onInspect: (figure: HistoricalFigure) => void;
    onConnect?: (figure: HistoricalFigure) => void;
    activeTracingFigureId?: string;
    focusFigureId?: string;
    isFollowingFigure?: boolean;
    onRelationship?: (figure: HistoricalFigure) => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    selectedCategories: Set<FigureCategory>;
    isLegendOpen: boolean;
    // A connection plays on the stage, which has the whole height: the header and the filters have stepped away, so the sidebar reaches the top.
    fullHeight?: boolean;
    isGlobalView?: boolean;
    connection?: SidebarConnection;
}



type ListMode = 'FIGURES' | 'EVENTS';
type ViewMode = ListMode | 'CONNECTION';

const Sidebar: React.FC<SidebarProps> = ({
    initialView,
    onViewChange,
    selectedFigures,
    currentYear,
    onTraceRelationships,
    onDiscover,
    onInspect,
    onConnect,
    activeTracingFigureId,
    focusFigureId,
    isFollowingFigure = false,
    onRelationship,
    isCollapsed,
    onToggleCollapse,
    selectedCategories,
    isLegendOpen,
    fullHeight = false,
    isGlobalView = false,
    connection
}) => {
    const [detailsMap, setDetailsMap] = useState<Map<string, { description: string; imageUrl: string | null }>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [tracingId, setTracingId] = useState<string | null>(null);
    // The saved view only remembers the list tabs; the Connection tab comes and goes with connections.
    const [listMode, setListMode] = useState<ListMode>(initialView?.mode ?? 'FIGURES');
    const [showConnection, setShowConnection] = useState(false);
    const [scrollPositions, setScrollPositions] = useState<{ FIGURES: number; EVENTS: number }>(initialView?.scrollPositions ?? { FIGURES: 0, EVENTS: 0 });
    const firstDisplay = useRef(true);
    useEffect(() => { onViewChange?.({ mode: listMode, scrollPositions }); }, [listMode, scrollPositions, onViewChange]);

    const hasConnectionTab = !!connection?.isVisible;
    const viewMode: ViewMode = showConnection && hasConnectionTab ? 'CONNECTION' : listMode;
    // Only a new request selects the tab; a sidebar that mounts later (another canvas) must not.
    const tabRequest = connection?.tabRequest ?? 0;
    const handledTabRequest = useRef(tabRequest);
    useEffect(() => {
        if (tabRequest === handledTabRequest.current) return;
        handledTabRequest.current = tabRequest;
        setShowConnection(true);
    }, [tabRequest]);
    useEffect(() => {
        if (!hasConnectionTab) setShowConnection(false);
    }, [hasConnectionTab]);

    const selectTab = (mode: ViewMode) => {
        if (mode === 'CONNECTION') setShowConnection(true);
        else {
            setShowConnection(false);
            setListMode(mode);
        }
    };

    // Refs for tracking positions
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);

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
            listMode === 'FIGURES' ? f.category !== 'EVENTS' : f.category === 'EVENTS'
        );
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    }, [categoryFilteredFigures, listMode]);

    useEffect(() => {
        let isMounted = true;

        const fetchDetails = async () => {
            if (displayFigures.length === 0) return;

            setIsLoading(true);
            // Batch fetch for displayed figures
            // Portraits remembered from earlier visits show at once; the rest follow when Wikipedia has answered.
            const results = await fetchBatchFigureDetails(displayFigures, remembered => {
                if (isMounted) setDetailsMap(prev => new Map([...prev, ...remembered]));
            });

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
        if (!container || viewMode === 'CONNECTION') return;

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
            scrollContainerRef.current.scrollTop = viewMode === 'CONNECTION' ? 0 : scrollPositions[viewMode];
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
    // The Connection tab can be shown even when no year selection lists any figures.
    const hasContent = hasSelection || hasConnectionTab;
    const toggleLabel = isCollapsed ? 'Show sidebar' : 'Hide sidebar';

    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent) => {
            if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey
                || (event.key.toLowerCase() !== 'b' && event.code !== 'KeyB')
                || !hasContent || sidebarRef.current?.closest('[inert]')) return;
            event.preventDefault();
            if (!event.repeat) onToggleCollapse();
        };
        window.addEventListener('keydown', handleShortcut);
        return () => window.removeEventListener('keydown', handleShortcut);
    }, [hasContent, onToggleCollapse]);

    const transformClass = (hasContent && !isCollapsed) ? 'translate-x-0' : 'translate-x-full';

    // Dynamic Top Offset: Align sidebar top with the bottom of the filters bar
    const topClass = fullHeight ? 'top-0' : isLegendOpen ? 'top-[114px]' : 'top-[52px]';
    const heightClass = fullHeight ? 'h-screen' : isLegendOpen ? 'h-[calc(100vh-114px)]' : 'h-[calc(100vh-52px)]';

    const tabClass = (selected: boolean) => `px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${selected ? 'bg-tab-selected text-content-primary shadow-sm' : 'text-content-muted hover:text-content-body bg-transparent'}`;
    const badgeClass = (selected: boolean) => `inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] leading-none ${selected ? 'bg-tab-badge text-tab-badge-text' : 'bg-surface-placeholder text-content-secondary'}`;

    return (
        <div id="canvas-sidebar" ref={sidebarRef} className={`absolute right-0 w-[34rem] bg-surface/50 backdrop-blur-xl border-l border-border shadow-2xl flex flex-col z-40 transition-all duration-300 ease-in-out font-sans ${transformClass} ${topClass} ${heightClass}`}>

            {/* Keep the tooltip anchor aligned with the floating trigger. */}
            {hasContent && (
                <div data-canvas-controls className="absolute top-1/2 -left-6 z-50" style={{ transform: 'translateY(-50%)' }}>
                    <Tooltip text={`${toggleLabel} (Ctrl/Cmd + B)`}>
                        <button type="button"
                            onClick={onToggleCollapse}
                            className="w-6 h-16 bg-surface border border-border shadow-lg rounded-l-xl flex items-center justify-center text-content-secondary hover:text-accent-text hover:bg-surface transition-all focus:outline-none group"
                            aria-label={toggleLabel} aria-expanded={!isCollapsed} aria-controls="canvas-sidebar" aria-keyshortcuts="Control+b Meta+b"
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
                    </Tooltip>
                </div>
            )}

            <div className="p-6 border-b border-border/50 bg-surface/30 flex items-center justify-between gap-3">
                <h2 className="text-3xl font-bold text-content-primary leading-none whitespace-nowrap">
                    {currentYear ? `Year ${formatYear(Math.floor(currentYear))}` : "Inspector"}
                </h2>

                {/* View Mode Toggle */}
                <div className="flex bg-surface-muted/50 p-1 rounded-lg">
                    <button
                        onClick={() => selectTab('FIGURES')}
                        aria-pressed={viewMode === 'FIGURES'}
                        className={tabClass(viewMode === 'FIGURES')}
                    >
                        People
                        <span className={badgeClass(viewMode === 'FIGURES')}>
                            {figuresCount}
                        </span>
                    </button>
                    <button
                        onClick={() => selectTab('EVENTS')}
                        aria-pressed={viewMode === 'EVENTS'}
                        className={tabClass(viewMode === 'EVENTS')}
                    >
                        Events
                        <span className={badgeClass(viewMode === 'EVENTS')}>
                            {eventsCount}
                        </span>
                    </button>
                    {hasConnectionTab && (
                        <button
                            onClick={() => selectTab('CONNECTION')}
                            aria-pressed={viewMode === 'CONNECTION'}
                            className={tabClass(viewMode === 'CONNECTION')}
                        >
                            Connections
                            <span className={badgeClass(viewMode === 'CONNECTION')}>
                                {connection?.recent.length ?? 0}
                            </span>
                        </button>
                    )}
                </div>
            </div>

            {/* The connection on show stays put above the list that scrolls. */}
            {viewMode === 'CONNECTION' && connection?.connection && (
                <div className="px-6 pt-4 pb-4 border-b border-border/50 bg-surface/30 flex-shrink-0">
                    <ConnectionHeader connection={connection.connection} onClose={connection.onClose} onOpenInfo={connection.onOpenInfo} />
                </div>
            )}

            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar"
            >
                {viewMode === 'CONNECTION' && connection && (
                    <ConnectionPanel
                        {...connection}
                        renderActions={person => (
                            <SidebarCardActions
                                figure={person}
                                onDiscover={onDiscover}
                                onInspect={onInspect}
                                onConnect={onConnect}
                                onTrace={handleTrace}
                                isTracing={tracingId === person.id}
                                isFollowingFigure={isFollowingFigure}
                                focusFigureId={focusFigureId}
                                onRelationship={onRelationship}
                            />
                        )}
                    />
                )}

                {viewMode !== 'CONNECTION' && categoryFilteredFigures.length === 0 && selectedCategories.size > 0 && (
                    <div className="flex flex-col items-center justify-center h-48 text-content-faint text-center">
                        <p>Selection hidden by category filters.</p>
                    </div>
                )}

                {viewMode !== 'CONNECTION' && displayFigures.length === 0 && categoryFilteredFigures.length > 0 && (
                    <div className="flex flex-col items-center justify-center h-48 text-content-faint text-center">
                        <p>No {listMode.toLowerCase()} {isGlobalView ? "found in timeline" : "selected for this year"}.</p>
                    </div>
                )}

                {viewMode !== 'CONNECTION' && displayFigures.map((fig) => {
                    const isTracing = tracingId === fig.id;

                    return (
                        <SidebarFigureCard
                            key={fig.id}
                            figure={fig}
                            detail={detailsMap.get(fig.id)}
                            isActive={activeTracingFigureId === fig.id}
                        >
                            <SidebarCardActions
                                figure={fig}
                                onDiscover={onDiscover}
                                onInspect={onInspect}
                                onConnect={onConnect}
                                onTrace={handleTrace}
                                isTracing={isTracing}
                                isFollowingFigure={isFollowingFigure}
                                focusFigureId={focusFigureId}
                                onRelationship={onRelationship}
                            />
                        </SidebarFigureCard>
                    );
                })}

                {viewMode !== 'CONNECTION' && isLoading && (
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
