/**
 * „Abfahrt“ – Minispiel: mit dem Daumen durch die Kehren einer Passabfahrt lenken.
 * Reines Canvas, keine Abhängigkeiten. Die Straße scrollt von oben nach unten,
 * der Fahrer sitzt im unteren Drittel und folgt dem Daumen.
 */

export interface DescentStats {
  meters: number;
  bidons: number;
  speedKmh: number;
  topKmh: number;
  score: number;
}

export interface DescentCallbacks {
  onTick?: (s: DescentStats) => void;
  onCrash?: (s: DescentStats) => void;
}

interface Item {
  d: number;      // Strecke in m
  off: number;    // seitlicher Versatz zur Straßenmitte (−1 … 1, relativ zur halben Breite)
  kind: 'bidon' | 'hole';
  taken?: boolean;
}

export const BIDON_POINTS = 50;
const VIEW_METERS = 70;        // sichtbare Strecke auf der Bildschirmhöhe
const RIDER_Y = 0.76;          // Position des Fahrers (Anteil der Höhe)
const RIDER_R = 0.022;         // Radius in Anteil der Breite

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DescentGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: DescentCallbacks;
  private raf = 0;
  private last = 0;
  private running = false;
  private w = 0;
  private h = 0;
  private dpr = 1;

  // Spielzustand
  private d = 0;
  private t = 0;
  private x = 0.5;
  private target = 0.5;
  private v = 12;
  private vTop = 12;
  private bidons = 0;
  private items: Item[] = [];
  private nextItem = 40;
  private shake = 0;
  private gravel = 0;
  private offTime = 0;
  private crashed = false;
  private phase: number[] = [];
  private rnd = Math.random;

  // Steuerung
  private dragStartX: number | null = null;
  private dragStartTarget = 0.5;

  // Farben aus dem Theme
  private col = { bg: '#000', road: '#1c1c1f', edge: '#fff', accent: '#ff5fa2', text: '#fff', muted: '#888', bidon: '#3d8bfd', hole: '#000', grass: '#111' };

  constructor(canvas: HTMLCanvasElement, cb: DescentCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas nicht verfügbar');
    this.ctx = ctx;
    this.cb = cb;
    this.readColors();
    this.resize();
    this.reset(1);
    this.draw();
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
  }

  readColors() {
    const cs = getComputedStyle(this.canvas);
    const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    this.col = {
      bg: v('--surface', '#111'),
      road: v('--surface3', '#26262a'),
      edge: v('--text', '#fff'),
      accent: v('--accent', '#ff5fa2'),
      text: v('--text', '#fff'),
      muted: v('--muted', '#888'),
      bidon: '#3d8bfd',
      hole: v('--bg', '#000'),
      grass: v('--surface2', '#1c1c1f'),
    };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(200, r.width);
    this.h = Math.max(200, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.running) this.draw();
  }

  reset(seed = Date.now()) {
    this.rnd = mulberry32(seed);
    this.phase = [0, 1, 2, 3].map(() => this.rnd() * Math.PI * 2);
    this.d = 0;
    this.t = 0;
    this.v = 12;
    this.vTop = 12;
    this.bidons = 0;
    this.items = [];
    this.nextItem = 40;
    this.shake = 0;
    this.gravel = 0;
    this.offTime = 0;
    this.crashed = false;
    this.x = this.center(0);
    this.target = this.x;
  }

  start(seed = Date.now()) {
    this.reset(seed);
    this.running = true;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume() {
    if (this.running || this.crashed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  get isRunning() { return this.running; }

  stats(): DescentStats {
    const meters = Math.floor(this.d);
    return { meters, bidons: this.bidons, speedKmh: Math.round(this.v * 3.6), topKmh: Math.round(this.vTop * 3.6), score: meters + this.bidons * BIDON_POINTS };
  }

  // ---------- Strecke ----------

  /** Straßenbreite (Anteil der Bildschirmbreite) wird mit der Zeit schmaler */
  private roadWidth(d: number) {
    return 0.42 - 0.16 * (1 - Math.exp(-d / 2500));
  }

  /** Straßenmitte (Anteil der Breite) bei Strecke d – immer kurviger */
  private center(d: number) {
    const p = this.phase;
    const twist = 1 + Math.min(2.4, d / 1100);
    const raw = 0.55 * Math.sin(d / (95 / twist) + p[0])
      + 0.3 * Math.sin(d / (41 / twist) + p[1])
      + 0.15 * Math.sin(d / (23 / Math.sqrt(twist)) + p[2]);
    const half = this.roadWidth(d) / 2;
    const amp = 0.5 - half - 0.04;
    // am Start gerade, dann zunehmend kurvig
    const ramp = Math.min(1, 0.35 + d / 160);
    return 0.5 + raw * amp * ramp;
  }

  private spawn() {
    while (this.nextItem < this.d + VIEW_METERS + 20) {
      const d = this.nextItem;
      const holeChance = Math.min(0.45, Math.max(0, (d - 250) / 3000));
      const kind: Item['kind'] = this.rnd() < holeChance ? 'hole' : 'bidon';
      this.items.push({ d, off: (this.rnd() * 2 - 1) * 0.7, kind });
      this.nextItem += 22 + this.rnd() * 38 - Math.min(18, d / 400);
    }
    this.items = this.items.filter((it) => it.d > this.d - 15);
  }

  // ---------- Steuerung ----------

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.dragStartX = e.clientX;
    this.dragStartTarget = this.target;
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragStartX === null) return;
    const dx = (e.clientX - this.dragStartX) / this.w;
    this.target = Math.min(0.98, Math.max(0.02, this.dragStartTarget + dx * 1.25));
  };

  private onUp = () => { this.dragStartX = null; };

  /** Lenken per Tastatur (Desktop) */
  nudge(dir: -1 | 1) {
    this.target = Math.min(0.98, Math.max(0.02, this.target + dir * 0.06));
  }

  // ---------- Schleife ----------

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw();
    if (this.running) this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.t += dt;
    // Tempo: 43 km/h am Start, gegen 110 km/h
    const vMax = 12 + 20 * (1 - Math.exp(-this.t / 35));
    this.v += (vMax - this.v) * Math.min(1, dt * 1.5);
    if (this.gravel > 0) this.v = Math.max(9, this.v * (1 - Math.min(0.5, dt * 1.2)));
    this.d += this.v * dt;
    this.vTop = Math.max(this.vTop, this.v);
    // Fahrer folgt dem Daumen weich
    this.x += (this.target - this.x) * Math.min(1, dt * 16);

    const c = this.center(this.d);
    const half = this.roadWidth(this.d) / 2;
    const off = Math.abs(this.x - c) - half;
    if (off > RIDER_R * 2.4) return this.crash();
    if (off > 0) {
      // im Kies: bremst, nach einer knappen Sekunde Sturz
      this.gravel = 0.25;
      this.offTime += dt;
      this.shake = Math.max(this.shake, 3);
      if (this.offTime > 0.8) return this.crash();
    } else {
      this.gravel = Math.max(0, this.gravel - dt);
      this.offTime = Math.max(0, this.offTime - dt * 2);
    }

    this.spawn();
    for (const it of this.items) {
      if (it.taken) continue;
      const dd = Math.abs(it.d - this.d);
      if (dd > 1.6) continue;
      const ix = this.center(it.d) + it.off * (this.roadWidth(it.d) / 2 - 0.03);
      if (Math.abs(ix - this.x) < RIDER_R * 1.9) {
        if (it.kind === 'bidon') {
          it.taken = true;
          this.bidons += 1;
        } else {
          return this.crash();
        }
      }
    }
    this.shake = Math.max(0, this.shake - dt * 20);
    this.cb.onTick?.(this.stats());
  }

  private crash() {
    this.crashed = true;
    this.running = false;
    this.shake = 10;
    this.draw();
    try { navigator.vibrate?.(120); } catch { /* egal */ }
    this.cb.onCrash?.(this.stats());
  }

  // ---------- Zeichnen ----------

  private draw() {
    const { ctx, w, h, col } = this;
    const pxPerM = h / VIEW_METERS;
    const riderPy = h * RIDER_Y;
    const sy = (d: number) => riderPy - (d - this.d) * pxPerM;
    const dAt = (py: number) => this.d + (riderPy - py) / pxPerM;
    const jitter = this.shake ? (Math.random() - 0.5) * this.shake : 0;

    ctx.save();
    ctx.translate(jitter, 0);
    ctx.fillStyle = col.bg;
    ctx.fillRect(-10, 0, w + 20, h);

    // Straße als Polygon
    const step = 6;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let py = -step; py <= h + step; py += step) {
      const d = dAt(py);
      const c = this.center(d) * w;
      const hw = (this.roadWidth(d) / 2) * w;
      left.push([c - hw, py]);
      right.push([c + hw, py]);
    }
    // Bankett
    ctx.fillStyle = col.grass;
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x - 7, y) : ctx.moveTo(x - 7, y)));
    for (let i = right.length - 1; i >= 0; i -= 1) ctx.lineTo(right[i][0] + 7, right[i][1]);
    ctx.closePath();
    ctx.fill();
    // Asphalt
    ctx.fillStyle = col.road;
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = right.length - 1; i >= 0; i -= 1) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
    // Randlinien
    ctx.strokeStyle = col.edge;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    for (const edge of [left, right]) {
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    // Mittellinie gestrichelt (bewegt sich mit)
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2;
    const dash = 4;
    const dStart = Math.floor(dAt(h + step) / dash) * dash;
    for (let d = dStart; sy(d) > -step; d += dash * 2) {
      ctx.beginPath();
      ctx.moveTo(this.center(d) * w, sy(d));
      ctx.lineTo(this.center(d + dash) * w, sy(d + dash));
      ctx.stroke();
    }
    // Leitpfosten alle 20 m
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = col.muted;
    const pStart = Math.floor(dAt(h) / 20) * 20;
    for (let d = pStart; sy(d) > -10; d += 20) {
      const c = this.center(d) * w;
      const hw = (this.roadWidth(d) / 2) * w;
      ctx.fillRect(c - hw - 12, sy(d) - 4, 3, 8);
      ctx.fillRect(c + hw + 9, sy(d) - 4, 3, 8);
    }
    ctx.globalAlpha = 1;

    // Trinkflaschen und Schlaglöcher
    for (const it of this.items) {
      if (it.taken) continue;
      const py = sy(it.d);
      if (py < -20 || py > h + 20) continue;
      const px = (this.center(it.d) + it.off * (this.roadWidth(it.d) / 2 - 0.03)) * w;
      if (it.kind === 'bidon') {
        ctx.fillStyle = col.bidon;
        roundRect(ctx, px - 5, py - 9, 10, 18, 4);
        ctx.fill();
        ctx.fillStyle = col.edge;
        ctx.fillRect(px - 3, py - 12, 6, 3);
      } else {
        ctx.fillStyle = col.hole;
        ctx.beginPath();
        ctx.ellipse(px, py, 11, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col.muted;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Fahrer (Draufsicht: Rad + Fahrer), leicht in die Kurve geneigt
    const rx = this.x * w;
    const lean = Math.max(-0.5, Math.min(0.5, (this.target - this.x) * 6));
    ctx.save();
    ctx.translate(rx, riderPy);
    ctx.rotate(lean);
    ctx.fillStyle = col.edge;
    roundRect(ctx, -2, -16, 4, 32, 2); // Rad
    ctx.fill();
    ctx.fillStyle = col.accent;
    ctx.beginPath();
    ctx.ellipse(0, 2, 9, 11, 0, 0, Math.PI * 2); // Rücken
    ctx.fill();
    ctx.fillStyle = col.edge;
    ctx.beginPath();
    ctx.arc(0, -9, 5, 0, Math.PI * 2); // Helm
    ctx.fill();
    ctx.restore();

    if (this.crashed) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-10, 0, w + 20, h);
    }
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
