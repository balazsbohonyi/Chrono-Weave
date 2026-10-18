// Canvas2D thread field behind the launcher: flowing strands with drifting year labels.
// Coordinates passed to the public API are viewport pixels (CSS px).
// Internally strands run along "u" with offsets on "v"; vertical orientation swaps the axes.
import { isReducedMotion } from './motion';

const YEARS = ['−3100', '−776', '−221', '−44', '476', '622', '800', '1066', '1206', '1347', '1453', '1492', '1517',
  '1543', '1600', '1687', '1776', '1789', '1815', '1848', '1869', '1905', '1914', '1945', '1969', '1989'];

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (cur: number, target: number, dt: number, rate: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

interface Strand { k: number; base: number; amp: number; f1: number; f2: number; p1: number; p2: number; sp: number; color: number; w: number; a: number }
interface Label { strand: number; u: number; text: string; v: number }
interface Attractor { u: number; v: number; ru: number; spread: number; s: number }
interface Pin extends Attractor { sTarget: number }
interface Pulse { u: number; v: number; age: number }

export interface ThreadFieldOptions { orientation?: 'horizontal' | 'vertical'; count?: number; labels?: number; seed?: number }

export class ThreadField {
  private ctx: CanvasRenderingContext2D;
  private vertical: boolean;
  private count: number;
  private labelCount: number;
  private t = 0;
  private speed = 1; private speedTarget = 1;
  private intro = 0; private introTarget = 1;
  // Attractor: a band the strands are pulled into. spread = band thickness on v, ru = reach along u.
  private att: Attractor = { u: 0, v: 0, ru: 200, spread: 40, s: 0 };
  private attTarget: Attractor = { ...this.att };
  private timeline = 0; private timelineTarget = 0; private timelineProgress = 0; private timelineProgressTarget = 0;
  private timelineV?: number; private timelineY?: number;
  private highlight: { u0: number; u1: number; v: number; band: number } | null = null;
  private pins: Pin[] = [];
  private pulses: Pulse[] = [];
  private running = false;
  private destroyed = false;
  private raf = 0;
  private last = 0;
  private staticQueued = false;
  private labelCache = new Map<string, HTMLCanvasElement>();
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private strands: Strand[] = [];
  private labels: Label[] = [];
  private colors: string[] = [];
  private glow = false;
  private labelColor = '148 163 184';
  private w = 1; private h = 1; private L = 1; private T = 1;
  private rect: DOMRect;
  private ro: ResizeObserver;
  private motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private onVisibility = () => this.syncRunning();

  constructor(private canvas: HTMLCanvasElement, private tokenRoot: Element, opts: ThreadFieldOptions = {}) {
    this.ctx = canvas.getContext('2d')!;
    this.vertical = opts.orientation === 'vertical';
    this.count = opts.count ?? 26;
    this.labelCount = opts.labels ?? 16;
    this.rect = canvas.getBoundingClientRect();
    this.seed(opts.seed ?? 7);
    this.refreshColors();
    this.resize();
    this.ro = new ResizeObserver(() => { this.resize(); this.requestStatic(); });
    this.ro.observe(canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motionQuery.addEventListener('change', this.onVisibility);
    this.syncRunning();
  }

  destroy() {
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motionQuery.removeEventListener('change', this.onVisibility);
  }

  private seed(s: number) {
    let x = s;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    this.strands = Array.from({ length: this.count }, (_, i) => ({
      k: i / (this.count - 1),
      base: 0.08 + 0.84 * (i / (this.count - 1)) + (rnd() - 0.5) * 0.05,
      amp: 18 + rnd() * 46,
      f1: 0.0016 + rnd() * 0.0022, f2: 0.004 + rnd() * 0.004,
      p1: rnd() * TAU, p2: rnd() * TAU,
      sp: 0.18 + rnd() * 0.32,
      color: i % 5,
      w: rnd() < 0.18 ? 1.6 : 1,
      a: 0.35 + rnd() * 0.5,
    }));
    this.labels = Array.from({ length: this.labelCount }, () => ({
      strand: Math.floor(rnd() * this.count),
      u: rnd(),
      text: YEARS[Math.floor(rnd() * YEARS.length)],
      v: 0.012 + rnd() * 0.02,
    }));
  }

  /** Re-reads the thread colours from the launcher's tokens (call after a theme change). */
  refreshColors() {
    const cs = getComputedStyle(this.tokenRoot);
    this.colors = [1, 2, 3, 4, 5].map(n => cs.getPropertyValue(`--thread-${n}`).trim() || '96 165 250');
    this.glow = cs.getPropertyValue('--thread-mode').trim() !== 'ink';
    this.labelColor = cs.getPropertyValue('--thread-label').trim() || '148 163 184';
    this.labelCache.clear();
    this.requestStatic();
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.L = this.vertical ? this.h : this.w; // length along u
    this.T = this.vertical ? this.w : this.h; // thickness along v
    this.rect = r;
  }

  // viewport point -> (u, v)
  private toUV(x: number, y: number) {
    const lx = x - this.rect.left, ly = y - this.rect.top;
    return this.vertical ? { u: ly, v: lx } : { u: lx, v: ly };
  }

  /* ---------- public API ---------- */

  attract(x: number, y: number, { strength = 0.85, spread = 36, reach = 220 } = {}) {
    const { u, v } = this.toUV(x, y);
    Object.assign(this.attTarget, { u, v, ru: reach, spread, s: strength });
    if (this.att.s < 0.02) Object.assign(this.att, { u, v, ru: reach, spread });
    this.kick();
  }

  converge(rect: DOMRect, strength = 0.95) {
    const c = this.toUV(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const along = this.vertical ? rect.height : rect.width;
    const across = this.vertical ? rect.width : rect.height;
    Object.assign(this.attTarget, { u: c.u, v: c.v, ru: Math.max(along * 1.4, 260), spread: across * 0.9, s: strength });
    if (this.att.s < 0.02) Object.assign(this.att, { u: c.u, v: c.v });
    this.kick();
  }

  release() { this.attTarget.s = 0; this.kick(); }

  setSpeed(mult: number) { this.speedTarget = mult; this.kick(); }

  // Pull every strand into one horizontal timeline at viewport y (progress grows a bright segment).
  setTimeline(active: boolean, y?: number) {
    this.timelineTarget = active ? 1 : 0;
    if (y != null) { this.timelineV = this.toUV(0, y).v; this.timelineY = y - this.rect.top; }
    if (!active) this.timelineProgressTarget = 0;
    this.kick();
  }
  setTimelineProgress(p: number) { this.timelineProgressTarget = clamp(p, 0, 1); this.kick(); }

  // Brighten strands between x0 and x1, within `band` px of viewport y (soft edges).
  setHighlight(x0: number | null, x1 = 0, y?: number, band = 150) {
    if (x0 == null) { this.highlight = null; this.kick(); return; }
    const a = this.toUV(x0, y ?? 0), b = this.toUV(x1, y ?? 0);
    this.highlight = { u0: Math.min(a.u, b.u), u1: Math.max(a.u, b.u), v: y == null ? this.T / 2 : a.v, band: y == null ? this.T : band };
    this.kick();
  }

  pulse(x: number, y: number) {
    if (isReducedMotion()) return;
    const { u, v } = this.toUV(x, y);
    this.pulses.push({ u, v, age: 0 });
  }

  playIntro() {
    if (isReducedMotion()) { this.intro = 1; this.requestStatic(); return; }
    this.intro = 0; this.introTarget = 1; this.kick();
  }

  /* ---------- loop ---------- */

  syncRunning() {
    if (this.destroyed) return;
    const should = !document.hidden && !isReducedMotion();
    if (should && !this.running) {
      this.running = true;
      this.last = performance.now();
      const step = (now: number) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.update(dt);
        this.draw();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    } else if (!should && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
    if (!should) this.requestStatic();
  }

  private kick() { if (!this.running) this.requestStatic(); }

  // Reduced motion / paused: snap to targets and draw one frame.
  private requestStatic() {
    if (this.running || this.staticQueued || this.destroyed) return;
    this.staticQueued = true;
    requestAnimationFrame(() => {
      this.staticQueued = false;
      if (this.destroyed) return;
      Object.assign(this.att, this.attTarget);
      this.speed = this.speedTarget;
      this.intro = 1;
      this.timeline = this.timelineTarget;
      this.timelineProgress = this.timelineProgressTarget;
      this.pulses = [];
      for (const p of this.pins) p.s = p.sTarget;
      this.pins = this.pins.filter(p => p.s > 0);
      this.draw();
    });
  }

  private update(dt: number) {
    this.speed = ease(this.speed, this.speedTarget, dt, 3);
    this.t += dt * this.speed;
    this.intro = ease(this.intro, this.introTarget, dt, 1.1);
    const a = this.att, b = this.attTarget;
    const r = 6;
    a.u = ease(a.u, b.u, dt, r); a.v = ease(a.v, b.v, dt, r);
    a.ru = ease(a.ru, b.ru, dt, r); a.spread = ease(a.spread, b.spread, dt, r);
    a.s = ease(a.s, b.s, dt, b.s > a.s ? 5 : 3);
    this.timeline = ease(this.timeline, this.timelineTarget, dt, 2.6);
    this.timelineProgress = ease(this.timelineProgress, this.timelineProgressTarget, dt, 2.2);
    for (const p of this.pins) p.s = ease(p.s, p.sTarget, dt, 4);
    if (this.pins.length && this.pins.every(p => p.sTarget === 0 && p.s < 0.005)) this.pins = [];
    for (const p of this.pulses) p.age += dt;
    this.pulses = this.pulses.filter(p => p.age < 1.4);
    for (const l of this.labels) {
      l.u += l.v * dt * this.speed * (this.speed > 2 ? 2.5 : 1);
      if (l.u > 1.08) { l.u = -0.08; l.text = YEARS[Math.floor(Math.random() * YEARS.length)]; }
    }
  }

  private strandV(s: Strand, u: number) {
    const t = this.t;
    let v = s.base * this.T
      + Math.sin(u * s.f1 + t * s.sp + s.p1) * s.amp
      + Math.sin(u * s.f2 - t * s.sp * 1.7 + s.p2) * s.amp * 0.35;
    for (const p of this.pins) {
      if (p.s < 0.002) continue;
      const g = Math.exp(-(((u - p.u) / p.ru) ** 2));
      if (g < 0.003) continue;
      v += (p.v + (s.k - 0.5) * p.spread - v) * p.s * g;
    }
    const a = this.att;
    if (a.s > 0.002) {
      const g = Math.exp(-(((u - a.u) / a.ru) ** 2));
      const target = a.v + (s.k - 0.5) * a.spread;
      v += (target - v) * a.s * g;
    }
    if (this.timeline > 0.002 && !this.vertical) {
      const target = (this.timelineV ?? this.T / 2) + (s.k - 0.5) * 10 + Math.sin(u * 0.01 + t * 2 + s.p1) * 2;
      v += (target - v) * this.timeline;
    }
    for (const p of this.pulses) {
      const d = Math.hypot(u - p.u, v - p.v);
      const r = p.age * 520;
      v += Math.exp(-(((d - r) / 46) ** 2)) * 22 * (1 - p.age / 1.4) * Math.sign(v - p.v || 1);
    }
    return v;
  }

  private label(text: string) {
    let c = this.labelCache.get(text);
    if (c) return c;
    c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = `600 ${12.5 * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(text).width) + 4; c.height = Math.ceil(18 * this.dpr);
    ctx.font = font; ctx.fillStyle = `rgb(${this.labelColor})`; ctx.textBaseline = 'middle';
    ctx.fillText(text, 2, c.height / 2);
    this.labelCache.set(text, c);
    return c;
  }

  private draw() {
    const { ctx, dpr, L } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.vertical) ctx.setTransform(0, dpr, dpr, 0, 0, 0); // (u,v) -> (x=v, y=u)
    else ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const step = 22;
    const n = Math.ceil(L / step) + 1;
    const reveal = this.intro * (L + 200);
    const pts = new Float32Array(n * 2);
    const glow = this.glow;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
    // vertical (warp) fields keep their strands; the timeline crosses them as a weft instead
    const dim = 1 - this.timeline * (this.vertical ? 0.6 : 0.2);

    for (const s of this.strands) {
      for (let i = 0; i < n; i++) {
        const u = i * step;
        pts[i * 2] = u; pts[i * 2 + 1] = this.strandV(s, u);
      }
      const col = this.colors[s.color];
      const path = new Path2D();
      const end = Math.min(n, Math.ceil(reveal / step));
      if (end < 2) continue;
      path.moveTo(pts[0], pts[1]);
      for (let i = 1; i < end - 1; i++) {
        const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2, my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2;
        path.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my);
      }
      path.lineTo(pts[(end - 1) * 2], pts[(end - 1) * 2 + 1]);

      const boost = this.att.s * 0.5;
      // wide soft pass, then the thin core
      ctx.strokeStyle = `rgb(${col} / ${(glow ? 0.07 : 0.05) * dim})`;
      ctx.lineWidth = glow ? 7 : 4;
      ctx.stroke(path);
      ctx.strokeStyle = `rgb(${col} / ${clamp(s.a * (glow ? 0.55 : 0.5) * dim + boost * 0.25, 0, 1)})`;
      ctx.lineWidth = s.w * (glow ? 1 : 1.1);
      ctx.stroke(path);

      if (this.highlight) {
        const h = this.highlight, pad = 60;
        ctx.save();
        ctx.beginPath(); ctx.rect(h.u0 - pad, h.v - h.band, h.u1 - h.u0 + pad * 2, h.band * 2); ctx.clip();
        const span = h.u1 - h.u0 + pad * 2;
        const grad = (alpha: number) => {
          const g = ctx.createLinearGradient(h.u0 - pad, 0, h.u1 + pad, 0);
          g.addColorStop(0, `rgb(${col} / 0)`);
          g.addColorStop(pad / span, `rgb(${col} / ${alpha})`);
          g.addColorStop(1 - pad / span, `rgb(${col} / ${alpha})`);
          g.addColorStop(1, `rgb(${col} / 0)`);
          return g;
        };
        ctx.strokeStyle = grad(glow ? 0.95 : 0.85); ctx.lineWidth = s.w * 1.7; ctx.stroke(path);
        ctx.strokeStyle = grad(glow ? 0.16 : 0.08); ctx.lineWidth = 10; ctx.stroke(path);
        ctx.restore();
      }
    }

    // intro "shuttle" head
    if (this.intro < 0.995) {
      const g = ctx.createLinearGradient(reveal - 220, 0, reveal, 0);
      g.addColorStop(0, 'rgb(255 255 255 / 0)');
      g.addColorStop(1, glow ? 'rgb(255 255 255 / 0.18)' : 'rgb(0 0 0 / 0.05)');
      ctx.fillStyle = g; ctx.fillRect(reveal - 220, 0, 220, this.T);
    }

    // timeline progress segment
    if (this.timeline > 0.05) {
      if (this.vertical) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = this.vertical ? (this.timelineY ?? this.h / 2) : (this.timelineV ?? this.T / 2);
      const p = this.timelineProgress * (this.vertical ? this.w : L);
      const col = this.colors[0];
      ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
      ctx.strokeStyle = `rgb(${col} / ${0.9 * this.timeline})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(p, v); ctx.stroke();
      ctx.fillStyle = `rgb(${col} / ${0.18 * this.timeline})`;
      ctx.beginPath(); ctx.arc(p, v, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgb(${col} / ${this.timeline})`;
      ctx.beginPath(); ctx.arc(p, v, 4, 0, TAU); ctx.fill();
      // ticks
      ctx.strokeStyle = `rgb(${this.labelColor} / ${0.5 * this.timeline})`;
      ctx.lineWidth = 1;
      for (let x = 40; x < p; x += 80) { ctx.beginPath(); ctx.moveTo(x, v + 10); ctx.lineTo(x, v + (x % 400 < 80 ? 22 : 16)); ctx.stroke(); }
    }

    // drifting year labels
    ctx.globalCompositeOperation = 'source-over';
    const la = (glow ? 0.55 : 0.6) * (1 - this.timeline) * Math.min(1, this.intro * 1.4);
    if (la > 0.02) {
      ctx.globalAlpha = la;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const l of this.labels) {
        const u = l.u * L;
        if (u > reveal) continue;
        const v = this.strandV(this.strands[l.strand], u);
        const img = this.label(l.text);
        const w = img.width / dpr, h = img.height / dpr;
        if (this.vertical) ctx.drawImage(img, v + 6, u - h / 2, w, h);
        else ctx.drawImage(img, u + 4, v - h - 2, w, h);
      }
      ctx.globalAlpha = 1;
    }
  }
}
