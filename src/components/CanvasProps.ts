import type { FigureCategory, HistoricalFigure, LayoutData, DiscoveryCluster, ClusterPlacement } from '../types';
import type { TimelineLayoutResult } from '../utils/timelineLayout';
import type { CanvasCamera } from '../utils/canvasCamera';
import type { ConnectionFocusRequest, ConnectionReveal } from '../hooks/useConnectionReveal';
import type { ConnectionPathEntry } from '../utils/connectionPaths';

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
  initialCamera?: CanvasCamera;
  onCameraChange?: (camera: CanvasCamera) => void;
  onToggleLayout?: () => void;
  modalActive: boolean;
  relationshipSourceId?: string;
  highlightedFigureIds: string[];
  focusedFigureId?: string | null;
  isSearchFocusActive?: boolean;
  onDiscover?: (figure: HistoricalFigure) => void;
  onTrace?: (figure: HistoricalFigure) => void;
  onInspect?: (figure: HistoricalFigure) => void;
  onRelationship?: (figure: HistoricalFigure) => void;
  isFollowingFigure?: boolean;
  isDiscovering?: boolean;
  onCanvasInteraction?: () => void;
  isBusy?: boolean;
  selectedCategories: Set<FigureCategory>;
  // Six Degrees guests: laid out apart from everyone else, and dimmed when the legend says so.
  guestIds?: ReadonlySet<string>;
  dimGuests?: boolean;
  onPromoteGuest?: (figure: HistoricalFigure) => void;
  // Guests moved to the main canvas, which can be moved back.
  movedToMainIds?: ReadonlySet<string>;
  onDemoteGuest?: (figure: HistoricalFigure) => void;
  // The saved connections each person is on, the portraits of their ends, and playing one.
  connectionsByFigure?: ReadonlyMap<string, ConnectionPathEntry[]>;
  connectionPortraits?: ReadonlyMap<string, string>;
  onShowConnection?: (entry: ConnectionPathEntry) => void;
  isLegendCollapsed: boolean;
  seedFigureId?: string;
  isSidebarOpen?: boolean;
  onConnect?: (figure: HistoricalFigure) => void;
  // Six Degrees: choosing the other end of a chain. Bars that cannot be chosen are dimmed.
  pickingSource?: HistoricalFigure | null;
  isPickable?: (figure: HistoricalFigure) => boolean;
  onPick?: (figure: HistoricalFigure) => void;
  // Six Degrees: the chain to draw as a thread, the person the camera is on, and a request to fly to someone.
  connection?: ConnectionReveal | null;
  connectionCurrentId?: string | null;
  connectionFocus?: ConnectionFocusRequest | null;
  onConnectionStep?: (index: number | null) => void;
  onConnectionRevealEnd?: () => void;
  // Leaves the connection view: Escape after the reveal, or a click on a ghosted person.
  onConnectionExit?: () => void;
}
