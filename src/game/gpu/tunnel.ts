/**
 * Tunnel für die WebGPU-Abfahrt: Röhre mit Hufeisen-Gewölbe in den Maßen des Spiels (tunnel3d.ts), Fahrbahn mit
 * Markierung, Rinne und Gehwegkante, Wandpaneele über dunklem Sockel, Spritzbeton im Gewölbe, Leuchtenreihen
 * links und rechts, gemauerte Portale.
 *
 * Unbeleuchtetes Material, das Licht entsteht pro Bildpunkt aus der Lage in der Röhre (Attribut aT: seitlich,
 * Höhe, Strecke, Abstand zum Portal): Lichtinseln unter den Leuchten, Tageslicht an den Portalen, das nach
 * innen abnimmt. So dringt keine Sonne durch die Röhre, und es kostet kaum mehr als eine Farbe.
 */
import * as THREE from 'three/webgpu';
import { ROAD_HALF, SEG, type Track } from '../abfahrt/track';
import { Boxes } from './corridor';
import { tsl, type N } from './nodes';

const { attribute, exp, float, floor, max, mix, uniform, vec3, vertexColor } = tsl;

/** Wandfläche (seitlich ab Mitte), Kämpfer (Beginn des Gewölbes), Scheitel – wie im Spiel */
export const T_WALL = 3.45;
export const T_SPRING = 3.2;
export const T_TOP = 6.15;
const KERB = 3.12;
const KERB_H = 0.17;
/** Leuchten: alle 12 m, links und rechts im Gewölbe */
export const LAMP_EVERY = 12;
const LAMP_X = 1.9;
const LAMP_H = 5.45;
/** Portalfassade: halbe Breite, Höhe */
const FAC_W = 7.6;
const FAC_H = 9.6;

interface Row { x: number; y: number; z: number; rx: number; rz: number; fx: number; fz: number }

/** Baukasten: Lage, Farbe, Lage in der Röhre (aT), Leuchten (aE) */
class TB {
  p: number[] = [];
  c: number[] = [];
  t: number[] = [];
  e: number[] = [];
  idx: number[] = [];
  v(p: number[], c: number[], t: number[], e = 0) {
    this.p.push(p[0], p[1], p[2]);
    this.c.push(c[0], c[1], c[2]);
    this.t.push(t[0], t[1], t[2], t[3]);
    this.e.push(e);
    return this.p.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 4));
    g.setAttribute('aE', new THREE.Float32BufferAttribute(this.e, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Querschnitt (rechts nach links): seitlich, Höhe, Farbe */
function profile(): { x: number; h: number; c: number[] }[] {
  const out: { x: number; h: number; c: number[] }[] = [];
  const asph = [0.05, 0.05, 0.052];
  const kerb = [0.42, 0.41, 0.39];
  const plinth = [0.12, 0.12, 0.13];
  const panel = [0.62, 0.63, 0.62];
  const shot = [0.3, 0.29, 0.27];
  // rechte Seite: Rinne, Gehwegkante, Wand mit Sockel und Paneelen
  out.push({ x: ROAD_HALF, h: 0, c: asph });
  out.push({ x: KERB, h: -0.04, c: plinth });
  out.push({ x: KERB, h: KERB_H, c: kerb });
  out.push({ x: T_WALL, h: KERB_H, c: kerb });
  out.push({ x: T_WALL, h: 0.95, c: plinth });
  out.push({ x: T_WALL, h: 1.0, c: panel });
  out.push({ x: T_WALL, h: T_SPRING - 0.1, c: panel });
  out.push({ x: T_WALL, h: T_SPRING, c: shot });
  // Gewölbe
  const N = 12;
  for (let k = 1; k < N; k++) {
    const t = (k / N) * Math.PI;
    out.push({ x: T_WALL * Math.cos(t), h: T_SPRING + (T_TOP - T_SPRING) * Math.sin(t), c: shot });
  }
  // linke Seite gespiegelt
  const right = out.slice(0, 8);
  for (let k = right.length - 1; k >= 0; k--) out.push({ x: -right[k].x, h: right[k].h, c: right[k].c });
  return out;
}

export class Tunnels {
  readonly mat: THREE.MeshBasicNodeMaterial;
  /** Tageslicht an den Portalen (Farbe × Stärke, von der Stimmung) */
  readonly day = uniform(new THREE.Color(1, 0.95, 0.88));
  /** Leuchtenfarbe */
  readonly lamp = uniform(new THREE.Color(1, 0.88, 0.7));
  private prof = profile();

  constructor(private track: Track, private stoneMat: THREE.Material) {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const T = attribute('aT', 'vec4');
    const E = attribute('aE', 'float');
    const lat = T.x, h = T.y, zl = T.z, dp = T.w;
    // nächste Leuchtenreihe (alle 12 m) – Abstand längs
    const dz = zl.sub(floor(zl.div(LAMP_EVERY).add(0.5)).mul(LAMP_EVERY));
    const lampAt = (side: number): N => {
      const dx = lat.sub(side * LAMP_X);
      const dy = h.sub(LAMP_H);
      const d2 = dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz).mul(0.7));
      return float(5.5).div(d2.add(2.2));
    };
    const lampL = lampAt(1).add(lampAt(-1)).add(0.16);
    // Tageslicht fällt an den Portalen hinein und nimmt nach innen ab
    const dayK = exp(dp.mul(-0.09)).mul(1.4).add(exp(dp.mul(-0.025)).mul(0.25));
    const base = vertexColor().xyz;
    const lit = base.mul(this.lamp.mul(lampL).add(vec3(this.day.x, this.day.y, this.day.z).mul(dayK)));
    // Leuchten selbst: hell (für das Leuchten)
    m.colorNode = mix(lit, vec3(this.lamp.x, this.lamp.y, this.lamp.z).mul(6), max(E, float(0)));
    m.name = 'tunnel';
    this.mat = m;
  }

  /**
   * Streaming: alle Tunnel im Bereich i0 … i1 (halboffen), dazu ihre Portale. null, wenn hier keiner liegt.
   * Ein Tunnel, der vor i0 beginnt, wird ab i0 gebaut (sein Portal liegt dann im vorigen Bereich).
   */
  *buildRange(i0: number, i1: number): Generator<void, THREE.Group | null, void> {
    const t = this.track;
    let any = false;
    for (let i = i0; i < i1; i++) if (t.seg(i).tunnel) { any = true; break; }
    if (!any) return null;
    const B = new TB();
    const stone = new Boxes();
    stone.stone = true;
    let i = i0;
    while (i < i1) {
      while (i < i1 && !t.seg(i).tunnel) i++;
      if (i >= i1) break;
      let j = i;
      while (j < i1 && t.seg(j).tunnel) j++;
      // Lage des ganzen Tunnels (für Portalabstand und Leuchtenraster)
      let a = i;
      while (a > 0 && t.seg(a - 1).tunnel) a--;
      let b = j;
      while (t.seg(b).tunnel) b++;
      this.tube(B, i, j, a * SEG, b * SEG);
      if (t.seg(i).portal === 1 || i === a) this.portal(stone, i, -1);
      if (j === b) this.portal(stone, j, 1);
      i = j;
      yield;
    }
    const out = new THREE.Group();
    const g = B.build();
    if (g) {
      const mesh = new THREE.Mesh(g, this.mat);
      // die Röhre hält die Sonne vom Fahrer ab (Schattenkarte)
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      out.add(mesh);
    }
    const sg = stone.build();
    if (sg) {
      const mesh = new THREE.Mesh(sg, this.stoneMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      out.add(mesh);
    }
    return out;
  }

  private row(z: number): Row {
    const w = this.track.world(z, 0, 0, { x: 0, y: 0, z: 0, th: 0 });
    return { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), fx: Math.sin(w.th), fz: -Math.cos(w.th) };
  }

  /** Röhre der Segmente i … j (Strecke za … zb: ganzer Tunnel) */
  private tube(B: TB, i: number, j: number, za: number, zb: number) {
    const P = this.prof;
    // Leuchtenraster ab einem Vielfachen von 60 m vor dem Tunnel (kleine Zahlen bleiben auf Handys genau)
    const base = Math.floor(za / 60) * 60;
    let prev: number[] | null = null;
    let prevRoad: number[] | null = null;
    for (let k = i; k <= j; k++) {
      const z = k * SEG;
      const r = this.row(z);
      const zl = z - base;
      const dp = Math.max(0, Math.min(z - za, zb - z));
      const ids = P.map((q) => B.v([r.x + r.rx * q.x, r.y + q.h, r.z + r.rz * q.x], q.c, [q.x, q.h, zl, dp]));
      // Fahrbahn mit Mittellinie (gestrichelt)
      const dash = (k & 3) < 2;
      const road = [-ROAD_HALF, -0.07, 0.07, ROAD_HALF].map((x, q) => B.v([r.x + r.rx * x, r.y + 0.002, r.z + r.rz * x],
        q === 1 || q === 2 ? (dash ? [0.7, 0.7, 0.68] : [0.05, 0.05, 0.052]) : [0.05, 0.05, 0.052], [x, 0, zl, dp]));
      if (prev && prevRoad) {
        for (let q = 0; q < ids.length - 1; q++) B.quad(prev[q], ids[q], ids[q + 1], prev[q + 1]);
        for (let q = 0; q < 3; q++) B.quad(prevRoad[q], prevRoad[q + 1], road[q + 1], road[q]);
      }
      prev = ids;
      prevRoad = road;
      // Leuchten: alle 12 m links und rechts eine Lichtleiste im Gewölbe
      if (Math.abs(((zl % LAMP_EVERY) + LAMP_EVERY) % LAMP_EVERY) < SEG - 1e-6) {
        for (const sg of [-1, 1]) {
          const lx = sg * LAMP_X;
          const w = 0.12;
          const a0 = this.row(z - 0.6), a1 = this.row(z + 0.6);
          const pts = [
            [a0.x + a0.rx * (lx - w), a0.y + LAMP_H - 0.06, a0.z + a0.rz * (lx - w)],
            [a0.x + a0.rx * (lx + w), a0.y + LAMP_H - 0.06, a0.z + a0.rz * (lx + w)],
            [a1.x + a1.rx * (lx + w), a1.y + LAMP_H - 0.06, a1.z + a1.rz * (lx + w)],
            [a1.x + a1.rx * (lx - w), a1.y + LAMP_H - 0.06, a1.z + a1.rz * (lx - w)],
          ];
          const v = pts.map((p) => B.v(p, [1, 1, 1], [lx, LAMP_H, zl, dp], 1));
          B.quad(v[0], v[1], v[2], v[3]);
        }
      }
    }
  }

  /** gemauertes Portal am Segment i (dir −1: Einfahrt, Fassade zeigt der Strecke entgegen; +1: Ausfahrt) */
  private portal(S: Boxes, i: number, dir: number) {
    const r = this.row(i * SEG);
    const back = dir * 0.02;
    const at = (x: number, h: number, d = 0) => [r.x + r.rx * x + r.fx * (back + d), r.y + h, r.z + r.rz * x + r.fz * (back + d)];
    // innen: Gewölbeumriss (rechts unten → Scheitel → links unten), außen: Rechteck in gleich vielen Schritten
    const inner: number[][] = [];
    const N = 16;
    inner.push([T_WALL, 0]);
    inner.push([T_WALL, T_SPRING]);
    for (let k = 1; k < N; k++) { const t = (k / N) * Math.PI; inner.push([T_WALL * Math.cos(t), T_SPRING + (T_TOP - T_SPRING) * Math.sin(t)]); }
    inner.push([-T_WALL, T_SPRING]);
    inner.push([-T_WALL, 0]);
    const outer: number[][] = inner.map(([x, h]) => {
      // Strahl von der Mitte (0, 3) nach außen bis zum Rechteck
      const dx = x, dy = h - 3;
      const k = Math.min(Math.abs(dx) > 1e-6 ? FAC_W / Math.abs(dx) : Infinity, dy > 1e-6 ? (FAC_H - 3) / dy : dy < -1e-6 ? 3 / -dy : Infinity);
      return [dx * k, 3 + dy * k];
    });
    const v = 0.9 + ((i * 7) % 5) * 0.04;
    const col = [0.4 * v, 0.38 * v, 0.35 * v];
    for (let k = 0; k < inner.length - 1; k++) {
      const a = at(inner[k][0], inner[k][1]), b = at(inner[k + 1][0], inner[k + 1][1]);
      const c = at(outer[k + 1][0], outer[k + 1][1]), d = at(outer[k][0], outer[k][1]);
      if (dir < 0) S.quad(a, d, c, b, col); else S.quad(a, b, c, d, col);
    }
    // Gesims oben
    const top = [0.46 * v, 0.44 * v, 0.41 * v];
    const g0 = at(-FAC_W - 0.2, FAC_H, -dir * 0.4), g1 = at(FAC_W + 0.2, FAC_H, -dir * 0.4), g2 = at(FAC_W + 0.2, FAC_H, dir * 0.6), g3 = at(-FAC_W - 0.2, FAC_H, dir * 0.6);
    if (dir < 0) S.quad(g0, g1, g2, g3, top); else S.quad(g0, g3, g2, g1, top);
  }
}
