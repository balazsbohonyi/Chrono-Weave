import type { HistoricalFigure } from '../../../src/types';

const person = (name: string, birthYear: number, deathYear: number): HistoricalFigure => ({
  id: `eval-${name}`, name, birthYear, deathYear, category: 'THINKERS', occupation: 'Historical person',
});
export const priorityCases = [
  [person('Isaac Newton', 1643, 1727), person('William Shakespeare', 1564, 1616)],
  [person('Isaac Newton', 1643, 1727), person('Albert Einstein', 1879, 1955)],
  [person('Isaac Newton', 1643, 1727), person('Napoleon Bonaparte', 1769, 1821)],
  [person('Albert Einstein', 1879, 1955), person('Steve Jobs', 1955, 2011)],
  [person('Niccolò Machiavelli', 1469, 1527), person('Leonardo da Vinci', 1452, 1519)],
] as const;
