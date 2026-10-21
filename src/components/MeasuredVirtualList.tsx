import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { firstVisibleRow, rowOffsets, visibleRange } from './connectionNetwork/VirtualList';

interface Props<T> {
  items: readonly T[];
  // Keep the identity of these between renders (module-level functions), or the layout is rebuilt every time.
  itemKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  // The element that scrolls. It must be positioned (`relative`), so the list's own offset inside it is cheap to read.
  scrollerRef: React.RefObject<HTMLElement | null>;
  // What every row measured, by key: the heights outlive the list (another tab, a list that comes back) so a scroll position restores exactly.
  heights: React.MutableRefObject<Map<string, number>>;
  // Space under every row, and the height assumed for a row that has not been drawn yet.
  gap?: number;
  estimate?: number;
  // Rows kept in the document above and below the viewport.
  overscan?: number;
  // How much height to fill before the scroller has been measured.
  fallbackViewport?: number;
}

// A list of rows whose heights are not known up front (wrapped text, a portrait that arrives later): only the rows near the viewport are put in
// the document, the rest is two spacers. A row's height is measured once it is drawn; until then it counts as `estimate`. When a measurement
// moves the rows above the viewport, the scroll position follows, so what is being read stays where it is. (The windowed lists of the
// Six Degrees explorer have fixed row heights and use VirtualList; this one is for the sidebar's cards.)
function MeasuredVirtualList<T>({ items, itemKey, renderItem, scrollerRef, heights, gap = 16, estimate = 150, overscan = 4, fallbackViewport = 800 }: Props<T>) {
  const list = useRef<HTMLDivElement | null>(null);
  // Bumped when a measured height changes, which changes where every row below it starts.
  const [version, setVersion] = useState(0);
  // Where the viewport is, measured from the top of the list.
  const [metrics, setMetrics] = useState({ top: 0, height: 0 });
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const offsets = useMemo(() => {
    // A row that has not been drawn counts as the average of the ones that have, so the scrollbar settles quickly instead of shrinking as rows are met.
    let sum = 0, known = 0;
    for (const key of keys) { const height = heights.current.get(key); if (height !== undefined) { sum += height; known++; } }
    const assumed = known ? sum / known : estimate + gap;
    return rowOffsets(keys.map(key => heights.current.get(key) ?? assumed));
  }, [keys, version, heights, estimate, gap]);

  const latest = useRef({ keys, offsets });
  latest.current = { keys, offsets };
  // The row at the top of the viewport, and how far the viewport is inside it.
  const anchor = useRef<{ key: string; inset: number } | null>(null);

  const sync = useCallback(() => {
    const scroller = scrollerRef.current, element = list.current;
    // A hidden scroller measures zero: keep what was known.
    if (!scroller || !element || scroller.clientHeight === 0) return;
    const top = scroller.scrollTop - element.offsetTop, height = scroller.clientHeight;
    const { keys: currentKeys, offsets: currentOffsets } = latest.current;
    const first = firstVisibleRow(currentOffsets, Math.max(0, top));
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
  }, [scrollerRef, overscan]);

  // The rows moved: the row that was at the top of the viewport stays there.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current, element = list.current;
    if (scroller && element && anchor.current && scroller.scrollTop > 0) {
      const index = keys.indexOf(anchor.current.key);
      if (index >= 0) {
        const wanted = element.offsetTop + offsets[index] + anchor.current.inset;
        if (Math.abs(wanted - scroller.scrollTop) >= 1) scroller.scrollTop = wanted;
      }
    }
    sync();
  }, [keys, offsets, scrollerRef, sync]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.addEventListener('scroll', sync, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    observer?.observe(scroller);
    return () => { scroller.removeEventListener('scroll', sync); observer?.disconnect(); };
  }, [scrollerRef, sync]);

  // One observer for the rows in the document; each reports its own height when it is drawn and whenever it changes.
  const rowObserver = useRef<ResizeObserver | null>(null);
  const getRowObserver = useCallback(() => rowObserver.current ??= new ResizeObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      const key = (entry.target as HTMLElement).dataset.key;
      const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight);
      if (key && height > 0 && heights.current.get(key) !== height) { heights.current.set(key, height); changed = true; }
    }
    if (changed) setVersion(current => current + 1);
  }), [heights]);
  const observeRow = useCallback((row: HTMLDivElement | null) => {
    if (row && typeof ResizeObserver !== 'undefined') getRowObserver().observe(row);
  }, [getRowObserver]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    // Development runs effects twice: the rows already in the document must be watched again after the first cleanup.
    list.current?.querySelectorAll('[data-key]').forEach(row => getRowObserver().observe(row));
    return () => { rowObserver.current?.disconnect(); rowObserver.current = null; };
  }, [getRowObserver]);

  const [start, end] = visibleRange(offsets, metrics.top, metrics.height || fallbackViewport, overscan);
  const count = items.length;
  // The last row's gap is not part of the list.
  return <div ref={list} role="list" style={{ marginBottom: -gap }}>
    <div aria-hidden="true" style={{ height: offsets[start] }} />
    {items.slice(start, end).map((item, position) => {
      const index = start + position;
      return <div key={keys[index]} data-key={keys[index]} ref={observeRow} role="listitem" aria-setsize={count} aria-posinset={index + 1} style={{ paddingBottom: gap }}>{renderItem(item)}</div>;
    })}
    <div aria-hidden="true" style={{ height: offsets[count] - offsets[end] }} />
  </div>;
}

export default MeasuredVirtualList;
