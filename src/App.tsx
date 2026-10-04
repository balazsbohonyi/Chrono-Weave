
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import TimelineCanvas from './components/TimelineCanvas';
import ControlPanel from './components/ControlPanel';
import Sidebar from './components/Sidebar';
import RelationshipPopover from './components/RelationshipPopover';
import Toast from './components/Toast';
import ProgressOverlay from './components/ProgressOverlay';
import SettingsDialog from './components/SettingsDialog';
import Legend from './components/Legend';
import { HistoricalFigure, DeepDiveData, IAIService, RelationshipExplanation, FigureCategory } from './types';
import { createAIService } from './services/aiService';
import { assessRelationships, readRelationshipAssessment } from './services/relationshipAssessment';
import { isConfigValid, providerNames } from './utils/providerConfig';
import { filterTimelineFigures, isTimelineFigureVisible } from './utils/timelineFigures';
import { readKnownRelationshipIds, readRelationshipMap, saveRelationshipMap, validRelatedIds } from './utils/relationshipCache';

import { fetchBatchFigureDetails } from './services/wikiService';
import { useEnvironment } from './contexts/EnvironmentContext';

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

    const { getEffectiveConfig } = useEnvironment();

    // AI Service Instance
    const [aiService, setAiService] = useState<IAIService>(() => createAIService(getEffectiveConfig()));

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





    const serviceRef = useRef(aiService);
    const operationController = useRef(new AbortController());
    const operationVersion = useRef(0);
    const buildController = useRef<AbortController | null>(null);
    const buildVersion = useRef(0);
    const traceVersion = useRef(0);
    const traceController = useRef<AbortController | null>(null);
    const popoverVersion = useRef(0);

    const invalidateFigureOperations = () => {
        operationVersion.current++;
        popoverVersion.current++;
        traceVersion.current++;
        operationController.current.abort();
        operationController.current = new AbortController();
    };

    const invalidateOperations = () => {
        invalidateFigureOperations();
        buildController.current?.abort();
        buildVersion.current++;
    };

    const beginRelationshipAction = () => {
        traceController.current?.abort();
        const controller = new AbortController();
        traceController.current = controller;
        const version = operationVersion.current;
        const request = ++traceVersion.current;
        const signal = AbortSignal.any([controller.signal, operationController.current.signal]);
        return {
            signal,
            isCurrent: () => !signal.aborted && operationVersion.current === version && traceVersion.current === request,
        };
    };

    const cancelRelationshipAction = () => {
        traceVersion.current++;
        traceController.current?.abort();
        setIsTracing(false);
        setIsDiscovering(false);
        if (isDiscovering) {
            setHighlightedFigureIds([]);
            setIsSearchFocusActive(false);
        }
    };

    // Storage Keys
    const TIMELINE_DATA_KEY = 'chrono_timeline_data';
    const TIMELINE_CONFIG_KEY = 'chrono_timeline_config';

    const loadTimelineFromCache = useCallback(() => {
        try {
            const cachedData = localStorage.getItem(TIMELINE_DATA_KEY);
            const cachedConfig = localStorage.getItem(TIMELINE_CONFIG_KEY);

            if (cachedData && cachedConfig) {
                const parsedData: HistoricalFigure[] = JSON.parse(cachedData);
                const parsedConfig: { start: number; end: number } = JSON.parse(cachedConfig);

                if (Array.isArray(parsedData) && parsedData.length > 0) {
                    const visibleFigures = filterTimelineFigures(parsedData);
                    setFigures(visibleFigures);
                    setConfig(parsedConfig);
                    if (visibleFigures.length !== parsedData.length) {
                        localStorage.setItem(TIMELINE_DATA_KEY, JSON.stringify(visibleFigures));
                    }
                    return true;
                }
            }
        } catch (e) {
            console.error("Failed to load timeline from cache", e);
        }
        return false;
    }, []);

    const saveTimelineToCache = useCallback((customConfig: { start: number, end: number }, data: HistoricalFigure[]) => {
        try {
            localStorage.setItem(TIMELINE_DATA_KEY, JSON.stringify(data));
            localStorage.setItem(TIMELINE_CONFIG_KEY, JSON.stringify(customConfig));
        } catch (e) {
            console.error("Failed to save timeline to cache", e);
        }
    }, []);

    const buildTimeline = useCallback(async (start: number, end: number) => {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
            setToast({ message: 'Enter a valid year range.', type: 'error' });
            return;
        }
        const selectedConfig = getEffectiveConfig();
        if (selectedConfig.provider !== 'ollama' && !isConfigValid(selectedConfig)) {
            setToast({ message: 'Configure your AI provider in Settings first.', type: 'error' });
            return;
        }
        invalidateOperations();
        const version = buildVersion.current;
        const controller = new AbortController();
        buildController.current = controller;
        const service = serviceRef.current;
        setLoading(true);
        setIsDiscovering(false);
        setIsTracing(false);
        setPopoverState(previous => ({ ...previous, isOpen: false, loading: false }));
        try {
            const data = filterTimelineFigures(await service.fetchHistoricalFigures(start, end, controller.signal));
            if (controller.signal.aborted || buildVersion.current !== version) return;
            if (!data.length) throw new Error('The model returned no timeline data. Try another model or year range.');
            invalidateFigureOperations();
            const nextConfig = { start, end };
            setFigures(data);
            setConfig(nextConfig);
            setSelectedYear(null);
            setSelectedFigures([]);
            setRelationshipState(null);
            setHighlightedFigureIds([]);
            setCurrentSearchIndex(0);
            setIsSearchFocusActive(false);
            setNewlyDiscoveredIds(new Set());
            setDiscoverySourceId(null);
            setKnownRelationships(new Map());
            setIsSidebarCollapsed(false);
            setSelectedCategories(new Set());
            setIsLegendOpen(false);
            saveTimelineToCache(nextConfig, data);
        } catch (error) {
            if (!controller.signal.aborted && buildVersion.current === version) {
                setToast({ message: error instanceof Error ? error.message : 'Failed to load timeline data.', type: 'error' });
            }
        } finally {
            if (!controller.signal.aborted && buildVersion.current === version) setLoading(false);
        }
    }, [getEffectiveConfig, saveTimelineToCache]);

    useEffect(() => {
        loadTimelineFromCache();
        return () => invalidateOperations();
    }, [loadTimelineFromCache]);

    const handleSettingsSaved = () => {
        const selectedConfig = getEffectiveConfig();
        const service = createAIService(selectedConfig);
        invalidateOperations();
        serviceRef.current = service;
        setAiService(service);
        setLoading(false);
        setIsDiscovering(false);
        setIsTracing(false);
        setPopoverState(previous => ({ ...previous, isOpen: false, loading: false }));
        setToast({ message: 'Settings saved. New requests use ' + providerNames[selectedConfig.provider] + '. Click Build to regenerate the timeline.', type: 'success' });
    };


    const handleYearClick = (year: number, sortedFigures: HistoricalFigure[]) => {
        cancelRelationshipAction();
        setSelectedYear(year);
        setSelectedFigures(sortedFigures);
        setRelationshipState(null);
        if (sortedFigures.length > 0) setIsSidebarCollapsed(false);
    };

    const handleTraceRelationships = async (
        figure: HistoricalFigure,
        mouseY: number | null,
        currentFigures: HistoricalFigure[] = figures,
        forcedRelatedIds: string[] = []
    ) => {
        const { signal, isCurrent } = beginRelationshipAction();
        setToast(null);
        const cached = readRelationshipMap(figure, currentFigures, localStorage);
        const knownIds = validRelatedIds(figure, currentFigures, [
            ...readKnownRelationshipIds(figure, currentFigures, localStorage),
            ...(knownRelationships.get(figure.id) || new Set<string>()),
            ...forcedRelatedIds,
        ]);
        const knownSet = new Set(knownIds);
        const remainingFigures = currentFigures.filter(candidate => !knownSet.has(candidate.id));
        const needsMapping = cached === null && remainingFigures.some(candidate => candidate.id !== figure.id);
        const effectiveY = mouseY ?? window.innerHeight / 2;
        setRelationshipState(null);
        if (isDiscovering) {
            setHighlightedFigureIds([]);
            setIsSearchFocusActive(false);
        }
        setIsDiscovering(false);
        setIsTracing(true);

        try {
            const aiRelatedIds = cached?.relatedIds ?? (needsMapping ? await aiService.fetchRelatedFigures(figure, remainingFigures, signal) : []);
            if (!isCurrent()) return;
            const proposedIds = validRelatedIds(figure, currentFigures, [
                ...aiRelatedIds,
                ...knownIds,
            ]);
            const proposedSet = new Set(proposedIds);
            const assessed = await assessRelationships(aiService, figure,
                currentFigures.filter(candidate => proposedSet.has(candidate.id)), localStorage, signal);
            if (!isCurrent()) return;
            const uniqueRelatedIds = [...assessed.keys()];
            setKnownRelationships(previous => new Map(previous).set(figure.id, new Set(uniqueRelatedIds)));
            saveRelationshipMap(figure, currentFigures, uniqueRelatedIds, localStorage, cached?.expansionAttempted);

            if (uniqueRelatedIds.length === 0) {
                if (cached?.expansionAttempted) {
                    setToast({ message: `Relationships could not be mapped for ${figure.name} with the figures on this canvas. Try Expand Timeline or a different year range.`, type: 'info' });
                } else {
                    setToast({ message: `No relationships found for ${figure.name} on the canvas. Expanding the timeline to look for related figures...`, type: 'info' });
                    await handleDiscover(figure, { fromMapping: true, sourceY: mouseY ?? window.innerHeight / 2 });
                }
                return;
            }

            const detailsMap = await fetchBatchFigureDetails([figure]);
            if (!isCurrent()) return;
            const sourceDetails = detailsMap.get(figure.id);
            setRelationshipState({
                sourceY: effectiveY,
                relatedIds: uniqueRelatedIds,
                targetId: figure.id,
                sourceFigure: figure,
                sourceImageUrl: sourceDetails?.imageUrl || null
            });

        } catch (error) {
            if (isCurrent()) {
                const message = error instanceof Error ? error.message : 'Failed to trace connections.';
                setToast({ message: `Could not assess connections for ${figure.name}: ${message}`, type: 'error' });
            }
        } finally {
            if (isCurrent()) setIsTracing(false);
        }
    };

    const handleUpdateSourceY = useCallback((y: number) => {
        setRelationshipState(prev => {
            if (!prev) return null;
            if (Math.abs(prev.sourceY - y) < 0.5) return prev;
            return { ...prev, sourceY: y };
        });
    }, []);

    const handleDiscover = async (sourceFigure: HistoricalFigure, options: { fromMapping?: boolean; sourceY?: number } = {}) => {
        const { signal, isCurrent } = beginRelationshipAction();
        const cached = readRelationshipMap(sourceFigure, figures, localStorage);
        setRelationshipState(null);
        setIsTracing(false);
        setIsDiscovering(true);
        setSelectedYear(null);

        setHighlightedFigureIds([sourceFigure.id]);
        setCurrentSearchIndex(0);
        setIsSearchFocusActive(true);

        try {
            const existingNames = figures.map(f => f.name);
            const newFigures = await aiService.discoverRelatedFigures(sourceFigure, existingNames, config.start, config.end, signal);
            if (!isCurrent()) return;

            const seenIds = new Set(figures.map(figure => figure.id));
            const seenNames = new Set(figures.map(figure => figure.name.trim().toLowerCase()));
            const proposedNewFigures = newFigures.filter(figure => {
                const name = figure.name.trim().toLowerCase();
                if (!isTimelineFigureVisible(figure) || figure.deathYear < config.start || figure.birthYear > config.end ||
                    seenIds.has(figure.id) || seenNames.has(name)) return false;
                seenIds.add(figure.id);
                seenNames.add(name);
                return true;
            });

            let updatedFigures = figures;
            const previousRelatedIdsSet = new Set<string>([
                ...(knownRelationships.get(sourceFigure.id) || []), ...(cached?.relatedIds || []),
                ...readKnownRelationshipIds(sourceFigure, figures, localStorage),
            ]);
            const assessed = await assessRelationships(aiService, sourceFigure, [
                ...figures.filter(figure => previousRelatedIdsSet.has(figure.id)), ...proposedNewFigures,
            ], localStorage, signal);
            if (!isCurrent()) return;
            const uniqueNewFigures = proposedNewFigures.filter(figure => assessed.has(figure.id));
            const allRelatedIdsSet = new Set(assessed.keys());
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
                    message: options.fromMapping
                        ? `Relationships could not be mapped for ${sourceFigure.name} with the figures on this canvas, and no new related figures were found in this period.`
                        : `No new significant connections found for ${sourceFigure.name} in this period.`,
                    type: 'info'
                });
            }

            const allRelatedIds = validRelatedIds(sourceFigure, updatedFigures, Array.from(allRelatedIdsSet));
            if (allRelatedIds.length === 0) {
                setKnownRelationships(previous => new Map(previous).set(sourceFigure.id, new Set<string>()));
                saveRelationshipMap(sourceFigure, updatedFigures, [], localStorage, true);
                setDiscoverySourceId(null);
                setHighlightedFigureIds([]);
                setIsSearchFocusActive(false);
                return;
            }
            const detailsMap = await fetchBatchFigureDetails([sourceFigure]);
            if (!isCurrent()) return;
            const sourceDetails = detailsMap.get(sourceFigure.id);

            setFigures(updatedFigures);
            setKnownRelationships(prev => {
                const next = new Map(prev);
                next.set(sourceFigure.id, new Set(allRelatedIds));
                return next;
            });

            // Save new discovery to cache
            saveTimelineToCache(config, updatedFigures);
            saveRelationshipMap(sourceFigure, updatedFigures, allRelatedIds, localStorage, true);

            setNewlyDiscoveredIds(new Set(newBatchIds));

            setRelationshipState({
                sourceY: options.sourceY ?? window.innerHeight / 2,
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
            if (isCurrent()) {
                setHighlightedFigureIds([]);
                setIsSearchFocusActive(false);
                setToast({ message: error instanceof Error ? error.message : "Failed to discover connections.", type: "error" });
            }
        } finally {
            if (isCurrent()) setIsDiscovering(false);
        }
    };

    const handleRelationshipBarClick = async (targetFigure: HistoricalFigure) => {
        if (!relationshipState) return;

        const sourceFigure = relationshipState.sourceFigure;
        const version = operationVersion.current;
        const request = ++popoverVersion.current;
        const signal = operationController.current.signal;
        const isCurrent = () => !signal.aborted && operationVersion.current === version && popoverVersion.current === request;

        setPopoverState({
            isOpen: true,
            target: targetFigure,
            source: sourceFigure,
            data: null,
            loading: true,
            mode: 'relationship'
        });

        const assessment = readRelationshipAssessment(sourceFigure, targetFigure, localStorage);
        const cacheKey = `chrono_rel_${sourceFigure.id}_${targetFigure.id}`;
        const reverseCacheKey = `chrono_rel_${targetFigure.id}_${sourceFigure.id}`;
        for (const key of [cacheKey, reverseCacheKey]) {
            const cached = localStorage.getItem(key);
            if (!cached || !assessment) continue;
            try {
                const parsed = JSON.parse(cached);
                const parsedData = key === reverseCacheKey
                    ? { ...parsed, sourceDetail: parsed.targetDetail, targetDetail: parsed.sourceDetail }
                    : parsed;
                setPopoverState({
                    isOpen: true,
                    target: targetFigure,
                    source: sourceFigure,
                    data: { ...parsedData, explanation: assessment },
                    loading: false,
                    mode: 'relationship'
                });
                return;
            } catch (e) {
                localStorage.removeItem(key);
            }
        }

        try {
            const [assessed, detailsMap] = await Promise.all([
                assessRelationships(aiService, sourceFigure, [targetFigure], localStorage, signal),
                fetchBatchFigureDetails([sourceFigure, targetFigure])
            ]);

            if (!isCurrent()) return;
            const explanation = assessed.get(targetFigure.id) ?? readRelationshipAssessment(sourceFigure, targetFigure, localStorage);

            const combinedData: RelationshipData = {
                explanation,
                sourceDetail: detailsMap.get(sourceFigure.id),
                targetDetail: detailsMap.get(targetFigure.id)
            };

            if (explanation) localStorage.setItem(cacheKey, JSON.stringify(combinedData));

            setPopoverState({
                isOpen: true,
                target: targetFigure,
                source: sourceFigure,
                data: combinedData,
                loading: false,
                mode: 'relationship'
            });
        } catch (error) {
            if (isCurrent()) {
                setToast({ message: error instanceof Error ? error.message : 'Failed to explain the relationship.', type: 'error' });
                setPopoverState(prev => ({ ...prev, loading: false }));
            }
        }
    };

    const handleInspectFigure = async (figure: HistoricalFigure) => {
        const version = operationVersion.current;
        const request = ++popoverVersion.current;
        const signal = operationController.current.signal;
        const isCurrent = () => !signal.aborted && operationVersion.current === version && popoverVersion.current === request;
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
                // Biography text is cached separately from Wikipedia images.
                // Show it immediately, then restore a missing header image.
                if (!figure.imageUrl) {
                    try {
                        const detailsMap = await fetchBatchFigureDetails([figure]);
                        const imageUrl = detailsMap.get(figure.id)?.imageUrl;
                        if (isCurrent() && imageUrl) {
                            setPopoverState(previous => ({
                                ...previous,
                                target: { ...figure, imageUrl }
                            }));
                        }
                    } catch (error) {
                        console.warn('Could not restore the biography image', error);
                    }
                }
                return;
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        try {
            const [deepDiveData, detailsMap] = await Promise.all([
                aiService.fetchFigureDeepDive(figure, signal),
                fetchBatchFigureDetails([figure])
            ]);

            if (!isCurrent()) return;

            if (deepDiveData) {
                const detail = detailsMap.get(figure.id);
                const target = detail?.imageUrl ? { ...figure, imageUrl: detail.imageUrl } : figure;

                localStorage.setItem(cacheKey, JSON.stringify(deepDiveData));

                setPopoverState({
                    isOpen: true,
                    target,
                    source: null,
                    data: deepDiveData,
                    loading: false,
                    mode: 'single'
                });
            } else {
                setPopoverState(previous => ({ ...previous, loading: false }));
                setToast({ message: 'The model returned no biography.', type: 'error' });
            }
        } catch (error) {
            if (isCurrent()) {
                setToast({ message: error instanceof Error ? error.message : 'Failed to inspect the figure.', type: 'error' });
                setPopoverState(prev => ({ ...prev, loading: false }));
            }
        }
    };

    const handleEmptyClick = () => {
        cancelRelationshipAction();
        setRelationshipState(null);
        setDiscoverySourceId(null);
        setNewlyDiscoveredIds(new Set());
        setHighlightedFigureIds([]);
        setIsSearchFocusActive(false);
        setSelectedFigures([]);
        setSelectedYear(null);
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
        popoverVersion.current++;
        setPopoverState(prev => ({ ...prev, isOpen: false }));
    };

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
                onDiscover={handleDiscover}
                onInspect={handleInspectFigure}
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
                onShowToast={(msg: string, type: 'success' | 'info' | 'error') => setToast({ message: msg, type })}
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
