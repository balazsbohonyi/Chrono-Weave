
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import TimelineCanvas from './components/TimelineCanvas';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import RelationshipPopover from './components/RelationshipPopover';
import Toast from './components/Toast';
import ProgressOverlay from './components/ProgressOverlay';
import SettingsDialog from './components/SettingsDialog';
import Legend from './components/Legend';
import { HistoricalFigure, DeepDiveData, IAIService, RelationshipExplanation, FigureCategory } from './types';
import { GeminiService } from './services/geminiService';
import { OpenRouterService } from './services/openRouterService';
import { fetchBatchFigureDetails } from './services/wikiService';

export interface RelationshipData {
    explanation: RelationshipExplanation | null;
    sourceDetail: { description: string; imageUrl: string | null } | undefined;
    targetDetail: { description: string; imageUrl: string | null } | undefined;
}

const App: React.FC = () => {
    const [config, setConfig] = useState({ start: 600, end: 1600 });
    const [figures, setFigures] = useState<HistoricalFigure[]>([]);
    const [loading, setLoading] = useState(false);
    const [hoverYear, setHoverYear] = useState<number | null>(null);

    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [selectedFigures, setSelectedFigures] = useState<HistoricalFigure[]>([]);
    const [highlightedFigureIds, setHighlightedFigureIds] = useState<string[]>([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
    const [isSearchFocusActive, setIsSearchFocusActive] = useState(false);

    const [figureLevels, setFigureLevels] = useState<Map<string, number>>(new Map());

    const [newlyDiscoveredIds, setNewlyDiscoveredIds] = useState<Set<string>>(new Set());
    const [discoverySourceId, setDiscoverySourceId] = useState<string | null>(null);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [isTracing, setIsTracing] = useState(false);

    // Sidebar State
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    // Legend State (Now Top Bar)
    const [isLegendOpen, setIsLegendOpen] = useState(false);

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

    // Settings State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    // AI Service Instance
    const [aiService, setAiService] = useState<IAIService>(new GeminiService());

    // Category Filter State
    const [selectedCategories, setSelectedCategories] = useState<Set<FigureCategory>>(new Set());

    const [knownRelationships, setKnownRelationships] = useState<Map<string, Set<string>>>(new Map());

    const [relationshipState, setRelationshipState] = useState<{
        sourceY: number;
        relatedIds: string[];
        targetId: string;
        sourceFigure: HistoricalFigure;
        sourceImageUrl: string | null;
    } | null>(null);

    const [popoverState, setPopoverState] = useState<{
        isOpen: boolean;
        target: HistoricalFigure | null;
        source: HistoricalFigure | null;
        data: RelationshipData | DeepDiveData | null;
        loading: boolean;
        mode: 'relationship' | 'single';
    }>({
        isOpen: false,
        target: null,
        source: null,
        data: null,
        loading: false,
        mode: 'relationship'
    });

    const getEffectiveConfig = () => {
        const localProvider = localStorage.getItem('chrono_provider');
        const localKey = localStorage.getItem('chrono_api_key');
        const localModel = localStorage.getItem('chrono_model');

        // Strict "All or Nothing" rule for localStorage
        if (localProvider && localKey && localModel) {
            return { provider: localProvider, apiKey: localKey, model: localModel };
        }

        // Fallback to Environment Variables
        return {
            provider: process.env.PROVIDER || 'gemini',
            apiKey: process.env.API_KEY || '',
            model: process.env.MODEL || 'gemini-2.5-flash'
        };
    };

    const initializeService = (showFeedback = false) => {
        const config = getEffectiveConfig();

        if (config.provider === 'openrouter') {
            if (config.apiKey) {
                setAiService(new OpenRouterService(config.apiKey, config.model));
                if (showFeedback) setToast({ message: "Switched to OpenRouter", type: "info" });
            } else {
                // Fallback if key is missing even in env (shouldn't happen if env is set, but good for safety)
                if (showFeedback) setToast({ message: "OpenRouter API key missing.", type: "error" });
            }
        } else {
            // Default to Gemini
            setAiService(new GeminiService(config.apiKey, config.model));
            if (showFeedback) setToast({ message: "Switched to Google Gemini", type: "success" });
        }
    };

    const hasValidApiKey = (): boolean => {
        const config = getEffectiveConfig();
        return !!config.apiKey;
    };

    useEffect(() => {
        initializeService(false);
        // Only auto-build timeline if we have a valid API key
        if (hasValidApiKey()) {
            buildTimeline(600, 1600);
        }
    }, []);

    const handleSettingsSaved = () => {
        initializeService(true);
        buildTimeline(config.start, config.end);
    };

    const buildTimeline = useCallback(async (start: number, end: number) => {
        setLoading(true);
        setConfig({ start, end });
        setSelectedYear(null);
        setSelectedFigures([]);
        setRelationshipState(null);
        setHighlightedFigureIds([]);
        setCurrentSearchIndex(0);
        setIsSearchFocusActive(false);
        setNewlyDiscoveredIds(new Set());
        setDiscoverySourceId(null);
        setKnownRelationships(new Map());
        setPopoverState(prev => ({ ...prev, isOpen: false }));
        setIsSidebarCollapsed(false);
        setSelectedCategories(new Set());
        setIsLegendOpen(false);
    }, []);

    useEffect(() => {
        let isMounted = true;
        if (loading) {
            const performBuild = async () => {
                try {
                    const data = await aiService.fetchHistoricalFigures(config.start, config.end);
                    if (isMounted) {
                        setFigures(data);
                        setLoading(false);
                    }
                } catch (error) {
                    console.error("Failed to fetch figures", error);
                    if (isMounted) {
                        setToast({ message: "Failed to load timeline data.", type: "error" });
                        setLoading(false);
                    }
                }
            };
            performBuild();
        }
        return () => { isMounted = false; };
    }, [loading, aiService, config.start, config.end]);


    const handleYearClick = (year: number, sortedFigures: HistoricalFigure[]) => {
        setSelectedYear(year);
        setSelectedFigures(sortedFigures);
        setRelationshipState(null);
    };

    const handleTraceRelationships = async (
        figure: HistoricalFigure,
        mouseY: number | null,
        currentFigures: HistoricalFigure[] = figures,
        forcedRelatedIds: string[] = []
    ) => {
        setRelationshipState(null);
        if (mouseY !== null) {
            setIsTracing(true);
        }

        try {
            const aiRelatedIds = await aiService.fetchRelatedFigures(figure, currentFigures);
            const knownIds = knownRelationships.get(figure.id) || new Set();
            const uniqueRelatedIds = Array.from(new Set([
                ...aiRelatedIds,
                ...Array.from(knownIds),
                ...forcedRelatedIds
            ]));

            const detailsMap = await fetchBatchFigureDetails([figure]);
            const sourceDetails = detailsMap.get(figure.id);
            const effectiveY = mouseY !== null ? mouseY : window.innerHeight / 2;

            setRelationshipState({
                sourceY: effectiveY,
                relatedIds: uniqueRelatedIds,
                targetId: figure.id,
                sourceFigure: figure,
                sourceImageUrl: sourceDetails?.imageUrl || null
            });

        } catch (error) {
            console.error("Failed to trace relationships", error);
            setToast({ message: "Failed to trace connections.", type: "error" });
        } finally {
            setIsTracing(false);
        }
    };

    const handleUpdateSourceY = useCallback((y: number) => {
        setRelationshipState(prev => {
            if (!prev) return null;
            if (Math.abs(prev.sourceY - y) < 0.5) return prev;
            return { ...prev, sourceY: y };
        });
    }, []);

    const handleDiscover = async (sourceFigure: HistoricalFigure) => {
        setIsDiscovering(true);
        setSelectedYear(null);

        setHighlightedFigureIds([sourceFigure.id]);
        setCurrentSearchIndex(0);
        setIsSearchFocusActive(true);

        try {
            const existingNames = figures.map(f => f.name);
            const newFigures = await aiService.discoverRelatedFigures(sourceFigure, existingNames, config.start, config.end);

            const uniqueNewFigures = newFigures.filter(nf =>
                !figures.some(ef => ef.id === nf.id || ef.name.toLowerCase() === nf.name.toLowerCase())
            );

            let updatedFigures = figures;
            let allRelatedIdsSet = new Set<string>(knownRelationships.get(sourceFigure.id) || []);
            let newBatchIds: string[] = [];

            if (uniqueNewFigures.length > 0) {
                updatedFigures = [...figures, ...uniqueNewFigures];
                newBatchIds = uniqueNewFigures.map(f => f.id);

                newBatchIds.forEach(id => allRelatedIdsSet.add(id));

                const namesList = uniqueNewFigures.map(f => f.name).join(", ");
                setToast({
                    message: `Discovered ${uniqueNewFigures.length} new figures: ${namesList}`,
                    type: 'success'
                });
            } else {
                setToast({
                    message: `No new significant connections found for ${sourceFigure.name} in this period.`,
                    type: 'info'
                });
            }

            const allRelatedIds = Array.from(allRelatedIdsSet);
            const detailsMap = await fetchBatchFigureDetails([sourceFigure]);
            const sourceDetails = detailsMap.get(sourceFigure.id);

            setFigures(updatedFigures);
            setKnownRelationships(prev => {
                const next = new Map(prev);
                next.set(sourceFigure.id, allRelatedIdsSet);
                return next;
            });

            setNewlyDiscoveredIds(new Set(newBatchIds));

            setRelationshipState({
                sourceY: window.innerHeight / 2,
                relatedIds: allRelatedIds,
                targetId: sourceFigure.id,
                sourceFigure: sourceFigure,
                sourceImageUrl: sourceDetails?.imageUrl || null
            });

            setDiscoverySourceId(sourceFigure.id);
            setHighlightedFigureIds([]);
            setCurrentSearchIndex(0);
            setIsSearchFocusActive(false);

            const allRelatedFigures = updatedFigures.filter(f => allRelatedIdsSet.has(f.id));
            const sidebarList = [sourceFigure, ...allRelatedFigures.filter(f => f.id !== sourceFigure.id)];
            setSelectedFigures(sidebarList);

        } catch (error) {
            console.error(error);
            setToast({ message: "Failed to discover connections.", type: "error" });
        } finally {
            setIsDiscovering(false);
        }
    };

    const handleRelationshipBarClick = async (targetFigure: HistoricalFigure) => {
        if (!relationshipState) return;

        const sourceFigure = relationshipState.sourceFigure;

        setPopoverState({
            isOpen: true,
            target: targetFigure,
            source: sourceFigure,
            data: null,
            loading: true,
            mode: 'relationship'
        });

        const cacheKey = `chrono_rel_${sourceFigure.id}_${targetFigure.id}`;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
            try {
                const parsedData = JSON.parse(cached);
                setPopoverState({
                    isOpen: true,
                    target: targetFigure,
                    source: sourceFigure,
                    data: parsedData,
                    loading: false,
                    mode: 'relationship'
                });
                return;
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        try {
            const [explanation, detailsMap] = await Promise.all([
                aiService.fetchRelationshipExplanation(sourceFigure, targetFigure),
                fetchBatchFigureDetails([sourceFigure, targetFigure])
            ]);

            const combinedData: RelationshipData = {
                explanation,
                sourceDetail: detailsMap.get(sourceFigure.id),
                targetDetail: detailsMap.get(targetFigure.id)
            };

            localStorage.setItem(cacheKey, JSON.stringify(combinedData));

            setPopoverState({
                isOpen: true,
                target: targetFigure,
                source: sourceFigure,
                data: combinedData,
                loading: false,
                mode: 'relationship'
            });
        } catch (error) {
            console.error("Error loading relationship data", error);
            setPopoverState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleInspectFigure = async (figure: HistoricalFigure) => {
        setPopoverState({
            isOpen: true,
            target: figure,
            source: null,
            data: null,
            loading: true,
            mode: 'single'
        });

        const cacheKey = `chrono_deepdive_${figure.id}`;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                setPopoverState({
                    isOpen: true,
                    target: figure,
                    source: null,
                    data: parsed,
                    loading: false,
                    mode: 'single'
                });
                return;
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        try {
            const [deepDiveData, detailsMap] = await Promise.all([
                aiService.fetchFigureDeepDive(figure),
                fetchBatchFigureDetails([figure])
            ]);

            if (deepDiveData) {
                const detail = detailsMap.get(figure.id);
                if (detail?.imageUrl) {
                    figure.imageUrl = detail.imageUrl;
                }

                localStorage.setItem(cacheKey, JSON.stringify(deepDiveData));

                setPopoverState({
                    isOpen: true,
                    target: figure,
                    source: null,
                    data: deepDiveData,
                    loading: false,
                    mode: 'single'
                });
            }
        } catch (error) {
            console.error("Error inspecting figure", error);
            setPopoverState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleEmptyClick = () => {
        setRelationshipState(null);
        setSelectedFigures([]);
        setSelectedYear(null);
        setIsSidebarCollapsed(false); // Ensure sidebar is visible for global view
    };

    const handleSearch = (query: string) => {
        if (!query || query.trim() === '') {
            setHighlightedFigureIds([]);
            setCurrentSearchIndex(0);
            setIsSearchFocusActive(false);
            return;
        }
        const lowerQuery = query.toLowerCase();
        const matches = figures
            .filter(f => f.name.toLowerCase().includes(lowerQuery))
            .sort((a, b) => a.birthYear - b.birthYear)
            .map(f => f.id);

        setHighlightedFigureIds(matches);
        setCurrentSearchIndex(0);
        setIsSearchFocusActive(true);
    };

    const handleNextSearchResult = () => {
        if (highlightedFigureIds.length <= 1) return;
        setCurrentSearchIndex(prev => (prev + 1) % highlightedFigureIds.length);
        setIsSearchFocusActive(true);
    };

    const handlePrevSearchResult = () => {
        if (highlightedFigureIds.length <= 1) return;
        setCurrentSearchIndex(prev => (prev - 1 + highlightedFigureIds.length) % highlightedFigureIds.length);
        setIsSearchFocusActive(true);
    };

    const handleCanvasInteraction = () => {
        if (isSearchFocusActive) {
            setIsSearchFocusActive(false);
        }
    };

    const toggleCategory = useCallback((category: FigureCategory) => {
        setSelectedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    }, []);

    const closePopover = () => {
        setPopoverState(prev => ({ ...prev, isOpen: false }));
    };

    useEffect(() => {
        if (selectedFigures.length > 0) {
            setIsSidebarCollapsed(false);
        }
    }, [selectedFigures]);

    // Determine which figures to show in sidebar (Global list if no year selected, otherwise specific year)
    const activeSidebarFigures = useMemo(() => {
        if (selectedYear !== null) return selectedFigures;
        return figures;
    }, [selectedYear, selectedFigures, figures]);

    const sortedSidebarFigures = useMemo(() => {
        if (activeSidebarFigures.length === 0) return [];

        // Sort alphabetically by name - sorting is now handled in Sidebar component
        return [...activeSidebarFigures];
    }, [activeSidebarFigures]);

    const focusedFigureId = highlightedFigureIds.length > 0
        ? highlightedFigureIds[currentSearchIndex]
        : null;

    const isBusy = loading || isDiscovering || isTracing;

    return (
        <div className="relative w-screen h-screen overflow-hidden font-sans text-gray-900 bg-[#f4ecd8]">
            <ControlPanel
                startYear={config.start}
                endYear={config.end}
                onBuild={buildTimeline}
                isBuilding={loading}
                hasFigures={figures.length > 0}
                onSearch={handleSearch}
                searchResultCount={highlightedFigureIds.length}
                currentResultIndex={currentSearchIndex}
                onNextResult={handleNextSearchResult}
                onPrevResult={handlePrevSearchResult}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onToggleLegend={() => setIsLegendOpen(prev => !prev)}
                isLegendOpen={isLegendOpen}
            />

            <Legend
                selectedCategories={selectedCategories}
                onToggleCategory={toggleCategory}
                isOpen={isLegendOpen}
                onToggleOpen={() => setIsLegendOpen(prev => !prev)}
            />

            <div className="absolute inset-0 z-0">
                <TimelineCanvas
                    figures={figures}
                    startYear={config.start}
                    endYear={config.end}
                    onHoverYear={setHoverYear}
                    onYearClick={handleYearClick}
                    onRelationshipClick={handleRelationshipBarClick}
                    onEmptyClick={handleEmptyClick}
                    selectedYear={selectedYear}
                    relationshipState={relationshipState}
                    highlightedFigureIds={highlightedFigureIds}
                    focusedFigureId={focusedFigureId}
                    isSearchFocusActive={isSearchFocusActive}
                    newlyDiscoveredIds={newlyDiscoveredIds}
                    discoverySourceId={discoverySourceId}
                    onDiscover={handleDiscover}
                    onTrace={(f, clientY) => handleTraceRelationships(f, clientY)}
                    onInspect={handleInspectFigure}
                    isDiscovering={isDiscovering}
                    onLayoutChange={setFigureLevels}
                    onCanvasInteraction={handleCanvasInteraction}
                    isBusy={isBusy}
                    isSidebarCollapsed={isSidebarCollapsed}
                    hasSidebarSelection={activeSidebarFigures.length > 0}
                    selectedCategories={selectedCategories}
                    isLegendCollapsed={!isLegendOpen}
                />
            </div>

            {loading && (
                <ProgressOverlay title="CONSULTING THE ARCHIVES" />
            )}

            {isDiscovering && (
                <ProgressOverlay title="Tracing Connections" subtitle="Expanding Timeline Graph..." />
            )}

            {isTracing && (
                <ProgressOverlay title="Analyzing Social Graph" subtitle="Identifying significant connections..." />
            )}

            <Sidebar
                selectedFigures={sortedSidebarFigures}
                currentYear={selectedYear}
                onTraceRelationships={(f, y) => handleTraceRelationships(f, y)}
                activeTracingFigureId={relationshipState?.sourceFigure.id}
                onUpdateSourceY={handleUpdateSourceY}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
                selectedCategories={selectedCategories}
                isLegendOpen={isLegendOpen}
                isGlobalView={selectedYear === null}
            />

            <RelationshipPopover
                isOpen={popoverState.isOpen}
                source={popoverState.source}
                target={popoverState.target}
                data={popoverState.data}
                isLoading={popoverState.loading}
                onClose={closePopover}
                mode={popoverState.mode}
            />

            <SettingsDialog
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                onSave={handleSettingsSaved}
            />

            <Toast
                message={toast?.message || null}
                type={toast?.type}
                onClose={() => setToast(null)}
            />
        </div>
    );
};

export default App;
