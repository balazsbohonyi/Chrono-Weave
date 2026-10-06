
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
export const KEEP_DISCOVERY_CLUSTERS = true;
export const OCCUPATION_MAX_WORDS = 3;
export const EVENT_TYPE_MAX_WORDS = 3;
export const SHORT_DESCRIPTION_MAX_WORDS = 40;
// Shared by event prompts and visibility filtering; measured as endYear - startYear.
export const MIN_EVENT_DURATION = 3;
// Shared output constraints for relationship explanations and deep dives.
export const RELATIONSHIP_SUMMARY_MIN_SENTENCES = 2;
export const RELATIONSHIP_SUMMARY_MAX_SENTENCES = 3;
// Refresh older positive assessments whose prose used the earlier brief style.
export const RELATIONSHIP_NARRATIVE_VERSION = 1;
export const DEEP_DIVE_SUMMARY_MAX_WORDS = 60;
export const DEEP_DIVE_SECTION_TITLES = [
  'Early Life', 'Major Achievements', 'Key Relationships', 'Historical Legacy',
] as const;
export const EVENT_DEEP_DIVE_SECTION_TITLES = [
  'Background', 'Main Developments', 'Key Participants', 'Historical Impact',
] as const;

// Theme tokens keep category bars and legend swatches in sync.
export const CATEGORY_COLORS: Record<FigureCategory, string> = {
  'ARTISTS': 'rgb(var(--color-category-artists))',
  'BUSINESS': 'rgb(var(--color-category-business))',
  'ENTERTAINERS': 'rgb(var(--color-category-entertainers))',
  'EVENTS': 'rgb(var(--color-category-events))',
  'EXPLORERS': 'rgb(var(--color-category-explorers))',
  'LEADERS & BADDIES': 'rgb(var(--color-category-leaders))',
  'SCIENTISTS': 'rgb(var(--color-category-scientists))',
  'THINKERS': 'rgb(var(--color-category-thinkers))',
  'WRITERS': 'rgb(var(--color-category-writers))',
};

// Each theme defines a contrasting year label for every category.
export const CATEGORY_BAR_TEXT_COLORS: Record<FigureCategory, string> = {
  'ARTISTS': 'rgb(var(--color-category-artists-text))',
  'BUSINESS': 'rgb(var(--color-category-business-text))',
  'ENTERTAINERS': 'rgb(var(--color-category-entertainers-text))',
  'EVENTS': 'rgb(var(--color-category-events-text))',
  'EXPLORERS': 'rgb(var(--color-category-explorers-text))',
  'LEADERS & BADDIES': 'rgb(var(--color-category-leaders-text))',
  'SCIENTISTS': 'rgb(var(--color-category-scientists-text))',
  'THINKERS': 'rgb(var(--color-category-thinkers-text))',
  'WRITERS': 'rgb(var(--color-category-writers-text))',
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
