/**
 * Hausfassaden für die Ortsdurchfahrten: ein Texturatlas mit zwölf Baustilen, je zwei Varianten
 * nebeneinander (je 4 m breit, zwei Fensterachsen). Jeder Stil hat drei Bereiche – Erdgeschoss,
 * Obergeschoss, Traufgesims –, die der Renderer stockwerksweise aufzieht: Fenster sitzen so immer
 * ganz und an der richtigen Stelle, egal wie hoch ein Haus ist.
 * Dazu eine zweite, halb so große Karte mit den abends erleuchteten Fenstern (exakt dieselbe Lage)
 * und ein Atlas mit Ladenschildern in der Sprache des Etappenorts.
 */
import { mulberry32, type Rng } from './rng';

/** Atlas in Pixeln: Breite (2 Varianten à 256), Höhe je Stil und die Bereiche darin (von oben) */
export const FAC = { W: 512, BH: 320, CR: 34, UH: 136, GH: 150, STYLES: 12 } as const;
/** dieselben Bereiche in Metern */
export const FAC_M = { ground: 3.3, upper: 3.0, cornice: 0.7 } as const;
const FAC_H = FAC.BH * FAC.STYLES;

/** Baustile (Index = Band im Atlas) */
export const STYLE = {
  ocker: 0, lachs: 1, creme: 2, gelb: 3, haussmann: 4, terrakotta: 5,
  chalet: 6, kirche: 7, bruchstein: 8, fachwerk: 9, backstein: 10, rathaus: 11,
} as const;

export type FacPart = 'cornice' | 'upper' | 'ground' | 'base';

/** v-Koordinaten [unten, oben] eines Bereichs (Canvas-Texturen stehen auf dem Kopf: v = 1 − y/H) */
export function facV(style: number, part: FacPart): [number, number] {
  const y0 = style * FAC.BH;
  const [yb, yt] = part === 'cornice' ? [y0 + FAC.CR - 0.5, y0 + 1]
    : part === 'upper' ? [y0 + FAC.CR + FAC.UH - 0.5, y0 + FAC.CR + 0.5]
      : part === 'ground' ? [y0 + FAC.BH - 0.5, y0 + FAC.CR + FAC.UH + 0.5]
        : [y0 + FAC.BH - 2.5, y0 + FAC.BH - 3.5];
  return [1 - yb / FAC_H, 1 - yt / FAC_H];
}

/** u-Koordinate: Variante 0/1, Meter innerhalb des 4-m-Stücks */
export const facU = (variant: number, m: number) => (variant * 256 + Math.max(0, Math.min(4, m)) * 64) / FAC.W;

interface Style {
  kind: 'town' | 'haus' | 'chalet' | 'church' | 'stone' | 'timber' | 'brick' | 'mairie';
  wall: string;
  wall2?: string;
  shutter: string | null;
  trim: string;
  shop: string;     // Rahmenfarbe der Ladenfront
  awning: string;
}

const STYLES: Style[] = [
  { kind: 'town', wall: '#dcaa6c', shutter: '#2f6a3a', trim: '#f1e4c8', shop: '#24432c', awning: '#c0392b' },
  { kind: 'town', wall: '#e39a7e', shutter: '#2c4f7a', trim: '#f5e8d8', shop: '#2c3e5c', awning: '#2e7d4f' },
  { kind: 'town', wall: '#ecdcbc', shutter: '#7a2d24', trim: '#fbf4e4', shop: '#5c1f1a', awning: '#1f5fbf' },
  { kind: 'town', wall: '#e9c76c', shutter: '#2f6a3a', trim: '#f7ecca', shop: '#2d2d2d', awning: '#b8860b' },
  { kind: 'haus', wall: '#e4dac8', shutter: null, trim: '#f2ece0', shop: '#1d1d1f', awning: '#7a1f2b' },
  { kind: 'town', wall: '#cc7b56', shutter: '#5b3a22', trim: '#ebcfae', shop: '#3b2a1e', awning: '#e8b13a' },
  { kind: 'chalet', wall: '#8b5a33', wall2: '#cdc5b5', shutter: '#3f6a3a', trim: '#5a3a22', shop: '#5a3a22', awning: '#2e7d4f' },
  { kind: 'church', wall: '#d2c7b3', shutter: null, trim: '#bcae96', shop: '#5a3a24', awning: '#000' },
  { kind: 'stone', wall: '#a8a193', shutter: '#6b4a2e', trim: '#cbc4b4', shop: '#4a3424', awning: '#8a2a20' },
  { kind: 'timber', wall: '#f0e9da', shutter: '#7a2d24', trim: '#5a3a26', shop: '#3a2a1e', awning: '#c0392b' },
  { kind: 'brick', wall: '#9b4b37', shutter: null, trim: '#f2efe8', shop: '#173a2a', awning: '#173a2a' },
  { kind: 'mairie', wall: '#dcd2c0', shutter: '#3a5a7a', trim: '#eee8db', shop: '#2c3e5c', awning: '#2c3e5c' },
];

/** Wandfarbe je Stil (für Giebel und Kamine) */
export const STYLE_WALL: string[] = STYLES.map((s) => s.wall);
/** Dachfarbe je Stil (Ziegel, Schiefer, Holz) */
export const STYLE_ROOF: string[] = ['#a8492a', '#9a4426', '#a24e2e', '#a8492a', '#566070', '#b05430', '#4a3a30', '#8a7d6c', '#5c6068', '#6a3524', '#4f5560', '#5a6270'];
/** Dachneigung je Stil (Höhe je Meter) */
export const STYLE_PITCH: number[] = [0.42, 0.42, 0.45, 0.42, 0.7, 0.38, 0.36, 0.55, 0.62, 0.85, 0.55, 0.5];

const X = (m: number) => m * 64;
const Y = (m: number) => m * 45.4;

type Glass = { x: number; y: number; w: number; h: number; k: 'win' | 'shop' | 'fan' | 'church' };

function noise(c: CanvasRenderingContext2D, r: Rng, x: number, y: number, w: number, h: number, n: number, a = 0.06) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 1.2})`;
    c.fillRect(x + r() * w, y + r() * h, 2 + r() * 5, 1 + r() * 3);
  }
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/**
 * Zeichnet den Atlas. Fenster, Schaufenster und Oberlichter werden in glass gesammelt –
 * daraus entsteht die Nachtkarte mit genau denselben Positionen.
 */
function drawAtlas(c: CanvasRenderingContext2D, glass: Glass[]) {
  const r = mulberry32(4711);
  for (let s = 0; s < FAC.STYLES; s++) {
    const st = STYLES[s];
    const y0 = s * FAC.BH;
    const yC = y0;                       // Gesims oben
    const yU = y0 + FAC.CR;              // Obergeschoss
    const yG = y0 + FAC.CR + FAC.UH;     // Erdgeschoss
    const bottomU = yG;                  // Boden des Obergeschosses
    const bottomG = y0 + FAC.BH;         // Boden des Erdgeschosses
    c.save();
    c.beginPath();
    c.rect(0, y0, FAC.W, FAC.BH);
    c.clip();
    for (let v = 0; v < 2; v++) {
      const x0 = v * 256;
      // jede Variante nur in ihrem eigenen Feld (sonst greifen Ziegel und Streben in die Nachbarin)
      c.save();
      c.beginPath();
      c.rect(x0, y0, 256, FAC.BH);
      c.clip();
      // ---- Wand
      wallFill(c, r, st, x0, y0, s);
      // ---- Obergeschoss
      for (let bay = 0; bay < 2; bay++) {
        const cx = x0 + 64 + bay * 128;
        upperBay(c, r, st, cx, bottomU, v, bay, glass, s);
      }
      // ---- Erdgeschoss
      groundFloor(c, r, st, x0, bottomG, v, glass, s);
      // ---- Gesims
      cornice(c, r, st, x0, yC, yU);
      c.restore();
    }
    c.restore();
  }
}

function wallFill(c: CanvasRenderingContext2D, r: Rng, st: Style, x0: number, y0: number, s: number) {
  const W = 256;
  const yG = y0 + FAC.CR + FAC.UH;
  c.fillStyle = st.wall;
  c.fillRect(x0, y0, W, FAC.BH);
  switch (st.kind) {
    case 'town': case 'timber': {
      noise(c, r, x0, y0, W, FAC.BH, 900, 0.05);
      // leichte Wasserflecken unter dem Gesims
      for (let i = 0; i < 4; i++) {
        const g = c.createLinearGradient(0, y0 + FAC.CR, 0, y0 + FAC.CR + 70);
        g.addColorStop(0, 'rgba(60,40,20,0.10)');
        g.addColorStop(1, 'rgba(60,40,20,0)');
        c.fillStyle = g;
        c.fillRect(x0 + r() * W, y0 + FAC.CR, 6 + r() * 16, 70);
      }
      break;
    }
    case 'haus': case 'mairie': case 'church': {
      noise(c, r, x0, y0, W, FAC.BH, 600, 0.04);
      // Quaderfugen
      c.fillStyle = 'rgba(90,80,64,0.22)';
      for (let y = y0 + FAC.CR + 22; y < y0 + FAC.BH; y += 23) c.fillRect(x0, y, W, 1.5);
      for (let y = y0 + FAC.CR, row = 0; y < y0 + FAC.BH; y += 23, row++) {
        for (let x = x0 + (row % 2 ? 0 : 48); x < x0 + W; x += 96) c.fillRect(x, y, 1.5, 23);
      }
      if (st.kind !== 'church') {
        // Erdgeschoss mit tiefen Rustika-Fugen
        c.fillStyle = 'rgba(70,60,48,0.35)';
        for (let y = yG + 18; y < y0 + FAC.BH - 10; y += 19) c.fillRect(x0, y, W, 3);
      }
      break;
    }
    case 'chalet': {
      // Holzschalung oben, Bruchstein im Erdgeschoss
      for (let x = x0; x < x0 + W; x += 16) {
        c.fillStyle = shade(st.wall, 0.9 + r() * 0.2);
        c.fillRect(x, y0, 15, yG - y0);
        c.fillStyle = 'rgba(30,18,8,0.55)';
        c.fillRect(x + 15, y0, 1, yG - y0);
      }
      noise(c, r, x0, y0, W, yG - y0, 500, 0.06);
      stones(c, r, st.wall2!, x0, yG, W, FAC.GH);
      break;
    }
    case 'stone':
      stones(c, r, st.wall, x0, y0, W, FAC.BH);
      break;
    case 'brick': {
      for (let y = y0, row = 0; y < y0 + FAC.BH; y += 6, row++) {
        for (let x = x0 - (row % 2 ? 8 : 0); x < x0 + W; x += 16) {
          c.fillStyle = shade(st.wall, 0.82 + r() * 0.3);
          c.fillRect(x + 1, y + 1, 15, 5);
        }
      }
      c.globalCompositeOperation = 'destination-over';
      c.fillStyle = '#cbbfae';
      c.fillRect(x0, y0, W, FAC.BH);
      c.globalCompositeOperation = 'source-over';
      break;
    }
  }
  if (st.kind === 'timber') {
    // Fachwerk: Schwellen und Rähme je Geschoss, Ständer an den Achsgrenzen, Streben in den Feldern
    const yU = y0 + FAC.CR;
    c.fillStyle = st.trim;
    c.fillRect(x0, yU, W, 9);
    c.fillRect(x0, yG - 9, W, 9);
    for (const x of [0, 120, 248]) c.fillRect(x0 + x, yU, 8, yG - yU);
    c.save();
    c.lineWidth = 7;
    c.strokeStyle = st.trim;
    for (const [ax, bx] of [[8, 30], [120, 98], [128, 150], [248, 226]] as const) {
      c.beginPath();
      c.moveTo(x0 + ax, yG - 9);
      c.lineTo(x0 + bx, yU + 9);
      c.stroke();
    }
    c.restore();
  }
  if (s !== 7) {
    // Sockel
    c.fillStyle = st.kind === 'brick' ? '#6e6a64' : 'rgba(70,62,52,0.55)';
    c.fillRect(x0, y0 + FAC.BH - Y(0.4), W, Y(0.4));
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(x0, y0 + FAC.BH - Y(0.4), W, 2);
  }
}

function stones(c: CanvasRenderingContext2D, r: Rng, col: string, x0: number, y0: number, w: number, h: number) {
  c.fillStyle = shade(col, 0.6);
  c.fillRect(x0, y0, w, h);
  for (let y = y0 - 4; y < y0 + h; y += 11) {
    let x = x0 - r() * 20;
    while (x < x0 + w) {
      const sw = 14 + r() * 22;
      c.fillStyle = shade(col, 0.8 + r() * 0.35);
      c.beginPath();
      c.ellipse(x + sw / 2, y + 6, sw / 2 - 1, 5.5, 0, 0, Math.PI * 2);
      c.fill();
      x += sw;
    }
  }
}

/** Fenster mit Laibung, Sprossen, Fensterbank und (optional) offenen Läden; gibt das Glas zurück */
function window(c: CanvasRenderingContext2D, st: Style, cx: number, yb: number, h0: number, wm: number, hm: number,
  opt: { shutters?: boolean; arch?: boolean; sash?: boolean; box?: boolean; grille?: boolean; french?: boolean }, glass: Glass[], kind: Glass['k'] = 'win') {
  const w = X(wm);
  const h = Y(hm);
  const x = cx - w / 2;
  const y = yb - Y(h0) - h;
  const brick = st.kind === 'brick';
  // Laibung / Umrahmung
  c.fillStyle = brick ? '#e8e2d6' : st.kind === 'chalet' ? '#4a2e18' : shade(st.trim, 1);
  if (opt.arch) {
    c.beginPath();
    c.moveTo(x - 5, y + h + 3);
    c.lineTo(x - 5, y + w / 2);
    c.arc(cx, y + w / 2, w / 2 + 5, Math.PI, 0);
    c.lineTo(x + w + 5, y + h + 3);
    c.fill();
  } else c.fillRect(x - 5, y - 5, w + 10, h + 8);
  if (brick) { c.fillStyle = '#d8d0c0'; c.fillRect(x - 8, y - 9, w + 16, 7); }
  // Glas: Himmelsspiegelung oben, dunkler unten
  const g = c.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, kind === 'church' ? '#3b4f7a' : '#7d93ab');
  g.addColorStop(0.45, kind === 'church' ? '#2a2f4a' : '#34404f');
  g.addColorStop(1, kind === 'church' ? '#1c1a2a' : '#1f2630');
  c.fillStyle = g;
  if (opt.arch) {
    c.beginPath();
    c.moveTo(x, y + h);
    c.lineTo(x, y + w / 2);
    c.arc(cx, y + w / 2, w / 2, Math.PI, 0);
    c.lineTo(x + w, y + h);
    c.fill();
  } else c.fillRect(x, y, w, h);
  glass.push({ x, y, w, h, k: kind });
  // Vorhang angedeutet
  if (kind === 'win' && !opt.sash) {
    c.fillStyle = 'rgba(235,228,214,0.22)';
    c.fillRect(x + 2, y + 2, w * 0.22, h - 4);
    c.fillRect(x + w * 0.78 - 2, y + 2, w * 0.22, h - 4);
  }
  // Sprossen
  c.fillStyle = brick || kind === 'shop' ? '#f4f1ea' : st.kind === 'chalet' ? '#5a3a22' : '#ece6da';
  if (opt.sash) {
    c.fillRect(x, y + h / 2 - 2, w, 4);
    c.fillRect(cx - 1, y, 2, h);
    c.fillRect(x, y + h / 4, w, 1.5);
    c.fillRect(x, y + (h * 3) / 4, w, 1.5);
  } else if (kind !== 'church') {
    c.fillRect(cx - 1.5, y, 3, h);
    for (let k = 1; k < (opt.french ? 4 : 3); k++) c.fillRect(x, y + (h * k) / (opt.french ? 4 : 3) - 1, w, 2);
  } else {
    c.fillStyle = 'rgba(20,20,20,0.6)';
    c.fillRect(cx - 1, y + 4, 2, h - 4);
    for (let k = 1; k < 5; k++) c.fillRect(x, y + (h * k) / 5, w, 1.5);
  }
  // Fensterbank
  if (!opt.french) {
    c.fillStyle = brick ? '#e8e2d6' : shade(st.trim, 0.92);
    c.fillRect(x - 7, y + h + 2, w + 14, 5);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x - 7, y + h + 7, w + 14, 2);
  }
  // Läden
  if (opt.shutters && st.shutter) {
    for (const sx of [x - 5 - w / 2, x + w + 5]) {
      c.fillStyle = st.shutter;
      c.fillRect(sx, y - 3, w / 2, h + 6);
      c.fillStyle = 'rgba(0,0,0,0.28)';
      for (let ly = y + 2; ly < y + h + 2; ly += 5) c.fillRect(sx + 3, ly, w / 2 - 6, 2);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(sx, y - 3, 2, h + 6);
    }
  }
  if (opt.grille) {
    c.fillStyle = 'rgba(25,25,28,0.85)';
    for (let gx = x + 5; gx < x + w; gx += 8) c.fillRect(gx, y, 2, h);
    c.fillRect(x, y + h * 0.5, w, 2);
  }
  if (opt.box) flowers(c, x - 6, y + h + 1, w + 12);
}

function flowers(c: CanvasRenderingContext2D, x: number, y: number, w: number) {
  c.fillStyle = '#5a3a24';
  c.fillRect(x, y, w, 7);
  for (let k = 0; k < w / 5; k++) {
    c.fillStyle = k % 3 === 0 ? '#3f7a2f' : k % 2 ? '#e2364a' : '#ff6b81';
    c.beginPath();
    c.arc(x + 3 + k * 5, y - 1 - (k % 2) * 2, 3.4, 0, Math.PI * 2);
    c.fill();
  }
}

function railing(c: CanvasRenderingContext2D, x: number, yb: number, w: number, hm: number, wood: boolean) {
  const h = Y(hm);
  const y = yb - h;
  if (wood) {
    c.fillStyle = '#5a3a22';
    c.fillRect(x, y, w, 6);
    c.fillRect(x, yb - 6, w, 6);
    for (let bx = x + 2; bx < x + w - 4; bx += 9) {
      c.fillStyle = '#6e4628';
      c.fillRect(bx, y + 6, 6, h - 12);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(bx + 2, y + h * 0.45, 2, 5);
    }
    flowers(c, x + 2, y - 2, w - 4);
    return;
  }
  // Schmiedeeisen
  c.fillStyle = 'rgba(28,28,32,0.95)';
  c.fillRect(x, y, w, 3);
  c.fillRect(x, yb - 3, w, 3);
  for (let bx = x + 3; bx < x + w - 2; bx += 6) c.fillRect(bx, y, 1.6, h);
  c.strokeStyle = 'rgba(28,28,32,0.9)';
  c.lineWidth = 1.4;
  for (let bx = x + 6; bx < x + w - 10; bx += 18) {
    c.beginPath();
    c.ellipse(bx + 6, y + h / 2, 5, h / 2 - 5, 0, 0, Math.PI * 2);
    c.stroke();
  }
}

function upperBay(c: CanvasRenderingContext2D, r: Rng, st: Style, cx: number, yb: number, v: number, bay: number, glass: Glass[], s: number) {
  switch (st.kind) {
    case 'town': case 'timber': {
      if (v === 0) window(c, st, cx, yb, 0.85, 0.95, 1.6, { shutters: true, box: (s + bay) % 2 === 0 }, glass);
      else {
        window(c, st, cx, yb, 0.05, 0.95, 2.25, { shutters: true, french: true }, glass);
        // kleiner Austritt mit Eisengeländer
        c.fillStyle = shade(st.trim, 0.8);
        c.fillRect(cx - X(0.7), yb - 6, X(1.4), 6);
        railing(c, cx - X(0.68), yb - 6, X(1.36), 0.95, false);
      }
      break;
    }
    case 'haus': case 'mairie': {
      window(c, st, cx, yb, 0.1, 1.0, 2.3, { shutters: st.kind === 'mairie', french: true }, glass);
      // Verdachung
      c.fillStyle = shade(st.trim, 0.85);
      c.fillRect(cx - X(0.62), yb - Y(2.55), X(1.24), 7);
      if (v === 0 || st.kind === 'mairie') {
        c.fillStyle = shade(st.trim, 0.75);
        c.fillRect(cx - X(0.7), yb - 7, X(1.4), 7);
        railing(c, cx - X(0.66), yb - 7, X(1.32), 0.9, false);
      } else if (bay === 1) {
        // durchlaufender Balkon über beide Achsen (nach beiden Fenstern gezeichnet)
        c.fillStyle = shade(st.trim, 0.75);
        c.fillRect(cx - 192, yb - 7, 256, 7);
        railing(c, cx - 190, yb - 7, 252, 0.9, false);
      }
      break;
    }
    case 'chalet': {
      window(c, st, cx, yb, 1.15, 0.9, 1.25, { shutters: true }, glass);
      if (bay === 0) {
        // Holzbalkon über die ganze Breite mit Geranien
        c.fillStyle = '#4a2e18';
        c.fillRect(cx - 64, yb - 9, 256, 9);
        railing(c, cx - 64, yb - 9, 256, 1.0, true);
      }
      break;
    }
    case 'church':
      window(c, st, cx, yb, 0.5, 0.85, 2.2, { arch: true }, glass, 'church');
      break;
    case 'stone':
      window(c, st, cx, yb, 1.0, 0.8, 1.15, { shutters: true, box: v === 1 && bay === 1 }, glass);
      break;
    case 'brick':
      window(c, st, cx, yb, 0.85, 0.95, 1.7, { sash: true }, glass);
      break;
  }
  void r;
}

function groundFloor(c: CanvasRenderingContext2D, r: Rng, st: Style, x0: number, yb: number, v: number, glass: Glass[], s: number) {
  const door = (cx: number, wm: number, hm: number, col: string, fan = true, arch = false) => {
    const w = X(wm);
    const h = Y(hm);
    const x = cx - w / 2;
    const y = yb - Y(0.12) - h;
    c.fillStyle = st.kind === 'brick' ? '#e8e2d6' : shade(st.trim, 0.9);
    c.fillRect(x - 7, y - 7, w + 14, h + 7 + Y(0.12));
    if (arch) {
      c.beginPath();
      c.moveTo(x - 7, y + w / 2);
      c.arc(cx, y + w / 2, w / 2 + 7, Math.PI, 0);
      c.fill();
    }
    c.fillStyle = col;
    if (arch) {
      c.beginPath();
      c.moveTo(x, y + h);
      c.lineTo(x, y + w / 2);
      c.arc(cx, y + w / 2, w / 2, Math.PI, 0);
      c.lineTo(x + w, y + h);
      c.fill();
    } else c.fillRect(x, y, w, h);
    // Füllungen
    c.fillStyle = 'rgba(0,0,0,0.22)';
    const top = arch ? y + w / 2 : y;
    const fh = fan && !arch ? Y(0.45) : 0;
    for (const px of [x + 5, cx + 3]) {
      c.fillRect(px, top + fh + 6, w / 2 - 8, (h - fh) * 0.38);
      c.fillRect(px, top + fh + (h - fh) * 0.5, w / 2 - 8, (h - fh) * 0.4);
    }
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(x, y, 3, h);
    if (fan && !arch) {
      c.fillStyle = '#2b3440';
      c.fillRect(x + 3, y + 3, w - 6, fh - 4);
      glass.push({ x: x + 3, y: y + 3, w: w - 6, h: fh - 4, k: 'fan' });
      c.fillStyle = 'rgba(230,225,215,0.7)';
      for (let k = 1; k < 4; k++) c.fillRect(x + 3 + ((w - 6) * k) / 4, y + 3, 1.5, fh - 4);
    }
    // Klinke, Stufe
    c.fillStyle = '#c8b070';
    c.fillRect(cx + w * 0.3, y + h * 0.55, 3, 3);
    c.fillStyle = 'rgba(150,145,135,0.9)';
    c.fillRect(x - 10, yb - Y(0.12), w + 20, Y(0.12));
  };
  const shopFront = (style: 'shop' | 'pub' | 'cafe') => {
    const x = x0 + 14;
    const w = 228;
    const y = yb - Y(2.4);
    c.fillStyle = st.shop;
    c.fillRect(x, y - 4, w, Y(2.4) + 4 - Y(0.1));
    // Schaufenster und Tür
    const doorW = X(0.95);
    const dx = style === 'cafe' ? x + w / 2 - doorW / 2 : x + 10;
    const panes = style === 'cafe' ? [[x + 8, dx - 6], [dx + doorW + 6, x + w - 8]] : [[dx + doorW + 8, x + w - 8]];
    for (const [a, b] of panes) {
      const py = y + 6;
      const ph = Y(2.4) - Y(0.55) - 6;
      const g = c.createLinearGradient(a, py, a + 30, py + ph);
      g.addColorStop(0, '#8aa0b6');
      g.addColorStop(0.5, '#38434f');
      g.addColorStop(1, '#232a33');
      c.fillStyle = g;
      c.fillRect(a, py, b - a, ph);
      glass.push({ x: a, y: py, w: b - a, h: ph, k: 'shop' });
      // Auslage angedeutet
      for (let k = 0; k < (b - a) / 14; k++) {
        c.fillStyle = ['#d9b36c', '#c45a3a', '#e8d9b0', '#7a9a5a'][(k + s) % 4];
        c.fillRect(a + 4 + k * 14, py + ph - 12 - (k % 3) * 3, 9, 10 + (k % 3) * 3);
      }
      c.fillStyle = 'rgba(255,255,255,0.75)';
      if (style === 'pub') for (let k = 1; k < 4; k++) c.fillRect(a + ((b - a) * k) / 4, py, 1.5, ph);
      c.fillStyle = shade(st.shop, 1.3);
      c.fillRect(a, py + ph, b - a, Y(0.55));
    }
    c.fillStyle = shade(st.shop, 0.7);
    c.fillRect(dx, y + 2, doorW, Y(2.4) - Y(0.1) - 2);
    c.fillStyle = '#2b3440';
    c.fillRect(dx + 6, y + 8, doorW - 12, Y(1.4));
    glass.push({ x: dx + 6, y: y + 8, w: doorW - 12, h: Y(1.4), k: 'shop' });
    // Markise (gestreift) und Schildbrett darüber
    if (style !== 'pub') {
      const ay = yb - Y(2.92);
      for (let k = 0; k < 12; k++) {
        c.fillStyle = k % 2 ? '#f4f1ea' : st.awning;
        c.fillRect(x + (k * w) / 12, ay, w / 12 + 0.5, Y(0.42));
      }
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x, ay + Y(0.42), w, 3);
      for (let k = 0; k < 12; k++) {
        c.fillStyle = k % 2 ? '#e8e2d6' : shade(st.awning, 0.8);
        c.beginPath();
        c.arc(x + ((k + 0.5) * w) / 12, ay + Y(0.42), w / 24, 0, Math.PI);
        c.fill();
      }
    }
    c.fillStyle = st.shop;
    c.fillRect(x, yb - Y(3.27), w, Y(0.32));
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(x, yb - Y(3.27), w, 2);
  };
  switch (st.kind) {
    case 'town': case 'timber':
      if (v === 0) {
        door(x0 + 64, 1.1, 2.45, ['#5a3a24', '#2f4a3a', '#6a2a24', '#2c3e5c', '#4a3a2a', '#3a4a5a'][s % 6]);
        window(c, st, x0 + 192, yb, 0.95, 0.95, 1.45, { shutters: true, grille: true }, glass);
      } else shopFront(s % 2 ? 'cafe' : 'shop');
      break;
    case 'haus':
      if (v === 0) {
        door(x0 + 64, 1.35, 2.75, '#2a2420', false, true);
        window(c, st, x0 + 192, yb, 0.7, 1.0, 2.1, { grille: true, arch: true }, glass);
      } else shopFront('cafe');
      break;
    case 'mairie':
      // Arkaden
      for (const cx of [x0 + 64, x0 + 192]) {
        const w = X(1.45);
        const h = Y(2.85);
        c.fillStyle = shade(st.trim, 0.85);
        c.fillRect(cx - w / 2 - 8, yb - h - 4, w + 16, h + 4);
        c.fillStyle = '#2a2622';
        c.beginPath();
        c.moveTo(cx - w / 2, yb);
        c.lineTo(cx - w / 2, yb - h + w / 2);
        c.arc(cx, yb - h + w / 2, w / 2, Math.PI, 0);
        c.lineTo(cx + w / 2, yb);
        c.fill();
        glass.push({ x: cx - w / 2 + 6, y: yb - h + 10, w: w - 12, h: h - 14, k: v === 0 ? 'shop' : 'fan' });
      }
      break;
    case 'chalet':
      if (v === 0) {
        door(x0 + 64, 1.0, 2.2, '#6a4224', false);
        window(c, st, x0 + 192, yb, 0.95, 0.85, 1.1, { shutters: true }, glass);
      } else shopFront('shop');
      break;
    case 'church':
      if (v === 0) door(x0 + 128, 1.6, 2.95, '#5a3a24', false, true);
      else window(c, st, x0 + 128, yb, 1.2, 0.7, 1.5, { arch: true }, glass, 'church');
      break;
    case 'stone':
      if (v === 0) {
        door(x0 + 64, 1.0, 2.2, '#6a4a2e', false);
        window(c, st, x0 + 192, yb, 1.0, 0.8, 1.0, { shutters: true }, glass);
      } else door(x0 + 128, 2.2, 2.7, '#5e4430', false, true);
      break;
    case 'brick':
      if (v === 0) {
        door(x0 + 64, 1.0, 2.35, ['#1d3b6a', '#7a1f1f', '#1f4a2f', '#1d1d1f'][s % 4]);
        window(c, st, x0 + 192, yb, 0.85, 0.95, 1.6, { sash: true }, glass);
      } else shopFront('pub');
      break;
  }
  void r;
}

function cornice(c: CanvasRenderingContext2D, r: Rng, st: Style, x0: number, yC: number, yU: number) {
  const W = 256;
  const h = yU - yC;
  switch (st.kind) {
    case 'chalet':
      c.fillStyle = '#4a2e18';
      c.fillRect(x0, yC, W, h);
      for (let x = x0 + 10; x < x0 + W; x += 40) { c.fillStyle = '#6a4424'; c.fillRect(x, yC + h * 0.3, 14, h * 0.6); }
      break;
    case 'brick':
      c.fillStyle = '#ebe5d8';
      c.fillRect(x0, yC + h * 0.3, W, h * 0.45);
      c.fillStyle = 'rgba(0,0,0,0.2)';
      for (let x = x0; x < x0 + W; x += 10) c.fillRect(x, yC + h * 0.3, 5, 5);
      break;
    case 'stone':
      c.fillStyle = shade(st.wall, 0.75);
      c.fillRect(x0, yC + h * 0.5, W, h * 0.5);
      break;
    default: {
      // profiliertes Gesims mit Zahnschnitt
      c.fillStyle = st.trim;
      c.fillRect(x0, yC + h * 0.25, W, h * 0.55);
      c.fillStyle = shade(st.trim, 0.82);
      c.fillRect(x0, yC + h * 0.62, W, 3);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = x0 + 2; x < x0 + W; x += 9) c.fillRect(x, yC + h * 0.28, 5, h * 0.22);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(x0, yC + h * 0.8, W, 2);
    }
  }
  // Schatten unter der Traufe
  const g = c.createLinearGradient(0, yC, 0, yC + h * 0.35);
  g.addColorStop(0, 'rgba(20,14,10,0.55)');
  g.addColorStop(1, 'rgba(20,14,10,0)');
  c.fillStyle = g;
  c.fillRect(x0, yC, W, h * 0.35);
  void r;
}

let atlas: { day: HTMLCanvasElement; night: HTMLCanvasElement } | null = null;

/** Fassadenatlas (Tag) und Nachtkarte mit erleuchteten Fenstern (halbe Auflösung) */
export function facadeAtlas(): { day: HTMLCanvasElement; night: HTMLCanvasElement } {
  if (atlas) return atlas;
  const day = document.createElement('canvas');
  day.width = FAC.W;
  day.height = FAC_H;
  const c = day.getContext('2d')!;
  const glass: Glass[] = [];
  drawAtlas(c, glass);
  const night = document.createElement('canvas');
  night.width = FAC.W / 2;
  night.height = FAC_H / 2;
  const n = night.getContext('2d')!;
  n.fillStyle = '#000';
  n.fillRect(0, 0, night.width, night.height);
  n.scale(0.5, 0.5);
  const r = mulberry32(99);
  for (const g of glass) {
    const p = g.k === 'shop' ? 0.85 : g.k === 'church' ? 0.7 : g.k === 'fan' ? 0.45 : 0.5;
    if (r() > p) continue;
    let col = g.k === 'shop' ? '#fff0c8' : g.k === 'church' ? '#ffb85a' : r() < 0.1 ? '#bcd2ff' : r() < 0.5 ? '#ffd28a' : '#ffbf6a';
    if (g.k === 'church') col = ['#ffb85a', '#ff8a5a', '#9ab8ff', '#ffd27a'][Math.floor(r() * 4)];
    const grad = n.createRadialGradient(g.x + g.w / 2, g.y + g.h * 0.55, 2, g.x + g.w / 2, g.y + g.h * 0.55, Math.max(g.w, g.h) * 0.75);
    grad.addColorStop(0, col);
    grad.addColorStop(1, shade(col.length === 7 ? col : '#ffbf6a', 0.55));
    n.fillStyle = grad;
    n.fillRect(g.x, g.y, g.w, g.h);
    if (g.k === 'win') {
      // Vorhänge und Sprossen dunkel lassen
      n.fillStyle = 'rgba(0,0,0,0.35)';
      n.fillRect(g.x + g.w / 2 - 1.5, g.y, 3, g.h);
    }
  }
  atlas = { day, night };
  return atlas;
}

// ---------------------------------------------------------------- Ladenschilder

export type Lang = 'it' | 'fr' | 'en' | 'es';
const LANGS: Lang[] = ['fr', 'it', 'en', 'es'];
/** je Sprache acht Schilder; Index 3 = Apotheke, 7 = Rathaus */
const SHOPS: Record<Lang, string[]> = {
  fr: ['BOULANGERIE', 'CAFÉ DU COMMERCE', 'TABAC · PRESSE', 'PHARMACIE', 'HÔTEL DE LA POSTE', 'BRASSERIE', 'BOUCHERIE', 'MAIRIE'],
  it: ['PANIFICIO', 'BAR SPORT', 'TABACCHI', 'FARMACIA', 'ALBERGO ALPINO', 'PIZZERIA', 'GELATERIA', 'MUNICIPIO'],
  en: ['BAKERY', 'THE RED LION', 'NEWSAGENT', 'PHARMACY', 'THE GEORGE HOTEL', 'FISH & CHIPS', 'BUTCHER', 'TOWN HALL'],
  es: ['PANADERÍA', 'BAR CENTRAL', 'ESTANCO', 'FARMACIA', 'HOTEL PLAZA', 'CAFETERÍA', 'CARNICERÍA', 'AYUNTAMIENTO'],
};
export const SHOP_SIGNS = 8;
export const SIGN_PHARMACY = 3;
export const SIGN_HALL = 7;
const SIGN_COLORS: [string, string][] = [['#24432c', '#f2d27a'], ['#5c1f1a', '#f4ecd8'], ['#1d1d1f', '#e8c46a'], ['#1d6b3a', '#ffffff'], ['#2c3e5c', '#f4ecd8'], ['#3b2a1e', '#f2d27a'], ['#7a1f1f', '#ffffff'], ['#e9e3d4', '#1d2a44']];

/** Atlas: 2 Spalten × 16 Zeilen Schilder (4 m × 0,5 m), darunter vier Steckschilder (Apothekenkreuz, Tabak …) */
export function signAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 576;
  const c = cv.getContext('2d')!;
  LANGS.forEach((lang, li) => {
    SHOPS[lang].forEach((text, k) => {
      const idx = li * 8 + k;
      const x = (idx % 2) * 256;
      const y = Math.floor(idx / 2) * 32;
      const [bg, fg] = SIGN_COLORS[k];
      c.fillStyle = bg;
      c.fillRect(x, y, 256, 32);
      c.strokeStyle = fg;
      c.globalAlpha = 0.6;
      c.lineWidth = 1.5;
      c.strokeRect(x + 3.5, y + 3.5, 249, 25);
      c.globalAlpha = 1;
      c.fillStyle = fg;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const serif = k === 1 || k === 4 || k === 7;
      let size = 19;
      c.font = `${serif ? '700' : '800'} ${size}px ${serif ? 'Georgia, "Times New Roman", serif' : 'Futura, "Trebuchet MS", Arial, sans-serif'}`;
      while (c.measureText(text).width > 232 && size > 10) { size -= 1; c.font = `${serif ? '700' : '800'} ${size}px ${serif ? 'Georgia, "Times New Roman", serif' : 'Futura, "Trebuchet MS", Arial, sans-serif'}`; }
      c.fillText(text, x + 128, y + 17);
    });
  });
  // Steckschilder (64 × 64): grünes Apothekenkreuz, Tabak-„Carotte“, Tabacchi-T, Pub-Schild
  const y = 512;
  const sq = (i: number, draw: (x: number) => void) => draw(i * 64);
  sq(0, (x) => {
    c.fillStyle = '#0e1a12';
    c.fillRect(x, y, 64, 64);
    c.fillStyle = '#2bd66a';
    c.fillRect(x + 22, y + 6, 20, 52);
    c.fillRect(x + 6, y + 22, 52, 20);
    c.fillStyle = '#b8ffd0';
    c.fillRect(x + 28, y + 12, 8, 40);
    c.fillRect(x + 12, y + 28, 40, 8);
  });
  sq(1, (x) => {
    c.fillStyle = '#1a1a1a';
    c.fillRect(x, y, 64, 64);
    c.fillStyle = '#d6202a';
    c.beginPath();
    c.moveTo(x + 32, y + 2);
    c.lineTo(x + 54, y + 32);
    c.lineTo(x + 32, y + 62);
    c.lineTo(x + 10, y + 32);
    c.fill();
    c.fillStyle = '#fff';
    c.font = '900 13px Arial, sans-serif';
    c.textAlign = 'center';
    c.fillText('TABAC', x + 32, y + 37);
  });
  sq(2, (x) => {
    c.fillStyle = '#163a8a';
    c.fillRect(x, y, 64, 64);
    c.fillStyle = '#fff';
    c.font = '900 48px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('T', x + 32, y + 50);
  });
  sq(3, (x) => {
    c.fillStyle = '#5c1f1a';
    c.fillRect(x, y, 64, 64);
    c.strokeStyle = '#e8c46a';
    c.lineWidth = 3;
    c.strokeRect(x + 5, y + 5, 54, 54);
    c.fillStyle = '#c0392b';
    c.beginPath();
    c.arc(x + 32, y + 32, 16, 0, Math.PI * 2);
    c.fill();
  });
  return cv;
}

/** UV-Rechteck [u0, v0, u1, v1] eines Ladenschilds (v unten → oben) */
export function signUV(lang: Lang, k: number): [number, number, number, number] {
  const idx = LANGS.indexOf(lang) * 8 + k;
  const x = (idx % 2) * 256;
  const y = Math.floor(idx / 2) * 32;
  return [(x + 1) / 512, 1 - (y + 31) / 576, (x + 255) / 512, 1 - (y + 1) / 576];
}

/** UV-Rechteck eines Steckschilds 0–3 */
export function badgeUV(i: number): [number, number, number, number] {
  return [(i * 64 + 1) / 512, 1 - 575 / 576, (i * 64 + 63) / 512, 1 - 513 / 576];
}

/** Dachdeckung: Ziegelreihen (hell, wird mit der Dachfarbe multipliziert); 1 Kachel = 2 × 2 m */
export function roofTex(): HTMLCanvasElement {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  const r = mulberry32(77);
  c.fillStyle = '#f2f2f2';
  c.fillRect(0, 0, S, S);
  const rows = 8;
  const rh = S / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    const off = row % 2 ? 16 : 0;
    for (let x = -off; x < S; x += 32) {
      const f = 0.86 + r() * 0.2;
      const v = Math.round(242 * f);
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(x + 1, y + 1, 30, rh - 2);
      // Rundung der Ziegel
      const g = c.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.18)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      c.fillStyle = g;
      c.fillRect(x + 1, y + 1, 30, rh - 2);
    }
    // Schattenkante der nächsten Reihe
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, y + rh - 3, S, 3);
  }
  // Flechten und Verschmutzung
  for (let i = 0; i < 260; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(60,60,40,0.10)' : 'rgba(255,255,230,0.08)';
    c.beginPath();
    c.arc(r() * S, r() * S, 1 + r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  // Ecke oben links hell (Flächen ohne UV greifen dorthin)
  c.fillStyle = '#f2f2f2';
  c.fillRect(0, 0, 3, 3);
  return cv;
}
