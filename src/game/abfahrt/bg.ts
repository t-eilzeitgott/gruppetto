/** Hintergründe je Tal: ferne Bergkette, näherer Höhenzug und der Talboden unter dem Horizont. */
import { mulberry32, type Rng } from './rng';
import { BIOME_PALETTES, css, mixRGB, shade, type RGB } from './palette';
import type { BiomeId } from './track';

export interface Backdrop {
  biome: BiomeId;
  width: number;          // Periodenbreite in px (nahtlos wiederholbar)
  far: HTMLCanvasElement; // Unterkante = Horizont
  mid: HTMLCanvasElement;
  valley: HTMLCanvasElement; // Oberkante = Horizont
  farH: number;
  midH: number;
  valleyH: number;
  lights: { x: number; y: number; s: number }[]; // Lichter im Tal (relativ zum Talbild)
}

function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** periodische Höhenlinie aus Sinus-Summen mit ganzzahligen Frequenzen */
function ridge(r: Rng, n: number, harmonics: [number, number][], sharp = 0): Float32Array {
  const out = new Float32Array(n);
  const phases = harmonics.map(() => r() * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let v = 0;
    harmonics.forEach(([f, a], j) => { v += Math.sin(t * f + phases[j]) * a; });
    if (sharp) v = Math.sign(v) * Math.pow(Math.abs(v), 1 - sharp * 0.4);
    out[i] = v;
  }
  return out;
}

function drawRidge(c: CanvasRenderingContext2D, w: number, h: number, line: Float32Array, base: number, amp: number, fill: CanvasGradient | string) {
  c.beginPath();
  c.moveTo(0, h);
  for (let i = 0; i < line.length; i++) c.lineTo((i / (line.length - 1)) * w, h - base - line[i] * amp);
  c.lineTo(w, h);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

export function makeBackdrop(biome: BiomeId, viewW: number, viewH: number, scale: number, seed: number): Backdrop {
  const pal = BIOME_PALETTES[biome];
  const r = mulberry32(seed);
  const W = Math.round(Math.max(1200, viewW * 2.8));
  const farH = Math.round(viewH * 0.34);
  const midH = Math.round(viewH * 0.2);
  const valleyH = Math.round(viewH * 0.66);
  const s = scale;
  const far = cv(W * s, farH * s);
  const mid = cv(W * s, midH * s);
  const valley = cv(W * s, valleyH * s);
  const lights: Backdrop['lights'] = [];

  // ---------- ferne Berge
  {
    const c = far.getContext('2d')!;
    c.scale(s, s);
    const n = 700;
    const jag = biome === 'pass' ? 0.9 : biome === 'alpine' ? 0.6 : biome === 'vineyard' ? 0 : 0.3;
    const amp = biome === 'vineyard' ? farH * 0.12 : biome === 'lake' ? farH * 0.4 : farH * (biome === 'forest' ? 0.33 : 0.42);
    const harm: [number, number][] = biome === 'vineyard'
      ? [[3, 0.5], [7, 0.3], [13, 0.15], [29, 0.05]]
      : [[2, 0.35], [5, 0.3], [11, 0.2], [23, 0.12 + jag * 0.1], [47, 0.06 + jag * 0.06], [97, jag * 0.04]];
    const line = ridge(r, n, harm, jag);
    const farCol = pal.far;
    const top = mixRGB(farCol, [255, 255, 255], 0.12);
    const g = c.createLinearGradient(0, 0, 0, farH);
    g.addColorStop(0, css(top));
    g.addColorStop(1, css(mixRGB(farCol, pal.haze, 0.55)));
    drawRidge(c, W, farH, line, farH * 0.4, amp, g);
    // Schneefelder auf hohen Gipfeln
    if (biome !== 'vineyard' && biome !== 'forest') {
      c.save();
      c.beginPath();
      c.moveTo(0, farH);
      for (let i = 0; i < n; i++) c.lineTo((i / (n - 1)) * W, farH - farH * 0.4 - line[i] * amp);
      c.lineTo(W, farH);
      c.closePath();
      c.clip();
      const snowLine = farH * (biome === 'pass' || biome === 'alpine' ? 0.42 : 0.3);
      c.fillStyle = css(pal.farSnow, 0.92);
      c.beginPath();
      c.moveTo(0, snowLine);
      for (let i = 0; i <= 80; i++) c.lineTo((i / 80) * W, snowLine + Math.sin(i * 1.7) * 6 + Math.sin(i * 0.37) * 10);
      c.lineTo(W, 0);
      c.lineTo(0, 0);
      c.closePath();
      c.fill();
      // weiche Schattierung nach unten
      c.globalCompositeOperation = 'source-atop';
      const sh = c.createLinearGradient(0, 0, 0, farH);
      sh.addColorStop(0, 'rgba(40,60,90,0)');
      sh.addColorStop(1, 'rgba(40,60,90,0.25)');
      c.fillStyle = sh;
      c.fillRect(0, 0, W, farH);
      c.restore();
    }
  }

  // ---------- näherer Höhenzug
  {
    const c = mid.getContext('2d')!;
    c.scale(s, s);
    const n = 500;
    const line = ridge(r, n, biome === 'vineyard' ? [[4, 0.5], [9, 0.3], [17, 0.15]] : [[3, 0.4], [7, 0.3], [15, 0.2], [31, 0.1]], 0);
    const col = pal.mid;
    const g = c.createLinearGradient(0, 0, 0, midH);
    g.addColorStop(0, css(mixRGB(col, pal.haze, 0.25)));
    g.addColorStop(1, css(mixRGB(col, pal.haze, 0.5)));
    drawRidge(c, W, midH, line, midH * 0.35, midH * 0.32, g);
    // Baumkronen auf dem Kamm
    if (biome === 'forest' || biome === 'alpine' || biome === 'village') {
      c.fillStyle = css(shade(mixRGB(col, pal.haze, 0.3), 0.85));
      for (let i = 0; i < n; i += 2) {
        if (r() < 0.6) {
          const x = (i / (n - 1)) * W;
          const y = midH - midH * 0.35 - line[i] * midH * 0.32;
          c.beginPath();
          c.moveTo(x - 3, y + 4);
          c.lineTo(x, y - 6 - r() * 6);
          c.lineTo(x + 3, y + 4);
          c.fill();
        }
      }
    }
    if (biome === 'vineyard') {
      c.fillStyle = css(shade(col, 0.6), 0.8);
      for (let i = 0; i < 70; i++) {
        const x = r() * W;
        const idx = Math.floor((x / W) * (n - 1));
        const y = midH - midH * 0.35 - line[idx] * midH * 0.32;
        c.beginPath(); c.ellipse(x, y - 5, 1.6, 6, 0, 0, Math.PI * 2); c.fill();
      }
    }
  }

  // ---------- Talboden (von oben gesehen, in Perspektive)
  {
    const c = valley.getContext('2d')!;
    c.scale(s, s);
    const base = pal.valley;
    const g = c.createLinearGradient(0, 0, 0, valleyH);
    g.addColorStop(0, css(mixRGB(base, pal.haze, 0.55)));
    g.addColorStop(0.2, css(mixRGB(base, pal.haze, 0.2)));
    g.addColorStop(1, css(shade(base, 0.92)));
    c.fillStyle = g;
    c.fillRect(0, 0, W, valleyH);
    const P = (t: number) => valleyH * Math.pow(t, 1.7);  // Tiefe → y
    const hazeAt = (t: number) => Math.max(0, 0.42 - t * 1.1);
    if (biome === 'lake') {
      c.fillStyle = css(mixRGB(pal.water, pal.haze, 0.3));
      c.fillRect(0, P(0.06), W, valleyH);
      for (let i = 0; i < 320; i++) {
        const t = 0.06 + Math.pow(r(), 0.9) * 0.94;
        const y = P(t);
        c.fillStyle = `rgba(255,255,255,${(0.06 + r() * 0.16).toFixed(2)})`;
        c.fillRect(r() * W, y, 3 + t * 34, 0.6 + t * 1.8);
      }
      // fernes Ufer mit Orten
      c.fillStyle = css(mixRGB(pal.mid, pal.haze, 0.45));
      c.fillRect(0, 0, W, P(0.065));
      for (let i = 0; i < 26; i++) {
        const x = r() * W;
        const n = 3 + Math.floor(r() * 6);
        for (let k = 0; k < n; k++) {
          const hx = x + (r() - 0.5) * 18;
          c.fillStyle = k % 2 ? 'rgba(240,232,215,0.9)' : 'rgba(205,120,90,0.85)';
          c.fillRect(hx, P(0.05) + r() * 2, 2, 1.6);
          if (r() < 0.5) lights.push({ x: hx + 1, y: P(0.055), s: 0.4 });
        }
      }
      // Segelboote
      for (let i = 0; i < 12; i++) {
        const t = 0.15 + r() * 0.6;
        const x = r() * W;
        const y = P(t);
        const k = 1 + t * 5;
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.beginPath(); c.moveTo(x, y - k * 2.2); c.lineTo(x + k, y); c.lineTo(x, y); c.closePath(); c.fill();
        c.fillRect(x - k * 0.8, y, k * 1.9, k * 0.35);
      }
    } else {
      const fieldCols: RGB[] = biome === 'vineyard'
        ? [[186, 168, 88], [140, 156, 72], [166, 142, 80], [120, 140, 70], [196, 182, 112]]
        : biome === 'forest'
          ? [[78, 118, 62], [92, 132, 70], [64, 102, 54], [110, 146, 80]]
          : [[120, 168, 78], [140, 180, 90], [104, 152, 70], [176, 178, 96], [96, 140, 64]];
      // Felder
      const rows = 30;
      for (let row = 0; row < rows; row++) {
        const t0 = 0.04 + (row / rows) * 0.96;
        const t1 = 0.04 + ((row + 1) / rows) * 0.96;
        const y0 = P(t0);
        const y1 = P(t1);
        let x = -r() * 80;
        while (x < W + 40) {
          const fw = (14 + r() * 46) * (0.35 + t0 * 3);
          const col = fieldCols[Math.floor(r() * fieldCols.length)];
          c.fillStyle = css(mixRGB(col, pal.haze, hazeAt(t0)), 0.7);
          const sk = (x - W / 2) * 0.04 * (t1 - t0);
          c.beginPath();
          c.moveTo(x, y0); c.lineTo(x + fw - 1, y0); c.lineTo(x + fw - 1 + sk, y1); c.lineTo(x + sk, y1); c.closePath();
          c.fill();
          if (biome === 'vineyard' && t0 > 0.2 && r() < 0.5) {
            c.strokeStyle = css(shade(col, 0.7), 0.4);
            c.lineWidth = 0.7;
            for (let q = 2; q < fw; q += 3 + t0 * 4) { c.beginPath(); c.moveTo(x + q, y0); c.lineTo(x + q + sk, y1); c.stroke(); }
          }
          x += fw;
        }
      }
      // Wege
      c.strokeStyle = css(mixRGB([220, 210, 185], pal.haze, 0.3), 0.6);
      for (let i = 0; i < 5; i++) {
        c.lineWidth = 0.6;
        let px = r() * W;
        c.beginPath();
        c.moveTo(px, P(0.05));
        for (let k = 1; k <= 20; k++) { const t = 0.05 + k * 0.0475; px += (r() - 0.5) * 40 * t; c.lineWidth = 0.5 + t * 2; c.lineTo(px, P(t)); }
        c.stroke();
      }
      // Fluss
      c.strokeStyle = css(mixRGB([120, 172, 210], pal.haze, 0.25), 0.95);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      let rx = W * r();
      for (let k = 1; k <= 40; k++) {
        const t0 = 0.03 + (k - 1) * 0.024;
        const t1 = 0.03 + k * 0.024;
        const nx = rx + Math.sin(k * 0.55 + seed) * (6 + t1 * 70);
        c.lineWidth = 0.8 + t1 * 9;
        c.beginPath(); c.moveTo(rx, P(t0)); c.lineTo(nx, P(t1)); c.stroke();
        rx = nx;
      }
      // Waldstücke aus vielen Baumkronen
      const woods = biome === 'forest' ? 34 : biome === 'vineyard' ? 10 : 20;
      for (let w = 0; w < woods; w++) {
        const t = 0.06 + Math.pow(r(), 0.75) * 0.9;
        const cx = r() * W;
        const cy = P(t);
        const spread = 10 + t * 70;
        const n = 18 + Math.floor(r() * 30);
        for (let k = 0; k < n; k++) {
          const ang = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * spread;
          const x = cx + Math.cos(ang) * d;
          const y = cy + Math.sin(ang) * d * 0.3;
          const rr = 0.8 + t * 3.2;
          c.fillStyle = css(mixRGB([46, 84, 44], pal.haze, hazeAt(t)), 0.9);
          c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
          c.fillStyle = css(mixRGB([96, 140, 72], pal.haze, hazeAt(t)), 0.6);
          c.beginPath(); c.arc(x - rr * 0.3, y - rr * 0.35, rr * 0.5, 0, Math.PI * 2); c.fill();
        }
      }
      // Dörfer
      for (let v = 0; v < 8; v++) {
        const t = 0.06 + r() * 0.55;
        const y = P(t);
        const x = r() * W;
        const n = 6 + Math.floor(r() * 12);
        for (let i = 0; i < n; i++) {
          const hx = x + (r() - 0.5) * (14 + t * 70);
          const hy = y + (r() - 0.5) * (2 + t * 12);
          const hs = 1.2 + t * 5;
          c.fillStyle = css(mixRGB([244, 238, 226], pal.haze, hazeAt(t)), 0.95);
          c.fillRect(hx, hy, hs, hs * 0.7);
          c.fillStyle = css(mixRGB([176, 78, 52], pal.haze, hazeAt(t)), 0.95);
          c.fillRect(hx - 0.3, hy - hs * 0.32, hs + 0.6, hs * 0.36);
          if (r() < 0.6) lights.push({ x: hx + hs / 2, y: hy + hs * 0.3, s: 0.4 + t });
        }
        if (r() < 0.6) {
          c.fillStyle = css(mixRGB([230, 222, 205], pal.haze, hazeAt(t)), 0.95);
          c.fillRect(x, y - (3 + t * 14), 1 + t * 2.4, 3 + t * 14);
        }
      }
    }
    // Dunst zum Horizont
    const hz = c.createLinearGradient(0, 0, 0, valleyH * 0.2);
    hz.addColorStop(0, css(pal.haze, 0.8));
    hz.addColorStop(1, css(pal.haze, 0));
    c.fillStyle = hz;
    c.fillRect(0, 0, W, valleyH * 0.32);
  }

  return { biome, width: W, far, mid, valley, farH, midH, valleyH, lights };
}
