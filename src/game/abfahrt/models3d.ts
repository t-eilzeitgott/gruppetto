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
  | 'snowpole' | 'hay' | 'vinerow' | 'fence' | 'lamp' | 'logs' | 'palm';

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
