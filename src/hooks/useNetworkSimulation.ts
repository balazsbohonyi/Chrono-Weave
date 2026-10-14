import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { NetworkLayout, type LayoutInput, type LayoutLinkInput, type LayoutMode } from '../services/connectionNetworkLayout';

interface Options {
  // A different key is a different exploration, so the layout starts over.
  resetKey: string;
  inputs: LayoutInput[];
  links: LayoutLinkInput[];
  bounds: [number, number];
  mode: LayoutMode;
  size: { width: number; height: number };
  // False until the drawing has been measured: people are placed for the real area, not for a guess that would
  // have to be corrected with a visible shuffle a moment later.
  ready: boolean;
  reducedMotion: boolean;
}

// Owns one NetworkLayout per open exploration and drives it from requestAnimationFrame. Positions stay
// inside the layout (and are painted by the graph straight onto the SVG), so a tick re-renders no React.
export function useNetworkSimulation({ resetKey, inputs, links, bounds, mode, size, ready, reducedMotion }: Options) {
  const layout = useMemo(() => new NetworkLayout(), [resetKey]);
  const frame = useRef(0);
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;

  const kick = useCallback(() => {
    if (reduced.current) { layout.settle(); return; }
    if (frame.current) return;
    // A layout that is already at rest (people seated before they were drawn) still gets one repaint, so the
    // drawing and its camera pick the positions up.
    const run = () => { frame.current = layout.step() ? requestAnimationFrame(run) : (layout.refresh(), 0); };
    frame.current = requestAnimationFrame(run);
  }, [layout]);

  const signature = JSON.stringify([inputs.map(input => [input.id, input.year, input.endpoint, input.radius]), links.map(link => [link.a, link.b]), bounds, mode, size.width, size.height, ready]);
  useLayoutEffect(() => {
    if (!ready) return;
    layout.setBounds(bounds[0], bounds[1]);
    layout.setSize(size.width, size.height);
    layout.setMode(mode);
    layout.setGraph(inputs, links);
    kick();
  }, [layout, signature, kick]);

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    layout.stop();
  }, [layout]);

  return { layout, kick };
}
