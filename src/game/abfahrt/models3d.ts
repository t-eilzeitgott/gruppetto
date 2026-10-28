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
/**
 * Gezeichneten Vorrat (Render-Ziel mit Kantenglättung) in eine einfache Textur umkopieren und das Ziel freigeben:
 * die mehrfach abgetasteten Puffer eines Render-Ziels belegen sonst dauerhaft ein Vielfaches an Grafikspeicher.
 */
export function freezeTarget(gl: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget): THREE.DataTexture {
  const px = new Uint8Array(rt.width * rt.height * 4);
  gl.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
  const t = bakedTexture(px, rt.width, rt.height);
  rt.dispose();
  return t;
}

/**
 * Fertig gezeichneter Vorrat als Textur (mit Mipmaps). Die Bilddaten im Arbeitsspeicher werden nach dem
 * Hochladen freigegeben – geht der Grafikkontext verloren, entsteht ohnehin alles neu.
 */
export function bakedTexture(px: Uint8Array, w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  t.onUpdate = () => {
    (t.image as { data: Uint8Array | null }).data = null;
    t.onUpdate = null;
  };
  return t;
}

/** schon umgerechnete Farben: das Zerlegen der Farbangabe (#rrggbb) kostet je Aufruf, Abschnitte rufen es tausendfach */
const linCache = new Map<string | number, RGBf>();
export function lin(hex: string | number): RGBf {
  let c = linCache.get(hex);
  if (!c) {
    tmpColor.set(hex as THREE.ColorRepresentation);
    c = [tmpColor.r, tmpColor.g, tmpColor.b];
    if (linCache.size > 4096) linCache.clear();
    linCache.set(hex, c);
  }
  // eigene Kopie (Aufrufer dürfen sie verändern)
  return [c[0], c[1], c[2]];
}
export function lin255(r: number, g: number, b: number): RGBf {
  tmpColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

/**
 * Wachsende Zahlenreihe auf einem Float32Array (verdoppelt sich bei Bedarf). Beim Bauen entsteht so kein
 * Berg aus Zahlenlisten, und die Speicherbereinigung muss halbfertige Geometrie nicht umkopieren – das
 * spart spürbare Pausen beim Fahren.
 */
export class FArr {
  a: Float32Array;
  length = 0;
  constructor(cap = 192) { this.a = new Float32Array(cap); }
  private grow(k: number) {
    const b = new Float32Array(Math.max(this.a.length * 2, this.length + k));
    b.set(this.a.subarray(0, this.length));
    this.a = b;
  }
  push1(x: number) {
    if (this.length + 1 > this.a.length) this.grow(1);
    this.a[this.length++] = x;
  }
  push2(x: number, y: number) {
    if (this.length + 2 > this.a.length) this.grow(2);
    const a = this.a;
    const n = this.length;
    a[n] = x; a[n + 1] = y;
    this.length = n + 2;
  }
  push3(x: number, y: number, z: number) {
    if (this.length + 3 > this.a.length) this.grow(3);
    const a = this.a;
    const n = this.length;
    a[n] = x; a[n + 1] = y; a[n + 2] = z;
    this.length = n + 3;
  }
  push4(x: number, y: number, z: number, w: number) {
    if (this.length + 4 > this.a.length) this.grow(4);
    const a = this.a;
    const n = this.length;
    a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = w;
    this.length = n + 4;
  }
  /** fertige Werte als eigenes Array passender Größe */
  take(): Float32Array { return this.a.slice(0, this.length); }
}

/** Baukasten für nicht-indizierte Geometrie mit Vertexfarben und optional UVs */
export class GB {
  p = new FArr();
  c = new FArr();
  u = new FArr(128);
  uv = false;
  get empty() { return this.p.length === 0; }
  vert(x: number, y: number, z: number, col: RGBf, s = 0, t = 0) {
    this.p.push3(x, y, z);
    this.c.push3(col[0], col[1], col[2]);
    if (this.uv) this.u.push2(s, t);
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
    const p = this.p.a;
    const c = this.c.a;
    const u = this.u.a;
    const n = this.p.length / 3;
    const swap = (a: Float32Array, i: number, j: number, k: number) => { for (let q = 0; q < k; q++) { const t = a[i * k + q]; a[i * k + q] = a[j * k + q]; a[j * k + q] = t; } };
    // Flächennormalen (Dreiecke zur Seite von hint wenden)
    const fn = new Float32Array(n);
    for (let a = 0; a < n; a += 3) {
      const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
      const e1x = p[a * 3 + 3] - ax, e1y = p[a * 3 + 4] - ay, e1z = p[a * 3 + 5] - az;
      const e2x = p[a * 3 + 6] - ax, e2y = p[a * 3 + 7] - ay, e2z = p[a * 3 + 8] - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (hint && nx * hint.x + ny * hint.y + nz * hint.z < 0) {
        swap(p, a + 1, a + 2, 3); swap(c, a + 1, a + 2, 3);
        if (this.uv) swap(u, a + 1, a + 2, 2);
        nx = -nx; ny = -ny; nz = -nz;
      }
      fn[a] = nx; fn[a + 1] = ny; fn[a + 2] = nz;
    }
    // gleiche Lage (auf 1/8 m) = ein Eckpunkt: je Ecke ihr Vertreter (Streuwerte mit Kette, ohne Zeichenketten)
    const rep = new Int32Array(n);
    const chain = new Int32Array(n);
    const head = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const x = Math.round(p[i * 3] * 8), y = Math.round(p[i * 3 + 1] * 8), z = Math.round(p[i * 3 + 2] * 8);
      const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
      const h0 = head.get(h);
      let j = h0 ?? -1;
      while (j >= 0 && (Math.round(p[j * 3] * 8) !== x || Math.round(p[j * 3 + 1] * 8) !== y || Math.round(p[j * 3 + 2] * 8) !== z)) j = chain[j];
      if (j < 0) { j = i; chain[i] = h0 ?? -1; head.set(h, i); }
      rep[i] = j;
    }
    const acc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = i - (i % 3);
      const r = rep[i] * 3;
      acc[r] += fn[t]; acc[r + 1] += fn[t + 1]; acc[r + 2] += fn[t + 2];
    }
    const g = this.build(false);
    const nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = rep[i] * 3;
      const x = acc[r], y = acc[r + 1], z = acc[r + 2];
      const l = Math.hypot(x, y, z) || 1;
      nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    return g;
  }
  build(normals = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const p = this.p.take();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.take(), 3));
    if (this.uv) g.setAttribute('uv', new THREE.BufferAttribute(this.u.take(), 2));
    if (normals) g.setAttribute('normal', new THREE.BufferAttribute(flatNormals(p), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Flache Normalen je Dreieck für Geometrie ohne Index – wie computeVertexNormals(), aber direkt auf dem Zahlenfeld
 * (ohne Vektor-Objekte je Ecke): bei großen Teilen eines Abschnitts (Fassaden, Banden) ein Vielfaches schneller.
 */
export function flatNormals(p: Float32Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i + 8 < p.length; i += 9) {
    // (C − B) × (A − B), wie three.js
    const ux = p[i + 6] - p[i + 3], uy = p[i + 7] - p[i + 4], uz = p[i + 8] - p[i + 5];
    const vx = p[i] - p[i + 3], vy = p[i + 1] - p[i + 4], vz = p[i + 2] - p[i + 5];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const x = nx / l, y = ny / l, z = nz / l;
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    out[i + 3] = x; out[i + 4] = y; out[i + 5] = z;
    out[i + 6] = x; out[i + 7] = y; out[i + 8] = z;
  }
  return out;
}

export const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};




/**
 * Weiche Normalen für Bäume: zum Großteil vom Stamm nach außen (wie eine Kugel um die Krone), ein wenig von der
 * Fläche selbst. So wirken Kronen rund und belaubt statt facettiert, ohne ein Dreieck mehr.
 */
export function softNormals(g: THREE.BufferGeometry, yc: number, k: number, keep = 0.3): THREE.BufferGeometry {
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

export const mixC = (a: RGBf, b: RGBf, t: number): RGBf => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulC = (a: RGBf, f: number): RGBf => [a[0] * f, a[1] * f, a[2] * f];

export type Prop3D = 'pine' | 'pineSnow' | 'larch' | 'tree' | 'treeRound' | 'cypress' | 'olive' | 'bush' | 'rock' | 'boulder'
  | 'snowpole' | 'hay' | 'vinerow' | 'fence' | 'lamp' | 'logs' | 'palm' | 'poplar' | 'apple';

/** Requisiten (Bäume kommen aus forest3d: Bildvorrat und nahe 3D-Modelle) */
export function propGeometries(): Partial<Record<Prop3D, THREE.BufferGeometry>> {
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
  const rock = new GB();
  rock.add(new THREE.DodecahedronGeometry(0.65, 0), M(0, 0.32, 0, 1, 0.7, 0.85), lin('#8e8a82'));
  const boulder = new GB();
  boulder.add(new THREE.DodecahedronGeometry(1.5, 0), M(0, 0.9, 0, 1, 0.75, 0.9, 0.4), lin('#8a867c'));
  boulder.add(new THREE.DodecahedronGeometry(0.9, 0), M(0.6, 1.7, 0.2, 1, 0.45, 0.8, 1.2), lin('#6f8a52'));
  const bush = new GB();
  bush.add(new THREE.IcosahedronGeometry(0.75, 0), M(0, 0.45, 0, 1.2, 0.75, 1), lin('#456f2e'));
  bush.add(new THREE.IcosahedronGeometry(0.55, 0), M(0.5, 0.55, 0.2, 1, 0.8, 1), lin('#5b8a3c'));
  return {
    bush: bush.build(),
    rock: rock.build(),
    boulder: boulder.build(),
    snowpole: snowpole.build(),
    hay: hay.build(),
    vinerow: vine.build(),
    fence: fence.build(),
    lamp: lamp.build(),
    logs: logs.build(),
  };
}
