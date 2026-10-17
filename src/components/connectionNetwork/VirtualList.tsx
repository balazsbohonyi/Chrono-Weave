import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Where the rows of a windowed list start: `offsets[i]` is the top of row i, the last entry is the total height.
export const rowOffsets = (heights: readonly number[]): number[] => {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i];
  return offsets;
};

// The smallest index in [0, offsets.length] whose offset satisfies `past`, which must go from false to true once along the offsets.
const firstWhere = (offsets: readonly number[], past: (offset: number) => boolean) => {
  let low = 0, high = offsets.length;
  while (low < high) { const mid = (low + high) >> 1; if (past(offsets[mid])) high = mid; else low = mid + 1; }
  return low;
};

// The first row that shows any part of the viewport starting at `top`.
export const firstVisibleRow = (offsets: readonly number[], top: number) => {
  const count = offsets.length - 1;
  return count <= 0 ? 0 : Math.min(count - 1, Math.max(0, firstWhere(offsets, offset => offset > top) - 1));
};

// The rows [start, end) that touch the viewport, widened by `overscan` rows on both sides so that a fast scroll or a Tab key has rows to land on.
export const visibleRange = (offsets: readonly number[], top: number, viewport: number, overscan: number): [number, number] => {
  const count = offsets.length - 1;
  if (count <= 0) return [0, 0];
  const first = firstVisibleRow(offsets, top);
  const end = Math.max(first + 1, Math.min(count, firstWhere(offsets, offset => offset >= top + viewport)));
  return [Math.max(0, first - overscan), Math.min(count, end + overscan)];
};

interface Props<T> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onScroll'> {
  items: readonly T[];
  // These three describe the rows and must keep their identity between renders (module-level functions), or the layout is rebuilt every time.
  itemKey: (item: T) => string;
  itemHeight: (item: T) => number;
  itemClassName?: (item: T) => string | undefined;
  renderItem: (item: T, index: number) => React.ReactNode;
  // Class of the `<ul>` that holds the rows.
  listClassName?: string;
  // The list goes back to the top when this changes (another tab, another search), and only then.
  resetKey?: string;
  overscan?: number;
  // How much height to fill before the scroller has been measured: server rendering, the first paint, a hidden panel.
  fallbackViewport?: number;
  // Where the list starts when it is first shown (coming back to a list somebody had scrolled), and a handle on the scrolling element.
  initialScrollTop?: number;
  scrollerRef?: React.MutableRefObject<HTMLDivElement | null>;
}

// A scrolling list that only puts the rows near the viewport in the document. Every row has a height of its own kind, known up front, so the
// position of any row is a sum rather than a measurement (no layout reads while scrolling, no jumps when an estimate is corrected). The
// scroller is the element that receives `className` and the other props.
function VirtualList<T>({ items, itemKey, itemHeight, itemClassName, renderItem, listClassName, resetKey, overscan = 8, fallbackViewport = 640, initialScrollTop, scrollerRef, ...scrollerProps }: Props<T>) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const setScroller = useCallback((element: HTMLDivElement | null) => { scroller.current = element; if (scrollerRef) scrollerRef.current = element; }, [scrollerRef]);
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const heights = useMemo(() => items.map(itemHeight), [items, itemHeight]);
  const offsets = useMemo(() => rowOffsets(heights), [heights]);
  const [metrics, setMetrics] = useState({ top: 0, height: 0 });

  // The latest layout for callbacks that outlive a render, and the row at the top of the viewport (with how far the viewport is inside it).
  const latest = useRef({ keys, offsets });
  latest.current = { keys, offsets };
  const anchor = useRef<{ key: string; inset: number } | null>(null);
  // Where the reader was while the scroller could be seen, and whether it has been hidden since (a covered list may lose its position).
  const lastTop = useRef(0), wasHidden = useRef(false);

  const sync = useCallback(() => {
    const element = scroller.current;
    // A hidden scroller (a closed panel, a covered list) measures zero: keep what was known; the observer calls this again when it is back.
    if (!element) return;
    if (element.clientHeight === 0) { wasHidden.current = true; return; }
    if (wasHidden.current) { wasHidden.current = false; if (Math.abs(element.scrollTop - lastTop.current) >= 1) element.scrollTop = lastTop.current; }
    const top = element.scrollTop, height = element.clientHeight;
    lastTop.current = top;
    const { keys: currentKeys, offsets: currentOffsets } = latest.current;
    const first = firstVisibleRow(currentOffsets, top);
    anchor.current = currentKeys.length ? { key: currentKeys[first], inset: top - currentOffsets[first] } : null;
    setMetrics(previous => {
      if (previous.top === top && previous.height === height) return previous;
      // Scrolling inside the rows already drawn changes nothing worth a render.
      if (previous.height === height) {
        const before = visibleRange(currentOffsets, previous.top, height, overscan), after = visibleRange(currentOffsets, top, height, overscan);
        if (before[0] === after[0] && before[1] === after[1]) return previous;
      }
      return { top, height };
    });
  }, [overscan]);

  // The rows changed or the list was reset. A reset goes to the top; otherwise the row that was at the top stays there, so people found
  // above the viewport while a search runs push the list down instead of pulling what is being read away.
  const resetSeen = useRef(resetKey);
  const started = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (!started.current) { started.current = true; if (initialScrollTop) { element.scrollTop = initialScrollTop; lastTop.current = element.scrollTop; } }
    if (resetSeen.current !== resetKey) { resetSeen.current = resetKey; element.scrollTop = 0; lastTop.current = 0; anchor.current = null; }
    else if (anchor.current && element.scrollTop > 0) {
      const index = keys.indexOf(anchor.current.key);
      if (index >= 0 && Math.abs(offsets[index] + anchor.current.inset - element.scrollTop) >= 1) element.scrollTop = offsets[index] + anchor.current.inset;
    }
    sync();
  }, [keys, offsets, resetKey, sync]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sync]);

  const [start, end] = visibleRange(offsets, metrics.top, metrics.height || fallbackViewport, overscan);
  return <div {...scrollerProps} ref={setScroller} onScroll={sync}>
    <ul className={listClassName} style={{ height: offsets[items.length] }}>
      {items.slice(start, end).map((item, position) => {
        const index = start + position;
        return <li key={keys[index]} className={itemClassName?.(item)} aria-setsize={items.length} aria-posinset={index + 1}
          style={{ top: offsets[index], height: heights[index] }}>{renderItem(item, index)}</li>;
      })}
    </ul>
  </div>;
}
export default VirtualList;
