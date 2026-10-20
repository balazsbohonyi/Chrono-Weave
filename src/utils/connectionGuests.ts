import type { CanvasConfig, CanvasViewSnapshot, HistoricalFigure } from '../types';
import { connectionPathEntry, savedPathIdsByKey, wovenFigureIds, type ConnectionPathEntry } from './connectionPaths';

// People a Six Degrees connection brought onto the canvas are its guests: they are kept apart from the people the canvas
// was woven around, and listed with the connections (saved path keys) that brought them. A guest that no connection
// needs any more leaves the canvas; one promoted to the main canvas is no longer a guest.
export type GuestMap = NonNullable<CanvasConfig['guests']>;
export type GuestVisibility = CanvasViewSnapshot['guestVisibility'];
export const GUEST_VISIBILITIES: GuestVisibility[] = ['show', 'dim', 'hide'];
// Guests woven in before connections recorded them, whose saved path is gone.
export const LEGACY_GUEST_KEY = 'legacy';

// Guests laid out in the "From connections" group: everyone a connection brought in, except those moved to the main canvas.
export function activeGuestIds(config: Pick<CanvasConfig, 'guests' | 'movedToMain'>): Set<string> {
  const moved = new Set(config.movedToMain ?? []);
  return new Set(Object.keys(config.guests ?? {}).filter(id => !moved.has(id)));
}

export function addGuests(guests: GuestMap = {}, ids: readonly string[], key: string): GuestMap {
  if (!ids.length) return guests;
  const next = { ...guests };
  for (const id of ids) next[id] = [...new Set([...(next[id] ?? []), key])];
  return next;
}

// A guest moved to the main canvas becomes part of what the canvas is about: its category joins the canvas categories
// (a filter chip, Expand scope, and kept on reload), remembered in `movedCategories` when only this move needed it.
export function moveToMain(config: CanvasConfig, figure: HistoricalFigure): CanvasConfig {
  if (!config.guests?.[figure.id] || config.movedToMain?.includes(figure.id)) return config;
  const context = config.weaveContext;
  const widen = !!context && !context.activeCategories.includes('ALL') && !context.activeCategories.includes(figure.category);
  return { ...config, movedToMain: [...(config.movedToMain ?? []), figure.id],
    ...(widen ? { weaveContext: { ...context!, activeCategories: [...context!.activeCategories, figure.category] },
      movedCategories: [...new Set([...(config.movedCategories ?? []), figure.category])] } : {}) };
}

// Undoes `moveToMain`. A category a move added leaves the canvas categories once no one on the main canvas has it.
export function moveBackToConnections(config: CanvasConfig, figure: HistoricalFigure, figures: readonly HistoricalFigure[]): CanvasConfig {
  if (!config.movedToMain?.includes(figure.id)) return config;
  const next: CanvasConfig = { ...config, movedToMain: config.movedToMain.filter(id => id !== figure.id) };
  const category = figure.category, context = config.weaveContext;
  if (!context || !config.movedCategories?.includes(category)) return next;
  const guests = activeGuestIds(next);
  if (figures.some(other => other.category === category && !guests.has(other.id))) return next;
  return { ...next, movedCategories: config.movedCategories.filter(other => other !== category),
    weaveContext: { ...context, activeCategories: context.activeCategories.filter(other => other !== category) } };
}

// Forgets one connection: its guests that no other connection brought in are returned as orphaned and leave the canvas,
// except those moved to the main canvas, which simply stop being guests.
export function removeConnectionGuests(config: Pick<CanvasConfig, 'guests' | 'movedToMain'>, key: string): { guests: GuestMap; movedToMain: string[]; orphaned: string[] } {
  const moved = new Set(config.movedToMain ?? []);
  const guests: GuestMap = {}, orphaned: string[] = [];
  for (const [id, keys] of Object.entries(config.guests ?? {})) {
    const remaining = keys.filter(other => other !== key);
    if (remaining.length) guests[id] = remaining;
    else if (!moved.has(id)) orphaned.push(id);
  }
  return { guests, movedToMain: [...moved].filter(id => id in guests), orphaned };
}

// Only guests still on the canvas, each with at least one connection.
export function normalizeGuests(value: unknown, figureIds: ReadonlySet<string>): GuestMap {
  const guests: GuestMap = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return guests;
  for (const [id, keys] of Object.entries(value)) {
    if (!figureIds.has(id) || !Array.isArray(keys)) continue;
    const valid = [...new Set(keys.filter((key): key is string => typeof key === 'string' && !!key))];
    if (valid.length) guests[id] = valid;
  }
  return guests;
}

// Canvases saved before guests were recorded: everyone a connection wove in becomes a guest of the saved
// connections they are on, or of the legacy key when those connections are gone. Endpoints that were already
// on the canvas were never woven in, so they stay where they are.
export function migrateGuests(figures: readonly HistoricalFigure[], storage: Storage): GuestMap {
  const onCanvas = new Set(figures.map(figure => figure.id));
  const woven = [...wovenFigureIds(storage)].filter(id => onCanvas.has(id));
  if (!woven.length) return {};
  const paths = savedPathIdsByKey(storage);
  return Object.fromEntries(woven.map(id => {
    const keys = [...paths].filter(([, ids]) => ids.includes(id)).map(([key]) => key);
    return [id, keys.length ? keys : [LEGACY_GUEST_KEY]];
  }));
}

export function splitGuests<T extends HistoricalFigure>(figures: readonly T[], guestIds: ReadonlySet<string>): { core: T[]; guests: T[] } {
  const core: T[] = [], guests: T[] = [];
  for (const figure of figures) (guestIds.has(figure.id) ? guests : core).push(figure);
  return { core, guests };
}

// The saved connections each person on the canvas is on (an end or a link of the chain), newest first: guests, those moved
// to the main canvas and everyone else alike. Connections whose saved path was evicted are not listed.
export function figureConnections(storage: Storage, figures: HistoricalFigure[]): Map<string, ConnectionPathEntry[]> {
  const result = new Map<string, ConnectionPathEntry[]>();
  for (const key of savedPathIdsByKey(storage).keys()) {
    const entry = connectionPathEntry(storage, key, figures);
    if (entry) for (const person of entry.figures) result.set(person.id, [...(result.get(person.id) ?? []), entry]);
  }
  for (const entries of result.values()) entries.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}
