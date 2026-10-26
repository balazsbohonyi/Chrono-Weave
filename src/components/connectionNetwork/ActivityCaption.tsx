import React, { useEffect, useRef, useState } from 'react';
import type { SearchActivity } from '../../services/connectionGraph';
import { activityText } from './activityText';

// The caption stays this long after a request ends (the next one usually follows at once), then slides back under the edge it came out of.
const HOLD_MS = 900, LEAVE_MS = 350;

// One line over the graph saying what the search is asking the model right now, amber while a request waits to be tried again. It slides out
// from under the top edge of the graph (under the year strip, or under the full-screen bar) and back. It is a component of its own so the
// countdown re-renders only the caption.
// `onWidth` hears the card's width while it is shown (0 once it is gone), so the full-screen bar can make room for it.
const ActivityCaption: React.FC<{ activity: SearchActivity | null; nameOf: (id: string) => string; belowStrip?: boolean; onWidth?: (width: number) => void }> = ({ activity, nameOf, belowStrip = false, onWidth }) => {
  const card = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [kept, setKept] = useState<SearchActivity | null>(activity);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (activity) { setKept(activity); setLeaving(false); return; }
    const leave = setTimeout(() => setLeaving(true), HOLD_MS), gone = setTimeout(() => setKept(null), HOLD_MS + LEAVE_MS);
    return () => { clearTimeout(leave); clearTimeout(gone); };
  }, [activity]);
  const current = activity ?? kept;
  const waitUntil = current?.waitUntil;
  useEffect(() => {
    if (!waitUntil) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [waitUntil]);
  const shown = !!current;
  useEffect(() => {
    const element = card.current;
    if (!onWidth || !element) return;
    const report = () => onWidth(element.offsetWidth);
    report();
    if (typeof ResizeObserver === 'undefined') return () => onWidth(0);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => { observer.disconnect(); onWidth(0); };
  }, [shown, onWidth]);
  if (!current) return null;
  return <div className={`net-activity-wrap${belowStrip ? ' is-below-strip' : ''}`}>
    <div ref={card} className={`net-activity${waitUntil ? ' is-waiting' : ''}${leaving ? ' is-leaving' : ''}`} role="status" aria-live="off"><i aria-hidden="true" />{activityText(current, nameOf, now)}{waitUntil ? '' : '…'}</div>
  </div>;
};
export default ActivityCaption;
