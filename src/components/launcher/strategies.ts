import type { WeaveMode } from '../../types';

export interface Strategy {
  mode: WeaveMode;
  title: string;
  badge: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  examples: string[];
}

export const STRATEGIES: Strategy[] = [
  { mode: 'time-span', title: 'Strict Time Span', badge: 'Chronological window',
    description: 'A precise window of years, any century.', inputLabel: 'Specify Start and End Years', placeholder: '', examples: [] },
  { mode: 'era', title: 'Historical Era', badge: 'Epoch & civilization',
    description: 'A period, civilization or dynasty.', inputLabel: 'Era or period', placeholder: 'Golden Age of Piracy, Meiji Restoration…',
    examples: ['Golden Age of Piracy', 'Meiji Restoration', 'Weimar Republic', 'Hellenistic Period', 'Italian Renaissance', 'Islamic Golden Age'] },
  { mode: 'figure', title: 'Follow a Figure', badge: 'Biography & world',
    description: 'One life and the people around it.', inputLabel: 'Historical figure', placeholder: 'Leonardo da Vinci, Ada Lovelace…',
    examples: ['Leonardo da Vinci', 'Cleopatra VII', 'Ada Lovelace', 'Ibn Battuta', 'Marie Curie', 'Mansa Musa'] },
  { mode: 'region', title: 'Region & Culture', badge: 'Geographic history',
    description: 'A region, empire or culture through time.', inputLabel: 'Region, empire or culture', placeholder: 'Song Dynasty China, Mughal Empire…',
    examples: ['Song Dynasty China', 'Mesoamerica before Spanish conquest', 'Mughal Empire', 'Viking Age Scandinavia', 'Ancient Egypt', 'Inca Empire'] },
  { mode: 'theme', title: 'Theme or Discipline', badge: 'Ideas & disciplines',
    description: 'How a field or an idea unfolded.', inputLabel: 'Theme, movement or idea', placeholder: 'Early history of computing…',
    examples: ['Early History of Computing', 'Astronomy in the Islamic Golden Age', 'History of Aviation', 'Silk Road Trade', 'History of Printing'] },
  { mode: 'freeform', title: 'Freeform', badge: 'Custom synthesis',
    description: 'Mix periods, places, people and ideas.', inputLabel: 'Describe your canvas', placeholder: 'Women pioneers in medicine before 1900…',
    examples: ['Women pioneers in medicine before 1900', 'Key inventors of the Industrial Revolution', 'Artists and writers of the Harlem Renaissance', 'Scholars and translators in medieval Baghdad'] },
];

export const strategyOf = (mode: WeaveMode): Strategy => STRATEGIES.find(s => s.mode === mode) ?? STRATEGIES[0];

/** The headline's rotating word: "Weave history around <word>". Hovering a card holds its word. */
export const ROTATOR_WORDS: Record<WeaveMode, string> = {
  'time-span': 'a century', era: 'an era', figure: 'a life', region: 'a culture', theme: 'an idea', freeform: 'anything',
};

export const formatLauncherYear = (y: number): string => (y < 0 ? `${-y} BCE` : `${y}`);

/* ---------- era band scale: compresses deep antiquity, widens recent centuries ---------- */
export const NOW = new Date().getFullYear();
export const MIN_YEAR = -3000;
export const MAX_YEAR = NOW;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Antiquity is narrow; the medieval centuries get room enough for every era's label.
const KNOTS: Array<[number, number]> = [[-3000, 0], [-500, 0.09], [500, 0.19], [1000, 0.29], [1300, 0.41], [1450, 0.54], [1600, 0.63], [1750, 0.72], [1850, 0.81], [1945, 0.9], [NOW, 1]];

export function yearToPos(y: number): number {
  y = clamp(y, MIN_YEAR, MAX_YEAR);
  for (let i = 1; i < KNOTS.length; i++) {
    const [y1, p1] = KNOTS[i];
    if (y <= y1) { const [y0, p0] = KNOTS[i - 1]; return p0 + ((y - y0) / (y1 - y0)) * (p1 - p0); }
  }
  return 1;
}

export function posToYear(p: number): number {
  p = clamp(p, 0, 1);
  for (let i = 1; i < KNOTS.length; i++) {
    const [y1, p1] = KNOTS[i];
    if (p <= p1) { const [y0, p0] = KNOTS[i - 1]; return y0 + ((p - p0) / (p1 - p0)) * (y1 - y0); }
  }
  return MAX_YEAR;
}

export { ERAS, eraOf } from '../../utils/eras';

/** One-click windows for the time span. */
export const PRESETS: Array<[string, number, number]> = [
  ['Renaissance', 1450, 1600], ['Age of Revolutions', 1750, 1850], ['High Middle Ages', 1000, 1300],
  ['Classical Athens', -500, -300], ['20th century', 1900, 2000], ['Viking Age', 793, 1066],
];

export const AXIS_YEARS = [-3000, 0, 1000, 1500, 1800, 1900, 2000];


/** A whole year, accepting the typographic minus and en dash for negatives; null when it is not one. */
export const parseYear = (v: string): number | null => {
  const t = String(v).trim().replace(/[−–]/g, '-');
  return /^-?\d+$/.test(t) ? Number(t) : null;
};

export const BUILD_PHASES = {
  validating: ['Checking your historical query...', 'Confirming the subject, dates, and categories for your timeline.'],
  building: ['Building your timeline...', 'Finding historical figures and events. Your timeline will open when it is ready.'],
  verifying: ['Checking historical connections...', 'Keeping figures with established connections to your focus figure.'],
} as const;
export const BUILD_STEP_LABELS = { validating: 'Validate', building: 'Build', verifying: 'Verify' } as const;
export type BuildPhase = keyof typeof BUILD_PHASES;
export const buildPhasesFor = (mode: WeaveMode): BuildPhase[] => (mode === 'figure' ? ['validating', 'building', 'verifying'] : ['validating', 'building']);
