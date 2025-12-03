
export const formatYear = (year: number): string => {
  if (year < 0) {
    return `${Math.abs(year)} BC`;
  }
  return year.toString();
};
