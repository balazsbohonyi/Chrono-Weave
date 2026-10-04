
import { FigureCategory } from './types';

// AI prompt configuration. Counts are requests, not guaranteed output sizes.
// Ranges <= the threshold use whole-range figures; longer ranges use chunks.
// Whole-range events are always requested, in addition to events per chunk.
export const HISTORICAL_FIGURES_COUNT = 60;
export const HISTORICAL_FIGURES_PER_CENTURY_CHUNK = 20;
export const HISTORICAL_EVENTS_COUNT = 30;
export const HISTORICAL_EVENTS_PER_CENTURY_CHUNK = 5;
export const TIMELINE_CHUNKING_THRESHOLD_YEARS = 200;
export const TIMELINE_CHUNK_YEARS = 100;
export const DISCOVERY_FIGURES_COUNT = 5;
export const OCCUPATION_MAX_WORDS = 3;
export const EVENT_TYPE_MAX_WORDS = 3;
export const SHORT_DESCRIPTION_MAX_WORDS = 40;
// Shared by event prompts and visibility filtering; measured as endYear - startYear.
export const MIN_EVENT_DURATION = 3;
// Shared output constraints for relationship explanations and deep dives.
export const RELATIONSHIP_SUMMARY_MIN_SENTENCES = 1;
export const RELATIONSHIP_SUMMARY_MAX_SENTENCES = 2;
export const DEEP_DIVE_SUMMARY_MAX_WORDS = 60;
export const DEEP_DIVE_SECTION_TITLES = [
  'Early Life', 'Major Achievements', 'Key Relationships', 'Historical Legacy',
] as const;
export const EVENT_DEEP_DIVE_SECTION_TITLES = [
  'Background', 'Main Developments', 'Key Participants', 'Historical Impact',
] as const;

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

// Year text inside timeline bars. Adjust alongside CATEGORY_COLORS.
export const CATEGORY_BAR_TEXT_COLORS: Record<FigureCategory, 'white' | 'black'> = {
  'ARTISTS': 'white',
  'BUSINESS': 'black',
  'ENTERTAINERS': 'white',
  'EVENTS': 'black',
  'EXPLORERS': 'white',
  'LEADERS & BADDIES': 'white',
  'SCIENTISTS': 'white',
  'THINKERS': 'white',
  'WRITERS': 'black'
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
