
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

export interface IAIService {
  fetchHistoricalFigures(start: number, end: number, signal?: AbortSignal): Promise<HistoricalFigure[]>;
  fetchRelatedFigures(target: HistoricalFigure, allFigures: HistoricalFigure[], signal?: AbortSignal): Promise<string[]>;
  discoverRelatedFigures(target: HistoricalFigure, existingNames: string[], start: number, end: number, signal?: AbortSignal): Promise<HistoricalFigure[]>;
  fetchRelationshipExplanation(source: HistoricalFigure, target: HistoricalFigure, signal?: AbortSignal): Promise<RelationshipExplanation | null>;
  fetchFigureDeepDive(figure: HistoricalFigure, signal?: AbortSignal): Promise<DeepDiveData | null>;
  testConnection(signal?: AbortSignal): Promise<{ success: boolean; error?: string }>;
}
