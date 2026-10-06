// Alternate full and shorter card rows, preserving every card in its given order.
// Let the final row use all remaining space rather than create a lone extra row.
export function relationshipRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  let offset = 0;
  while (offset < items.length) {
    const capacity = rows.length % 2 ? Math.max(1, columns - 1) : columns;
    const remaining = items.length - offset;
    const count = remaining <= columns ? remaining : capacity;
    rows.push(items.slice(offset, offset + count));
    offset += count;
  }
  return rows;
}
