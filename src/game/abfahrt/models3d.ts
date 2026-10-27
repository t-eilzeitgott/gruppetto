/** Low-Poly-Modelle (Bäume, Felsen, Requisiten) und der 3D-Radfahrer */
import * as THREE from 'three';

export type RGBf = [number, number, number];

/**
 * Textur mit Durchsichtigkeit aus einer Zeichenfläche, aber über die Bilddaten statt direkt: Auf manchen Handys
 * entsteht beim direkten Hochladen in fast durchsichtigen Rändern buntes Rauschen (Verläufe sind gedithert, beim
 * Zurückrechnen der Farbe wird das riesig). Hier bekommen die Ränder eine ruhige Farbe: fest (rgb), das Mittel der
 * deckenden Teile oder ('bleed') die Farbe der nächsten deckenden Nachbarn.
 */
export function alphaTex(cv: HTMLCanvasElement, fill?: [number, number, number] | 'bleed'): THREE.DataTexture {
  const w = cv.width;
  const h = cv.height;
  const img = cv.getContext('2d')?.getImageData?.(0, 0, w, h);
  // ohne Bilddaten (Testumgebung): wie gewohnt direkt aus der Zeichenfläche
  if (!img?.data) return Object.assign(new THREE.CanvasTexture(cv), { colorSpace: THREE.SRGBColorSpace }) as unknown as THREE.DataTexture;
  const src = img.data;
  const d = new Uint8ClampedArray(src);
  if (fill === 'bleed') {
    // in mehreren Durchgängen die Farbe deckender Nachbarn nach außen tragen
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      const add: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (solid[i]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!solid[j]) continue;
            r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
          }
          if (n) { d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; add.push(i); }
        }
      }
      for (const i of add) solid[i] = 1;
    }
  } else {
    let fr = 0, fg = 0, fb = 0;
    if (fill) [fr, fg, fb] = fill;
    else {
      let n = 0;
      for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 200) { fr += d[i * 4]; fg += d[i * 4 + 1]; fb += d[i * 4 + 2]; n++; }
      if (n) { fr /= n; fg /= n; fb /= n; }
    }
    for (let i = 0; i < w * h; i++) {
      const a = d[i * 4 + 3];
      const k = Math.max(0, Math.min(1, (a - 40) / 120));
      d[i * 4] = fr + (d[i * 4] - fr) * k;
      d[i * 4 + 1] = fg + (d[i * 4 + 1] - fg) * k;
      d[i * 4 + 2] = fb + (d[i * 4 + 2] - fb) * k;
    }
  }
  // Zeilen umdrehen (Zeichenfläche oben = Textur v = 1)
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(d.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}



const tmpColor = new THREE.Color();
/** sRGB-Hex → lineare Farbe für Vertexfarben */
export function lin(hex: string | number): RGBf {
  tmpColor.set(hex as THREE.ColorRepresentation);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}
export function lin255(r: number, g: number, b: number): RGBf {
  tmpColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

/** Baukasten für nicht-indizierte Geometrie mit Vertexfarben und optional UVs */
export class GB {
  p: number[] = [];
  c: number[] = [];
  u: number[] = [];
  uv = false;
  get empty() { return this.p.length === 0; }
  vert(x: number, y: number, z: number, col: RGBf, s = 0, t = 0) {
    this.p.push(x, y, z);
    this.c.push(col[0], col[1], col[2]);
    this.u.push(s, t);
  }
  tri(a: number[], b: number[], c: number[], col: RGBf, ua?: number[], ub?: number[], uc?: number[]) {
    this.vert(a[0], a[1], a[2], col, ua?.[0], ua?.[1]);
    this.vert(b[0], b[1], b[2], col, ub?.[0], ub?.[1]);
    this.vert(c[0], c[1], c[2], col, uc?.[0], uc?.[1]);
  }
  /** Dreieck mit je eigener Eckfarbe */
  triC(a: number[], b: number[], c: number[], ca: RGBf, cb: RGBf, cc: RGBf) {
    this.vert(a[0], a[1], a[2], ca);
    this.vert(b[0], b[1], b[2], cb);
    this.vert(c[0], c[1], c[2], cc);
  }
  /** fertige Geometrie mit Farbe je Ecke (aus Lage und Normale, beides nach der Transformation) */
  addFn(g: THREE.BufferGeometry, m: THREE.Matrix4, fn: (p: THREE.Vector3, n: THREE.Vector3) => RGBf) {
    const src = g.index ? g.toNonIndexed() : g;
    src.computeVertexNormals();
    const pos = src.getAttribute('position');
    const nrm = src.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      this.vert(v.x, v.y, v.z, fn(v, n));
    }
  }
  /** Viereck mit Farbe je Ecke */
  quadC(a: number[], b: number[], c: number[], d: number[], ca: RGBf, cb: RGBf, cc: RGBf, cd: RGBf, uvs: number[][]) {
    this.vert(a[0], a[1], a[2], ca, uvs[0][0], uvs[0][1]);
    this.vert(b[0], b[1], b[2], cb, uvs[1][0], uvs[1][1]);
    this.vert(c[0], c[1], c[2], cc, uvs[2][0], uvs[2][1]);
    this.vert(a[0], a[1], a[2], ca, uvs[0][0], uvs[0][1]);
    this.vert(c[0], c[1], c[2], cc, uvs[2][0], uvs[2][1]);
    this.vert(d[0], d[1], d[2], cd, uvs[3][0], uvs[3][1]);
  }
  /** Viereck a-b-c-d (gegen den Uhrzeigersinn von vorn gesehen) */
  quad(a: number[], b: number[], c: number[], d: number[], col: RGBf, uvs?: number[][]) {
    this.tri(a, b, c, col, uvs?.[0], uvs?.[1], uvs?.[2]);
    this.tri(a, c, d, col, uvs?.[0], uvs?.[2], uvs?.[3]);
  }
  /** fertige Three-Geometrie mit Transformation und Farbe einfügen */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, col: RGBf) {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.vert(v.x, v.y, v.z, col);
    }
  }
  /**
   * Wie build(), aber mit weichen Normalen (gleiche Lage = gemittelte Normale). Alle Dreiecke werden so
   * gewendet, dass sie zur Seite von hint zeigen – gemittelt wird dann nur Gleichgerichtetes.
   */
  buildSmooth(hint: THREE.Vector3 | null): THREE.BufferGeometry {
    const p = this.p;
    const swap = (a: number[], i: number, j: number, n: number) => { for (let k = 0; k < n; k++) { const t = a[i * n + k]; a[i * n + k] = a[j * n + k]; a[j * n + k] = t; } };
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const fn = new THREE.Vector3();
    const acc = new Map<string, number[]>();
    const keys: string[] = [];
    const key = (i: number) => `${Math.round(p[i * 3] * 8)},${Math.round(p[i * 3 + 1] * 8)},${Math.round(p[i * 3 + 2] * 8)}`;
    for (let t = 0; t < p.length / 9; t++) {
      const a = t * 3;
      e1.set(p[(a + 1) * 3] - p[a * 3], p[(a + 1) * 3 + 1] - p[a * 3 + 1], p[(a + 1) * 3 + 2] - p[a * 3 + 2]);
      e2.set(p[(a + 2) * 3] - p[a * 3], p[(a + 2) * 3 + 1] - p[a * 3 + 1], p[(a + 2) * 3 + 2] - p[a * 3 + 2]);
      fn.crossVectors(e1, e2);
      if (hint && fn.dot(hint) < 0) { swap(p, a + 1, a + 2, 3); swap(this.c, a + 1, a + 2, 3); swap(this.u, a + 1, a + 2, 2); fn.negate(); }
      for (let k = 0; k < 3; k++) {
        const kk = key(a + k);
        keys.push(kk);
        const v = acc.get(kk);
        if (v) { v[0] += fn.x; v[1] += fn.y; v[2] += fn.z; } else acc.set(kk, [fn.x, fn.y, fn.z]);
      }
    }
    const g = this.build();
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    keys.forEach((kk, i) => { const v = acc.get(kk)!; const l = Math.hypot(v[0], v[1], v[2]) || 1; nrm.setXYZ(i, v[0] / l, v[1] / l, v[2] / l); });
    return g;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};

const TRUNK = lin('#5a3d27');



/**
 * Weiche Normalen für Bäume: zum Großteil vom Stamm nach außen (wie eine Kugel um die Krone), ein wenig von der
 * Fläche selbst. So wirken Kronen rund und belaubt statt facettiert, ohne ein Dreieck mehr.
 */
function softNormals(g: THREE.BufferGeometry, yc: number, k: number, keep = 0.3): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const sp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    sp.set(v.x, (v.y - yc) * k + 0.25, v.z).normalize();
    n.multiplyScalar(keep).addScaledVector(sp, 1 - keep).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return g;
}

const mixC = (a: RGBf, b: RGBf, t: number): RGBf => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulC = (a: RGBf, f: number): RGBf => [a[0] * f, a[1] * f, a[2] * f];

/**
 * Fichte/Tanne: Stamm und viele sternförmige Astetagen. Jede Etage hat Astspitzen mit unterschiedlicher Länge,
 * die nach außen hängen, dazwischen Kerben; innen am Stamm dunkel, an den Spitzen hell (frische Triebe),
 * die Unterseite im Schatten. Mit snow liegt Schnee auf den Oberseiten.
 */
function spruce(o: { h: number; w: number; tiers: number; spikes: number; dark: string; light: string; seed: number; snow?: boolean; droop?: number; sparse?: number; low?: boolean }): THREE.BufferGeometry {
  const b = new GB();
  let rs = o.seed * 9301 + 49297;
  const rnd = () => { rs = (rs * 9301 + 49297) % 233280; return rs / 233280; };
  const trunk = lin('#4e3524');
  b.addFn(new THREE.CylinderGeometry(0.1, 0.2, o.h * 0.55, o.low ? 4 : 7), M(0, o.h * 0.275), (p) => mulC(trunk, 0.75 + 0.35 * Math.min(1, p.y / 3)));
  const dark = lin(o.dark);
  const light = lin(o.light);
  const snowC = lin('#eef3f8');
  const base = 1.05;
  const droop = o.droop ?? 0.24;
  for (let t = 0; t < o.tiers; t++) {
    const k = t / (o.tiers - 1);
    const th = ((o.h - base) / o.tiers) * 2.1;
    const y = base + k * (o.h - base - th * 0.75);
    const r = o.w * Math.pow(1 - k, 0.85) * (0.88 + rnd() * 0.24) + 0.18;
    const n = Math.max(5, Math.round(o.spikes * (1 - k * 0.35)));
    const apex = [0, y + th, 0];
    const under = [0, y + th * 0.18, 0];
    const rot = rnd() * Math.PI * 2;
    const rim: number[][] = [];
    const notch: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + ((i + (rnd() - 0.5) * 0.35) / n) * Math.PI * 2;
      const ri = r * (0.78 + rnd() * 0.4) * (o.sparse && rnd() < o.sparse ? 0.55 : 1);
      rim.push([Math.cos(a) * ri, y - droop * ri * (0.7 + rnd() * 0.5), Math.sin(a) * ri]);
      const an = a + Math.PI / n;
      notch.push([Math.cos(an) * ri * 0.74, y - droop * ri * 0.45 + th * 0.1, Math.sin(an) * ri * 0.74]);
    }
    const shade = 0.82 + 0.3 * k;
    const cIn = mulC(dark, 0.7);
    for (let i = 0; i < n; i++) {
      const R = rim[i];
      const Nb = notch[i];
      const Na = notch[(i + n - 1) % n];
      const tip = mulC(mixC(dark, light, 0.55 + rnd() * 0.45), shade);
      const mid = mulC(mixC(dark, light, 0.25), shade);
      const top = o.snow && t < o.tiers - 1 ? mixC(tip, snowC, 0.85) : tip;
      const midT = o.snow && t < o.tiers - 1 ? mixC(mid, snowC, 0.6) : mid;
      // Oberseite: von der Spitze der Etage zu Kerbe – Astspitze – nächste Kerbe
      b.triC(apex, Na, R, cIn, midT, top);
      b.triC(apex, R, Nb, cIn, top, midT);
      // Unterseite im Schatten
      if (o.low) continue;
      b.triC(under, R, Na, mulC(dark, 0.45), mulC(tip, 0.55), mulC(dark, 0.5));
      b.triC(under, Nb, R, mulC(dark, 0.45), mulC(dark, 0.5), mulC(tip, 0.55));
    }
  }
  // Wipfel
  if (!o.low) b.addFn(new THREE.ConeGeometry(0.16, 1.1, 5), M(0, o.h + 0.25), () => mixC(dark, light, 0.6));
  return softNormals(b.build(), o.h * 0.42, 0.45);
}

/** Laubbaum: viele unregelmäßige Blätterballen, oben im Licht hell, unten und innen dunkel, dazu Äste */
function leafTree(crowns: [number, number, number, number][], trunkH: number, dark: string, light: string, branches = 3, detail = 1): THREE.BufferGeometry {
  const b = new GB();
  const trunk = lin('#5a4030');
  b.addFn(new THREE.CylinderGeometry(0.12, 0.27, trunkH + 0.6, detail ? 7 : 4), M(0, (trunkH + 0.6) / 2), (p) => mulC(trunk, 0.8 + 0.25 * Math.min(1, p.y / trunkH)));
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + 0.4;
    b.add(new THREE.CylinderGeometry(0.05, 0.1, 1.9, 5), M(Math.cos(a) * 0.55, trunkH + 0.55, Math.sin(a) * 0.55, 1, 1, 1, 0, Math.sin(a) * 0.75, -Math.cos(a) * 0.75), trunk);
  }
  const D = lin(dark);
  const Lc = lin(light);
  const top = Math.max(...crowns.map(([, y, , r]) => y + r));
  const bot = Math.min(...crowns.map(([, y, , r]) => y - r));
  crowns.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const pos = g.getAttribute('position');
    const v = new THREE.Vector3();
    for (let q = 0; q < pos.count; q++) {
      v.fromBufferAttribute(pos, q);
      const k = 0.84 + 0.24 * Math.abs(Math.sin(v.x * 3.1 + v.y * 2.3 + i) * Math.cos(v.z * 2.7 - i));
      pos.setXYZ(q, v.x * k, v.y * k * 0.86, v.z * k);
    }
    b.addFn(g, M(x, y, z, 1, 1, 1, i * 1.3), (p, n) => {
      const hgt = (p.y - bot) / Math.max(0.1, top - bot);
      const lit = 0.5 + 0.5 * n.y;
      return mulC(mixC(D, Lc, Math.min(1, hgt * 0.55 + lit * 0.5)), 0.78 + 0.3 * hgt);
    });
  });
  return softNormals(b.build(), (top + bot) / 2, 0.8, 0.25);
}


/** einfache Fassungen der Bäume für weiter entfernte Landschaftskacheln (gleiche Umrisse, weniger Dreiecke) */
export function treeGeometriesLow(): Partial<Record<Prop3D, THREE.BufferGeometry>> {
  const cypress = new GB();
  cypress.add(new THREE.IcosahedronGeometry(1, 0), M(0, 4.6, 0, 0.72, 4.3, 0.72), lin('#2b4d27'));
  return {
    pine: spruce({ h: 12, w: 2.8, tiers: 7, spikes: 8, dark: '#16391f', light: '#4f8448', seed: 3, low: true }),
    pineSnow: spruce({ h: 11.5, w: 2.7, tiers: 7, spikes: 8, dark: '#173a28', light: '#4a7a52', seed: 5, snow: true, low: true }),
    larch: spruce({ h: 11, w: 2.3, tiers: 7, spikes: 8, dark: '#4d7428', light: '#a8c65c', seed: 7, droop: 0.34, low: true }),
    tree: leafTree([[0, 5.4, 0, 2.3], [1.4, 4.7, 0.5, 1.7], [-1.3, 4.8, -0.4, 1.8], [0.3, 6.4, -0.2, 1.5]], 3.6, '#2f5e22', '#7fb64e', 0, 0),
    treeRound: leafTree([[0, 3.8, 0, 1.7], [0.6, 4.3, 0.3, 1.1]], 2.6, '#3a6e28', '#8cc256', 0, 0),
    cypress: softNormals(cypress.build(), 4.6, 0.25),
  };
}

/** ganz einfache Fassungen für Bäume jenseits von gut 130 m: dort sind sie nur noch wenige Pixel hoch */
export function treeGeometriesFar(): Partial<Record<Prop3D, THREE.BufferGeometry>> {
  return {
    pine: spruce({ h: 12, w: 2.8, tiers: 4, spikes: 6, dark: '#16391f', light: '#4f8448', seed: 3, low: true }),
    pineSnow: spruce({ h: 11.5, w: 2.7, tiers: 4, spikes: 6, dark: '#173a28', light: '#4a7a52', seed: 5, snow: true, low: true }),
    larch: spruce({ h: 11, w: 2.3, tiers: 4, spikes: 6, dark: '#4d7428', light: '#a8c65c', seed: 7, droop: 0.34, low: true }),
    tree: leafTree([[0, 5.3, 0, 2.6], [0.9, 4.6, 0.4, 1.9]], 3.6, '#2f5e22', '#7fb64e', 0, 0),
    treeRound: leafTree([[0, 3.9, 0, 1.9]], 2.6, '#3a6e28', '#8cc256', 0, 0),
  };
}

export type Prop3D = 'pine' | 'pineSnow' | 'larch' | 'tree' | 'treeRound' | 'cypress' | 'olive' | 'bush' | 'rock' | 'boulder'
  | 'snowpole' | 'hay' | 'vinerow' | 'fence' | 'lamp' | 'logs' | 'palm';

export function propGeometries(): Record<Prop3D, THREE.BufferGeometry> {
  const snowpole = new GB();
  for (let i = 0; i < 6; i++) snowpole.add(new THREE.CylinderGeometry(0.04, 0.04, 0.34, 6), M(0, 0.17 + i * 0.34), lin(i % 2 ? '#ffffff' : '#e03131'));
  const hay = new GB();
  hay.add(new THREE.CylinderGeometry(0.65, 0.65, 1.2, 12), M(0, 0.65, 0, 1, 1, 1, 0, 0, Math.PI / 2), lin('#d9b45a'));
  const vine = new GB();
  vine.add(new THREE.BoxGeometry(0.45, 1.2, 1.9), M(0, 0.8), lin('#5f8a2c'));
  vine.add(new THREE.BoxGeometry(0.5, 0.25, 1.95), M(0, 1.45), lin('#78a33a'));
  vine.add(new THREE.BoxGeometry(0.06, 1.7, 0.06), M(0, 0.85, 0.95), lin('#6b5240'));
  const fence = new GB();
  fence.add(new THREE.BoxGeometry(0.12, 1.15, 0.12), M(0, 0.575), lin('#7a5634'));
  const lamp = new GB();
  lamp.add(new THREE.CylinderGeometry(0.06, 0.09, 4.8, 6), M(0, 2.4), lin('#2d3238'));
  lamp.add(new THREE.BoxGeometry(0.08, 0.08, 0.7), M(0, 4.75, -0.32), lin('#2d3238'));
  lamp.add(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 6), M(0, 4.6, -0.62), lin('#2d3238'));
  lamp.add(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 6), M(0, 4.44, -0.62), lin('#fff2c4'));
  const logs = new GB();
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
    logs.add(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8), M((i - (3 - row) / 2) * 0.46, 0.22 + row * 0.4, 0, 1, 1, 1, Math.PI / 2, Math.PI / 2), lin(i % 2 ? '#a5784c' : '#b98c5a'));
  }
  const palm = new GB();
  for (let i = 0; i < 8; i++) palm.add(new THREE.CylinderGeometry(0.15, 0.18, 0.9, 6), M(i * 0.06, 0.45 + i * 0.85, 0, 1, 1, 1, 0, 0, -0.05), lin(i % 2 ? '#7a5a3a' : '#8a6a46'));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    palm.add(new THREE.BoxGeometry(2.6, 0.06, 0.55), M(0.5 + Math.cos(a) * 1.3, 7.1, Math.sin(a) * 1.3, 1, 1, 1, -a, 0, -0.35), lin(i % 2 ? '#3f7a32' : '#4f8f3c'));
  }
  const rock = new GB();
  rock.add(new THREE.DodecahedronGeometry(0.65, 0), M(0, 0.32, 0, 1, 0.7, 0.85), lin('#8e8a82'));
  const boulder = new GB();
  boulder.add(new THREE.DodecahedronGeometry(1.5, 0), M(0, 0.9, 0, 1, 0.75, 0.9, 0.4), lin('#8a867c'));
  boulder.add(new THREE.DodecahedronGeometry(0.9, 0), M(0.6, 1.7, 0.2, 1, 0.45, 0.8, 1.2), lin('#6f8a52'));
  const olive = new GB();
  olive.add(new THREE.CylinderGeometry(0.16, 0.3, 2.2, 6), M(0, 1.1, 0, 1, 1, 1, 0, 0.15, 0.1), lin('#6b5a48'));
  olive.add(new THREE.IcosahedronGeometry(1.3, 0), M(-0.4, 2.8, 0, 1, 0.65, 1), lin('#8f9c72'));
  olive.add(new THREE.IcosahedronGeometry(1.1, 0), M(0.6, 3.1, 0.3, 1, 0.65, 1), lin('#7c8b60'));
  const cypress = new GB();
  cypress.add(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 5), M(0, 0.4), TRUNK);
  cypress.add(new THREE.IcosahedronGeometry(1, 1), M(0, 4.6, 0, 0.72, 4.3, 0.72), lin('#2b4d27'));
  const bush = new GB();
  bush.add(new THREE.IcosahedronGeometry(0.75, 0), M(0, 0.45, 0, 1.2, 0.75, 1), lin('#456f2e'));
  bush.add(new THREE.IcosahedronGeometry(0.55, 0), M(0.5, 0.55, 0.2, 1, 0.8, 1), lin('#5b8a3c'));
  return {
    pine: spruce({ h: 12, w: 2.8, tiers: 9, spikes: 10, dark: '#16391f', light: '#4f8448', seed: 3 }),
    pineSnow: spruce({ h: 11.5, w: 2.7, tiers: 9, spikes: 10, dark: '#173a28', light: '#4a7a52', seed: 5, snow: true }),
    larch: spruce({ h: 11, w: 2.3, tiers: 8, spikes: 9, dark: '#4d7428', light: '#a8c65c', seed: 7, droop: 0.34, sparse: 0.25 }),
    tree: leafTree([[0, 5.4, 0, 2.1], [1.4, 4.7, 0.5, 1.6], [-1.3, 4.8, -0.4, 1.7], [0.3, 6.5, -0.2, 1.5], [-0.5, 5.9, 1.2, 1.3], [0.8, 5.6, -1.2, 1.35], [-0.9, 4.2, 0.9, 1.1]], 3.6, '#2f5e22', '#7fb64e'),
    treeRound: leafTree([[0, 3.8, 0, 1.55], [0.7, 4.4, 0.3, 1.05], [-0.6, 4.3, -0.4, 1.0], [0.1, 3.3, 0.8, 0.95]], 2.6, '#3a6e28', '#8cc256', 2),
    cypress: softNormals(cypress.build(), 4.6, 0.25),
    olive: softNormals(olive.build(), 2.8, 0.8),
    bush: bush.build(),
    rock: rock.build(),
    boulder: boulder.build(),
    snowpole: snowpole.build(),
    hay: hay.build(),
    vinerow: vine.build(),
    fence: fence.build(),
    lamp: lamp.build(),
    logs: logs.build(),
    palm: palm.build(),
  };
}
