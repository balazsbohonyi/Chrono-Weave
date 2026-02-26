
import { FigureCategory } from './types';

export const HISTORICAL_FIGURES_COUNT = 60;
export const HISTORICAL_FIGURES_PER_CENTURY_CHUNK = 20;
export const HISTORICAL_EVENTS_COUNT = 30;
export const HISTORICAL_EVENTS_PER_CENTURY_CHUNK = 5;

// Previous color scheme (commented out for reference):
// export const CATEGORY_COLORS: Record<FigureCategory, string> = {
//   'ARTISTS': '#b7e1f3',
//   'BUSINESS': '#f9c908',
//   'ENTERTAINERS': '#e879f9',
//   'EXPLORERS': '#f35844',
//   'LEADERS & BADDIES': '#000000',
//   'SCIENTISTS': '#81599b',
//   'THINKERS': '#aad356',
//   'WRITERS': '#189aa8',
//   'EVENTS': '#bdb48e'
// };

export const CATEGORY_COLORS: Record<FigureCategory, string> = {
  'ARTISTS': '#60A5FA', // blue
  'BUSINESS': '#FBBF24', // amber
  'ENTERTAINERS': '#84CC16', // bright yellow-green
  'EVENTS': '#A8B5C8', // medium slate gray (slightly muted)
  'EXPLORERS': '#EF4444', // red
  'LEADERS & BADDIES': '#1E293B', // dark slate
  'SCIENTISTS': '#8B5CF6', // violet
  'THINKERS': '#10B981', // emerald
  'WRITERS': '#06B6D4' // cyan
};

// Sorted Alphabetically
export const CATEGORY_LIST: FigureCategory[] = [
  'ARTISTS',
  'BUSINESS',
  'ENTERTAINERS',
  'EVENTS',
  'EXPLORERS',
  'LEADERS & BADDIES',
  'SCIENTISTS',
  'THINKERS',
  'WRITERS'
];
