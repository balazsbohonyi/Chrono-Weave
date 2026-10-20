import type { CanvasConfig, ClusterPlacement, DiscoveryClusterState, FigureCategory, HistoricalFigure } from '../types';
import { addDiscoveryCluster } from './discoveryClusters';

// Padding, in years, added beyond woven-in people who fall outside the canvas range.
export const CONNECTION_RANGE_PADDING = 20;

// Each consecutive run of new people hangs from the existing chain node just before it,
// so the people who bridge a gap sit next to the person they were found through.
export function connectionClusterRuns(chain: readonly HistoricalFigure[], newIds: ReadonlySet<string>): Array<{ sourceId: string; memberIds: string[] }> {
  const runs: Array<{ sourceId: string; memberIds: string[] }> = [];
  chain.forEach((person, index) => {
    if (!newIds.has(person.id) || index === 0) return;
    const previous = chain[index - 1];
    if (newIds.has(previous.id)) runs[runs.length - 1]?.memberIds.push(person.id);
    else runs.push({ sourceId: previous.id, memberIds: [person.id] });
  });
  return runs;
}

// Grows the canvas range only as far as the new people need.
export function extendConnectionRange(range: Pick<CanvasConfig, 'start' | 'end'>, people: readonly HistoricalFigure[],
  padding = CONNECTION_RANGE_PADDING): Pick<CanvasConfig, 'start' | 'end'> {
  if (!people.length) return range;
  const earliest = Math.min(...people.map(person => person.birthYear));
  const latest = Math.max(...people.map(person => person.deathYear));
  return {
    start: earliest < range.start ? Math.floor((earliest - padding) / 10) * 10 : range.start,
    end: latest > range.end ? Math.ceil((latest + padding) / 10) * 10 : range.end,
  };
}

export interface WovenCanvas {
  figures: HistoricalFigure[];
  config: CanvasConfig;
  clusters: DiscoveryClusterState;
  selectedCategories: Set<FigureCategory>;
  newIds: string[];
}

interface WeaveInput {
  figures: HistoricalFigure[];
  config: CanvasConfig;
  clusters: DiscoveryClusterState;
  placements: Record<string, ClusterPlacement>;
  selectedCategories: Set<FigureCategory>;
  chain: HistoricalFigure[];
  newFigures: HistoricalFigure[];
}

// The canvas after a verified chain is woven in: people are added as permanent members, in clusters on
// the timeline layout and plainly on the gallery, with the range and category scope widened to show them.
export function weaveConnectionIntoCanvas({ figures, config, clusters, placements, selectedCategories, chain, newFigures }: WeaveInput): WovenCanvas {
  const existing = new Set(figures.map(figure => figure.id));
  const added = newFigures.filter((figure, index) => !existing.has(figure.id) && newFigures.findIndex(other => other.id === figure.id) === index);
  if (!added.length) return { figures, config, clusters, selectedCategories, newIds: [] };
  const newIds = new Set(added.map(figure => figure.id));
  const context = config.weaveContext;
  const categories = new Set(added.map(figure => figure.category));
  return {
    figures: [...figures, ...added],
    config: {
      ...config, ...extendConnectionRange(config, added),
      ...(context && !context.activeCategories.includes('ALL')
        ? { weaveContext: { ...context, activeCategories: [...new Set([...context.activeCategories, ...categories])] } } : {}),
    },
    clusters: config.layoutMode === 'timeline'
      ? connectionClusterRuns(chain, newIds).reduce((state, run) => addDiscoveryCluster(state, run.sourceId, run.memberIds, placements), clusters)
      : clusters,
    // An empty filter already shows everything; an active one must not hide the people just added.
    selectedCategories: selectedCategories.size ? new Set([...selectedCategories, ...categories]) : selectedCategories,
    newIds: added.map(figure => figure.id),
  };
}
