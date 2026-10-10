
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import TimelineCanvas from './components/TimelineCanvas';
import GalleryCanvas from './components/GalleryCanvas';
import CanvasLayoutToggle from './components/CanvasLayoutToggle';
import CanvasHistory from './components/CanvasHistory';
import type { CanvasProps } from './components/CanvasProps';
import { CANVAS_LAYOUT_VERSION, getCanvasFocusFigure, prepareCanvasLayout } from './utils/canvasLayout';
import ControlPanel from './components/ControlPanel';
import WeaveLauncherOverlay from './components/WeaveLauncherOverlay';
import Sidebar from './components/Sidebar';
import RelationshipPopover from './components/RelationshipPopover';
import RelationshipOverlay, { RelationshipOverlayState } from './components/RelationshipOverlay';
import { CATEGORY_LIST, KEEP_DISCOVERY_CLUSTERS } from './constants';
import { addDiscoveryCluster, emptyClusters } from './utils/discoveryClusters';
import { activateCanvas, CanvasCache, createCanvasSnapshot, defaultCanvasView, loadCanvasHistory, saveCanvasHistory } from './utils/canvasHistory';
import Toast from './components/Toast';
import ProgressOverlay from './components/ProgressOverlay';
import SettingsDialog from './components/SettingsDialog';
import Legend from './components/Legend';
import { HistoricalFigure, DeepDiveData, IAIService, RelationshipExplanation, FigureCategory, DiscoveryClusterState, ClusterPlacement, LayoutData, WeaveRequest, WeaveGenerationContext, CanvasLayoutMode, CanvasConfig, CanvasSnapshot, CanvasHistoryRecord, CanvasViewSnapshot, SidebarViewState } from './types';
import { calculateWeaveBounds, normalizeWeaveCategories } from './utils/weave';
import { getUserErrorMessage, getWeaveValidationMessage, UserFacingError } from './utils/userErrors';
import { createAIService } from './services/aiService';
import { assessRelationships, readRelationshipAssessment } from './services/relationshipAssessment';
import { isConfigValid, providerNames } from './utils/providerConfig';
import { filterTimelineFigures } from './utils/timelineFigures';
import { saveRelationshipMap } from './utils/relationshipCache';
import { resolveRelationshipAction } from './services/relationshipActions';
import { discardRejectedFollowFigureCandidates, verifyFollowFigureConnections } from './services/followFigureConnections';

import { fetchBatchFigureDetails } from './services/wikiService';
import { useEnvironment } from './contexts/EnvironmentContext';

export interface RelationshipData {
    explanation: RelationshipExplanation | null;
    sourceDetail: { description: string; imageUrl: string | null } | undefined;
    targetDetail: { description: string; imageUrl: string | null } | undefined;
}

const App: React.FC = () => {
    const [config, setConfig] = useState<CanvasConfig>({ start: 600, end: 1600, layoutMode: 'timeline', layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'automatic' });
    const [initialLayout, setInitialLayout] = useState<CanvasProps['initialLayout']>(null);
    const [canvasRevision, setCanvasRevision] = useState(0);
    const [figures, setFigures] = useState<HistoricalFigure[]>([]);
    const [history, setHistory] = useState<CanvasSnapshot[]>([]);
    const historyRef = useRef<CanvasSnapshot[]>([]);
    const [activeCanvas, setActiveCanvas] = useState<Pick<CanvasSnapshot, 'id' | 'createdAt'> | null>(null);
    const latestSnapshot = useRef<CanvasSnapshot | null>(null);
    const cameras = useRef<CanvasViewSnapshot['cameras']>({});
    const sidebarView = useRef<SidebarViewState>(defaultCanvasView().sidebar);
    const [initialSidebarView, setInitialSidebarView] = useState(sidebarView.current);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleSaveRef = useRef<() => void>(() => {});
    const canvasStorage = useRef(new CanvasCache({}, () => scheduleSaveRef.current()));
    const saveFailed = useRef(false);
    const [loading, setLoading] = useState(false);
    const [isLauncherOpen, setIsLauncherOpen] = useState(false);
    const [launcherPhase, setLauncherPhase] = useState<'idle' | 'validating' | 'building' | 'verifying'>('idle');
    const launcherInvoker = useRef<HTMLElement | null>(null);
    const [hoverYear, setHoverYear] = useState<number | null>(null);

    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [selectedFigures, setSelectedFigures] = useState<HistoricalFigure[]>([]);
    const [highlightedFigureIds, setHighlightedFigureIds] = useState<string[]>([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchFocusActive, setIsSearchFocusActive] = useState(false);

    const [clusterState, setClusterState] = useState<DiscoveryClusterState>(emptyClusters);
    const overlayInvoker = useRef<HTMLElement | null>(null);
    const currentPlacements = useRef<Record<string, ClusterPlacement>>({});
    const [cacheLoaded, setCacheLoaded] = useState(false);
    const handlePlacementsResolved = useCallback((layout: LayoutData[]) => {
        const resolved = Object.fromEntries(layout.map(({ figure, level, labelLevel, labelYearOffset }) => [figure.id, { level, labelLevel, labelYearOffset }]));
        currentPlacements.current = resolved;
        setClusterState(previous => {
            const placements = { ...previous.placements };
            let changed = false;
            for (const id of new Set(previous.clusters.flatMap(cluster => cluster.memberIds))) {
                if (!resolved[id]) continue;
                if (JSON.stringify(placements[id]) !== JSON.stringify(resolved[id])) {
                    placements[id] = resolved[id];
                    changed = true;
                }
            }
            return changed ? { ...previous, placements } : previous;
        });
    }, []);

    const [newlyDiscoveredIds, setNewlyDiscoveredIds] = useState<Set<string>>(new Set());
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

    const [relationshipState, setRelationshipState] = useState<RelationshipOverlayState | null>(null);

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

    const relationshipDetailReturn = useRef<typeof popoverState | null>(null);

    useEffect(() => {
        if (relationshipState || popoverState.isOpen || !overlayInvoker.current) return;
        const invoker = overlayInvoker.current;
        overlayInvoker.current = null;
        if (invoker.isConnected && !invoker.closest('[inert]')) invoker.focus({ preventScroll: true });
    }, [relationshipState, popoverState.isOpen]);
    const serviceRef = useRef(aiService);
    const operationController = useRef(new AbortController());
    const operationVersion = useRef(0);
    const buildController = useRef<AbortController | null>(null);
    const buildVersion = useRef(0);
    const traceVersion = useRef(0);
    const traceController = useRef<AbortController | null>(null);
    const popoverVersion = useRef(0);

    const invalidateFigureOperations = () => {
        relationshipDetailReturn.current = null;
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

    const dismissRelationships = useCallback(() => {
        traceVersion.current++;
        traceController.current?.abort();
        popoverVersion.current++;
        relationshipDetailReturn.current = null;
        setIsTracing(false);
        setIsDiscovering(false);
        setRelationshipState(null);
        setPopoverState(previous => ({ ...previous, isOpen: false }));
        setNewlyDiscoveredIds(new Set());
        if (!KEEP_DISCOVERY_CLUSTERS) setClusterState(emptyClusters());
    }, []);

    const currentSnapshot: CanvasSnapshot | null = activeCanvas && figures.length ? {
        ...activeCanvas, config, figures, clusters: clusterState, cache: {},
        view: { cameras: cameras.current, selectedYear, selectedFigureIds: selectedFigures.map(figure => figure.id),
            selectedCategories: [...selectedCategories], isSidebarCollapsed, isLegendOpen, sidebar: sidebarView.current,
            searchQuery, highlightedFigureIds, currentSearchIndex },
    } : null;
    useLayoutEffect(() => { latestSnapshot.current = currentSnapshot; });

    const captureCanvas = useCallback((): CanvasSnapshot | null => latestSnapshot.current ? {
        ...latestSnapshot.current, cache: canvasStorage.current.snapshot(),
        view: { ...latestSnapshot.current.view, cameras: { ...cameras.current }, sidebar: sidebarView.current },
    } : null, []);

    const persistRecord = useCallback((record: CanvasHistoryRecord) => {
        try {
            saveCanvasHistory(localStorage, record);
            saveFailed.current = false;
        } catch (error) {
            console.error('Failed to save canvas history', error);
            if (!saveFailed.current) setToast({ message: 'Canvas history could not be saved. Browser storage is full or unavailable.', type: 'error' });
            saveFailed.current = true;
        }
    }, []);

    const persistCurrentCanvas = useCallback(() => {
        const current = captureCanvas();
        if (current) persistRecord({ version: 1, current, history: historyRef.current });
    }, [captureCanvas, persistRecord]);

    const scheduleSave = useCallback(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(persistCurrentCanvas, 200);
    }, [persistCurrentCanvas]);
    scheduleSaveRef.current = scheduleSave;

    const installCanvas = useCallback((canvas: CanvasSnapshot) => {
        invalidateOperations();
        launcherInvoker.current = null;
        overlayInvoker.current = null;
        const storage = new CanvasCache(canvas.cache, () => scheduleSaveRef.current());
        const data = discardRejectedFollowFigureCandidates(canvas.figures, canvas.config.weaveContext, storage, canvas.config.seedFigureId);
        const layout = prepareCanvasLayout(data, canvas.config.layoutMode, canvas.config.layoutVersion, canvas.config.layoutSelection);
        canvasStorage.current = storage;
        cameras.current = { ...canvas.view.cameras };
        sidebarView.current = canvas.view.sidebar;
        setInitialSidebarView(sidebarView.current);
        setActiveCanvas({ id: canvas.id, createdAt: canvas.createdAt });
        setFigures(data);
        setConfig({ ...canvas.config, layoutMode: layout.mode, layoutVersion: layout.version, layoutSelection: layout.selection });
        setInitialLayout(layout.timeline ? { figures: data, result: layout.timeline } : null);
        setCanvasRevision(previous => previous + 1);
        currentPlacements.current = {};
        setClusterState(canvas.clusters);
        setSelectedYear(canvas.view.selectedYear);
        setSelectedFigures(data.filter(figure => canvas.view.selectedFigureIds.includes(figure.id)));
        setSelectedCategories(new Set(canvas.view.selectedCategories));
        setIsSidebarCollapsed(canvas.view.isSidebarCollapsed);
        setIsLegendOpen(canvas.view.isLegendOpen);
        setSearchQuery(canvas.view.searchQuery);
        const highlights = canvas.view.highlightedFigureIds.filter(id => data.some(figure => figure.id === id));
        setHighlightedFigureIds(highlights);
        setCurrentSearchIndex(Math.max(0, Math.min(canvas.view.currentSearchIndex, highlights.length - 1)));
        setIsSearchFocusActive(false);
        setNewlyDiscoveredIds(new Set());
        setKnownRelationships(new Map());
        setRelationshipState(null);
        setPopoverState(previous => ({ ...previous, isOpen: false, loading: false }));
        setHoverYear(null);
        setIsDiscovering(false);
        setIsTracing(false);
        setLoading(false);
        setLauncherPhase('idle');
        setIsLauncherOpen(false);
    }, []);

    const commitCanvas = useCallback((canvas: CanvasSnapshot) => {
        const record = activateCanvas(historyRef.current, captureCanvas(), canvas);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        historyRef.current = record.history;
        setHistory(record.history);
        setToast(null);
        persistRecord(record);
        installCanvas(canvas);
    }, [captureCanvas, installCanvas, persistRecord]);

    useEffect(() => {
        if (cacheLoaded && activeCanvas) scheduleSave();
    }, [cacheLoaded, activeCanvas, config, figures, clusterState, selectedYear, selectedFigures, selectedCategories,
        isSidebarCollapsed, isLegendOpen, searchQuery, highlightedFigureIds, currentSearchIndex, scheduleSave]);

    useEffect(() => {
        const saveWhenHidden = () => { if (document.visibilityState === 'hidden') persistCurrentCanvas(); };
        window.addEventListener('pagehide', persistCurrentCanvas);
        document.addEventListener('visibilitychange', saveWhenHidden);
        return () => {
            window.removeEventListener('pagehide', persistCurrentCanvas);
            document.removeEventListener('visibilitychange', saveWhenHidden);
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, [persistCurrentCanvas]);

    const handleCameraChange = useCallback((mode: CanvasLayoutMode, camera: { x: number; y: number; scale: number }) => {
        cameras.current = { ...cameras.current, [mode]: camera };
        scheduleSave();
    }, [scheduleSave]);
    const handleTimelineCamera = useCallback((camera: { x: number; y: number; scale: number }) => handleCameraChange('timeline', camera), [handleCameraChange]);
    const handleGalleryCamera = useCallback((camera: { x: number; y: number; scale: number }) => handleCameraChange('gallery', camera), [handleCameraChange]);
    const handleSidebarView = useCallback((view: SidebarViewState) => {
        sidebarView.current = view;
        scheduleSave();
    }, [scheduleSave]);

    const closeLauncher = useCallback(() => {
        buildController.current?.abort();
        buildVersion.current++;
        setLoading(false);
        setLauncherPhase('idle');
        setIsLauncherOpen(false);
    }, []);

    useEffect(() => {
        if (isLauncherOpen || isSettingsOpen || !launcherInvoker.current) return;
        const invoker = launcherInvoker.current;
        launcherInvoker.current = null;
        if (invoker.isConnected && !invoker.closest('[inert]')) invoker.focus({ preventScroll: true });
    }, [isLauncherOpen, isSettingsOpen]);

    const openLauncher = useCallback(() => {
        launcherInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dismissRelationships();
        setPopoverState(previous => ({ ...previous, isOpen: false, loading: false }));
        setToast(null);
        setIsLauncherOpen(true);
    }, [dismissRelationships]);

    const ensureWeaveProvider = useCallback(() => {
        const selectedConfig = getEffectiveConfig();
        if (selectedConfig.provider !== 'ollama' && !isConfigValid(selectedConfig)) {
            throw new UserFacingError('Choose an AI provider and add your access key in Settings to get started.');
        }
    }, [getEffectiveConfig]);

    const buildTimeline = useCallback(async (request: WeaveRequest) => {
        ensureWeaveProvider();
        invalidateOperations();
        const version = buildVersion.current;
        const controller = new AbortController();
        buildController.current = controller;
        const service = serviceRef.current;
        const storage = new CanvasCache();
        setLauncherPhase('validating');
        try {
            const validation = await service.validateWeaveQuery(request, controller.signal);
            controller.signal.throwIfAborted();
            if (buildVersion.current !== version) throw new DOMException('Request cancelled.', 'AbortError');
            if (!validation.isValid) throw new UserFacingError(getWeaveValidationMessage(validation.errorMessage, request.mode));
            const { start, end } = calculateWeaveBounds(validation.inferredStartYear, validation.inferredEndYear);
            const weaveContext: WeaveGenerationContext = {
                mode: request.mode, query: request.query,
                inferredStartYear: validation.inferredStartYear, inferredEndYear: validation.inferredEndYear,
                themeDescription: validation.themeDescription,
                activeCategories: normalizeWeaveCategories(validation.activeCategories),
            };
            setLauncherPhase('building');
            setLoading(true);
            const candidates = filterTimelineFigures(await service.fetchHistoricalFigures(start, end, controller.signal, weaveContext))
                .filter(figure => weaveContext.activeCategories.includes('ALL') || weaveContext.activeCategories.includes(figure.category));
            controller.signal.throwIfAborted();
            if (buildVersion.current !== version) throw new DOMException('Request cancelled.', 'AbortError');
            if (!candidates.length) throw new UserFacingError('No historical figures or events were found for this subject. Try another topic.');
            if (weaveContext.mode === 'figure') setLauncherPhase('verifying');
            const verified = await verifyFollowFigureConnections(service, candidates, weaveContext, storage, controller.signal);
            controller.signal.throwIfAborted();
            if (buildVersion.current !== version) throw new DOMException('Request cancelled.', 'AbortError');
            const data = verified.figures;
            invalidateFigureOperations();
            const layout = prepareCanvasLayout(data);
            const nextConfig = { start, end, weaveContext, layoutMode: layout.mode, layoutVersion: layout.version, layoutSelection: layout.selection, seedFigureId: verified.seedFigureId };
            const focus = data.find(figure => figure.id === verified.seedFigureId);
            if (focus) saveRelationshipMap(focus, data, verified.relatedIds, storage);
            commitCanvas(createCanvasSnapshot(data, nextConfig, storage.snapshot()));
        } finally {
            if (buildVersion.current === version) {
                setLoading(false);
                setLauncherPhase('idle');
            }
        }
    }, [ensureWeaveProvider, commitCanvas]);

    const suggestWeaveTopic = useCallback(async (excludedTopics: string[]) => {
        ensureWeaveProvider();
        buildController.current?.abort();
        const controller = new AbortController();
        const version = ++buildVersion.current;
        buildController.current = controller;
        const suggestion = await serviceRef.current.suggestWeaveTopic(excludedTopics, controller.signal);
        controller.signal.throwIfAborted();
        if (version !== buildVersion.current) throw new DOMException('Request cancelled.', 'AbortError');
        return suggestion;
    }, [ensureWeaveProvider]);

    useEffect(() => {
        const record = loadCanvasHistory(localStorage);
        historyRef.current = record.history;
        setHistory(record.history);
        if (record.current) installCanvas(record.current);
        else setIsLauncherOpen(true);
        setCacheLoaded(true);
        return () => invalidateOperations();
    }, [installCanvas]);

    const handleSettingsSaved = () => {
        const selectedConfig = getEffectiveConfig();
        const service = createAIService(selectedConfig);
        invalidateOperations();
        serviceRef.current = service;
        setAiService(service);
        dismissRelationships();
        setLoading(false);
        setIsDiscovering(false);
        setIsTracing(false);
        setPopoverState(previous => ({ ...previous, isOpen: false, loading: false }));
        setLauncherPhase('idle');
        setToast({ message: 'Settings saved. New requests use ' + providerNames[selectedConfig.provider] + '. Choose Weave New Canvas to start a timeline.', type: 'success' });
    };


    const handleYearClick = (year: number, sortedFigures: HistoricalFigure[]) => {
        dismissRelationships();
        setSelectedYear(year);
        setSelectedFigures(sortedFigures);
        if (sortedFigures.length > 0) setIsSidebarCollapsed(false);
    };

    const runRelationshipAction = async (sourceFigure: HistoricalFigure, action: 'map' | 'expand') => {
        const storage = canvasStorage.current;
        if (action === 'expand' && config.weaveContext?.mode === 'figure'
            && getCanvasFocusFigure(figures, config.weaveContext, config.seedFigureId)?.id !== sourceFigure.id) {
            setToast({ message: 'Follow a Figure canvases can only be expanded from the focus figure.', type: 'info' });
            return;
        }
        if (!relationshipState) overlayInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        relationshipDetailReturn.current = null;
        popoverVersion.current++;
        setPopoverState(previous => ({ ...previous, isOpen: false }));
        const { signal, isCurrent } = beginRelationshipAction();
        const requestId = traceVersion.current;
        setToast(null);
        setIsTracing(action === 'map');
        setIsDiscovering(action === 'expand');
        // Disable search auto-framing so the existing camera stays put throughout.
        setIsSearchFocusActive(false);
        setRelationshipState({ sourceFigure, relatedIds: [], action, status: 'loading', requestId });
        const update = (next: Partial<RelationshipOverlayState>) => {
            if (isCurrent()) setRelationshipState(previous => previous?.requestId === requestId ? { ...previous, ...next } : previous);
        };
        try {
            const { relatedIds, newFigures, expansionAttempted } = await resolveRelationshipAction({
                service: aiService, source: sourceFigure, figures, action, config,
                knownIds: [...(knownRelationships.get(sourceFigure.id) || [])],
                storage, signal,
                onExpansionFallback: () => {
                    if (!isCurrent()) return;
                    update({ message: 'No connections found on the timeline. Looking for new related figures...' });
                    setIsTracing(false);
                    setIsDiscovering(true);
                },
            });
            if (!isCurrent()) return;
            const updatedFigures = [...figures, ...newFigures];
            saveRelationshipMap(sourceFigure, updatedFigures, relatedIds, storage, expansionAttempted);
            setKnownRelationships(previous => new Map(previous).set(sourceFigure.id, new Set(relatedIds)));
            if (newFigures.length) {
                const newIds = newFigures.map(figure => figure.id);
                if (config.layoutMode === 'timeline') {
                    setClusterState(previous => addDiscoveryCluster(previous, sourceFigure.id, newIds, currentPlacements.current));
                }
                setFigures(updatedFigures);
                setNewlyDiscoveredIds(new Set(newIds));
                setToast({ message: `Discovered ${newFigures.length} new figures: ${newFigures.map(figure => figure.name).join(', ')}`, type: 'success' });
            }
            update({ relatedIds, status: relatedIds.length ? 'results' : 'empty', message: relatedIds.length ? undefined : `No new verified connections for ${sourceFigure.name} in this period.` });
        } catch (error) {
            if (isCurrent()) {
                const message = getUserErrorMessage(error, 'We could not find historical connections this time. Please try again.');
                update({ status: 'error', message });
                setToast({ message, type: 'error' });
            }
        } finally {
            if (isCurrent()) {
                setIsDiscovering(false);
                setIsTracing(false);
            }
        }
    };

    const handleTraceRelationships = (figure: HistoricalFigure) => runRelationshipAction(figure, 'map');
    const handleDiscover = (figure: HistoricalFigure) => runRelationshipAction(figure, 'expand');

    const openFigureRelationship = async (sourceFigure: HistoricalFigure, targetFigure: HistoricalFigure) => {
        const storage = canvasStorage.current;
        if (!relationshipState && !popoverState.isOpen) {
            overlayInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        relationshipDetailReturn.current = null;
        const version = operationVersion.current;
        const request = ++popoverVersion.current;
        const signal = operationController.current.signal;
        const isCurrent = () => !signal.aborted && operationVersion.current === version && popoverVersion.current === request;

        const rejectRelationship = () => {
            setPopoverState(previous => ({ ...previous, isOpen: false, loading: false }));
            setToast({ message: `No verified historical connection between ${sourceFigure.name} and ${targetFigure.name}.`, type: 'info' });
            if (getCanvasFocusFigure(figures, config.weaveContext, config.seedFigureId)?.id === sourceFigure.id) {
                setFigures(previous => discardRejectedFollowFigureCandidates(previous, config.weaveContext, storage, config.seedFigureId));
                setSelectedFigures(previous => previous.filter(figure => figure.id !== targetFigure.id));
                setHighlightedFigureIds(previous => previous.filter(id => id !== targetFigure.id));
                setCurrentSearchIndex(0);
            }
            setRelationshipState(previous => previous?.sourceFigure.id === sourceFigure.id
                ? { ...previous, relatedIds: previous.relatedIds.filter(id => id !== targetFigure.id) } : previous);
        };
        const assessment = readRelationshipAssessment(sourceFigure, targetFigure, storage);
        if (assessment?.isRelevant === false) {
            rejectRelationship();
            return;
        }

        setPopoverState({
            isOpen: true,
            target: targetFigure,
            source: sourceFigure,
            data: null,
            loading: true,
            mode: 'relationship'
        });

        const cacheKey = `chrono_rel_${sourceFigure.id}_${targetFigure.id}`;
        const reverseCacheKey = `chrono_rel_${targetFigure.id}_${sourceFigure.id}`;
        for (const key of [cacheKey, reverseCacheKey]) {
            const cached = storage.getItem(key);
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
                storage.removeItem(key);
            }
        }

        try {
            const [assessed, detailsMap] = await Promise.all([
                assessRelationships(aiService, sourceFigure, [targetFigure], storage, signal),
                fetchBatchFigureDetails([sourceFigure, targetFigure])
            ]);

            if (!isCurrent()) return;
            const explanation = assessed.get(targetFigure.id);
            if (!explanation) {
                rejectRelationship();
                return;
            }

            const combinedData: RelationshipData = {
                explanation,
                sourceDetail: detailsMap.get(sourceFigure.id),
                targetDetail: detailsMap.get(targetFigure.id)
            };

            if (explanation) storage.setItem(cacheKey, JSON.stringify(combinedData));

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
                setToast({ message: getUserErrorMessage(error, 'We could not explain this relationship. Please try again.'), type: 'error' });
                setPopoverState(prev => ({ ...prev, loading: false }));
            }
        }
    };

    const handleRelationshipCardClick = (targetFigure: HistoricalFigure) => {
        if (relationshipState) return openFigureRelationship(relationshipState.sourceFigure, targetFigure);
    };

    const handleInspectFigure = async (figure: HistoricalFigure, returnToRelationship = false) => {
        const storage = canvasStorage.current;
        if (!relationshipState && !popoverState.isOpen) {
            overlayInvoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        relationshipDetailReturn.current = returnToRelationship ? popoverState : null;
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
        const cached = storage.getItem(cacheKey);

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
                storage.removeItem(cacheKey);
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

                storage.setItem(cacheKey, JSON.stringify(deepDiveData));

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
                setToast({ message: 'We could not find a biography this time. Please try again.', type: 'error' });
            }
        } catch (error) {
            if (isCurrent()) {
                setToast({ message: getUserErrorMessage(error, 'We could not load this biography. Please try again.'), type: 'error' });
                setPopoverState(prev => ({ ...prev, loading: false }));
            }
        }
    };

    const handleEmptyClick = () => {
        dismissRelationships();
        setHighlightedFigureIds([]);
        setIsSearchFocusActive(false);
        setSelectedFigures([]);
        setSelectedYear(null);
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
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

    const availableCategories = useMemo(() => config.weaveContext && !config.weaveContext.activeCategories.includes('ALL')
        ? CATEGORY_LIST.filter(category => config.weaveContext!.activeCategories.includes(category))
        : CATEGORY_LIST, [config]);
    const hasCategoryFilters = availableCategories.length > 1;

    const toggleCategory = useCallback((category: FigureCategory) => {
        if (!availableCategories.includes(category)) return;
        setSelectedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    }, [availableCategories]);

    const closePopover = useCallback(() => {
        popoverVersion.current++;
        const previousRelationship = relationshipDetailReturn.current;
        relationshipDetailReturn.current = null;
        setPopoverState(prev => previousRelationship ?? { ...prev, isOpen: false });
    }, []);

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

    const isBusy = loading || launcherPhase !== 'idle' || isDiscovering || isTracing;
    const toggleCanvasLayout = () => {
        if (isBusy || !figures.length) return;
        setConfig(previous => ({ ...previous,
            layoutMode: previous.layoutMode === 'gallery' ? 'timeline' : 'gallery',
            layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'manual' }));
        setInitialLayout(null);
        setHoverYear(null);
        setSelectedYear(null);
        setSelectedFigures([]);
    };
    const CanvasComponent = config.layoutMode === 'gallery' ? GalleryCanvas : TimelineCanvas;
    const focusFigure = getCanvasFocusFigure(figures, config.weaveContext, config.seedFigureId);
    const isFollowingFigure = config.weaveContext?.mode === 'figure';
    const handleCanvasRelationship = (figure: HistoricalFigure) => {
        if (!focusFigure || figure.id === focusFigure.id || isBusy) return;
        void openFigureRelationship(focusFigure, figure);
    };

    return (
        <div className="relative w-screen h-screen overflow-hidden font-sans text-content-primary bg-canvas" data-canvas-wheel-scope>
            <div className="absolute inset-0" inert={isLauncherOpen || !!relationshipState || popoverState.isOpen || isSettingsOpen}>
            <ControlPanel
                searchQuery={searchQuery}
                onOpenLauncher={openLauncher}
                isBuilding={loading || launcherPhase !== 'idle'}
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

            {hasCategoryFilters && <Legend
                selectedCategories={selectedCategories}
                availableCategories={availableCategories}
                onToggleCategory={toggleCategory}
                isOpen={isLegendOpen}
                onToggleOpen={() => setIsLegendOpen(prev => !prev)}
            />}

            <div className="absolute inset-0 z-0">
                <CanvasComponent
                    key={canvasRevision}
                    figures={figures}
                    startYear={config.start}
                    endYear={config.end}
                    onHoverYear={setHoverYear}
                    onYearClick={handleYearClick}
                    onEmptyClick={handleEmptyClick}
                    selectedYear={selectedYear}
                    clusters={clusterState.clusters}
                    clusterPlacements={clusterState.placements}
                    onPlacementsResolved={handlePlacementsResolved}
                    initialLayout={initialLayout}
                    initialCamera={cameras.current[config.layoutMode]}
                    onCameraChange={config.layoutMode === 'gallery' ? handleGalleryCamera : handleTimelineCamera}
                    seedFigureId={focusFigure?.id}
                    isSidebarOpen={sortedSidebarFigures.length > 0 && !isSidebarCollapsed}
                    modalActive={isLauncherOpen || !!relationshipState || popoverState.isOpen || isSettingsOpen}
                    relationshipSourceId={relationshipState?.sourceFigure.id}
                    highlightedFigureIds={highlightedFigureIds}
                    focusedFigureId={focusedFigureId}
                    isSearchFocusActive={isSearchFocusActive}
                    newlyDiscoveredIds={newlyDiscoveredIds}
                    onDiscover={handleDiscover}
                    onTrace={handleTraceRelationships}
                    onInspect={handleInspectFigure}
                    onRelationship={focusFigure ? handleCanvasRelationship : undefined}
                    isFollowingFigure={isFollowingFigure}
                    isDiscovering={isDiscovering}
                    onCanvasInteraction={handleCanvasInteraction}
                    isBusy={isBusy}
                    selectedCategories={selectedCategories}
                    isLegendCollapsed={!hasCategoryFilters || !isLegendOpen}
                />
            </div>

            {figures.length > 0 && <CanvasLayoutToggle
                mode={config.layoutMode}
                onToggle={toggleCanvasLayout}
                disabled={isBusy}
            />}

            {loading && !isLauncherOpen && (
                <ProgressOverlay title="CONSULTING THE ARCHIVES" />
            )}

            <Sidebar
                key={activeCanvas?.id}
                initialView={initialSidebarView}
                onViewChange={handleSidebarView}
                selectedFigures={sortedSidebarFigures}
                currentYear={selectedYear}
                onTraceRelationships={handleTraceRelationships}
                onDiscover={handleDiscover}
                onInspect={handleInspectFigure}
                activeTracingFigureId={relationshipState?.sourceFigure.id}
                focusFigureId={focusFigure?.id}
                isFollowingFigure={isFollowingFigure}
                onRelationship={focusFigure ? handleCanvasRelationship : undefined}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
                selectedCategories={selectedCategories}
                isLegendOpen={hasCategoryFilters && isLegendOpen}
                isGlobalView={selectedYear === null}
            />

            </div>

            {!isLauncherOpen && !isSettingsOpen && <CanvasHistory canvases={history} onSelect={commitCanvas} />}

            {isLauncherOpen && <WeaveLauncherOverlay
                historyControl={<CanvasHistory canvases={history} onSelect={commitCanvas} orientation="horizontal" />}
                initialStartYear={config.start}
                initialEndYear={config.end}
                phase={launcherPhase}
                onClose={closeLauncher}
                onSubmit={buildTimeline}
                onSurprise={suggestWeaveTopic}
                onOpenSettings={() => { closeLauncher(); setIsSettingsOpen(true); }}
            />}

            {relationshipState && <RelationshipOverlay
                key={relationshipState.requestId}
                state={relationshipState}
                figures={figures}
                detailOpen={popoverState.isOpen}
                onClose={dismissRelationships}
                onRetry={() => runRelationshipAction(relationshipState.sourceFigure, relationshipState.action)}
                onInspect={handleInspectFigure}
                onRelationship={handleRelationshipCardClick}
            />}

            <RelationshipPopover
                isOpen={popoverState.isOpen}
                source={popoverState.source}
                target={popoverState.target}
                data={popoverState.data}
                isLoading={popoverState.loading}
                onClose={closePopover}
                onInspect={figure => handleInspectFigure(figure, true)}
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
