/**
 * Bäume für den WebGPU-Test, neu: Zweige als Karten mit gebackenen Nadel- und Blatttexturen (Fichte, Lärche,
 * Laubbaum, Rinde) statt Zacken aus Dreiecken. Jeder Ast sind zwei gekreuzte, leicht hängende Karten – von jeder
 * Seite sieht man Nadeln, die Silhouette ist weich und fransig.
 *
 * Drei Stufen, die sich ähneln: nah viele Äste, mittel wenige große, fern ein Bild des nahen Baums (Impostor,
 * beim Start aus allen drei Arten gebacken: Farbe und Normale, damit das Licht gleich bleibt). Zwischen den
 * Stufen wird weich überblendet (Kantenglättung als Deckung, „alpha to coverage“) – nichts springt.
 */
import * as THREE from 'three/webgpu';
import { h21, tsl, voronoi, fbm, type N } from './nodes';

const { Fn, atan, clamp, cos, dot, float, floor, fract, fwidth, length, max, min, mix, normalize, select, sin, smoothstep, sqrt, texture, uv, vec2, vec3, vec4, vertexColor, attribute } = tsl;

export type Arch = 'pine' | 'larch' | 'broad';
export const ARCHS: Arch[] = ['pine', 'larch', 'broad'];

/** Zellen im Atlas (2 × 2): Fichtenzweig, Lärchenzweig, Blattbüschel, Rinde */
const CELL = { pine: [0, 0], larch: [1, 0], broad: [0, 1], bark: [1, 1] } as const;

const lin = (r: number, g: number, b: number): N => vec3(r, g, b);

/** Abstand Punkt–Strecke und Lage darauf (0 … 1) */
function seg(p: N, a: [number, number] | N, b: [number, number] | N) {
  const A = Array.isArray(a) ? vec2(a[0], a[1]) : a;
  const B = Array.isArray(b) ? vec2(b[0], b[1]) : b;
  const pa = p.sub(A);
  const ba = B.sub(A);
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
  return { d: length(pa.sub(ba.mul(h))), h };
}

/** Fichtenzweig (v längs vom Stamm zur Spitze, u quer): Seitentriebe, dicht benadelt, Spitzen heller */
function spruce(p: N) {
  const v = p.y;
  const cx = (vv: number) => 0.5 + 0.015 * Math.sin(vv * 6);
  const E = (vv: number) => 0.47 * Math.pow(Math.max(0, 1 - vv), 0.7) * Math.min(1, vv / 0.08) + 0.035;
  let cover: N = float(0);
  let near: N = float(1);
  let wood: N = float(0);
  // Hauptachse
  for (let k = 0; k < 4; k++) {
    const a = k / 4, b = (k + 1) / 4;
    const s = seg(p, [cx(a), a * 0.98], [cx(b), b * 0.98]);
    const L = 0.078 * (1 - 0.35 * b);
    cover = max(cover, smoothstep(L, L * 0.55, s.d));
    near = min(near, s.d.div(L));
    wood = max(wood, smoothstep(0.009, 0.004, s.d));
  }
  // Seitentriebe, nach vorn gerichtet
  for (let k = 0; k < 12; k++) {
    const vk = 0.05 + k * 0.074;
    if (vk > 0.93) break;
    for (const sd of [-1, 1]) {
      const reach = E(vk + 0.08) * (0.86 + 0.1 * Math.sin(k * 3.1 + sd));
      const s = seg(p, [cx(vk), vk], [cx(vk) + sd * reach, vk + 0.085 + 0.03 * ((k + (sd > 0 ? 1 : 0)) % 2)]);
      const L = s.h.mul(-0.4).add(1).mul(0.064 * (1 - vk * 0.3));
      const ser = sin(s.h.mul(95).add(k * 1.7)).mul(0.13).add(0.87);
      cover = max(cover, smoothstep(L.mul(ser), L.mul(ser).mul(0.5), s.d));
      near = min(near, s.d.div(L));
      wood = max(wood, smoothstep(0.006, 0.0025, s.d).mul(s.h.mul(-1).add(1)));
    }
  }
  // luftig: ein paar Lücken
  const holes = smoothstep(0.7, 0.8, fbm(p.mul(14), 14, 2));
  cover = cover.mul(holes.mul(-0.7).add(1));
  const shade = clamp(near, 0, 1);
  let col: N = mix(lin(0.02, 0.048, 0.022), lin(0.065, 0.13, 0.045), shade.mul(0.8).add(fbm(p.mul(40), 40, 2).mul(0.3)).clamp(0, 1));
  // frische Triebe an den Spitzen
  col = mix(col, lin(0.08, 0.15, 0.05), smoothstep(0.82, 1.0, v).mul(shade).mul(0.6));
  col = mix(col, lin(0.06, 0.04, 0.025), wood.mul(0.7));
  return { col, a: cover };
}

/** Lärchenzweig: weiche Nadelbüschel an kurzen Trieben, hellgrün */
function larch(p: N) {
  const cx = (vv: number) => 0.5 + 0.02 * Math.sin(vv * 5);
  let cover: N = float(0);
  let wood: N = float(0);
  for (let k = 0; k < 4; k++) {
    const a = k / 4, b = (k + 1) / 4;
    const s = seg(p, [cx(a), a * 0.97], [cx(b), b * 0.97]);
    wood = max(wood, smoothstep(0.008, 0.003, s.d));
  }
  for (let k = 0; k < 9; k++) {
    const vk = 0.07 + k * 0.1;
    if (vk > 0.92) break;
    for (const sd of [-1, 1]) {
      const reach = (0.44 - vk * 0.3) * (0.85 + 0.15 * Math.sin(k * 2.3 + sd));
      const ax = cx(vk), ay = vk, bx = ax + sd * reach, by = vk + 0.07;
      const s = seg(p, [ax, ay], [bx, by]);
      wood = max(wood, smoothstep(0.005, 0.002, s.d));
      // Büschel entlang des Triebs
      cover = max(cover, smoothstep(0.05, 0.022, s.d).mul(0.85));
      for (let q = 0; q < 5; q++) {
        const f = 0.12 + q * 0.21;
        const c = vec2(ax + (bx - ax) * f, ay + (by - ay) * f);
        const dvec = p.sub(c);
        const r = 0.058 * (1 - f * 0.3);
        const ang = atan(dvec.y, dvec.x);
        const rays = sin(ang.mul(13).add(k * 2 + q)).mul(0.3).add(0.7);
        cover = max(cover, smoothstep(r, r * 0.45, length(dvec).div(rays)));
      }
    }
  }
  cover = max(cover, wood);
  const tone = fbm(p.mul(30), 30, 2);
  let col: N = mix(lin(0.05, 0.095, 0.028), lin(0.12, 0.18, 0.055), tone);
  col = mix(col, lin(0.07, 0.05, 0.03), wood.mul(0.8));
  return { col, a: cover };
}

/** Blattbüschel (Laubbaum): viele Blätter in einer runden, fransigen Wolke */
function leaves(p: N) {
  const c = voronoi(p.mul(11), 11);
  const r = c.r;
  const ang = h21(vec2(c.id, 3.3)).mul(Math.PI);
  const ca = cos(ang), sa = sin(ang);
  const q = vec2(r.x.mul(ca).add(r.y.mul(sa)), r.y.mul(ca).sub(r.x.mul(sa)));
  const leaf = smoothstep(0.42, 0.34, length(q.mul(vec2(1, 1.9))));
  const env = smoothstep(0.5, 0.36, length(p.sub(0.5)).add(fbm(p.mul(6), 6, 3).sub(0.5).mul(0.14)));
  const tone = h21(vec2(c.id, 9.1));
  const col = mix(lin(0.025, 0.06, 0.018), lin(0.08, 0.14, 0.035), tone.mul(0.7).add(q.y.mul(0.6).add(0.3).clamp(0, 1).mul(0.3)));
  return { col, a: leaf.mul(env) };
}

/** Rinde: Längsfurchen, grau-braun */
function bark(p: N) {
  const f = fbm(vec2(p.x.mul(6), p.y.mul(2)), 6, 3);
  const furrow = sin(p.x.mul(Math.PI * 2 * 9).add(f.mul(7))).mul(0.5).add(0.5);
  const col = mix(lin(0.022, 0.017, 0.013), lin(0.07, 0.058, 0.047), furrow.mul(0.6).add(f.mul(0.4)));
  return { col, a: float(1) };
}

/** Atlas backen (1024², RGBA: Farbe als Wurzel, Deckung) */
export function bakeFoliage(renderer: THREE.WebGPURenderer, size = 1024): THREE.Texture {
  const half = size / 2;
  const quad = new THREE.QuadMesh(new THREE.NodeMaterial());
  const prev = renderer.getRenderTarget();
  const cells: THREE.RenderTarget[] = [];
  for (const make of [spruce, larch, leaves, bark]) {
    const rt = new THREE.RenderTarget(half, half, { type: THREE.UnsignedByteType, depthBuffer: false });
    const m = new THREE.NodeMaterial();
    m.fragmentNode = Fn(() => {
      const r = make(uv());
      // durchsichtige Stellen tragen die mittlere Farbe (keine dunklen Ränder in den kleinen Stufen)
      return vec4(sqrt(clamp(r.col, 0, 1)), clamp(r.a, 0, 1));
    })();
    quad.material = m;
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    m.dispose();
    cells.push(rt);
  }
  const atlas = new THREE.RenderTarget(size, size, {
    type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const m = new THREE.NodeMaterial();
  m.fragmentNode = Fn(() => {
    const p = uv().mul(2);
    const cx = floor(p.x), cy = floor(p.y);
    const q = fract(p);
    const s = (k: number) => texture(cells[k].texture, q);
    return select(cy.lessThan(0.5), select(cx.lessThan(0.5), s(0), s(1)), select(cx.lessThan(0.5), s(2), s(3)));
  })();
  quad.material = m;
  renderer.setRenderTarget(atlas);
  quad.render(renderer);
  m.dispose();
  for (const c of cells) c.dispose();
  renderer.setRenderTarget(prev);
  atlas.texture.anisotropy = 4;
  return atlas.texture;
}

// ——— Geometrie ———

type V3 = [number, number, number];

class TreeMesh {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  idx: number[] = [];
  /** Viereck-Streifen: Reihen von Punkten links/rechts, Texturzelle, Farbe je Reihe */
  strip(left: V3[], right: V3[], cell: readonly [number, number], nrm: (p: V3) => V3, tint: (t: number) => V3, sw: (p: V3, t: number) => number) {
    const o = this.pos.length / 3;
    const n = left.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      for (const [p, u] of [[left[i], 0], [right[i], 1]] as [V3, number][]) {
        this.pos.push(p[0], p[1], p[2]);
        const q = nrm(p);
        this.nor.push(q[0], q[1], q[2]);
        // Atlaszelle, mit kleinem Rand (keine Nachbarzelle in den kleinen Stufen)
        this.uv.push((cell[0] + 0.01 + u * 0.98) / 2, (cell[1] + 0.01 + t * 0.98) / 2);
        const c = tint(t);
        this.col.push(c[0], c[1], c[2]);
        this.sway.push(sw(p, t));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = o + i * 2, b = a + 1, c = a + 2, d = a + 3;
      this.idx.push(a, b, d, a, d, c);
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x1b873593, 0xcc9e2d51);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};
const nrm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Stamm: Kegelstumpf mit Rinde */
function trunk(M: TreeMesh, h: number, r0: number, r1: number, seg: number) {
  const left: V3[][] = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    left.push([[Math.cos(a) * r0, 0, Math.sin(a) * r0], [Math.cos(a) * r1, h, Math.sin(a) * r1]]);
  }
  for (let k = 0; k < seg; k++) {
    const [a0, a1] = left[k], [b0, b1] = left[k + 1];
    M.strip([b0, b1], [a0, a1], CELL.bark, (p) => nrm3([p[0], 0.1, p[2]]), () => [1, 1, 1], () => 0);
  }
}

interface Conifer { h: number; tiers: number; b0: number; b1: number; width: number; droop: number; cardW: number; segs: number; cell: readonly [number, number]; tint: V3; seed: number; cross: number }

/** Nadelbaum: Etagen von Ästen, jeder Ast zwei gekreuzte, hängende Zweigkarten */
function conifer(o: Conifer): THREE.BufferGeometry {
  const M = new TreeMesh();
  const H = o.h;
  trunk(M, H * 0.9, H * 0.014, H * 0.004, o.segs > 1 ? 6 : 4);
  const yc = H * 0.45;
  const nrm = (p: V3): V3 => nrm3([p[0], (p[1] - yc) * 0.35 + Math.hypot(p[0], p[2]) * 0.6 + H * 0.02, p[2]]);
  let ang = rnd(o.seed) * 6.28;
  for (let t = 0; t < o.tiers; t++) {
    const f = t / (o.tiers - 1);
    const y = H * (0.07 + 0.89 * Math.pow(f, 0.95));
    const R = (o.width * H * Math.pow(1 - f, 0.85) + H * 0.035) * (0.92 + rnd(o.seed + t) * 0.16);
    const B = Math.max(3, Math.round(o.b0 + (o.b1 - o.b0) * f));
    for (let k = 0; k < B; k++) {
      ang += 2.39996 + (rnd(o.seed * 7 + t * 13 + k) - 0.5) * 0.3;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const L = R * (0.85 + rnd(o.seed + t * 5 + k) * 0.3);
      const droop = L * o.droop * (0.7 + 0.6 * (1 - f));
      const lift = L * 0.18;
      const W = Math.max(0.55, L * o.cardW);
      // Ast: Mittellinie mit Durchhang
      const pts: V3[] = [];
      for (let i = 0; i <= o.segs; i++) {
        const s = i / o.segs;
        pts.push([dx * (0.08 + L * s), y + lift * s - droop * s * s, dz * (0.08 + L * s)]);
      }
      // quer zum Ast (waagrecht), dazu die Kippung um die Astachse für die beiden Karten
      const side: V3 = [-dz, 0, dx];
      // Abschattung: innen dunkler, unten dunkler (die Krone darüber nimmt Licht)
      const ao = 0.42 + f * 0.33;
      const tint = (tt: number): V3 => {
        const k2 = (ao + (1 - ao) * tt) * (0.72 + 0.28 * f) * (0.92 + rnd(o.seed + t * 31 + k) * 0.16);
        return [o.tint[0] * k2, o.tint[1] * k2, o.tint[2] * k2];
      };
      const sw = (p: V3, tt: number) => tt * tt * (0.4 + 0.6 * p[1] / H);
      // gekreuzte Karten (nah) oder eine, abwechselnd gekippt (mittel)
      for (const tilt of o.cross > 0 ? [o.cross, -o.cross] : [(k % 2 ? 1 : -1) * 0.45]) {
        const c = Math.cos(tilt), s2 = Math.sin(tilt);
        const off: V3 = [side[0] * c, s2, side[2] * c];
        const left = pts.map((p, i): V3 => { const w = W * (0.55 + 0.45 * Math.sin(Math.PI * (0.25 + 0.75 * i / o.segs))) / 2; return [p[0] - off[0] * w, p[1] - off[1] * w, p[2] - off[2] * w]; });
        const right = pts.map((p, i): V3 => { const w = W * (0.55 + 0.45 * Math.sin(Math.PI * (0.25 + 0.75 * i / o.segs))) / 2; return [p[0] + off[0] * w, p[1] + off[1] * w, p[2] + off[2] * w]; });
        M.strip(left, right, o.cell, nrm, tint, sw);
      }
    }
  }
  // Wipfel: zwei gekreuzte, stehende Karten
  for (const a of [0, Math.PI / 2]) {
    const sx = Math.cos(a) * H * 0.045, sz = Math.sin(a) * H * 0.045;
    const y0 = H * 0.86, y1 = H * 1.02;
    M.strip([[-sx, y0, -sz], [-sx * 0.3, y1, -sz * 0.3]], [[sx, y0, sz], [sx * 0.3, y1, sz * 0.3]], o.cell, (p) => nrm3([p[0], 0.6, p[2]]), (tt) => [o.tint[0] * (0.8 + 0.3 * tt), o.tint[1] * (0.8 + 0.3 * tt), o.tint[2] * (0.8 + 0.3 * tt)], (_p, tt) => tt * 0.8);
  }
  return M.build();
}

/** Laubbaum: Stamm, Krone aus Blattwolken (je drei gekreuzte Karten) */
function broadleaf(h: number, blobs: number, size: number, seed: number): THREE.BufferGeometry {
  const M = new TreeMesh();
  trunk(M, h * 0.62, h * 0.035, h * 0.018, blobs > 5 ? 6 : 4);
  const yc = h * 0.66;
  for (let b = 0; b < blobs; b++) {
    const a = rnd(seed + b * 3) * Math.PI * 2;
    const rr = b === 0 ? 0 : h * (0.1 + rnd(seed + b * 5) * 0.14);
    const c: V3 = [Math.cos(a) * rr, h * (0.55 + rnd(seed + b * 7) * 0.32), Math.sin(a) * rr];
    const S = h * size * (0.8 + rnd(seed + b * 9) * 0.4);
    const nrm = (p: V3): V3 => nrm3([p[0], (p[1] - yc) * 0.8 + h * 0.08, p[2]]);
    const tint = (tt: number): V3 => { const k = 0.55 + 0.45 * ((c[1] - h * 0.5) / (h * 0.45)) * 0.6 + tt * 0.25; return [k, k, k]; };
    const sw = (p: V3) => 0.3 + 0.7 * (p[1] / h);
    const r0 = rnd(seed + b);
    for (const [ax, az] of [[1, 0], [0, 1], [0.7, 0.7]] as [number, number][]) {
      const rot = r0 * 3;
      const ux = ax * Math.cos(rot) - az * Math.sin(rot), uz = ax * Math.sin(rot) + az * Math.cos(rot);
      M.strip([[c[0] - ux * S / 2, c[1] - S / 2, c[2] - uz * S / 2], [c[0] - ux * S / 2, c[1] + S / 2, c[2] - uz * S / 2]],
        [[c[0] + ux * S / 2, c[1] - S / 2, c[2] + uz * S / 2], [c[0] + ux * S / 2, c[1] + S / 2, c[2] + uz * S / 2]], CELL.broad, nrm, tint, sw);
    }
    // waagrechte Karte (von oben gesehen nicht durchsichtig)
    M.strip([[c[0] - S / 2, c[1], c[2] - S / 2], [c[0] - S / 2, c[1], c[2] + S / 2]], [[c[0] + S / 2, c[1], c[2] - S / 2], [c[0] + S / 2, c[1], c[2] + S / 2]], CELL.broad, nrm, tint, sw);
  }
  return M.build();
}

/** Baumformen je Art: [nah, mittel] (Höhe 12 m bei Maßstab 1) */
export function treeGeometries(): Record<Arch, THREE.BufferGeometry[]> {
  const pine: Conifer = { h: 12, tiers: 13, b0: 7, b1: 4, width: 0.25, droop: 0.3, cardW: 0.9, segs: 2, cell: CELL.pine, tint: [1, 1, 1], seed: 3, cross: 0.6 };
  const larch: Conifer = { h: 13, tiers: 11, b0: 6, b1: 3, width: 0.22, droop: 0.24, cardW: 0.95, segs: 2, cell: CELL.larch, tint: [1, 1, 1], seed: 9, cross: 0.55 };
  return {
    pine: [conifer(pine), conifer({ ...pine, tiers: 8, b0: 7, b1: 3, cardW: 1.35, segs: 1, cross: 0 })],
    larch: [conifer(larch), conifer({ ...larch, tiers: 7, b0: 6, b1: 3, cardW: 1.35, segs: 1, cross: 0 })],
    broad: [broadleaf(11, 9, 0.3, 5), broadleaf(11, 5, 0.38, 5)],
  };
}

// ——— Bild für die Ferne (Impostor) ———

export interface Impostor { albedo: THREE.Texture; normal: THREE.Texture; w: number; h: number; rtA: THREE.RenderTarget; rtN: THREE.RenderTarget }

/**
 * Den nahen Baum von der Seite in zwei Texturen zeichnen: Farbe (mit Abschattung, als Wurzel) und Normale.
 * Fern zeigt eine zur Kamera gedrehte Fläche dieses Bild – mit demselben Licht wie der nahe Baum.
 */
export function bakeImpostor(renderer: THREE.WebGPURenderer, geo: THREE.BufferGeometry, atlas: THREE.Texture, size = 512): Impostor {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const h = bb.max.y * 1.02;
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.04;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, -50, 50);
  // Kamera schaut entlang −z, Bild von y = 0 … h
  cam.position.set(0, 0, 20);
  cam.updateMatrixWorld();
  const scene = new THREE.Scene();
  const t = texture(atlas, uv());
  const mA = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mA.colorNode = vec4(t.rgb.mul(sqrt(vertexColor().xyz)), 1);
  mA.opacityNode = t.a;
  mA.alphaTest = 0.32;
  const mN = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mN.colorNode = vec4(normalize(attribute('normal', 'vec3')).mul(0.5).add(0.5), 1);
  mN.opacityNode = t.a;
  mN.alphaTest = 0.32;
  const mesh = new THREE.Mesh(geo, mA);
  scene.add(mesh);
  const make = () => new THREE.RenderTarget(Math.round(size * Math.min(1, w / h)), size, {
    type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const rtA = make();
  const rtN = make();
  const prev = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rtA);
  renderer.render(scene, cam);
  mesh.material = mN;
  renderer.setClearColor(0x808080, 0);
  renderer.setRenderTarget(rtN);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(prevClear, prevAlpha);
  mA.dispose();
  mN.dispose();
  return { albedo: rtA.texture, normal: rtN.texture, w, h, rtA, rtN };
}

/** Fläche für das Fernbild: unten in der Mitte verankert, w × h */
export function impostorQuad(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}

/** Deckung aus der Textur, an den Kanten scharf (Bildpunkt-genau), mal Überblendung */
export function coverage(a: N, fade: N, cut = 0.42): N {
  const fw = max(fwidth(a), float(1e-4));
  return clamp(a.sub(cut).div(fw).add(0.5), 0, 1).mul(fade);
}

