import React, { useEffect, useState } from 'react';

type Point = [number, number];

// Two torn paper sheets, seeded so they tear the same way on every load.
function drawSheets(w: number, h: number) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // a torn edge: a gentle curve from a to b, wobbling at two scales, with fine fibre jitter
  const tear = (ax: number, ay: number, bx: number, by: number, bulge: number): Point[] => {
    const len = Math.hypot(bx - ax, by - ay), n = Math.ceil(len / 5);
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    const f1 = 1 + rnd() * 2, f2 = 5 + rnd() * 4, p1 = rnd() * 6, p2 = rnd() * 6;
    const pts: Point[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const off = bulge * Math.sin(Math.PI * t) + 9 * Math.sin(t * Math.PI * 2 * f1 + p1) + 4 * Math.sin(t * Math.PI * 2 * f2 + p2) + (rnd() - 0.5) * 3.2;
      pts.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off]);
    }
    return pts;
  };
  const d = (pts: Point[]) => pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const sheets = [
    // lower right sheet, rising toward the right edge
    { edge: tear(w * 0.3, h + 12, w + 12, h * 0.62, -h * 0.07), close: `L${w + 40} ${h + 40}Z` },
    // small corner tear, top left
    { edge: tear(-12, h * 0.34, w * 0.2, -12, h * 0.03), close: 'L-40 -40Z' },
  ];
  return sheets.map(s => {
    const core = s.edge.map(([x, y]): Point => [x + (rnd() - 0.5) * 1.2, y - 1.2]);
    return { core: d(core), sheet: `${d(s.edge)}${s.close}` };
  });
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

/** The launcher's paper ground: fibre texture over everything below the threads, and two torn sheets. */
const PaperGround: React.FC = () => {
  const [size, setSize] = useState(viewport);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => setSize(viewport()), 120); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, []);
  const sheets = drawSheets(size.w, size.h);
  return <>
    <div className="lx-paper" aria-hidden="true">
      <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        {sheets.map((s, i) => <React.Fragment key={i}>
          <path className="lx-sheet-core" d={s.core} />
          <path className="lx-sheet" d={s.sheet} />
        </React.Fragment>)}
      </svg>
    </div>
    <div className="lx-paper-tex" aria-hidden="true" />
  </>;
};

export default PaperGround;
