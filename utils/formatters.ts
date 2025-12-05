
export const formatYear = (year: number | undefined | null): string => {
  if (year === undefined || year === null) return '';
  if (year < 0) {
    return `${Math.abs(year)} BC`;
  }
  return year.toString();
};
