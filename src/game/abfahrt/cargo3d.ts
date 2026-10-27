/**
 * Lastenrad: Holzkiste aus Birkensperrholz mit Schaumstoffkante, darin Bello (Beagle mit Rennmütze,
 * Ohren im Fahrtwind, heraushängender Zunge und wedelndem Schwanz), dazu Baguette und Wimpel.
 * Alles steht still mit dem Rahmen; gebaut in Rahmenkoordinaten (Tretlager bei z ≈ 0, vorn ist −z).
 */
import * as THREE from 'three';
import { Mesher, rgb, type C3 } from './gloss';
import { pipe, revolve } from './prim3d';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface CargoMeshers { paint: Mesher; metal: Mesher; satin: Mesher; matte: Mesher }

/** Lage der Kiste: Boden (y0), vorn/hinten (z), halbe Breite, Wandhöhe */
export interface BoxDims { y0: number; zf: number; zb: number; hw: number; h: number }

export const CARGO_BOX: BoxDims = { y0: 0.268, zf: -1.235, zb: -0.64, hw: 0.3, h: 0.29 };

const M = (p: V, s: V, r = new THREE.Euler()) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(r), s);

/** Ellipsoid (Kugel skaliert, gedreht) */
function blob(m: Mesher, q: 0 | 1, c: V, r: V, col: C3, rot?: THREE.Euler, gl?: number) {
  m.add(new THREE.SphereGeometry(1, q ? 16 : 8, q ? 12 : 6), M(c, r, rot), col, gl);
}

/** Kiste mit Hund; gibt die Flächen für den Schriftzug an beiden Seiten zurück */
export function buildCargoBox(f: CargoMeshers, q: 0 | 1, cap: C3, capSide: C3): THREE.BufferGeometry {
  const B = CARGO_BOX;
  const t = 0.014;
  const L = B.zb - B.zf;
  const zc = (B.zf + B.zb) / 2;
  const wood = rgb('#d9bb8c');
  const woodIn = rgb('#c9a676');
  const edge = rgb('#ead3a8');
  const ply = rgb('#9a7650');
  const W = f.satin;
  const box = (p: V, s: V, c: C3, m: Mesher = W) => m.add(new THREE.BoxGeometry(1, 1, 1), M(p, s), c);
  // Boden, Seiten, Front (etwas höher) und Rückwand
  box(v3(0, B.y0 + t / 2, zc), v3(B.hw * 2, t, L), woodIn);
  for (const sx of [-1, 1]) box(v3(sx * (B.hw - t / 2), B.y0 + B.h / 2, zc), v3(t, B.h, L), wood);
  const hf = B.h + 0.02;
  box(v3(0, B.y0 + hf / 2, B.zf + t / 2), v3(B.hw * 2 - 0.002, hf, t), wood);
  const hb = B.h - 0.03;
  box(v3(0, B.y0 + hb / 2, B.zb - t / 2), v3(B.hw * 2 - 2 * t, hb, t), wood);
  // Sperrholzkanten oben: hell mit dunklen Lagen
  const top = B.y0 + B.h;
  if (q) {
    for (const sx of [-1, 1]) {
      box(v3(sx * (B.hw - t / 2), top + 0.0012, zc), v3(t + 0.0012, 0.0026, L + 0.0012), edge);
      for (const k of [0.006, 0.012]) box(v3(sx * (B.hw - t / 2), top - k, zc), v3(t + 0.0016, 0.0012, L - 0.002), ply);
    }
    box(v3(0, B.y0 + hb + 0.0012, B.zb - t / 2), v3(B.hw * 2 - 2 * t, 0.0026, t + 0.0012), edge);
    // Metallwinkel an den oberen Ecken
    for (const sx of [-1, 1]) {
      for (const z of [B.zf + 0.02, B.zb - 0.02]) box(v3(sx * (B.hw + 0.0008), top - 0.03, z), v3(0.002, 0.05, 0.03), rgb('#b9bec4'), f.metal);
    }
  }
  // Schaumstoffpolster auf der Frontkante (schwarz, rund)
  const fy = B.y0 + hf + 0.012;
  pipe(f.matte, [v3(-B.hw + 0.01, fy, B.zf + t / 2), v3(B.hw - 0.01, fy, B.zf + t / 2)], 0.014, q ? 10 : 5, rgb('#1d1e21'));
  // Kissen am Boden (blau kariert angedeutet)
  box(v3(0, B.y0 + t + 0.02, zc + 0.02), v3(B.hw * 2 - 0.06, 0.04, L - 0.08), rgb('#3f6fb0'), f.matte);

  buildDog(f, q, cap, capSide);

  // Baguette hinten rechts, schräg aus der Kiste
  const bq = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), v3(0.12, 1, 0.22).normalize());
  const bagC = rgb('#d79c52');
  W.add(new THREE.CapsuleGeometry(0.024, 0.42, q ? 4 : 2, q ? 10 : 6), new THREE.Matrix4().compose(v3(0.21, top + 0.04, B.zb - 0.1), bq, v3(1, 1, 1)), bagC, 0.15);
  if (q) {
    // Einschnitte
    for (let k = -1; k <= 1; k++) {
      const c = v3(0.21, top + 0.04, B.zb - 0.1).add(v3(0.12, 1, 0.22).normalize().multiplyScalar(k * 0.11));
      W.add(new THREE.BoxGeometry(0.03, 0.006, 0.02), new THREE.Matrix4().compose(c.add(v3(0, 0, -0.019)), bq, v3(1, 1, 1)), rgb('#f0d39a'), 0.1);
    }
  }

  // Wimpel an der Stange hinten links
  const pole0 = v3(-B.hw + 0.03, top - 0.02, B.zb - 0.03);
  const pole1 = v3(-B.hw + 0.03, 1.62, B.zb - 0.05);
  pipe(f.satin, [pole0, pole1], 0.0045, q ? 6 : 4, rgb('#f2f2ef'));
  pennant(f.paint, pole1, 0.2, 0.12, rgb('#ff6a1a'));

  // Schriftzug-Flächen auf beiden Seitenwänden
  return sideDecal(B.hw + 0.0008, B.y0 + B.h * 0.48, zc + 0.02, 0.44, 0.075);
}

/** dreieckiger Wimpel am Stangenende, nach hinten wehend (beidseitig) */
export function pennant(m: Mesher, top: V, len: number, h: number, col: C3) {
  const a = top.clone();
  const b = top.clone().add(v3(0.004, -h * 0.45, len));
  const c = top.clone().add(v3(0, -h, 0));
  for (const sx of [-1, 1]) {
    const o = v3(sx * 0.0012, 0, 0);
    const i0 = m.v(a.x + o.x, a.y, a.z, col);
    const i1 = m.v(b.x + o.x, b.y, b.z, col);
    const i2 = m.v(c.x + o.x, c.y, c.z, col);
    // von +x gesehen gegen den Uhrzeigersinn: a (oben vorn), b (Spitze hinten), c (unten vorn)
    if (sx > 0) m.tri(i0, i1, i2); else m.tri(i0, i2, i1);
  }
}

/** zwei Flächen (links, rechts) mit uv für einen Schriftzug */
export function sideDecal(x: number, y: number, z: number, w: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1]) {
    const b = pos.length / 3;
    // von außen gesehen links beginnen: rechts (+x) ist links hinten, links (−x) ist links vorn
    for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const zz = side > 0 ? z + w / 2 - du * w : z - w / 2 + du * w;
      pos.push(side * x, y - h / 2 + dv * h, zz);
      uv.push(du, dv);
    }
    // von außen gesehen gegen den Uhrzeigersinn
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Bello: Beagle in der Kiste, Pfoten auf der Kante, Kopf im Wind */
function buildDog(f: CargoMeshers, q: 0 | 1, capC: C3, capSide: C3) {
  const fur = f.matte;
  const brown = rgb('#9a5a2b');
  const ear = rgb('#6e3d1c');
  const white = rgb('#f2ebe0');
  const black = rgb('#2a2320');
  const B = CARGO_BOX;
  const zf = B.zf;
  // Körper (Sattel schwarz), Brust und Hals
  blob(fur, q, v3(0, 0.455, -0.96), v3(0.12, 0.125, 0.2), black);
  blob(fur, q, v3(0, 0.47, -1.09), v3(0.1, 0.12, 0.09), white);
  blob(fur, q, v3(0, 0.61, -1.105), v3(0.075, 0.105, 0.075), brown, new THREE.Euler(0.35, 0, 0));
  // Halsband mit Marke
  fur.add(new THREE.TorusGeometry(0.068, 0.0085, q ? 6 : 4, q ? 18 : 10), M(v3(0, 0.6, -1.11), v3(1, 1, 1), new THREE.Euler(Math.PI / 2 - 0.35, 0, 0)), rgb('#c8302b'), 0.3);
  f.metal.add(new THREE.SphereGeometry(0.011, 8, 6), M(v3(0, 0.566, -1.168), v3(1, 1.2, 0.5)), rgb('#e0b54a'));
  // Kopf, Schnauze, Blesse
  const head = v3(0, 0.715, -1.13);
  blob(fur, q, head, v3(0.078, 0.074, 0.085), brown);
  blob(fur, q, v3(0, 0.682, -1.205), v3(0.046, 0.04, 0.062), white);
  blob(fur, q, v3(0, 0.735, -1.19), v3(0.018, 0.05, 0.03), white, new THREE.Euler(-0.5, 0, 0));
  // Nase, Augen (mit Glanzpunkt)
  blob(f.satin, q, v3(0, 0.7, -1.262), v3(0.019, 0.015, 0.014), rgb('#151313'), undefined, 0.6);
  for (const sx of [-1, 1]) {
    blob(f.satin, q, v3(sx * 0.036, 0.734, -1.191), v3(0.011, 0.012, 0.009), rgb('#1a1412'), undefined, 0.7);
    if (q) blob(f.satin, q, v3(sx * 0.033, 0.738, -1.199), v3(0.003, 0.003, 0.002), white, undefined, 0.6);
  }
  // Schlappohren im Fahrtwind: nach hinten und außen geweht
  for (const sx of [-1, 1]) {
    blob(fur, q, v3(sx * 0.082, 0.722, -1.06), v3(0.012, 0.036, 0.085), ear, new THREE.Euler(-0.28, sx * 0.35, sx * -0.45));
  }
  // Zunge seitlich heraus
  blob(fur, q, v3(0.026, 0.652, -1.218), v3(0.017, 0.006, 0.032), rgb('#e46d86'), new THREE.Euler(0.75, 0.5, 0.2), 0.35);
  // Rennmütze mit hochgeklapptem Schirm
  const capTop = v3(0, 0.768, -1.118);
  fur.add(new THREE.SphereGeometry(1, q ? 16 : 8, q ? 8 : 4, 0, Math.PI * 2, 0, Math.PI / 2), M(capTop, v3(0.07, 0.042, 0.078), new THREE.Euler(-0.12, 0, 0)), capC);
  if (q) fur.add(new THREE.CylinderGeometry(0.0705, 0.0705, 0.012, 16, 1, true), M(capTop.clone().add(v3(0, 0.004, 0)), v3(1, 1, 1.11), new THREE.Euler(-0.12, 0, 0)), capSide);
  fur.add(new THREE.BoxGeometry(0.09, 0.006, 0.05), M(v3(0, 0.79, -1.19), v3(1, 1, 1), new THREE.Euler(0.55, 0, 0)), capC);
  // Vorderpfoten auf der Kistenkante
  for (const sx of [-1, 1]) blob(fur, q, v3(sx * 0.056, B.y0 + B.h + 0.045, zf + 0.022), v3(0.03, 0.024, 0.048), white);
  for (const sx of [-1, 1]) blob(fur, q, v3(sx * 0.058, B.y0 + B.h + 0.0, zf + 0.04), v3(0.028, 0.06, 0.03), brown, new THREE.Euler(-0.4, 0, 0));
  // Schwanz: hoch gestellt, weiße Spitze
  const tail = [v3(0, 0.5, -0.78), v3(0, 0.58, -0.74), v3(0, 0.66, -0.73), v3(0.01, 0.73, -0.75)];
  pipe(fur, tail, 0.013, q ? 8 : 4, (i) => (i === tail.length - 1 ? white : black));
  if (q) revolve(fur, [[0.0005, -0.02, white], [0.012, -0.012, white], [0.0005, 0.02, white]], 8, v3(0, 0, 0), false, new THREE.Matrix4().compose(tail[3], new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), v3(0.12, 1, -0.2).normalize()), v3(1, 1, 1)));
}
