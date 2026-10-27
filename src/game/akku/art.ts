/**
 * Kulisse und Bauteile von „Akku leer!“ – einmal gemalt, danach nur noch kopiert (schnell):
 * Himmel und Alpenpanorama (Bildschirm), Felsen, Straße und Schilder (Welt), Bauteile als kleine Bilder.
 * Stil: Radsport-Plakat – flache Farben, zwei Töne pro Fläche, warmer Dunst am Horizont.
 */
import type { LevelDef, Mat } from './level';
import { INK } from './chars';

export const PAL = {
  skyTop: '#5fb0e4',
  skyMid: '#a9daf0',
  haze: '#f8e6c4',
  sun: '#fff4cf',
  farA: '#9eaed7',
  farB: '#8696c6',
  snow: '#f7f5f0',
  snowSh: '#d9def0',
  midA: '#7d9bba',
  midB: '#6b88a8',
  forest: '#3f6f58',
  forestDk: '#2f5a47',
  hillA: '#8cc56c',
  hillB: '#77b05a',
  hillC: '#679f4d',
  pine: '#2e5e48',
  rock: '#bcae98',
  rockDk: '#9d8e78',
  rockSh: '#857764',
  grass: '#7cbc58',
  grassDk: '#5d9a43',
  soil: '#6e5440',
  soilDk: '#5a4334',
  road: '#4b4f58',
  roadHi: '#5d626d',
  paint: '#f6f2e8',
};

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------ Kulisse (Bildschirm)

export interface Backdrop {
  canvas: HTMLCanvasElement;
  /** Linker Rand des Bildes relativ zum Bildschirm (Gerätepixel) */
  pad: number;
  /** Bodenlinie im Bild */
  groundY: number;
}

/** Bergkette: Punkte von links nach rechts */
function ridge(w: number, n: number, base: number, lo: number, hi: number, r: () => number): [number, number][] {
  const pts: [number, number][] = [];
  const step = w / n;
  for (let i = 0; i <= n; i++) {
    const peak = i % 2 === 1;
    const h = peak ? lo + (hi - lo) * (0.55 + r() * 0.45) : lo * (0.25 + r() * 0.35);
    pts.push([i * step + (r() - 0.5) * step * 0.5, base - h]);
  }
  return pts;
}

/**
 * Himmel, Sonne, ferne und nahe Berge, Wald und Almwiesen. w/h in Gerätepixeln, groundY = Bodenlinie,
 * z = Gerätepixel pro Meter. Breiter als der Bildschirm (Rand pad links/rechts) für das Mitziehen.
 */
export function paintBackdrop(w: number, h: number, groundY: number, z: number, pad: number, dark: boolean): Backdrop {
  const W = w + pad * 2;
  const H = h + pad;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const gy = groundY + pad;
  const r = rng(11);
  // Himmel
  const skyGrad = ctx.createLinearGradient(0, 0, 0, gy);
  if (dark) {
    skyGrad.addColorStop(0, '#2b3f73');
    skyGrad.addColorStop(0.55, '#c7809c');
    skyGrad.addColorStop(1, '#ffc58f');
  } else {
    skyGrad.addColorStop(0, PAL.skyTop);
    skyGrad.addColorStop(0.6, PAL.skyMid);
    skyGrad.addColorStop(1, PAL.haze);
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);
  // Sonne oben rechts
  // Himmel über dem Boden (in Metern): im Hochformat viel Platz für hohe Gipfel
  const sky = Math.max(10, groundY / z);
  const sx = pad + w * 0.74;
  const sy = Math.max(pad + groundY * 0.16, gy - z * Math.min(24, sky * 0.8));
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, z * 9);
  glow.addColorStop(0, dark ? 'rgba(255,214,170,0.75)' : 'rgba(255,248,214,0.95)');
  glow.addColorStop(0.25, dark ? 'rgba(255,190,150,0.35)' : 'rgba(255,244,207,0.45)');
  glow.addColorStop(1, 'rgba(255,244,207,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = dark ? '#ffe2b8' : PAL.sun;
  ctx.beginPath();
  ctx.arc(sx, sy, z * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // ferne Gipfel mit Schnee
  // ferne Kette: so hoch, dass sie den Himmel trägt (im Hochformat bis weit nach oben)
  const farHi = Math.max(16, Math.min(30, sky * 0.74));
  const far = ridge(W, 9, gy - z * 2.5, z * farHi * 0.42, z * farHi, r);
  // noch fernere, blasse Gipfel dahinter
  const back = ridge(W, 7, gy - z * 6, z * farHi * 0.5, z * farHi * 1.05, r);
  ctx.fillStyle = dark ? 'rgba(150,140,190,0.55)' : 'rgba(190,205,232,0.75)';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (const [x, y] of back) ctx.lineTo(x, y);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  for (let i = 1; i < back.length - 1; i += 2) {
    const [px, py] = back[i];
    const [lx, ly] = back[i - 1];
    const [rx, ry] = back[i + 1];
    ctx.fillStyle = dark ? 'rgba(240,220,235,0.6)' : 'rgba(250,251,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (lx - px) * 0.28, py + (ly - py) * 0.28);
    ctx.lineTo(px + (rx - px) * 0.12, py + (ry - py) * 0.22);
    ctx.lineTo(px + (rx - px) * 0.26, py + (ry - py) * 0.26);
    ctx.closePath();
    ctx.fill();
  }
  const farA = dark ? '#7b78a8' : PAL.farA;
  const farB = dark ? '#66658f' : PAL.farB;
  ctx.fillStyle = farA;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (const [x, y] of far) ctx.lineTo(x, y);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  // Schatten auf den linken Flanken, Schnee oben
  for (let i = 1; i < far.length - 1; i += 2) {
    const [px, py] = far[i];
    const [lx, ly] = far[i - 1];
    const [rx, ry] = far[i + 1];
    ctx.fillStyle = farB;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx + (px - lx) * 0.55, H);
    ctx.lineTo(px + (rx - px) * 0.15, H);
    ctx.closePath();
    ctx.fill();
    const snowH = (Math.min(ly, ry) - py) * 0.42;
    if (snowH > z * 1.2) {
      const sl = (t: number) => [px + (lx - px) * t, py + (ly - py) * t] as const;
      const sr = (t: number) => [px + (rx - px) * t, py + (ry - py) * t] as const;
      const k = snowH / Math.max(1, Math.min(ly, ry) - py);
      ctx.fillStyle = dark ? '#f3d9e6' : PAL.snow;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const [ax, ay] = sl(k * 1.1);
      ctx.lineTo(ax, ay);
      for (let j = 1; j < 6; j++) {
        const t = j / 6;
        const bx = ax + (sr(k)[0] - ax) * t;
        const by = ay + (sr(k)[1] - ay) * t + (j % 2 ? z * 0.9 : -z * 0.2);
        ctx.lineTo(bx, by);
      }
      ctx.lineTo(...sr(k * 0.9));
      ctx.closePath();
      ctx.fill();
      // Schneeschatten links
      ctx.fillStyle = dark ? '#cdb3cf' : PAL.snowSh;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ax, ay);
      ctx.lineTo(px - (px - ax) * 0.15, ay + z * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Dunst vor den fernen Bergen
  const hz = ctx.createLinearGradient(0, gy - z * 9, 0, gy);
  hz.addColorStop(0, 'rgba(248,230,196,0)');
  hz.addColorStop(1, dark ? 'rgba(255,190,150,0.55)' : 'rgba(248,230,196,0.7)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, gy - z * 9, W, z * 9);

  // mittlere Kette mit Wald
  const mid = ridge(W, 13, gy - z * 0.8, z * 3.5, z * 8, r);
  ctx.fillStyle = dark ? '#5e6f96' : PAL.midA;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (const [x, y] of mid) ctx.lineTo(x, y);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  for (let i = 1; i < mid.length - 1; i += 2) {
    const [px, py] = mid[i];
    const [lx, ly] = mid[i - 1];
    ctx.fillStyle = dark ? '#4f5f86' : PAL.midB;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx + (px - lx) * 0.6, H);
    ctx.lineTo(px, H);
    ctx.closePath();
    ctx.fill();
  }
  // Waldsaum
  const forestY = gy - z * 2.2;
  ctx.fillStyle = dark ? '#2f4c4a' : PAL.forest;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += z * 0.45) {
    const k = Math.sin(x / (z * 7)) * z * 1.2 + Math.sin(x / (z * 2.3)) * z * 0.4;
    ctx.lineTo(x, forestY + k);
    ctx.lineTo(x + z * 0.22, forestY + k - z * (0.7 + r() * 0.6));
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // naher Almhügel mit Serpentine
  const hillTop = (x: number) => gy - z * 1.6 - Math.sin(x / (z * 9) + 1.3) * z * 1.6 - Math.sin(x / (z * 3.7)) * z * 0.35;
  ctx.fillStyle = dark ? '#4f7a4a' : PAL.hillA;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 6) ctx.lineTo(x, hillTop(x));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  // Wiesenstreifen
  ctx.fillStyle = dark ? '#466e42' : PAL.hillB;
  for (let i = 0; i < 9; i++) {
    const x = r() * W;
    const y = hillTop(x) + z * (0.4 + r() * 1.2);
    ctx.beginPath();
    ctx.ellipse(x, y, z * (2 + r() * 3), z * (0.25 + r() * 0.2), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Tannen und Hütte auf dem Hügel
  const pine = (x: number, y: number, s: number) => {
    ctx.fillStyle = dark ? '#24443c' : PAL.pine;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 2.2);
    ctx.lineTo(x - s * 0.7, y);
    ctx.lineTo(x + s * 0.7, y);
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    pine(x, hillTop(x) + z * (0.15 + r() * 0.5), z * (0.35 + r() * 0.3));
  }
  // Chalet
  const hx = W * 0.62;
  const hy = hillTop(hx) + z * 0.2;
  ctx.fillStyle = '#8a5a3a';
  ctx.fillRect(hx - z * 0.7, hy - z * 0.8, z * 1.4, z * 0.8);
  ctx.fillStyle = '#c4553d';
  ctx.beginPath();
  ctx.moveTo(hx - z * 0.95, hy - z * 0.75);
  ctx.lineTo(hx, hy - z * 1.45);
  ctx.lineTo(hx + z * 0.95, hy - z * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2e6c8';
  ctx.fillRect(hx - z * 0.35, hy - z * 0.55, z * 0.25, z * 0.22);
  ctx.fillRect(hx + z * 0.12, hy - z * 0.55, z * 0.25, z * 0.22);
  // Wiese bis zum Boden
  ctx.fillStyle = dark ? '#3f6640' : PAL.hillC;
  ctx.fillRect(0, gy - z * 0.6, W, H);
  return { canvas: c, pad, groundY: gy };
}

/** Wolke als kleines Bild */
export function cloudSprite(w: number, seed: number, dark: boolean): HTMLCanvasElement {
  const h = w * 0.45;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const r = rng(seed);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    puffs.push([w * (0.15 + t * 0.7), h * (0.62 - Math.sin(t * Math.PI) * 0.22 + (r() - 0.5) * 0.08), h * (0.22 + Math.sin(t * Math.PI) * 0.16 + r() * 0.06)]);
  }
  ctx.fillStyle = dark ? '#d9b8cc' : '#e3edf5';
  for (const [x, y, rr] of puffs) { ctx.beginPath(); ctx.arc(x, y + rr * 0.18, rr, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = dark ? '#f4e2ec' : '#ffffff';
  for (const [x, y, rr] of puffs) { ctx.beginPath(); ctx.arc(x - rr * 0.08, y - rr * 0.05, rr * 0.92, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = dark ? '#d9b8cc' : '#e3edf5';
  ctx.fillRect(w * 0.12, h * 0.72, w * 0.76, h * 0.12);
  return c;
}

// ------------------------------------------------------------------ Gelände (Welt)

export interface TerrainLayer {
  canvas: HTMLCanvasElement;
  /** Weltkoordinaten der linken oberen Ecke */
  x0: number;
  y1: number;
  /** Pixel pro Meter */
  s: number;
}

/** Felsen, Boden, Straße mit Namen, Passschild, Gipfelkreuz – einmal gemalt (Welt, y nach oben) */
export function paintTerrain(level: LevelDef, s: number, names: string[], dark: boolean): TerrainLayer {
  const v = level.view;
  const x0 = v.x0 - 12;
  const x1 = v.x1 + 12;
  const y0 = -14;
  const y1 = v.y1 + 4;
  const c = makeCanvas((x1 - x0) * s, (y1 - y0) * s);
  const ctx = c.getContext('2d')!;
  // Welt → Bild (y nach oben)
  const W = (fn: () => void) => {
    ctx.save();
    ctx.setTransform(s, 0, 0, -s, -x0 * s, y1 * s);
    fn();
    ctx.restore();
  };
  const r = rng(5);

  W(() => {
    // Erdreich unter der Straße
    ctx.fillStyle = PAL.soil;
    ctx.fillRect(x0, y0, x1 - x0, -y0);
    ctx.fillStyle = PAL.soilDk;
    for (let i = 0; i < 70; i++) {
      ctx.beginPath();
      ctx.ellipse(x0 + r() * (x1 - x0), -1.4 + y0 * r() * 0.9, 0.15 + r() * 0.35, 0.08 + r() * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wiese vor der Straße
    ctx.fillStyle = dark ? '#4c7d43' : PAL.grassDk;
    ctx.fillRect(x0, -1.3, x1 - x0, 1.0);
    ctx.fillStyle = dark ? '#5a8f4b' : PAL.grass;
    ctx.fillRect(x0, -0.85, x1 - x0, 0.5);
    // Straße
    ctx.fillStyle = PAL.road;
    ctx.fillRect(x0, -0.4, 3.6 - x0, 0.4);
    ctx.fillStyle = PAL.roadHi;
    ctx.fillRect(x0, -0.07, 3.6 - x0, 0.07);
    ctx.fillStyle = 'rgba(246,242,232,0.85)';
    for (let x = x0; x < 3.2; x += 1.1) ctx.fillRect(x, -0.37, 0.55, 0.04);
  });

  // Schrift auf der Straße (flach gedrückt wie aufgemalt): ALLEZ vor der Schleuder, Namen der Runde dahinter
  const paint = (word: string, x: number) => {
    ctx.save();
    ctx.translate((x - x0) * s, (y1 + 0.17) * s);
    ctx.scale(1, 0.42);
    ctx.fillText(word, 0, 0);
    ctx.restore();
  };
  ctx.save();
  ctx.fillStyle = 'rgba(246,242,232,0.6)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 italic ${Math.round(s * 0.42)}px ${FONT}`;
  paint('ALLEZ', 1.45);
  const spots = [-2.75, -6.8, -10.4];
  names.slice(0, spots.length).forEach((n, i) => paint(n.toUpperCase(), spots[i]));
  ctx.restore();

  W(() => {
    // Felsen
    for (const poly of level.rocks) {
      ctx.save();
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = PAL.rock;
      ctx.fill();
      ctx.clip();
      // Schichten und Risse
      const minX = Math.min(...poly.map((p) => p[0]));
      const maxX = Math.max(...poly.map((p) => p[0]));
      const maxY = Math.max(...poly.map((p) => p[1]));
      ctx.strokeStyle = 'rgba(140,124,102,0.7)';
      ctx.lineWidth = 0.05;
      for (let y = 0.6; y < maxY; y += 0.9 + r() * 0.5) {
        ctx.beginPath();
        ctx.moveTo(minX - 1, y + r() * 0.3);
        for (let x = minX; x <= maxX + 1; x += 0.8) ctx.lineTo(x, y + Math.sin(x * 1.7 + y) * 0.12 + (r() - 0.5) * 0.08);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(120,104,84,0.35)';
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.ellipse(minX + r() * (maxX - minX), r() * maxY, 0.3 + r() * 0.5, 0.12 + r() * 0.12, (r() - 0.5) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // linke Flanke im Schatten
      const sh = ctx.createLinearGradient(minX, 0, minX + 1.6, 0);
      sh.addColorStop(0, 'rgba(90,76,60,0.35)');
      sh.addColorStop(1, 'rgba(90,76,60,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(minX, -1, 1.6, maxY + 2);
      // Schatten unten
      ctx.fillStyle = 'rgba(70,58,44,0.22)';
      ctx.fillRect(minX - 1, -1, maxX - minX + 2, 1.5);
      ctx.restore();
      // Grasnarbe auf den oberen Kanten
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        if (bx >= ax) continue;
        const flat = Math.abs(by - ay) < 0.4 * Math.abs(bx - ax);
        if (!flat) continue;
        ctx.strokeStyle = dark ? '#4c7d43' : PAL.grassDk;
        ctx.lineWidth = 0.34;
        ctx.beginPath();
        ctx.moveTo(ax, ay - 0.1);
        ctx.lineTo(bx, by - 0.1);
        ctx.stroke();
        ctx.strokeStyle = dark ? '#5a8f4b' : PAL.grass;
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.moveTo(ax, ay - 0.06);
        ctx.lineTo(bx, by - 0.06);
        ctx.stroke();
        // Blumen und Halme
        const len = ax - bx;
        for (let k = 0; k < len * 2.2; k++) {
          const x = bx + r() * len;
          const y = ay + (by - ay) * ((x - ax) / (bx - ax));
          ctx.strokeStyle = dark ? '#5a8f4b' : PAL.grass;
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(x, y - 0.05);
          ctx.lineTo(x + (r() - 0.5) * 0.12, y + 0.12 + r() * 0.1);
          ctx.stroke();
          if (r() < 0.35) {
            ctx.fillStyle = ['#ffffff', '#ffd23f', '#8a6ff0', '#ff8fb1'][Math.floor(r() * 4)];
            ctx.beginPath();
            ctx.arc(x, y + 0.04, 0.055, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  });

  // Passschild neben der Schleuder
  W(() => {
    ctx.fillStyle = '#7a5434';
    ctx.fillRect(1.95, 0, 0.1, 1.55);
    ctx.fillRect(3.35, 0, 0.1, 1.55);
  });
  const sign = (x: number, y: number, w: number, h: number) => {
    const px = (x - x0) * s;
    const py = (y1 - y) * s;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.roundRect(px, py, w * s, h * s, s * 0.08);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(px + s * 0.08, py + s * 0.08, w * s - s * 0.16, s * 0.07);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(s * 0.22)}px ${FONT}`;
    ctx.fillText('COL DU WATT', px + (w * s) / 2, py + h * s * 0.42);
    ctx.font = `700 ${Math.round(s * 0.19)}px ${FONT}`;
    ctx.fillText('2240 m', px + (w * s) / 2, py + h * s * 0.74);
  };
  sign(1.65, 2.05, 2.1, 0.78);

  // Gipfelkreuz hinter dem Motor-Doper
  W(() => {
    const gx = 19.1;
    const gy0 = 9.0 + (19.1 - 17.6) * (4.5 / 22.4);
    ctx.fillStyle = '#6b4a2e';
    ctx.fillRect(gx - 0.09, gy0, 0.18, 2.6);
    ctx.fillRect(gx - 0.65, gy0 + 1.85, 1.3, 0.16);
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.moveTo(gx + 0.09, gy0 + 2.55);
    ctx.lineTo(gx + 0.75, gy0 + 2.4);
    ctx.lineTo(gx + 0.09, gy0 + 2.22);
    ctx.closePath();
    ctx.fill();
    // Steinmännchen
    ctx.fillStyle = '#9d8e78';
    for (const [dx, dy, rr] of [[0.9, 0.2, 0.22], [0.92, 0.5, 0.16], [0.9, 0.72, 0.11]]) {
      ctx.beginPath();
      ctx.ellipse(gx + dx, gy0 + dy, rr * 1.3, rr, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return { canvas: c, x0, y1, s };
}

// ------------------------------------------------------------------ Bauteile

/** Ecken (Körperkoordinaten) eines Polygons → Bild; Rechteck wenn poly fehlt */
export function blockSprite(mat: Mat, w: number, h: number, stage: number, poly: { x: number[]; y: number[] } | null, s: number, seed: number, deco?: string): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const pad = 0.06;
  let minX = -w / 2;
  let maxX = w / 2;
  let minY = -h / 2;
  let maxY = h / 2;
  if (poly) {
    minX = Math.min(...poly.x);
    maxX = Math.max(...poly.x);
    minY = Math.min(...poly.y);
    maxY = Math.max(...poly.y);
  }
  const cw = (maxX - minX + pad * 2) * s;
  const ch = (maxY - minY + pad * 2) * s;
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext('2d')!;
  // Bildmitte = Körperursprung, y nach unten (lokal y nach oben → spiegeln)
  const ox = (-minX + pad) * s;
  const oy = (maxY + pad) * s;
  ctx.setTransform(s, 0, 0, -s, ox, oy);
  const r = rng(seed);
  const path = () => {
    ctx.beginPath();
    if (poly) poly.x.forEach((x, i) => (i === 0 ? ctx.moveTo(x, poly.y[i]) : ctx.lineTo(x, poly.y[i])));
    else ctx.roundRect(-w / 2, -h / 2, w, h, mat === 'akku' ? Math.min(w, h) * 0.18 : mat === 'stone' ? 0.06 : 0.035);
    ctx.closePath();
  };
  const line = 0.05;
  const long = w >= h;

  if (mat === 'wood' || mat === 'roof') {
    path();
    ctx.fillStyle = mat === 'roof' ? '#a8452f' : '#c98b4f';
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (mat === 'roof') {
      // Schindeln in Reihen
      for (let y = minY; y < maxY; y += 0.22) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(minX, y, maxX - minX, 0.035);
        for (let x = minX + ((y * 10) % 2 ? 0.12 : 0); x < maxX; x += 0.26) {
          ctx.fillStyle = r() < 0.5 ? '#b9533a' : '#9a3e2a';
          ctx.beginPath();
          ctx.ellipse(x + 0.13, y + 0.12, 0.12, 0.09, 0, Math.PI, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#7b4b2a';
      ctx.fillRect(minX, minY, maxX - minX, 0.14);
    } else if (Math.abs(w - h) < 0.25 && w < 1) {
      // Kiste mit Kreuzstreben
      ctx.strokeStyle = '#a86d38';
      ctx.lineWidth = 0.11;
      ctx.strokeRect(-w / 2 + 0.07, -h / 2 + 0.07, w - 0.14, h - 0.14);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 0.1, -h / 2 + 0.1);
      ctx.lineTo(w / 2 - 0.1, h / 2 - 0.1);
      ctx.stroke();
    } else {
      // Maserung entlang der langen Seite
      ctx.strokeStyle = '#a86d38';
      ctx.lineWidth = 0.03;
      const n = Math.max(2, Math.round((long ? h : w) / 0.12));
      for (let i = 1; i < n; i++) {
        const t = -0.5 + i / n;
        ctx.beginPath();
        if (long) {
          ctx.moveTo(-w / 2, t * h);
          for (let x = -w / 2; x <= w / 2; x += 0.3) ctx.lineTo(x, t * h + Math.sin(x * 3 + i) * 0.02);
        } else {
          ctx.moveTo(t * w, -h / 2);
          for (let y = -h / 2; y <= h / 2; y += 0.3) ctx.lineTo(t * w + Math.sin(y * 3 + i) * 0.02, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#9c6533';
      for (let i = 0; i < Math.max(1, Math.round(Math.max(w, h) / 1.2)); i++) {
        ctx.beginPath();
        const kx = long ? (r() - 0.5) * w * 0.8 : (r() - 0.5) * w * 0.3;
        const ky = long ? (r() - 0.5) * h * 0.3 : (r() - 0.5) * h * 0.8;
        ctx.ellipse(kx, ky, 0.08, 0.045, long ? 0 : Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Nagelköpfe an den Enden
      ctx.fillStyle = '#5b4a3a';
      for (const e of [-1, 1]) {
        if (long) { ctx.beginPath(); ctx.arc(e * (w / 2 - 0.12), 0, 0.035, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(0, e * (h / 2 - 0.12), 0.035, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // Lichtkante oben
    ctx.fillStyle = 'rgba(255,230,190,0.35)';
    ctx.fillRect(minX, maxY - 0.07, maxX - minX, 0.07);
    ctx.fillStyle = 'rgba(60,30,10,0.18)';
    ctx.fillRect(minX, minY, maxX - minX, 0.07);
    ctx.restore();
    path();
    ctx.strokeStyle = '#6e4322';
    ctx.lineWidth = line;
    ctx.stroke();
  } else if (mat === 'glass') {
    path();
    ctx.fillStyle = 'rgba(196,236,252,0.6)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.min(w, h) * 0.18;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      const o = k * Math.max(w, h) * 0.45;
      ctx.moveTo(-w / 2 + o, -h / 2);
      ctx.lineTo(w / 2 + o + h * 0.3, h / 2);
      ctx.stroke();
    }
    ctx.restore();
    path();
    ctx.strokeStyle = '#7fbad4';
    ctx.lineWidth = 0.06;
    ctx.stroke();
  } else if (mat === 'stone') {
    path();
    ctx.fillStyle = '#b9b3a8';
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Mauerwerk
    const rowH = Math.min(0.42, Math.max(0.2, Math.min(w, h) * 0.6));
    let row = 0;
    for (let y = -h / 2; y < h / 2; y += rowH) {
      let x = -w / 2 - (row % 2 ? rowH * 0.8 : 0);
      while (x < w / 2) {
        const bw = rowH * (1.3 + r() * 0.9);
        ctx.fillStyle = ['#c3bdb2', '#aea89c', '#bab4a8', '#a49d91'][Math.floor(r() * 4)];
        ctx.beginPath();
        ctx.roundRect(x + 0.025, y + 0.025, bw - 0.05, rowH - 0.05, 0.05);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x + 0.05, y + rowH - 0.1, bw - 0.12, 0.04);
        x += bw;
      }
      row++;
    }
    ctx.restore();
    path();
    ctx.strokeStyle = '#6f695f';
    ctx.lineWidth = line;
    ctx.stroke();
  } else if (mat === 'akku') {
    path();
    ctx.fillStyle = '#2c313b';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#3a404d';
    ctx.fillRect(-w / 2, h / 2 - h * 0.22, w, h * 0.22);
    // Ladeanzeige
    const segs = 3;
    const sw = (w * 0.62) / segs;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = '#5be37d';
      ctx.fillRect(-w * 0.31 + i * sw + 0.02, -h * 0.32, sw - 0.04, h * 0.16);
    }
    // Blitz
    ctx.fillStyle = '#ffd23f';
    const bs = Math.min(w, h) * 0.32;
    ctx.beginPath();
    ctx.moveTo(bs * 0.15, bs * 1.0);
    ctx.lineTo(-bs * 0.45, -bs * 0.05);
    ctx.lineTo(-bs * 0.02, -bs * 0.05);
    ctx.lineTo(-bs * 0.2, -bs * 0.85);
    ctx.lineTo(bs * 0.45, bs * 0.2);
    ctx.lineTo(bs * 0.02, bs * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    path();
    ctx.strokeStyle = '#11131a';
    ctx.lineWidth = line;
    ctx.stroke();
    // Pole oben
    ctx.fillStyle = '#9aa3b5';
    ctx.fillRect(-w * 0.3, h / 2, w * 0.14, 0.05);
    ctx.fillRect(w * 0.16, h / 2, w * 0.14, 0.05);
  } else if (mat === 'cake') {
    // Schwarzwälder Kirschtorte
    ctx.save();
    path();
    ctx.clip();
    const layers = ['#5a3220', '#fff4e4', '#6b3b26', '#fff4e4'];
    layers.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(-w / 2, -h / 2 + (i * h) / layers.length, w, h / layers.length + 0.01);
    });
    ctx.fillStyle = '#3d2216';
    for (let i = 0; i < 10; i++) ctx.fillRect(-w / 2 + r() * w, -h / 2 + r() * h * 0.2, 0.05, 0.02);
    ctx.restore();
    path();
    ctx.strokeStyle = '#3d2216';
    ctx.lineWidth = 0.035;
    ctx.stroke();
    // Sahnetupfer und Kirschen
    for (let i = 0; i < 3; i++) {
      const cx = -w / 2 + (w * (i + 0.5)) / 3;
      ctx.fillStyle = '#fffaf2';
      ctx.beginPath();
      ctx.arc(cx, h / 2 + 0.03, 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d7263d';
      ctx.beginPath();
      ctx.arc(cx, h / 2 + 0.12, 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Risse je nach Schaden
  if (stage > 0) {
    ctx.save();
    path();
    ctx.clip();
    ctx.strokeStyle = mat === 'glass' ? 'rgba(255,255,255,0.95)' : mat === 'stone' ? 'rgba(60,55,48,0.75)' : 'rgba(60,30,10,0.7)';
    ctx.lineWidth = mat === 'glass' ? 0.03 : 0.035;
    const cracks = stage === 1 ? 1 : 3;
    for (let k = 0; k < cracks; k++) {
      let x = minX + r() * (maxX - minX);
      let y = minY + r() * (maxY - minY);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (r() - 0.5) * 0.35;
        y += (r() - 0.5) * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  void deco;
  return { canvas: c, ox, oy };
}
