import type { FigureCategory, HistoricalFigure, LayoutData, DiscoveryCluster, ClusterPlacement } from '../types';
import type { TimelineLayoutResult } from '../utils/timelineLayout';

export interface CanvasProps {
  figures: HistoricalFigure[];
  startYear: number;
  endYear: number;
  onHoverYear: (year: number | null) => void;
  onYearClick: (year: number, figures: HistoricalFigure[]) => void;
  onEmptyClick: () => void;
  selectedYear: number | null;
  clusters: DiscoveryCluster[];
  clusterPlacements: Record<string, ClusterPlacement>;
  onPlacementsResolved: (layout: LayoutData[]) => void;
  initialLayout?: { figures: HistoricalFigure[]; result: TimelineLayoutResult } | null;
  modalActive: boolean;
  relationshipSourceId?: string;
  highlightedFigureIds: string[];
  focusedFigureId?: string | null;
  isSearchFocusActive?: boolean;
  newlyDiscoveredIds?: Set<string>;
  onDiscover?: (figure: HistoricalFigure) => void;
  onTrace?: (figure: HistoricalFigure) => void;
  onInspect?: (figure: HistoricalFigure) => void;
  onRelationship?: (figure: HistoricalFigure) => void;
  isFollowingFigure?: boolean;
  isDiscovering?: boolean;
  onCanvasInteraction?: () => void;
  isBusy?: boolean;
  selectedCategories: Set<FigureCategory>;
  isLegendCollapsed: boolean;
  seedFigureId?: string;
  isSidebarOpen?: boolean;
}
