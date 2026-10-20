
export type FigureCategory = 
  | 'ARTISTS' 
  | 'BUSINESS' 
  | 'ENTERTAINERS' 
  | 'EXPLORERS' 
  | 'LEADERS & BADDIES'
  | 'SCIENTISTS' 
  | 'THINKERS' 
  | 'WRITERS'
  | 'EVENTS';

export type WeaveMode = 'time-span' | 'era' | 'figure' | 'region' | 'theme' | 'freeform';
export type CanvasLayoutMode = 'timeline' | 'gallery';
export type CanvasLayoutSelection = 'automatic' | 'manual';

export interface CanvasConfig {
  start: number;
  end: number;
  weaveContext?: WeaveGenerationContext;
  layoutMode: CanvasLayoutMode;
  layoutVersion: number;
  layoutSelection: CanvasLayoutSelection;
  seedFigureId?: string;
  // People Six Degrees connections brought in (see utils/connectionGuests): figure id to the saved path keys that need them.
  guests?: Record<string, string[]>;
  // Guests moved to the main canvas: still listed in `guests` (so the move can be undone), laid out with everyone else.
  movedToMain?: string[];
  // Categories that only such moves added to `weaveContext.activeCategories`, taken out again when no one needs them.
  movedCategories?: FigureCategory[];
}

export interface SidebarViewState {
  mode: 'FIGURES' | 'EVENTS';
  scrollPositions: { FIGURES: number; EVENTS: number };
}

export interface CanvasViewSnapshot {
  cameras: Partial<Record<CanvasLayoutMode, { x: number; y: number; scale: number }>>;
  selectedYear: number | null;
  selectedFigureIds: string[];
  selectedCategories: FigureCategory[];
  isSidebarCollapsed: boolean;
  isLegendOpen: boolean;
  sidebar: SidebarViewState;
  searchQuery: string;
  highlightedFigureIds: string[];
  currentSearchIndex: number;
  guestVisibility: 'show' | 'dim' | 'hide';
}

export interface CanvasSnapshot {
  id: string;
  createdAt: number;
  config: CanvasConfig;
  figures: HistoricalFigure[];
  clusters: DiscoveryClusterState;
  view: CanvasViewSnapshot;
  cache: Record<string, string>;
}

export interface CanvasHistoryRecord {
  version: 1;
  current: CanvasSnapshot | null;
  history: CanvasSnapshot[];
}

export interface WeaveRequest {
  mode: WeaveMode;
  query: string;
  startYear?: number;
  endYear?: number;
}

export interface WeaveValidationResult {
  isValid: boolean;
  errorMessage: string | null;
  inferredStartYear: number;
  inferredEndYear: number;
  themeDescription: string;
  activeCategories: Array<FigureCategory | 'ALL'>;
}

export interface WeaveGenerationContext {
  mode: WeaveMode;
  query: string;
  inferredStartYear: number;
  inferredEndYear: number;
  themeDescription: string;
  activeCategories: Array<FigureCategory | 'ALL'>;
}

export interface HistoricalFigure {
  id: string;
  name: string;
  birthYear: number;
  deathYear: number;
  occupation: string;
  category: FigureCategory;
  // Detailed info fetched lazily
  shortDescription?: string;
  imageUrl?: string;
  isDetailsLoading?: boolean;
}

export interface TimelineConfig {
  startYear: number;
  endYear: number;
  weaveContext?: WeaveGenerationContext;
}

export interface ViewState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface TimelineItemProps {
  figure: HistoricalFigure;
  level: number;
  pixelsPerYear: number;
  minStartYear: number;
}

export interface LayoutData {
  figure: HistoricalFigure;
  level: number;
  // For short events with floating labels
  labelLevel?: number;     // The row index where the label sits (can be different from bar level)
  labelYearOffset?: number; // How many years from birthYear the label starts
}

export interface DiscoveryCluster {
  sourceId: string;
  memberIds: string[];
}

export type ClusterPlacement = Pick<LayoutData, 'level' | 'labelLevel' | 'labelYearOffset'>;

export interface DiscoveryClusterState {
  clusters: DiscoveryCluster[];
  placements: Record<string, ClusterPlacement>;
}

export interface DeepDiveData {
  summary: string;
  famousQuote: string;
  sections: { title: string; content: string }[];
}

export interface RelationshipExplanation {
    // Optional for compatibility with explanations cached before relevance checks.
    isRelevant?: boolean;
    evidence?: string;
    summary: string;
    sections: { title: string; content: string }[];
}

export type InteractionMode = 'select' | 'pan' | 'zoom';

// A person proposed or identified by the model who may not be on the canvas yet.
export interface NewPerson {
  name: string;
  birthYear: number;
  deathYear: number;
  occupation: string;
  category: FigureCategory;
  description: string;
}

export interface PathCatalogEntry {
  id: string;
  name: string;
  birthYear: number;
  deathYear: number;
}

export interface ConnectionPathOptions {
  // Canvas people the model may reference by id.
  catalog: PathCatalogEntry[];
  // Most people allowed strictly between the two endpoints.
  maxIntermediates: number;
}

export type ConnectionPathNode = { id: string } | NewPerson;

export interface ConnectionPathProposal {
  nodes: ConnectionPathNode[];
  // The model's reasoning for each consecutive pair. Used for progress labels only, never shown as evidence.
  links: Array<{ claim: string }>;
}

// `contactOnly` is Six Degrees' verification: only a documented personal interaction qualifies.
export interface RelationshipExplanationOptions {
  contactOnly?: boolean;
}

export interface IAIService {
  discoverPersonalContacts(request: import('./services/connectionAI').ContactDiscoveryRequest, signal?: AbortSignal): Promise<import('./services/connectionAI').ContactProposal[]>;
  assessPersonalContacts(pairs: import('./services/connectionAI').ContactPair[], signal?: AbortSignal): Promise<import('./services/connectionAI').ContactAssessmentResult[]>;
  explainPersonalContact(first: import('./services/connectionGraph').ContactPerson, second: import('./services/connectionGraph').ContactPerson, contact: import('./services/connectionGraph').ContactAssessment, signal?: AbortSignal): Promise<RelationshipExplanation>;
  validateWeaveQuery(request: WeaveRequest, signal?: AbortSignal): Promise<WeaveValidationResult>;
  suggestWeaveTopic(excludedTopics?: string[], signal?: AbortSignal, broadenTopic?: string): Promise<WeaveValidationResult>;
  fetchHistoricalFigures(start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]>;
  fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[], signal?: AbortSignal): Promise<string[]>;
  discoverRelatedFigures(target: HistoricalFigure, existingNames: string[], start: number, end: number, signal?: AbortSignal, context?: WeaveGenerationContext): Promise<HistoricalFigure[]>;
  fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure, signal?: AbortSignal, options?: RelationshipExplanationOptions): Promise<RelationshipExplanation | null>;
  fetchFigureDeepDive(figure: HistoricalFigure, signal?: AbortSignal): Promise<DeepDiveData | null>;
  fetchConnectionPath(from: HistoricalFigure, to: HistoricalFigure, options: ConnectionPathOptions, signal?: AbortSignal): Promise<ConnectionPathProposal | null>;
  resolveFigure(name: string, signal?: AbortSignal): Promise<NewPerson | null>;
  testConnection(signal?: AbortSignal): Promise<{ success: boolean; error?: string }>;
}
