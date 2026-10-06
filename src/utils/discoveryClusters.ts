import { ClusterPlacement, DiscoveryCluster, DiscoveryClusterState, HistoricalFigure, LayoutData } from '../types';

export const CLUSTER_STORAGE_KEY = 'chrono_timeline_clusters';
export const emptyClusters = (): DiscoveryClusterState => ({ clusters: [], placements: {} });

const timelineIdentity = (figures: HistoricalFigure[]) => JSON.stringify(
  figures.map(({ id, name, birthYear, deathYear, occupation, category }) => [id, name, birthYear, deathYear, occupation, category]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
);

export function serializeClusters(figures: HistoricalFigure[], state: DiscoveryClusterState): string {
  return JSON.stringify({ version: 1, timeline: timelineIdentity(figures), ...state });
}

export function restoreClusters(raw: string | null, figures: HistoricalFigure[], enabled: boolean): DiscoveryClusterState {
  if (!enabled || !raw) return emptyClusters();
  try {
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || saved.timeline !== timelineIdentity(figures) || !Array.isArray(saved.clusters)) return emptyClusters();
    const ids = new Set(figures.map(figure => figure.id));
    const clusters: DiscoveryCluster[] = saved.clusters.flatMap((cluster: DiscoveryCluster) => {
      if (!cluster || !ids.has(cluster.sourceId) || !Array.isArray(cluster.memberIds)) return [];
      const memberIds = [...new Set([cluster.sourceId, ...cluster.memberIds.filter(id => ids.has(id))])];
      return [{ sourceId: cluster.sourceId, memberIds }];
    });
    const members = new Set(clusters.flatMap(cluster => cluster.memberIds));
    const placements: Record<string, ClusterPlacement> = {};
    for (const id of members) {
      const placement = saved.placements && Object.hasOwn(saved.placements, id) ? saved.placements[id] : undefined;
      // Bound saved rows to avoid allocating enormous arrays from invalid metadata.
      if (!placement || !Number.isSafeInteger(placement.level) || placement.level < 0 || placement.level > figures.length * 12) continue;
      if (placement.labelLevel !== undefined && (!Number.isFinite(placement.labelLevel) || placement.labelLevel < 0 || Math.abs(placement.labelLevel - placement.level) !== 0.5)) continue;
      if (placement.labelLevel !== undefined && !Number.isFinite(placement.labelYearOffset)) continue;
      placements[id] = { level: placement.level, labelLevel: placement.labelLevel, labelYearOffset: placement.labelYearOffset };
    }
    return { clusters, placements };
  } catch {
    return emptyClusters();
  }
}

export function addDiscoveryCluster(state: DiscoveryClusterState, sourceId: string, newIds: string[], currentPlacements: Record<string, ClusterPlacement>): DiscoveryClusterState {
  if (!newIds.length) return state;
  return {
    clusters: [...state.clusters, { sourceId, memberIds: [...new Set([sourceId, ...newIds])] }],
    placements: { ...state.placements, ...(!state.placements[sourceId] && currentPlacements[sourceId] ? { [sourceId]: currentPlacements[sourceId] } : {}) },
  };
}

// Reserve fixed members first, then search outwards from each cluster's source.
// Ordinary figures fill remaining chronological gaps without moving retained members.
export function placeClusterBars(figures: HistoricalFigure[], clusters: DiscoveryCluster[], placements: Record<string, ClusterPlacement>, occupiedWidth: (figure: HistoricalFigure) => number): LayoutData[] {
  const rows: { start: number; end: number }[][] = [];
  const result = new Map<string, LayoutData>();
  const members = new Set(clusters.flatMap(cluster => cluster.memberIds));
  const byId = new Map(figures.map(figure => [figure.id, figure]));
  const fits = (figure: HistoricalFigure, row: number) => !(rows[row] ?? []).some(interval => figure.birthYear < interval.end + 6 && figure.birthYear + occupiedWidth(figure) + 6 > interval.start);
  const reserve = (figure: HistoricalFigure, placement: ClusterPlacement) => {
    while (rows.length <= placement.level) rows.push([]);
    rows[placement.level].push({ start: figure.birthYear, end: figure.birthYear + occupiedWidth(figure) });
    result.set(figure.id, { figure, ...placement });
  };
  for (const figure of figures) {
    const placement = placements[figure.id];
    if (members.has(figure.id) && placement && fits(figure, placement.level)) reserve(figure, placement);
  }
  const place = (figure: HistoricalFigure, near = 0) => {
    if (result.has(figure.id)) return;
    for (let distance = 0; ; distance++) {
      const candidates = distance === 0 ? [near] : [near + distance, near - distance];
      const row = candidates.find(row => row >= 0 && fits(figure, row));
      if (row !== undefined) { reserve(figure, { level: row }); return; }
    }
  };
  for (const cluster of clusters) {
    const source = byId.get(cluster.sourceId);
    if (!source) continue;
    place(source);
    for (const id of cluster.memberIds) {
      const figure = byId.get(id);
      if (figure) place(figure, result.get(source.id)!.level);
    }
  }
  [...figures].sort((a, b) => a.birthYear - b.birthYear).forEach(figure => place(figure));
  return [...result.values()];
}
