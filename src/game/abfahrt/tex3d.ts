/** Farbtexturen für den WebGL-Renderer (prozedural, nahtlos kachelbar) */
import { mulberry32, type Rng } from './rng';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function grain(c: CanvasRenderingContext2D, S: number, r: Rng, amount: number) {
  const img = c.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + v));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v));
  }
  c.putImageData(img, 0, 0);
}

/** nahtlos: Elemente am Rand zusätzlich auf der Gegenseite zeichnen */
function wrapDraw(S: number, x: number, y: number, draw: (x: number, y: number) => void) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(x + dx, y + dy);
}

export function asphaltTex(fresh = false): HTMLCanvasElement {
  const S = 512;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(fresh ? 41 : 42);
  c.fillStyle = fresh ? '#3f4247' : '#62656b';
  c.fillRect(0, 0, S, S);
  grain(c, S, r, fresh ? 18 : 26);
  for (let i = 0; i < 2600; i++) {
    const x = r() * S;
    const y = r() * S;
    const s = 0.8 + r() * 2.2;
    c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${(0.05 + r() * 0.08).toFixed(2)})` : `rgba(0,0,0,${(0.06 + r() * 0.1).toFixed(2)})`;
    wrapDraw(S, x, y, (a, b) => c.fillRect(a, b, s, s));
  }
  if (!fresh) {
    // Risse
    c.strokeStyle = 'rgba(20,20,22,0.35)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      let x = r() * S;
      let y = r() * S;
      c.beginPath();
      c.moveTo(x, y);
      for (let j = 0; j < 7; j++) { x += (r() - 0.5) * 40; y += 8 + r() * 22; c.lineTo(x, y); }
      c.stroke();
    }
  }
  return cv;
}

export function cobbleTex(): HTMLCanvasElement {
  const S = 512;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(43);
  c.fillStyle = '#5b544c';
  c.fillRect(0, 0, S, S);
  const rows = 16;
  const rh = S / rows;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * rh * 0.55;
    for (let x = -rh + off; x < S; x += rh * 1.1) {
      const w = rh * (0.92 + r() * 0.2);
      const h = rh * (0.82 + r() * 0.1);
      const base = 120 + r() * 50;
      const tint = r();
      const col = tint < 0.3 ? `rgb(${base + 15},${base - 5},${base - 18})` : tint < 0.6 ? `rgb(${base},${base - 6},${base - 8})` : `rgb(${base - 10},${base - 12},${base - 4})`;
      wrapDraw(S, x, row * rh, (px, py) => {
        c.fillStyle = col;
        c.beginPath(); c.roundRect(px + 1.5, py + 1.5, w - 3, h - 2, rh * 0.3); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.beginPath(); c.roundRect(px + 3, py + 3, w * 0.55, h * 0.35, rh * 0.2); c.fill();
      });
    }
  }
  grain(c, S, r, 14);
  return cv;
}

export function gravelTex(): HTMLCanvasElement {
  const S = 512;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(44);
  c.fillStyle = '#c9b48c';
  c.fillRect(0, 0, S, S);
  grain(c, S, r, 26);
  for (let i = 0; i < 3500; i++) {
    const x = r() * S;
    const y = r() * S;
    const s = 1 + r() * 3.5;
    c.fillStyle = r() < 0.5 ? 'rgba(110,90,60,0.45)' : 'rgba(255,250,235,0.5)';
    wrapDraw(S, x, y, (a, b) => { c.beginPath(); c.ellipse(a, b, s, s * 0.7, 0, 0, Math.PI * 2); c.fill(); });
  }
  // Fahrspuren
  c.fillStyle = 'rgba(120,95,60,0.18)';
  c.fillRect(S * 0.2, 0, S * 0.12, S);
  c.fillRect(S * 0.68, 0, S * 0.12, S);
  return cv;
}

export function vergeTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(45);
  c.fillStyle = '#8f8676';
  c.fillRect(0, 0, S, S);
  grain(c, S, r, 34);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(60,50,35,0.4)' : 'rgba(240,230,210,0.35)';
    c.fillRect(r() * S, r() * S, 2, 2);
  }
  return cv;
}

/** helles Rauschen, das mit Vertexfarben multipliziert wird (Gras, Fels, Schnee) */
export function detailTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(46);
  c.fillStyle = '#e6e6e6';
  c.fillRect(0, 0, S, S);
  grain(c, S, r, 30);
  for (let i = 0; i < 1600; i++) {
    const x = r() * S;
    const y = r() * S;
    c.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    wrapDraw(S, x, y, (a, b) => { c.beginPath(); c.moveTo(a, b); c.lineTo(a + (r() - 0.5) * 3, b - 2 - r() * 4); c.stroke(); });
  }
  return cv;
}

/** Talboden: Felder, Wälder und Wege von oben */
export function fieldsTex(): HTMLCanvasElement {
  const S = 1024;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(47);
  c.fillStyle = '#7ea85e';
  c.fillRect(0, 0, S, S);
  const cols = ['#86b062', '#a4bf6c', '#6f9a52', '#c6b875', '#93ad5c', '#b2c27a', '#5f8a48'];
  for (let i = 0; i < 160; i++) {
    const x = r() * S;
    const y = r() * S;
    const w = 40 + r() * 140;
    const h = 30 + r() * 120;
    const a = (r() - 0.5) * 0.6;
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    wrapDraw(S, x, y, (px, py) => { c.save(); c.translate(px, py); c.rotate(a); c.fillRect(-w / 2, -h / 2, w, h); c.restore(); });
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * S;
    const y = r() * S;
    const n = 30 + Math.floor(r() * 60);
    for (let k = 0; k < n; k++) {
      const px = x + (r() - 0.5) * 120;
      const py = y + (r() - 0.5) * 80;
      c.fillStyle = r() < 0.5 ? '#3f6a36' : '#4d7a40';
      wrapDraw(S, px, py, (a, b) => { c.beginPath(); c.arc(a, b, 4 + r() * 5, 0, Math.PI * 2); c.fill(); });
    }
  }
  c.strokeStyle = 'rgba(235,225,200,0.7)';
  c.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    let x = r() * S;
    let y = 0;
    c.beginPath(); c.moveTo(x, y);
    while (y < S) { x += (r() - 0.5) * 80; y += 40 + r() * 60; c.lineTo(x, y); }
    c.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const x = r() * S;
    const y = r() * S;
    for (let k = 0; k < 10; k++) {
      c.fillStyle = k % 3 ? '#efe7d8' : '#b4553a';
      c.fillRect(x + (r() - 0.5) * 50, y + (r() - 0.5) * 40, 7, 6);
    }
  }
  grain(c, S, r, 16);
  return cv;
}

/** Hausfassaden: mehrere Farbvarianten untereinander, je Band 4 m breit und 12 m hoch */
export const FACADE_BANDS = 8;
export function facadeTex(lit: boolean): HTMLCanvasElement {
  const W = 256;
  const BH = 384;
  const cv = canvas(W, BH * FACADE_BANDS);
  const c = cv.getContext('2d')!;
  const r = mulberry32(48);
  const walls = ['#dca86a', '#e2997c', '#ecdcbc', '#e8c86c', '#d98f8c', '#cc7a55', '#eeeae0', '#cfc4b0'];
  const shutters = ['#2f6a3a', '#5b3a22', '#2c4f7a', '#7a2d24', '#2f6a3a', '#3a5a3a', '#5b3a22', '#444'];
  const px = W / 4; // px pro Meter
  for (let b = 0; b < FACADE_BANDS; b++) {
    const y0 = b * BH;
    c.fillStyle = lit ? '#000' : walls[b];
    c.fillRect(0, y0, W, BH);
    if (!lit) {
      // Putzstruktur
      for (let i = 0; i < 500; i++) {
        c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
        c.fillRect(r() * W, y0 + r() * BH, 3 + r() * 6, 2 + r() * 4);
      }
      // Sockel
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(0, y0 + BH - px * 0.7, W, px * 0.7);
    }
    const church = b === 7;
    for (let col = 0; col < 2; col++) {
      const cx = (col + 0.5) * (W / 2);
      for (let fl = 0; fl < 3; fl++) {
        const top = y0 + BH - px * (3.1 + fl * 2.9 + 1.4);
        const ww = px * 0.85;
        const wh = px * 1.35;
        const on = lit && r() < 0.55;
        if (lit) {
          if (on) { c.fillStyle = '#ffcf7a'; c.fillRect(cx - ww / 2, top, ww, wh); }
          continue;
        }
        if (church) {
          c.fillStyle = '#3b3530';
          c.beginPath(); c.moveTo(cx - ww / 2, top + wh); c.lineTo(cx - ww / 2, top + ww / 2); c.arc(cx, top + ww / 2, ww / 2, Math.PI, 0); c.lineTo(cx + ww / 2, top + wh); c.fill();
          continue;
        }
        c.fillStyle = shutters[b];
        c.fillRect(cx - ww * 1.05, top, ww * 0.5, wh);
        c.fillRect(cx + ww * 0.55, top, ww * 0.5, wh);
        c.fillStyle = '#2c3440';
        c.fillRect(cx - ww / 2, top, ww, wh);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(cx - ww / 2, top, ww * 0.45, wh * 0.5);
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.fillRect(cx - 1, top, 2, wh);
        if (r() < 0.5) {
          c.fillStyle = '#5a3a24';
          c.fillRect(cx - ww * 0.65, top + wh, ww * 1.3, 5);
          for (let k = 0; k < 7; k++) { c.fillStyle = k % 2 ? '#e2364a' : '#ff6b81'; c.beginPath(); c.arc(cx - ww * 0.55 + k * ww * 0.18, top + wh - 2, 4, 0, Math.PI * 2); c.fill(); }
        }
      }
      // Erdgeschoss
      const gTop = y0 + BH - px * 2.4;
      if (lit) {
        if (r() < 0.4) { c.fillStyle = '#ffd99a'; c.fillRect(cx - px * 0.7, gTop + px * 0.3, px * 1.4, px * 1.7); }
        continue;
      }
      if (col === 0 || church) {
        c.fillStyle = '#5a3a24';
        c.fillRect(cx - px * 0.45, gTop, px * 0.9, px * 2.4);
      } else {
        c.fillStyle = '#3d4a58';
        c.fillRect(cx - px * 0.75, gTop + px * 0.35, px * 1.5, px * 1.7);
        const aw = ['#c0392b', '#2e7d4f', '#1f5fbf', '#b8860b'][b % 4];
        for (let k = 0; k < 6; k++) { c.fillStyle = k % 2 ? '#fff' : aw; c.fillRect(cx - px * 0.85 + k * px * 0.283, gTop, px * 0.283, px * 0.35); }
      }
    }
    if (!lit) {
      // Traufkante
      c.fillStyle = 'rgba(60,40,30,0.9)';
      c.fillRect(0, y0, W, 6);
    }
  }
  return cv;
}

export function roundTex(inner: string, outer: string, size = 64): HTMLCanvasElement {
  const cv = canvas(size, size);
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return cv;
}

/** Schriftzug für Torbögen */
export function bannerTex(text: string, sub: string, bg: string, fg: string): HTMLCanvasElement {
  const W = 1024;
  const H = 160;
  const cv = canvas(W, H);
  const c = cv.getContext('2d')!;
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const font = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif';
  let fs = sub ? 64 : 80;
  c.font = `800 ${fs}px ${font}`;
  while (c.measureText(text).width > W * 0.92 && fs > 20) { fs -= 4; c.font = `800 ${fs}px ${font}`; }
  c.fillText(text, W / 2, sub ? H * 0.38 : H * 0.52);
  if (sub) {
    c.globalAlpha = 0.85;
    c.font = `600 38px ${font}`;
    c.fillText(sub, W / 2, H * 0.76);
  }
  return cv;
}
