
import { FigureCategory } from './types';

export const CATEGORY_COLORS: Record<FigureCategory, string> = {
  'ARTISTS': '#b7e1f3',
  'BUSINESS': '#f9c908',
  'ENTERTAINERS': '#e879f9', // Changed to Fuchsia to differentiate from Writers
  'EXPLORERS': '#f35844',
  'LEADERS & BADDIES': '#000000',
  'SCIENTISTS': '#81599b',
  'THINKERS': '#aad356',
  'WRITERS': '#189aa8',
  'EVENTS': '#bdb48e' // Khaki for Events
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

// export const HISTORICAL_FIGURES_COUNT = 60;
// export const HISTORICAL_FIGURES_PER_CENTURY_CHUNK = 20;
// export const HISTORICAL_EVENTS_COUNT = 30;
// export const HISTORICAL_EVENTS_PER_CENTURY_CHUNK = 5;

export const HISTORICAL_FIGURES_COUNT = 20;
export const HISTORICAL_FIGURES_PER_CENTURY_CHUNK = 3;
export const HISTORICAL_EVENTS_COUNT = 10;
export const HISTORICAL_EVENTS_PER_CENTURY_CHUNK = 3;
