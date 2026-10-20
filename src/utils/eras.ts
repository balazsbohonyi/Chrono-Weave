// Historical eras, as the launcher's era band shows them and as time-span canvas titles name them.
/** [name, short label, start, end] */
export const ERAS: Array<[string, string, number, number]> = [
  ['Ancient world', 'Ancient', -3000, -500], ['Classical antiquity', 'Classical', -500, 500], ['Early Middle Ages', 'Early Medieval', 500, 1000],
  ['High Middle Ages', 'High Medieval', 1000, 1300], ['Late Middle Ages', 'Late Medieval', 1300, 1450], ['Renaissance', 'Renaissance', 1450, 1600],
  ['Early modern', 'Early Modern', 1600, 1750], ['Age of Revolutions', 'Revolutions', 1750, 1850], ['Industrial & modern', 'Industrial', 1850, 1945], ['Contemporary', 'Contemporary', 1945, new Date().getFullYear()],
];

export const eraOf = (y: number): string => (ERAS.find(([, , , b]) => y < b) ?? ERAS[ERAS.length - 1])[0];

/** The eras a span of years runs through, by name: one era, or its first and last ("Late Middle Ages – Renaissance").
 *  The end year closes the span, so a span ending exactly where an era starts (1450–1600) stays in the earlier one. */
export function eraSpan(start: number, end: number): string {
  const first = eraOf(start), last = eraOf(Math.max(start, end - 1));
  return first === last ? first : `${first} – ${last}`;
}
