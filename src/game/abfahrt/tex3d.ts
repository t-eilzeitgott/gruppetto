/** Farbtexturen für den WebGL-Renderer (prozedural, nahtlos kachelbar) */
import { mulberry32, type Rng } from './rng';
import { fitFont } from './textfit';

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
  // Kopien nur, wo das Element über einen Rand ragen kann (spart beim Laden viel Zeichenarbeit)
  const M = Math.min(S / 4, 64);
  const xs = x < M ? [0, S] : x > S - M ? [0, -S] : [0];
  const ys = y < M ? [0, S] : y > S - M ? [0, -S] : [0];
  for (const dx of xs) for (const dy of ys) draw(x + dx, y + dy);
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

/**
 * Kopfsteinpflaster: Reihen unterschiedlicher Höhe, Steine verschieden breit, leicht schief und unregelmäßig
 * gerundet, Farben von Granitgrau über Beige bis Rostbraun; Fugen mit Sand statt schwarzer Linien. So entsteht
 * kein strenges Raster, das beim Fahren flimmert. Nahtlos.
 */
export function cobbleTex(): HTMLCanvasElement {
  const S = 512;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(43);
  c.fillStyle = '#6a6156';
  c.fillRect(0, 0, S, S);
  // Sand in den Fugen
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(150,135,110,0.35)' : 'rgba(60,52,44,0.3)';
    c.fillRect(r() * S, r() * S, 1.5, 1.5);
  }
  const rows: number[] = [];
  let sum = 0;
  while (sum < S - 40) { const h = 26 + Math.floor(r() * 14); rows.push(h); sum += h; }
  rows.push(S - sum);
  const tones: [number, number, number][] = [[128, 126, 122], [146, 138, 124], [118, 112, 108], [150, 128, 108], [104, 104, 108], [136, 132, 126], [158, 148, 132]];
  let y = 0;
  for (const h of rows) {
    let x = -r() * 30;
    const x0 = x;
    while (x < x0 + S) {
      const w = h * (0.85 + r() * 0.75);
      const t = tones[Math.floor(r() * tones.length)];
      const v = 0.85 + r() * 0.28;
      const col = `rgb(${Math.round(t[0] * v)},${Math.round(t[1] * v)},${Math.round(t[2] * v)})`;
      // unregelmäßige Ecken
      const g = 2 + r() * 1.5;
      const jx = () => (r() - 0.5) * 3.5;
      const pts: [number, number][] = [[g + jx(), g + jx()], [w - g + jx(), g + jx()], [w - g + jx(), h - g + jx()], [g + jx(), h - g + jx()]];
      const rad = 4 + r() * 6;
      const tilt = (r() - 0.5) * 0.06;
      const draw = (px: number) => {
        c.save();
        c.translate(px + w / 2, y + h / 2);
        c.rotate(tilt);
        c.translate(-w / 2, -h / 2);
        c.beginPath();
        for (let i = 0; i < 4; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[(i + 1) % 4];
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          if (i === 0) c.moveTo(mx, my);
          c.arcTo(bx, by, (bx + pts[(i + 2) % 4][0]) / 2, (by + pts[(i + 2) % 4][1]) / 2, rad);
        }
        c.closePath();
        c.fillStyle = col;
        c.fill();
        // gewölbte Oberfläche: oben links Licht, unten rechts Schatten
        const lg = c.createLinearGradient(0, 0, w, h);
        lg.addColorStop(0, 'rgba(255,255,255,0.16)');
        lg.addColorStop(0.5, 'rgba(255,255,255,0)');
        lg.addColorStop(1, 'rgba(0,0,0,0.2)');
        c.fillStyle = lg;
        c.fill();
        // Abrieb, Flecken
        for (let k = 0; k < 4; k++) {
          c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
          c.beginPath();
          c.ellipse(r() * w, r() * h, 2 + r() * 6, 1.5 + r() * 4, r() * 3, 0, Math.PI * 2);
          c.fill();
        }
        c.restore();
      };
      draw(x);
      if (x + w > S) draw(x - S);
      if (x < 0) draw(x + S);
      x += w;
    }
    y += h;
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

/**
 * Felswände: waagrechte Gesteinsschichten mit Fugen, senkrechte Risse und Flecken – hell,
 * wird mit der Eckpunktfarbe multipliziert (auch Schneewände bekommen so ihre Lagen). Nahtlos.
 */
export function rockTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(48);
  c.fillStyle = '#e2e0da';
  c.fillRect(0, 0, S, S);
  const TAU = Math.PI * 2;
  // Schichten: Bänder mit welliger Ober- und Unterkante (ganze Wellen über die Breite → nahtlos)
  let y = 0;
  while (y < S) {
    const h = Math.min(S - y, 4 + r() * 15);
    const tone = r();
    const fill = tone < 0.34 ? `rgba(78,68,56,${(0.12 + r() * 0.22).toFixed(2)})`
      : tone < 0.72 ? `rgba(255,252,246,${(0.14 + r() * 0.26).toFixed(2)})`
        : `rgba(132,110,86,${(0.12 + r() * 0.18).toFixed(2)})`;
    const amp = 0.8 + r() * 2.5;
    const ph = r() * TAU;
    const k = 1 + Math.floor(r() * 3);
    const edge = (x: number, off: number) => off + amp * Math.sin(ph + (x / S) * TAU * k) + 1.2 * Math.sin(ph * 3 + (x / S) * TAU * (k + 3));
    const joint = `rgba(38,32,26,${(0.16 + r() * 0.3).toFixed(2)})`;
    const lw = 0.8 + r() * 1.6;
    for (const dy of [-S, 0, S]) {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(0, edge(0, y + dy));
      for (let x = 8; x <= S; x += 8) c.lineTo(x, edge(x, y + dy));
      for (let x = S; x >= 0; x -= 8) c.lineTo(x, edge(x, y + h + dy));
      c.closePath();
      c.fill();
      c.strokeStyle = joint;
      c.lineWidth = lw;
      c.beginPath();
      for (let x = 0; x <= S; x += 8) { const yy = edge(x, y + h + dy); if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy); }
      c.stroke();
    }
    y += h;
  }
  // senkrechte Risse
  for (let i = 0; i < 40; i++) {
    const x0 = r() * S;
    const y0 = r() * S;
    const n = 3 + Math.floor(r() * 6);
    const steps: [number, number][] = [];
    let x = 0;
    let yy = 0;
    for (let j = 0; j < n; j++) { x += (r() - 0.5) * 3.5; yy += 2.5 + r() * 6; steps.push([x, yy]); }
    const a = (0.14 + r() * 0.24).toFixed(2);
    const w = 0.7 + r() * 1.4;
    wrapDraw(S, x0, y0, (px, py) => {
      c.strokeStyle = `rgba(30,26,22,${a})`;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(px, py);
      for (const [dx, dy] of steps) c.lineTo(px + dx, py + dy);
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.18)';
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(px + 1.4, py);
      for (const [dx, dy] of steps) c.lineTo(px + dx + 1.4, py + dy);
      c.stroke();
    });
  }
  // Flecken (Flechten, Feuchtigkeit)
  for (let i = 0; i < 70; i++) {
    const x0 = r() * S;
    const y0 = r() * S;
    const rad = 1.5 + r() * 8;
    const dark = r() < 0.6;
    const col = dark ? `rgba(60,58,44,${(0.05 + r() * 0.08).toFixed(2)})` : `rgba(255,255,240,${(0.06 + r() * 0.1).toFixed(2)})`;
    wrapDraw(S, x0, y0, (px, py) => { c.fillStyle = col; c.beginPath(); c.ellipse(px, py, rad * 1.6, rad * 0.7, 0, 0, TAU); c.fill(); });
  }
  grain(c, S, r, 22);
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
  fitFont(c, text, W * 0.92, sub ? 64 : 80, 4, 20, (fs) => `800 ${fs}px ${font}`);
  c.fillText(text, W / 2, sub ? H * 0.38 : H * 0.52);
  if (sub) {
    c.globalAlpha = 0.85;
    c.font = `600 38px ${font}`;
    c.fillText(sub, W / 2, H * 0.76);
  }
  return cv;
}

// ------------------------------------------------------------------ Werbebanden und Pappschilder

/** Zellen im Atlas (1024×2560, je 256×128, 4 Spalten × 20 Zeilen): oben die Banden, ab Zelle SIGN_BASE die Schilder */
export const AD_COLS = 4;
const AD_ROWS = 20;
const AD_H = AD_ROWS * 128;
const SIGN_BASE = 40;
/** UV-Rechteck einer Zelle: [u0, v0, u1, v1] */
export function adCell(i: number, sign: boolean): [number, number, number, number] {
  const k = sign ? SIGN_BASE + (i % SIGN_COUNT) : i % AD_COUNT;
  const cx = k % AD_COLS;
  const cy = Math.floor(k / AD_COLS);
  const pu = 2 / 1024;
  const pv = 2 / AD_H;
  return [cx / AD_COLS + pu, 1 - (cy + 1) / AD_ROWS + pv, (cx + 1) / AD_COLS - pu, 1 - cy / AD_ROWS - pv];
}

const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Arial, sans-serif';
const ROUND = '"Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, ' + SANS;
const MARKER = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", "Bradley Hand", ' + SANS;

/** erfundene Marken – Radsport-Humor statt echter Sponsoren */
const ADS: { t: string; s: string; bg: string; fg: string; ac?: string; style?: 'round' | 'italic' | 'stripe' }[] = [
  { t: 'gruppetto', s: 'Tippen. Leiden. Siegen.', bg: '#ff5fa2', fg: '#ffffff', style: 'round' },
  { t: 'BIDON-BAR', s: 'kalt · nass · gratis', bg: '#0b5394', fg: '#ffffff', ac: '#7fd3ff' },
  { t: 'KETTE RECHTS', s: 'Fahrradwerkstatt', bg: '#111214', fg: '#ffd400', style: 'italic' },
  { t: 'POLENTA POWER', s: 'seit 1923', bg: '#ffd400', fg: '#1a1a1a', ac: '#c0392b' },
  { t: 'Gelateria Tornante', s: '48 Sorten · 48 Kehren', bg: '#f6efe2', fg: '#d63384', style: 'round' },
  { t: 'ESPRESSO DOPPIO', s: 'Doping für alle', bg: '#4b2e1e', fg: '#f3e2c7', style: 'stripe' },
  { t: 'Bremsen?', s: 'Optional.', bg: '#e74c3c', fg: '#ffffff', style: 'italic' },
  { t: 'WINDSCHATTEN', s: 'Versicherung AG', bg: '#169c88', fg: '#ffffff' },
  { t: 'Kaiserschmarrn', s: 'Hütte · 2 km', bg: '#ffffff', fg: '#7d1f2a', style: 'round' },
  { t: 'SPRINT-SALAMI', s: 'luftgetrocknet', bg: '#7d1f2a', fg: '#ffffff', ac: '#ffd400' },
  { t: 'SITZCREME', s: 'Deluxe · für lange Tage', bg: '#ffffff', fg: '#2e86de', style: 'stripe' },
  { t: 'TOUR27', s: 'Jetzt mittippen', bg: '#1f2a44', fg: '#ff8fc0', style: 'round' },
  { t: 'PASTA LANTERNA', s: 'für das Gruppetto', bg: '#2f9e5a', fg: '#ffffff', ac: '#ffffff' },
  { t: 'Schlauch-Express', s: '24 h Pannendienst', bg: '#f1c40f', fg: '#111214', style: 'italic' },
  { t: 'BERGPREIS BIER', s: 'alkoholfrei · leider', bg: '#0e3b2e', fg: '#f1c40f' },
  { t: 'Pizzeria Kehre 7', s: 'Holzofen · Aussicht', bg: '#ffffff', fg: '#c0392b', style: 'round' },
  // Essen & Trinken
  { t: 'TRATTORIA TEMPOLIMIT', s: 'Pasta in 4 Minuten 59', bg: '#c0392b', fg: '#ffffff', ac: '#2f9e5a' },
  { t: 'GEL-O-MAT', s: '24 h Zucker', bg: '#ff8c1a', fg: '#ffffff', style: 'stripe' },
  { t: 'Bäckerei Bergwertung', s: 'Kuchen der 1. Kategorie', bg: '#fbf3e4', fg: '#8a4b1f', style: 'round' },
  { t: 'RISOTTO RIVALE', s: 'wartet auf niemanden', bg: '#f4e7c5', fg: '#1a1a1a', ac: '#c0392b' },
  { t: 'CAPPUCCINO-STOPP', s: 'nur vor 11 Uhr. Ernsthaft.', bg: '#6f4e37', fg: '#fff4e0', style: 'italic' },
  { t: 'Banane GmbH', s: 'gelb wie das Trikot', bg: '#ffe14d', fg: '#3b2f00', style: 'round' },
  // Rad & Material
  { t: 'CARBON-KUMMER', s: 'leichter als dein Konto', bg: '#1b1b1d', fg: '#e8e8e8', style: 'stripe' },
  { t: 'NOCH EIN RAD?', s: 'N+1 Finanzierung', bg: '#2e86de', fg: '#ffffff', style: 'italic' },
  { t: 'Speichen Schmidt', s: 'wir ziehen alles nach', bg: '#ffffff', fg: '#34495e', ac: '#e67e22' },
  { t: 'RITZEL-REHA', s: 'für Knie ab 40', bg: '#16a085', fg: '#ffffff', style: 'round' },
  { t: 'Kettenfett Klaus', s: 'schmiert alles', bg: '#2d2a26', fg: '#f5b041', style: 'italic' },
  // Dienstleistungen & Pseudo-Sponsoren
  { t: 'ZEITLIMIT AIRLINES', s: 'wir warten nicht', bg: '#0b2545', fg: '#ffffff', ac: '#ff5fa2' },
  { t: 'BESENWAGEN TAXI', s: 'holt dich überall ab', bg: '#ffd400', fg: '#111214', style: 'stripe' },
  { t: 'Physio Pedalo', s: 'Waden & Seele', bg: '#e8f6f3', fg: '#117a65', style: 'round' },
  { t: 'LEISTUNGSDATEN AG', s: 'lügt nie, leider', bg: '#5b2c6f', fg: '#ffffff', ac: '#f1c40f' },
  { t: 'WATT-WETTE', s: 'Bauchgefühl statt Powermeter', bg: '#ff5733', fg: '#ffffff', style: 'italic' },
  { t: 'Gegenwind GmbH', s: 'immer für dich da', bg: '#aed6f1', fg: '#1b4f72', style: 'round' },
  { t: 'SERPENTINEN-SPARKASSE', s: 'es geht aufwärts', bg: '#d63031', fg: '#ffffff', ac: '#ffffff' },
  // gruppetto in eigener Sache
  { t: 'gruppetto', s: 'Hinten ist das neue Vorne', bg: '#1f2a44', fg: '#ff8fc0', style: 'round' },
  { t: 'TIPP-SCHLUSS', s: '12 Uhr. Kein Pardon.', bg: '#ff5fa2', fg: '#ffffff', style: 'italic' },
  { t: 'Außenseiter-Bonus', s: 'einsam, aber reich', bg: '#ffffff', fg: '#d6249f', style: 'round' },
  { t: 'gruppetto', s: 'Wir kommen an. Irgendwann.', bg: '#ffd400', fg: '#1f2a44', style: 'round' },
];
export const AD_COUNT = ADS.length;

/** Vorrat an Sprüchen für die Pappschilder – je Rennen kommt eine neue Auswahl auf die Schilder */
const SIGN_POOL = ['ALLEZ!', 'FORZA!', 'DAJE!', 'HOPP HOPP', 'VAI VAI!', 'GO GO GO', '♥ GIRO', 'KEINE BREMSE!', 'HALLO MAMA', 'SCHNELLER!',
  'BIDON PLS!', 'TOUR27', 'MACH ES!', 'BRAVO!', 'ICH BIN IM TV', 'ALLEZ ALLEZ', 'ZIEL IST DA →', 'TRET DOCH!', 'PAPA FÄHRT MIT',
  'NUR NOCH 14 KEHREN', 'WO IST DEIN E-BIKE?', 'KUCHEN OBEN!', 'TIPP: PLATZ 1', 'SCHALT RUNTER!', 'ICH WILL EIN BIDON', 'OMA FÄHRT SCHNELLER',
  'BERG? WELCHER BERG?', 'LÄCHELN!', 'DU SCHAFFST DAS', 'KETTE RECHTS!', 'BEINE WIE BUTTER?', 'WATT IST LOS?', 'ATTACKE!', 'NIE MEHR E-BIKE',
  'WINKEN!', 'HUPEN!', 'SCHÖNE WADEN!', 'NOCH 3 KM (GELOGEN)', 'ICH HAB GETIPPT!', 'AUSSENSEITER!', 'PASTA PARTY', 'PIZZA OBEN',
  'MEHR WATT!', 'NICHT BREMSEN', 'GEL? HAB ICH!', 'SPRINT!', 'DAI DAI DAI', 'FORZA RAGAZZI', 'VAMOS!', 'GRUPPETTO 4 LIFE',
  // Radsport-Insider
  'N+1', 'CHAPEAU!', 'SHUT UP LEGS', 'RULE #5', 'KOM? KAFFEE!', 'SOCKEN ZU KURZ!', 'BEINE RASIERT?', 'KARBON STATT KARIES',
  'FAHR DEIN TEMPO', 'NUR NOCH 1 SEGMENT', 'STRAVA ODER NIE PASSIERT', 'WATT/KG? EGAL!', 'KETTE GEÖLT?', 'BIDON LEER?', 'WINDSCHATTEN GESUCHT',
  'SCHLAUCH GEFLICKT?', 'GEGENWIND IST AUCH WIND', 'DAS IST KEIN BERG', 'BERGAUF IST AUCH SCHÖN', 'KAFFEE-STOPP OBEN',
  // Tippspiel-Insider
  'AUSSENSEITER-BONUS +4', 'MAX 3× TIPPBAR!', 'TIPPSCHLUSS 12:00!', '20 PUNKTE BITTE', 'PLATZ 10 = 1 PUNKT', 'ICH TIPP GEGEN DICH',
  'HINTEN IST DAS NEUE VORNE', 'GRUPPETTO > PELOTON', 'ZEITLIMIT? EGAL!', 'SPRITZ IM ZIEL', 'BONUSTIPP SITZT', 'TIPP VERPENNT',
  'WER HAT DEN FAVORITEN?', 'PRO FÜR 2,99', 'MEIN TIPP GEWINNT', 'GEISTERFAHRER ♥', 'ZWISCHENZEIT: GRÜN!', 'BESTZEIT HEUTE?'];
/** mit Namen der Runde: % = Vorname – die Lieblingsstelle für Insider */
const SIGN_NAMED = ['ALLEZ %', '% ♥', 'FORZA %', 'GO %!', 'VAI %!', '% FÜR GELB', 'HOPP %!', 'WIR ♥ %',
  '% ZAHLT DEN SPRITZ', 'TIPPKÖNIG %', '% TIPPT FALSCH', '% IM GRUPPETTO', '% HOL DIE 20!', '% → ZEITLIMIT', 'GEIST VON %', '% FÄHRT E-BIKE',
  '% ATTACKE!', 'WO IST %?', '% SCHULDET MIR BIER', 'PODIUM FÜR %'];
/** so viele Schilder hat der Atlas (Zellen 40 … 79) */
export const SIGN_COUNT = 40;

/** Mischen mit festem Startwert (Fisher-Yates) */
function shuffled<T>(list: T[], r: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Sprüche der 40 Pappschilder für ein Rennen: bis zu 18 mit Namen der Runde (immer andere Mitspieler und
 * Sprüche), der Rest aus dem Vorrat. Derselbe Startwert ergibt dieselben Schilder; jedes Rennen würfelt neu.
 */
export function signTexts(names: string[], seed: number): string[] {
  const r = mulberry32(seed ^ 0x1b873593);
  const own = shuffled(names, r).slice(0, 6);
  const named = shuffled(SIGN_NAMED, r);
  const pool = shuffled(SIGN_POOL, r);
  const out: string[] = [];
  for (let i = 0; i < SIGN_COUNT; i++) {
    if (i < own.length * 3) out.push(named[i % named.length].replace('%', own[Math.floor(i / 3)]));
    else out.push(pool[(i - own.length * 3) % pool.length]);
  }
  return out;
}
/** Pappe, Bettlaken, Zeichenkarton: meist hell oder Pappbraun, ab und zu Gelb oder Rosa */
const BOARDS: [string, string][] = [['#f4f1e8', '#141414'], ['#f2d64b', '#141414'], ['#ec9cc2', '#141414'], ['#c9a273', '#1a1a1a'], ['#f4f1e8', '#c42a86'],
  ['#f4f1e8', '#b03a2e'], ['#f7f6f2', '#1f3f73'], ['#b98f5f', '#141414'], ['#d7b588', '#7a1f1f'], ['#f4f1e8', '#2d5a3a']];

/**
 * Atlas mit Banden (oben) und handgeschriebenen Pappschildern (unten); Namen der Runde kommen auf ein paar Schilder.
 * seed: je Rennen ein neuer – dann stehen andere Sprüche auf den Schildern (die Banden bleiben)
 */
export function adsTex(names: string[], seed = 77): HTMLCanvasElement {
  const cv = canvas(1024, AD_H);
  const c = cv.getContext('2d')!;
  const r = mulberry32(seed);
  const texts = signTexts(names, seed);
  const fit = (text: string, weight: string, font: string, max: number, maxW: number) => {
    let fs = max;
    c.font = `${weight} ${fs}px ${font}`;
    while (c.measureText(text).width > maxW && fs > 12) { fs -= 2; c.font = `${weight} ${fs}px ${font}`; }
    return fs;
  };
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // Banden: 2 m × 0,8 m – gezeichnet in 320×128 und auf 256×128 gestaucht
  for (let i = 0; i < AD_COUNT; i++) {
    const ad = ADS[i];
    const x0 = (i % 4) * 256;
    const y0 = Math.floor(i / 4) * 128;
    c.save();
    c.translate(x0, y0);
    c.scale(256 / 320, 1);
    c.fillStyle = ad.bg;
    c.fillRect(0, 0, 320, 128);
    if (ad.style === 'stripe') {
      c.fillStyle = ad.fg;
      c.globalAlpha = 0.18;
      for (let k = -2; k < 12; k++) { c.beginPath(); c.moveTo(k * 36, 128); c.lineTo(k * 36 + 18, 128); c.lineTo(k * 36 + 58, 0); c.lineTo(k * 36 + 40, 0); c.fill(); }
      c.globalAlpha = 1;
    }
    if (ad.ac) { c.fillStyle = ad.ac; c.fillRect(0, 0, 320, 7); c.fillRect(0, 121, 320, 7); }
    c.fillStyle = ad.fg;
    const font = ad.style === 'round' ? ROUND : SANS;
    const weight = ad.style === 'italic' ? 'italic 900' : '900';
    fit(ad.t, weight, font, 54, 296);
    c.fillText(ad.t, 160, 54);
    c.globalAlpha = 0.85;
    fit(ad.s, '600', SANS, 22, 280);
    c.fillText(ad.s, 160, 98);
    c.globalAlpha = 1;
    c.restore();
  }
  // Pappschilder, leicht schief beschrieben – so groß wie möglich (bei mehreren Wörtern zweizeilig),
  // dick mit Edding nachgezogen, damit man sie im Vorbeifahren lesen kann
  for (let i = 0; i < SIGN_COUNT; i++) {
    const k = SIGN_BASE + i;
    const x0 = (k % 4) * 256;
    const y0 = Math.floor(k / 4) * 128;
    const [bg, fg] = BOARDS[Math.floor(r() * BOARDS.length)];
    c.fillStyle = bg;
    c.fillRect(x0, y0, 256, 128);
    // Pappe: leichte Flecken und Kanten
    c.globalAlpha = 0.07;
    for (let n = 0; n < 40; n++) { c.fillStyle = r() < 0.5 ? '#000' : '#fff'; c.fillRect(x0 + r() * 250, y0 + r() * 122, 3 + r() * 10, 2 + r() * 6); }
    c.globalAlpha = 0.3;
    c.strokeStyle = '#000';
    c.lineWidth = 4;
    c.strokeRect(x0 + 2, y0 + 2, 252, 124);
    c.globalAlpha = 1;
    const text = texts[i];
    c.save();
    c.beginPath();
    c.rect(x0 + 3, y0 + 3, 250, 122);
    c.clip();
    c.translate(x0 + 128, y0 + 64);
    c.rotate((r() - 0.5) * 0.1);
    paintLines(c, text, 238, 118, 96, MARKER, fg);
    c.restore();
  }
  return cv;
}

/**
 * Text so groß wie möglich in ein Feld (Mitte = Ursprung): einzeilig oder an der besten Wortgrenze zweizeilig –
 * was die größere Schrift ergibt. Füllung plus Kontur in derselben Farbe macht die Striche dicker (Edding, Pinsel).
 */
export function paintLines(c: CanvasRenderingContext2D, text: string, maxW: number, maxH: number, maxFs: number, family: string, fg: string) {
  const font = (fs: number) => `900 ${fs}px ${family}`;
  const fitW = (t: string, start: number) => fitFont(c, t, maxW, start, 2, 12, font);
  let lines = [text];
  let fs = fitW(text, Math.min(maxFs, Math.round(maxH * 0.78)));
  const words = text.split(' ');
  if (words.length > 1) {
    const cap = Math.round(maxH * 0.44);
    for (let k = 1; k < words.length; k++) {
      const two = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      const wide = c.measureText(two[0]).width > c.measureText(two[1]).width ? two[0] : two[1];
      const f2 = fitW(wide, cap);
      // zweizeilig nur, wenn es wirklich größer wird
      if (f2 > fs * 1.12) { fs = f2; lines = two; }
    }
  }
  c.font = font(fs);
  c.fillStyle = fg;
  c.strokeStyle = fg;
  c.lineJoin = 'round';
  c.lineWidth = Math.max(2, fs * 0.07);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const lh = fs * 0.98;
  lines.forEach((l, k) => {
    const y = (k - (lines.length - 1) / 2) * lh + fs * 0.04;
    c.strokeText(l, 0, y);
    c.fillText(l, 0, y);
  });
}

// ------------------------------------------------------------------ Fan-Bögen

/** Spruchbänder über die Straße: Bettlaken, Giro-Rosa, Gelb, Tricolore-Saum … */
const FAN_LOOKS: { bg: string; fg: string; edge: string; stripes?: string[] }[] = [
  { bg: '#fbfaf5', fg: '#d6249f', edge: '#d6249f' },
  { bg: '#ff5fa2', fg: '#ffffff', edge: '#ffffff' },
  { bg: '#ffe14d', fg: '#141414', edge: '#141414' },
  { bg: '#fbfaf5', fg: '#c0392b', edge: '#c0392b', stripes: ['#009246', '#fbfaf5', '#ce2b37'] },
  { bg: '#141414', fg: '#ffe14d', edge: '#ffe14d' },
  { bg: '#0b5394', fg: '#ffffff', edge: '#ffe14d' },
  { bg: '#fbfaf5', fg: '#141414', edge: '#141414', stripes: ['#1b1b1b', '#dd0000', '#ffce00'] },
];

const FAN_SAYINGS = ['ALLEZ ALLEZ ALLEZ!', 'FORZA GRUPPETTO!', 'HINTEN IST DAS NEUE VORNE', 'KEINE BREMSE, KEINE GNADE', 'WO BLEIBT DER BESENWAGEN?',
  'AUSSENSEITER-BONUS INCOMING', 'N+1 IST DIE EINZIG RICHTIGE ZAHL', 'TIPPEN. LEIDEN. SIEGEN.', 'SPRITZ IM ZIEL – FÜR ALLE!', 'GEGENWIND? KENNEN WIR.',
  'E-BIKES BITTE DRAUSSEN LASSEN', 'KUCHEN IM ZIEL!', 'TIPPSCHLUSS 12 UHR!', 'DAJE DAJE DAJE!', 'VAI VAI VAI!', 'TRET DOCH MAL!',
  'NUR NOCH EINE KEHRE. EHRLICH.', '♥ GIRO ♥', 'WATT? WIR TIPPEN!', 'ALLEZ LES GRUPPETTOS', 'HUPEN FÜR DAS GRUPPETTO!'];
const FAN_NAMED = ['ALLEZ %!', 'FORZA %!', '% ♥', 'WIR GLAUBEN AN %', '% FOR PRESIDENT', 'HOPP HOPP %!', 'VAI %!', '% IST DER BESTE',
  'FANCLUB %', '% – TIPPKÖNIG DER HERZEN', '% FÄHRT, WIR TRINKEN', 'HEUTE GEWINNT %'];

/** Atlas der Spruchbänder: 1024 × 2048, neun Zeilen zu 224 px (eine je Band, 7,7 m × 1,7 m) */
export const FAN_CELLS = 9;
const FAN_ROW = 224;
/** Höhe : Breite eines Bands im Atlas */
export const FAN_ASPECT = (FAN_ROW - 4) / 1024;

/** UV-Rechteck [u0, v0, u1, v1] eines Spruchbands */
export function fanCell(i: number): [number, number, number, number] {
  const k = ((i % FAN_CELLS) + FAN_CELLS) % FAN_CELLS;
  const pv = 2 / 2048;
  return [2 / 1024, 1 - ((k + 1) * FAN_ROW) / 2048 + pv, 1 - 2 / 1024, 1 - (k * FAN_ROW) / 2048 - pv];
}

/** Die Sprüche der neun Bänder: die ersten vier mit Namen der Runde (wenn es welche gibt), dann Sprüche – je Rennen andere */
export function fanTexts(names: string[], seed: number): string[] {
  const r = mulberry32(seed ^ 0x5f3759df);
  const say = shuffled(FAN_SAYINGS, r);
  const own = shuffled(names, r).slice(0, 6);
  const off = Math.floor(r() * FAN_NAMED.length);
  const out: string[] = [];
  let n = 0;
  for (let k = 0; k < FAN_CELLS; k++) {
    if (own.length && k < 4) out.push(FAN_NAMED[(off + k * 3) % FAN_NAMED.length].replace('%', own[k % own.length]));
    else out.push(say[n++ % say.length]);
  }
  return out;
}

/** Atlas der Spruchbänder: Stoff mit Falten, gemalter Rand (oder Saum in Landesfarben), riesige Pinselschrift */
export function fanAtlas(names: string[], seed: number): HTMLCanvasElement {
  const W = 1024;
  const cv = canvas(W, 2048);
  const c = cv.getContext('2d')!;
  const texts = fanTexts(names, seed);
  const r = mulberry32(seed ^ 0x2545f491);
  const look0 = Math.floor(r() * FAN_LOOKS.length);
  for (let k = 0; k < FAN_CELLS; k++) {
    const L = FAN_LOOKS[(look0 + k) % FAN_LOOKS.length];
    const y0 = k * FAN_ROW;
    const H = FAN_ROW;
    c.save();
    c.beginPath();
    c.rect(0, y0, W, H);
    c.clip();
    c.translate(0, y0);
    c.fillStyle = L.bg;
    c.fillRect(0, 0, W, H);
    // Falten: weiche senkrechte Bahnen
    for (let x = 0; x < W; x += 40 + r() * 50) {
      const w = 20 + r() * 40;
      const g = c.createLinearGradient(x, 0, x + w, 0);
      const dark = r() < 0.5;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, dark ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, w, H);
    }
    if (L.stripes) {
      const sh = 12;
      L.stripes.forEach((col, i) => {
        c.fillStyle = col;
        c.fillRect(0, 2 + i * sh, W, sh);
        c.fillRect(0, H - 2 - (L.stripes!.length - i) * sh, W, sh);
      });
    } else {
      // von Hand gemalter Rand
      c.strokeStyle = L.edge;
      c.lineWidth = 7;
      c.lineJoin = 'round';
      const m = 14;
      const pts: [number, number][] = [];
      for (let x = m; x <= W - m; x += 64) pts.push([x, m + (r() - 0.5) * 3]);
      for (let y = m; y <= H - m; y += 48) pts.push([W - m + (r() - 0.5) * 3, y]);
      for (let x = W - m; x >= m; x -= 64) pts.push([x, H - m + (r() - 0.5) * 3]);
      for (let y = H - m; y >= m; y -= 48) pts.push([m + (r() - 0.5) * 3, y]);
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.stroke();
    }
    c.translate(W / 2, H / 2);
    c.rotate((r() - 0.5) * 0.025);
    paintLines(c, texts[k], W * 0.88, H * 0.72, 150, MARKER, L.fg);
    c.restore();
  }
  return cv;
}

// ------------------------------------------------------------------ Tunnel

/**
 * Bruchsteinmauer für Portale und Stützmauern: Lagen unterschiedlich hoher, behauener Steine mit hellen
 * Fugen, jeder Stein mit eigener Tönung, Kantenlicht oben, Schatten unten. Hell – die Eckpunktfarbe tönt. Nahtlos.
 */
export function masonryTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(51);
  c.fillStyle = '#b9b2a6';
  c.fillRect(0, 0, S, S);
  // Lagen: Höhen, die zusammen genau S ergeben
  const rows: number[] = [];
  let sum = 0;
  while (sum < S - 30) { const h = 26 + Math.floor(r() * 16); rows.push(h); sum += h; }
  rows.push(S - sum);
  let y = 0;
  for (const h of rows) {
    let x = -r() * 40;
    const x0 = x;
    while (x < x0 + S) {
      const w = 34 + r() * 46;
      const tone = 196 + r() * 44;
      const warm = (r() - 0.5) * 18;
      const col = `rgb(${Math.round(tone + warm)},${Math.round(tone + warm * 0.3)},${Math.round(tone - warm * 0.6 - 6)})`;
      const draw = (px: number) => {
        const g = 2.2;
        c.fillStyle = col;
        c.beginPath();
        c.roundRect(px + g, y + g, w - 2 * g, h - 2 * g, 4);
        c.fill();
        // Kantenlicht oben links, Schatten unten
        c.fillStyle = 'rgba(255,255,255,0.22)';
        c.fillRect(px + g + 2, y + g, w - 2 * g - 4, 2.5);
        c.fillStyle = 'rgba(40,32,24,0.2)';
        c.fillRect(px + g + 1, y + h - g - 3, w - 2 * g - 2, 3);
        // behauene Fläche: ein paar Flecken
        for (let k = 0; k < 5; k++) {
          c.fillStyle = r() < 0.5 ? 'rgba(60,50,40,0.08)' : 'rgba(255,255,255,0.1)';
          c.beginPath();
          c.ellipse(px + g + r() * (w - 2 * g), y + g + r() * (h - 2 * g), 2 + r() * 7, 1.5 + r() * 4, 0, 0, Math.PI * 2);
          c.fill();
        }
      };
      draw(x);
      if (x + w > S) draw(x - S);
      if (x < 0) draw(x + S);
      x += w;
    }
    y += h;
  }
  grain(c, S, r, 16);
  return cv;
}

/** Spritzbeton im Gewölbe: unruhige graue Fläche mit Wasserflecken und Fugen der Betonierabschnitte. Nahtlos. */
export function shotcreteTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(52);
  c.fillStyle = '#d9d8d4';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 200; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 3 + r() * 14;
    const col = r() < 0.55 ? `rgba(70,68,64,${(0.03 + r() * 0.05).toFixed(2)})` : `rgba(255,255,255,${(0.04 + r() * 0.06).toFixed(2)})`;
    wrapDraw(S, x, y, (a, b) => { c.fillStyle = col; c.beginPath(); c.ellipse(a, b, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2); c.fill(); });
  }
  // Sickerspuren: senkrechte dunkle Schlieren
  for (let i = 0; i < 14; i++) {
    const x = r() * S;
    const w = 2 + r() * 6;
    const g = c.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(60,56,50,0)');
    g.addColorStop(0.3 + r() * 0.3, `rgba(60,56,50,${(0.08 + r() * 0.1).toFixed(2)})`);
    g.addColorStop(1, 'rgba(60,56,50,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, w, S);
  }
  // Fuge zwischen Betonierabschnitten (quer)
  c.fillStyle = 'rgba(40,40,40,0.35)';
  c.fillRect(0, S - 2, S, 2);
  grain(c, S, r, 26);
  return cv;
}

/** Schilder im Tunnel (Atlas 4 Zellen nebeneinander, je 128×128): SOS, Notausgang, Feuerlöscher, Abstand */
export const TSIGN = { sos: 0, exit: 1, fire: 2, dist: 3 } as const;
export function tunnelSignTex(): HTMLCanvasElement {
  const cv = canvas(512, 128);
  const c = cv.getContext('2d')!;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // SOS: blau mit weißer Schrift und Telefon
  c.fillStyle = '#1d5fd1'; c.fillRect(0, 0, 128, 128);
  c.strokeStyle = '#ffffff'; c.lineWidth = 6; c.strokeRect(6, 6, 116, 116);
  c.fillStyle = '#ffffff'; c.font = `900 46px ${SANS}`; c.fillText('SOS', 64, 46);
  c.beginPath(); c.roundRect(40, 74, 48, 30, 8); c.fill();
  c.fillStyle = '#1d5fd1'; c.fillRect(50, 84, 28, 10);
  // Notausgang: grün mit laufender Figur und Pfeil
  c.fillStyle = '#15a34a'; c.fillRect(128, 0, 128, 128);
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(128 + 52, 30, 10, 0, Math.PI * 2); c.fill();
  c.lineCap = 'round'; c.strokeStyle = '#ffffff'; c.lineWidth = 12;
  c.beginPath(); c.moveTo(128 + 50, 46); c.lineTo(128 + 42, 76); c.lineTo(128 + 58, 92); c.lineTo(128 + 52, 116); c.stroke();
  c.beginPath(); c.moveTo(128 + 42, 76); c.lineTo(128 + 26, 100); c.stroke();
  c.beginPath(); c.moveTo(128 + 50, 50); c.lineTo(128 + 68, 64); c.stroke();
  c.beginPath(); c.moveTo(128 + 48, 52); c.lineTo(128 + 30, 62); c.stroke();
  c.lineWidth = 9;
  c.beginPath(); c.moveTo(128 + 80, 64); c.lineTo(128 + 112, 64); c.stroke();
  c.beginPath(); c.moveTo(128 + 100, 50); c.lineTo(128 + 114, 64); c.lineTo(128 + 100, 78); c.stroke();
  // Feuerlöscher: rot mit weißem Symbol
  c.fillStyle = '#d7261e'; c.fillRect(256, 0, 128, 128);
  c.fillStyle = '#ffffff';
  c.beginPath(); c.roundRect(256 + 46, 34, 36, 74, 12); c.fill();
  c.fillRect(256 + 56, 20, 16, 16);
  c.lineWidth = 6; c.strokeStyle = '#ffffff';
  c.beginPath(); c.moveTo(256 + 72, 26); c.lineTo(256 + 96, 22); c.lineTo(256 + 100, 44); c.stroke();
  // Abstand: weiß mit schwarzem Rand
  c.fillStyle = '#f4f4f0'; c.fillRect(384, 0, 128, 128);
  c.strokeStyle = '#111111'; c.lineWidth = 6; c.strokeRect(390, 6, 116, 116);
  c.fillStyle = '#111111'; c.font = `800 40px ${SANS}`; c.fillText('100 m', 448, 64);
  return cv;
}

/** Inschrift über dem Portal: Marmortafel mit Name und Länge */
export function plaqueTex(name: string, len: string): HTMLCanvasElement {
  const W = 512;
  const H = 120;
  const cv = canvas(W, H);
  const c = cv.getContext('2d')!;
  const r = mulberry32(name.length * 31 + len.length);
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#ede8dd');
  g.addColorStop(1, '#d9d2c4');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // Maserung
  c.strokeStyle = 'rgba(120,110,95,0.12)';
  c.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    let x = r() * W;
    let y = 0;
    c.beginPath(); c.moveTo(x, y);
    while (y < H) { x += (r() - 0.5) * 30; y += 10 + r() * 14; c.lineTo(x, y); }
    c.stroke();
  }
  c.strokeStyle = 'rgba(70,60,48,0.55)';
  c.lineWidth = 4;
  c.strokeRect(8, 8, W - 16, H - 16);
  const SERIF = 'Georgia, "Times New Roman", "Iowan Old Style", serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  fitFont(c, name, W - 60, 46, 2, 16, (fs) => `700 ${fs}px ${SERIF}`);
  // eingemeißelt: dunkle Schrift mit heller Kante darunter
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.fillText(name, W / 2 + 1, 46 + 2);
  c.fillStyle = '#3b3328';
  c.fillText(name, W / 2, 46);
  c.font = `600 26px ${SERIF}`;
  c.fillStyle = '#5a4f40';
  c.fillText(len, W / 2, 90);
  return cv;
}

// ------------------------------------------------------------------ Landschaft (pro Bildpunkt)

/**
 * Rauschen in drei Kanälen (nahtlos, verschiedene Körnung): R grob, G mittel, B fein. Bricht in den Shadern
 * von Landschaft und Bergen die Übergänge (Waldrand, Fels, Schnee) organisch auf.
 */
export function noiseTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(61);
  const grid = (n: number) => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = r(); return g; };
  const sample = (g: Float32Array, n: number, x: number, y: number) => {
    const fx = (x / S) * n;
    const fy = (y / S) * n;
    const xi = Math.floor(fx);
    const yi = Math.floor(fy);
    let u = fx - xi;
    let v = fy - yi;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    const at = (i: number, j: number) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
    const a = at(xi, yi), b = at(xi + 1, yi), cc = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  const oct = [4, 8, 16, 32, 64].map((n) => ({ n, g: grid(n) }));
  const fbm = (x: number, y: number, from: number, k: number) => {
    let s = 0;
    let a = 0.5;
    let norm = 0;
    for (let o = from; o < Math.min(oct.length, from + k); o++) { s += sample(oct[o].g, oct[o].n, x, y) * a; norm += a; a *= 0.55; }
    return s / norm;
  };
  const img = c.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // Kontrast etwas strecken (Rauschen sammelt sich sonst um 0,5)
      const st = (v: number) => Math.max(0, Math.min(255, Math.round((0.5 + (v - 0.5) * 1.7) * 255)));
      d[i] = st(fbm(x, y, 0, 3));
      d[i + 1] = st(fbm(x, y, 1, 3));
      d[i + 2] = st(fbm(x, y, 2, 3));
      d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/**
 * Kronendach eines geschlossenen Walds von oben (Graustufen, wird grün getönt): dicht an dicht runde Kronen,
 * oben links im Licht, unten rechts im Schatten, dazwischen dunkle Lücken. Nahtlos.
 */
export function canopyTex(): HTMLCanvasElement {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const r = mulberry32(62);
  c.fillStyle = '#3a3a3a';
  c.fillRect(0, 0, S, S);
  const crowns: [number, number, number, number][] = [];
  for (let i = 0; i < 230; i++) crowns.push([r() * S, r() * S, 8 + r() * 9, 0.78 + r() * 0.3]);
  // kleine zuerst, große darüber: wirkt wie unterschiedlich hohe Bäume
  crowns.sort((a, b) => a[2] - b[2]);
  for (const [x, y, rad, lum] of crowns) {
    wrapDraw(S, x, y, (px, py) => {
      // Schlagschatten nach unten rechts
      c.fillStyle = 'rgba(0,0,0,0.32)';
      c.beginPath(); c.arc(px + rad * 0.35, py + rad * 0.4, rad, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(px - rad * 0.35, py - rad * 0.35, rad * 0.1, px, py, rad);
      const hi = Math.round(255 * lum);
      const lo = Math.round(120 * lum);
      g.addColorStop(0, `rgb(${hi},${hi},${hi})`);
      g.addColorStop(0.65, `rgb(${Math.round((hi + lo) / 2)},${Math.round((hi + lo) / 2)},${Math.round((hi + lo) / 2)})`);
      g.addColorStop(1, `rgb(${lo},${lo},${lo})`);
      c.fillStyle = g;
      c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.fill();
    });
  }
  grain(c, S, r, 18);
  return cv;
}

/**
 * Wiese von oben (Farbe, wird durch ihren Mittelwert geteilt und mit der Eckpunktfarbe multipliziert): Büschel
 * aus Halmen in mehreren Grüntönen, dunkle satte und helle trockene Flecken, Lücken mit Erde, einzelne
 * trockene Halme – dazu wenige Blüten (weiß, gelb, violett) mit eigener Maske, die ihre Farbe behalten.
 * Nahtlos, 256 Texel auf gut 4 m.
 */
export function grassTex(): { rgb: HTMLCanvasElement; flower: HTMLCanvasElement } {
  const S = 256;
  const cv = canvas(S, S);
  const c = cv.getContext('2d')!;
  const fv = canvas(S, S);
  const f = fv.getContext('2d')!;
  const r = mulberry32(71);
  const TAU = Math.PI * 2;
  c.fillStyle = 'rgb(116,134,74)';
  c.fillRect(0, 0, S, S);
  f.fillStyle = '#000';
  f.fillRect(0, 0, S, S);
  // weiche Flecken: satt und dunkel, trocken und hell, kühl
  const blobs: [string, number][] = [['78,104,50', 0.32], ['158,156,94', 0.24], ['94,122,82', 0.22], ['128,140,70', 0.2]];
  for (let i = 0; i < 90; i++) {
    const [col, al] = blobs[Math.floor(r() * blobs.length)];
    const rad = 8 + r() * 30;
    wrapDraw(S, r() * S, r() * S, (x, y) => {
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${col},${al})`);
      g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
    });
  }
  // Erde zwischen den Büscheln
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(${r() < 0.5 ? '72,62,42' : '58,66,40'},${(0.25 + r() * 0.3).toFixed(2)})`;
    const sz = 1 + r() * 2;
    wrapDraw(S, r() * S, r() * S, (x, y) => c.fillRect(x, y, sz, sz));
  }
  // Büschel: Halme strahlenförmig von einem Punkt (von oben gesehen), dunkel innen, hell an den Spitzen
  const blade = ['52,80,34', '70,100,44', '96,124,58', '124,146,70', '150,164,86', '172,176,104'];
  for (let i = 0; i < 420; i++) {
    const n = 5 + Math.floor(r() * 9);
    const base = r() * (blade.length - 2);
    const sx = r() * S;
    const sy = r() * S;
    wrapDraw(S, sx, sy, (x, y) => {
      for (let k = 0; k < n; k++) {
        const a = r() * TAU;
        const len = 2.5 + r() * 6;
        const tone = blade[Math.min(blade.length - 1, Math.floor(base + r() * 2.6))];
        c.strokeStyle = `rgba(${tone},${(0.5 + r() * 0.4).toFixed(2)})`;
        c.lineWidth = 0.7 + r() * 0.8;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + Math.cos(a) * len * 0.6 + (r() - 0.5) * 2, y + Math.sin(a) * len * 0.6 + (r() - 0.5) * 2, x + Math.cos(a) * len, y + Math.sin(a) * len);
        c.stroke();
      }
    });
  }
  // einzelne trockene Halme
  for (let i = 0; i < 140; i++) {
    const a = r() * TAU;
    const len = 4 + r() * 7;
    c.strokeStyle = `rgba(${r() < 0.6 ? '186,178,118' : '160,150,96'},${(0.45 + r() * 0.35).toFixed(2)})`;
    c.lineWidth = 0.6 + r() * 0.5;
    wrapDraw(S, r() * S, r() * S, (x, y) => { c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke(); });
  }
  grain(c, S, r, 16);
  // Blüten in kleinen Gruppen: Farbe ins Bild, Stärke in die Maske
  const flowers = ['236,232,214', '232,200,72', '168,136,200', '226,176,62', '200,170,214'];
  for (let g = 0; g < 22; g++) {
    const col = flowers[Math.floor(r() * flowers.length)];
    const gx = r() * S;
    const gy = r() * S;
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const rad = 0.6 + r() * 0.6;
      wrapDraw(S, gx + (r() - 0.5) * 18, gy + (r() - 0.5) * 18, (x, y) => {
        c.fillStyle = `rgb(${col})`;
        c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
        f.fillStyle = '#fff';
        f.beginPath(); f.arc(x, y, rad, 0, TAU); f.fill();
      });
    }
  }
  return { rgb: cv, flower: fv };
}

/**
 * Lichtschein für additive Darstellung: Farbe in der Mitte, zum Rand schwarz – ganz ohne Durchsichtigkeit.
 * (Verläufe ins Durchsichtige bekommen auf manchen Handys beim Hochladen farbiges Rauschen in den Rand.)
 */
export function glowTex(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  const cv = canvas(size, size);
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, size, size);
  const gr = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgb(${r},${g},${b})`);
  gr.addColorStop(0.35, `rgb(${Math.round(r * 0.45)},${Math.round(g * 0.42)},${Math.round(b * 0.38)})`);
  gr.addColorStop(1, '#000');
  c.fillStyle = gr;
  c.fillRect(0, 0, size, size);
  return cv;
}
