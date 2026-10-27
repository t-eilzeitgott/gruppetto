/**
 * Wohnwagen fürs Fahrrad, Marke Eigenbau: Tropfenform aus genieteten Aluminiumblechen mit Retro-Streifen,
 * Tür mit Bullauge und karierten Gardinen, Dachluke, Ofenrohr, Heckklappe mit Rückleuchten und Kennzeichen,
 * Kotflügel über zwei Speichenrädern, A-Deichsel mit Gasflasche und hochgeklapptem Stützrad, Wimpel.
 *
 * Koordinaten: Ursprung in der Kupplung (am linken Ende der Hinterachse), +z nach hinten, y = 0 auf Achshöhe
 * des Rads (gebaut wird über dem Boden, am Ende um die Kupplungshöhe verschoben).
 */
import * as THREE from 'three';
import { MATTE, Mesher, PAINT, SATIN, CHROME, merge, rgb, type C3 } from './gloss';
import { along, ccwZY, insetZY, pipe, prism, revolve, strut, sweep, pathFrames, shape } from './prim3d';
import { pennant } from './cargo3d';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Maße (in Rahmenkoordinaten des Rads: Kupplung links an der Hinterachse) */
export const CARAVAN = {
  /** Kupplung am Rad */
  hitch: v3(-0.078, 0.335, 0.43),
  /** Mitte des Wohnwagens seitlich zur Kupplung */
  xc: 0.078,
  /** Kasten: Anfang hinter der Kupplung, Länge, halbe Breite */
  z0: 0.62, len: 1.46, w: 0.36,
  /** Achse hinter der Kupplung, Radradius, Räder seitlich zur Mitte */
  axleZ: 1.47, wheelR: 0.24, wheelX: 0.45,
};

export interface CaravanBuild {
  geo: THREE.BufferGeometry;
  plate: { geo: THREE.BufferGeometry; mat: THREE.Material } | null;
}

const M = (p: V, s: V, r = new THREE.Euler()) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(r), s);

/** Umriss des Kastens (z ab Kupplung, y über Boden), gegen den Uhrzeigersinn; Nähte als dunkle Linien */
function outline(q: 0 | 1, alu: C3, seam: C3) {
  const { z0 } = CARAVAN;
  const ctrl: [number, number][] = [
    [0.02, 0.3], [-0.004, 0.4], [0.0, 0.52], [0.04, 0.68], [0.13, 0.84], [0.28, 0.97], [0.48, 1.05], [0.72, 1.076],
    [0.95, 1.05], [1.15, 0.97], [1.31, 0.83], [1.42, 0.64], [1.465, 0.46], [1.46, 0.34], [1.43, 0.3],
  ];
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([z, y]) => v3(0, y, z0 + z)), false, 'centripetal');
  // Nähte (Bahnpositionen): vorn, Dach, Anfang und Ende der Heckklappe
  const seams = q ? [0.17, 0.4, 0.62, 0.95] : [];
  const N = q ? 52 : 16;
  const ts: { t: number; c: C3 }[] = [];
  for (let i = 0; i <= N; i++) ts.push({ t: i / N, c: alu });
  for (const s of seams) ts.push({ t: s - 0.0035, c: alu }, { t: s, c: seam }, { t: s + 0.0035, c: alu });
  ts.sort((a, b) => a.t - b.t);
  const pts: [number, number][] = [];
  const cols: C3[] = [];
  for (const { t, c } of ts) {
    const p = curve.getPointAt(Math.min(1, Math.max(0, t)));
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - p.z, last[1] - p.y) < 1e-4) continue;
    pts.push([p.z, p.y]);
    cols.push(c);
  }
  return { pts, cols, curve, seams };
}

/** kariertes Gardinenfenster (rot-weiß, Gingham) in der Seitenwand, von außen gesehen */
function gingham(m: Mesher, xs: number, sx: number, zc: number, yc: number, r: number, q: 0 | 1) {
  const n = q ? 8 : 2;
  const cs = (2 * r) / n;
  const red = rgb('#c9242b');
  const pink = rgb('#e8a2a2');
  const white = rgb('#f5efe6');
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = -r + i * cs;
      const b = -r + j * cs;
      if (Math.hypot(a + cs / 2, b + cs / 2) > r) continue;
      const c = i % 2 && j % 2 ? red : i % 2 || j % 2 ? pink : white;
      // Bildschirm des Betrachters: rechts ist −z (von +x) bzw. +z (von −x)
      const ids = [[a, b], [a + cs, b], [a + cs, b + cs], [a, b + cs]].map(([u, v]) => m.v(xs, yc + v, zc - sx * u, c, 0.55));
      m.tri(ids[0], ids[1], ids[2]);
      m.tri(ids[0], ids[2], ids[3]);
    }
  }
}

/** Bullauge: verchromter Ring und Gardinen, auf beiden Seiten */
function porthole(f: Sets, zc: number, yc: number, r: number, q: 0 | 1) {
  const { xc, w } = CARAVAN;
  for (const sx of [-1, 1]) {
    f.chrome.add(new THREE.TorusGeometry(r, r * 0.11, q ? 6 : 4, q ? 28 : 12), M(v3(xc + sx * (w + 0.006), yc, zc), v3(1, 1, 1), new THREE.Euler(0, Math.PI / 2, 0)), rgb('#d9dde1'));
    gingham(f.satin, xc + sx * (w + 0.0045), sx, zc, yc, r * 0.98, q);
  }
}

interface Sets { alu: Mesher; door: Mesher; paint: Mesher; chrome: Mesher; satin: Mesher; matte: Mesher }

export function buildCaravan(q: 0 | 1, stripe: C3): CaravanBuild {
  const { xc, w, z0, len, axleZ, wheelR, wheelX } = CARAVAN;
  const f: Sets = { alu: new Mesher(0.74), door: new Mesher(0.7), paint: new Mesher(PAINT), chrome: new Mesher(CHROME), satin: new Mesher(SATIN), matte: new Mesher(MATTE) };
  const alu = rgb('#c9ced4');
  const seamC = rgb('#6d737a');
  const dark = rgb('#2a2b2e');
  const rubber = rgb('#141416');
  const n = q ? 14 : 6;

  // Kasten: Tropfenumriss, seitlich gerade Wände, Kanten gerundet
  const o = outline(q, alu, seamC);
  const ol = ccwZY(o.pts);
  const cols = ol === o.pts ? o.cols : [...o.cols].reverse();
  prism(f.alu, ol, w, 0.026, (i) => cols[i], f.door, xc);
  // Boden dunkel
  f.matte.add(new THREE.BoxGeometry(w * 2 - 0.02, 0.012, len - 0.06), M(v3(xc, 0.296, z0 + len / 2), v3(1, 1, 1)), dark);

  // Retro-Streifen entlang der Kante auf beiden Seiten (über der Bodenlinie)
  const in1 = insetZY(ol, 0.048);
  const in2 = insetZY(ol, 0.074);
  for (const sx of [-1, 1]) {
    const xs = xc + sx * (w + 0.0007);
    for (let i = 0; i < ol.length; i++) {
      const j = (i + 1) % ol.length;
      if (in1[i][1] < 0.39 || in1[j][1] < 0.39 || in2[i][1] < 0.39 || in2[j][1] < 0.39) continue;
      const a = f.paint.v(xs, in1[i][1], in1[i][0], stripe);
      const b = f.paint.v(xs, in1[j][1], in1[j][0], stripe);
      const c = f.paint.v(xs, in2[j][1], in2[j][0], stripe);
      const d = f.paint.v(xs, in2[i][1], in2[i][0], stripe);
      // von außen gegen den Uhrzeigersinn (Umriss läuft von +x gesehen gegen den Uhrzeigersinn)
      if (sx > 0) { f.paint.tri(a, b, c); f.paint.tri(a, c, d); } else { f.paint.tri(a, c, b); f.paint.tri(a, d, c); }
    }
  }

  // Nieten: entlang der Nähte quer übers Dach und in Reihen an den Seitenkanten
  if (q) {
    const rivet = rgb('#e3e6ea');
    const hemi = () => new THREE.SphereGeometry(0.0034, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const s of o.seams) {
      const p = o.curve.getPointAt(s);
      const tng = o.curve.getTangentAt(s);
      const nrm = v3(0, -tng.z, tng.y);
      // nach außen (weg von der Kastenmitte)
      if (nrm.y * (p.y - 0.68) + nrm.z * (p.z - (z0 + len / 2)) < 0) nrm.negate();
      for (let x = -w + 0.035; x <= w - 0.034; x += 0.046) {
        for (const off of [-0.011, 0.011]) {
          const c = v3(xc + x, p.y + tng.y * off, p.z + tng.z * off).addScaledVector(nrm, 0.0005);
          f.chrome.add(hemi(), along(c, nrm), rivet);
        }
      }
    }
    const rows = insetZY(ol, 0.014);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < rows.length; i += 2) {
        const [z, y] = rows[i];
        if (y < 0.33) continue;
        f.chrome.add(hemi(), along(v3(xc + sx * (w + 0.0004), y, z), v3(sx, 0, 0)), rivet);
      }
    }
  }

  // Tür (beidseitig): Dichtung, Türblatt, Bullauge mit Gardine, Griff
  const dz0 = z0 + 0.43;
  const dz1 = z0 + 0.79;
  const dy0 = 0.35;
  const dy1 = 0.92;
  const rr = 0.07;
  const door: [number, number][] = [];
  const corner = (cz: number, cy: number, a0: number) => { for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (Math.PI / 2); door.push([cz + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } };
  corner(dz1 - rr, dy1 - rr, 0);
  corner(dz0 + rr, dy1 - rr, Math.PI / 2);
  corner(dz0 + rr, dy0 + rr, Math.PI);
  corner(dz1 - rr, dy0 + rr, Math.PI * 1.5);
  prism(f.matte, insetZY(ccwZY(door), -0.006), w + 0.0016, 0.0008, rubber, f.matte, xc);
  prism(f.door, door, w + 0.003, 0.0016, rgb('#d6dade'), f.door, xc);
  porthole(f, (dz0 + dz1) / 2, 0.72, 0.085, q);
  for (const sx of [-1, 1]) {
    const hx = xc + sx * (w + 0.012);
    strut(f.chrome, v3(hx, 0.58, dz1 - 0.06), v3(hx, 0.58, dz1 - 0.16), 0.012, 0.014, rgb('#d9dde1'), v3(0, 1, 0));
    if (q) f.chrome.add(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10), M(v3(xc + sx * (w + 0.007), 0.5, dz1 - 0.08), v3(1, 1, 1), new THREE.Euler(0, 0, Math.PI / 2)), rgb('#b9bec4'));
  }
  // kleines Bullauge vorn an der Seite
  porthole(f, z0 + 0.2, 0.7, 0.05, q);

  // Dachluke und Ofenrohr
  const roofAt = (zz: number) => {
    let best = 0;
    for (const [z, y] of ol) if (Math.abs(z - zz) < 0.04 && y > best) best = y;
    return best;
  };
  const ry = roofAt(z0 + 0.72);
  f.satin.add(new THREE.BoxGeometry(0.27, 0.03, 0.27), M(v3(xc, ry + 0.01, z0 + 0.72), v3(1, 1, 1)), rgb('#eeeeea'));
  f.satin.add(new THREE.SphereGeometry(1, q ? 16 : 8, q ? 6 : 3, 0, Math.PI * 2, 0, Math.PI / 2), M(v3(xc, ry + 0.024, z0 + 0.72), v3(0.11, 0.035, 0.11)), rgb('#f6f6f2'), 0.6);
  const cz = z0 + 1.02;
  const cy = roofAt(cz);
  const cxp = xc + 0.19;
  f.chrome.add(new THREE.CylinderGeometry(0.042, 0.048, 0.025, n), M(v3(cxp, cy + 0.004, cz), v3(1, 1, 1)), rgb('#b9bec4'));
  f.satin.add(new THREE.CylinderGeometry(0.022, 0.022, 0.3, n), M(v3(cxp, cy + 0.15, cz), v3(1, 1, 1)), rgb('#3a3b3f'));
  f.satin.add(new THREE.CylinderGeometry(0.0, 0.055, 0.035, n), M(v3(cxp, cy + 0.335, cz), v3(1, 1, 1)), rgb('#3a3b3f'));
  if (q) for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    strut(f.satin, v3(cxp + Math.cos(a) * 0.02, cy + 0.3, cz + Math.sin(a) * 0.02), v3(cxp + Math.cos(a) * 0.032, cy + 0.318, cz + Math.sin(a) * 0.032), 0.003, 0.003, rgb('#3a3b3f'));
  }

  // Heckklappe: Gummidichtung an den Seiten, Scharnier oben, Griff unten
  if (q) {
    const [, s1, s2] = o.seams;
    void s1;
    for (const sx of [-1, 1]) {
      const line: V[] = [];
      for (let k = 0; k <= 16; k++) {
        const t = s2 + (k / 16) * (0.95 - s2);
        const p = o.curve.getPointAt(t);
        line.push(v3(xc + sx * (w - 0.04), p.y, p.z));
      }
      // knapp über der Haut
      const out = line.map((p, i) => {
        const tg = o.curve.getTangentAt(s2 + (i / 16) * (0.95 - s2));
        const nn = v3(0, -tg.z, tg.y);
        if (nn.z < 0 && nn.y < 0.3) nn.negate();
        return p.addScaledVector(nn, 0.0025);
      });
      pipe(f.matte, out, 0.0028, 4, rubber, undefined, false);
    }
    const hp = o.curve.getPointAt(s2);
    strut(f.chrome, v3(xc - w + 0.05, hp.y + 0.006, hp.z), v3(xc + w - 0.05, hp.y + 0.006, hp.z), 0.012, 0.008, rgb('#d9dde1'), v3(0, 1, 0));
    const gp = o.curve.getPointAt(0.9);
    strut(f.chrome, v3(xc - 0.07, gp.y, gp.z + 0.012), v3(xc + 0.07, gp.y, gp.z + 0.012), 0.014, 0.012, rgb('#d9dde1'), v3(0, 1, 0));
  }

  // Rückleuchten, Blinker, Kennzeichen am Heck
  const backAt = (yy: number) => {
    let best = 0;
    for (const [z, y] of ol) if (Math.abs(y - yy) < 0.05 && z > best) best = z;
    return best;
  };
  for (const sx of [-1, 1]) {
    const zl = backAt(0.44);
    f.paint.add(new THREE.CylinderGeometry(0.034, 0.034, 0.016, n), M(v3(xc + sx * 0.25, 0.44, zl + 0.004), v3(1, 1, 1), new THREE.Euler(Math.PI / 2 + 0.25, 0, 0)), rgb('#d1161c'));
    f.paint.add(new THREE.CylinderGeometry(0.018, 0.018, 0.014, n), M(v3(xc + sx * 0.25, 0.52, backAt(0.52) + 0.002), v3(1, 1, 1), new THREE.Euler(Math.PI / 2 + 0.35, 0, 0)), rgb('#f39a1f'));
  }
  const pz = backAt(0.4) + 0.006;
  f.satin.add(new THREE.BoxGeometry(0.25, 0.065, 0.006), M(v3(xc, 0.4, pz), v3(1, 1, 1), new THREE.Euler(-0.18, 0, 0)), rgb('#f4f4f2'));
  const plate = q ? plateDecal(v3(xc, 0.4, pz + 0.0035), -0.18) : null;

  // Fahrgestell: Längsträger, Achse, Federn
  for (const sx of [-1, 1]) f.matte.add(new THREE.BoxGeometry(0.04, 0.04, len - 0.1), M(v3(xc + sx * 0.22, 0.27, z0 + len / 2), v3(1, 1, 1)), dark);
  f.matte.add(new THREE.CylinderGeometry(0.016, 0.016, wheelX * 2 + 0.02, 8), M(v3(xc, wheelR, axleZ), v3(1, 1, 1), new THREE.Euler(0, 0, Math.PI / 2)), dark);
  for (const sx of [-1, 1]) f.matte.add(new THREE.BoxGeometry(0.05, 0.05, 0.18), M(v3(xc + sx * 0.22, 0.255, axleZ), v3(1, 1, 1)), dark);
  // Kotflügel über den Rädern, mit Halter zur Wand
  for (const sx of [-1, 1]) {
    const pts: V[] = [];
    const K = q ? 18 : 7;
    for (let k = 0; k <= K; k++) {
      const a = (12 + (156 * k) / K) * (Math.PI / 180);
      pts.push(v3(xc + sx * wheelX, wheelR + Math.sin(a) * 0.285, axleZ + Math.cos(a) * 0.285));
    }
    const fr = pts.map((p) => { const c = v3(0, p.y - wheelR, p.z - axleZ).normalize(); return { s: v3(1, 0, 0), c }; });
    sweep(f.chrome, pts, fr, () => 0.085, () => 0.014, () => rgb('#cfd3d8'), shape('round', q ? 10 : 6));
    strut(f.chrome, v3(xc + sx * (w + 0.002), wheelR + 0.24, axleZ), v3(xc + sx * (wheelX - 0.03), wheelR + 0.27, axleZ), 0.012, 0.03, rgb('#b9bec4'), v3(0, 0, 1));
  }

  // Deichsel: A-Rahmen zur Spitze, ein Rohr zur Kupplung
  const apex = v3(0.02, 0.33, 0.4);
  const deich = rgb('#3a3c40');
  for (const sx of [-1, 1]) pipe(f.satin, [apex.clone(), v3(xc + sx * 0.2, 0.31, z0 + 0.04)], 0.015, n, deich);
  pipe(f.satin, [v3(0, 0.335, 0.03), v3(0.004, 0.334, 0.18), apex.clone()], 0.014, n, deich);
  f.matte.add(new THREE.BoxGeometry(0.05, 0.045, 0.07), M(v3(0, 0.335, 0.02), v3(1, 1, 1)), rubber);
  f.chrome.add(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 10), M(v3(0.02, 0.335, 0.0), v3(1, 1, 1), new THREE.Euler(0, 0, Math.PI / 2)), rgb('#b9bec4'));
  // Gasflasche auf der Deichsel
  const gb = v3(xc, 0.33, z0 - 0.1);
  f.satin.add(new THREE.BoxGeometry(0.2, 0.01, 0.16), M(gb, v3(1, 1, 1)), deich);
  revolve(f.paint, [[0.0005, -0.1, rgb('#2f62b3')], [0.05, -0.1, rgb('#2f62b3')], [0.056, -0.09, rgb('#2f62b3')], [0.056, 0.07, rgb('#2f62b3')], [0.044, 0.1, rgb('#2f62b3')], [0.016, 0.115, rgb('#b9bec4')], [0.0005, 0.12, rgb('#b9bec4')]], q ? 18 : 8, v3(0, 0, 0), false,
    new THREE.Matrix4().compose(gb.clone().add(v3(0, 0.105, 0)), new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), v3(0, 1, 0)), v3(1, 1, 1)));
  // Stützrad, hochgeklappt
  const jw = v3(0.07, 0.34, 0.3);
  f.chrome.add(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 10), M(jw.clone().add(v3(0, -0.04, 0)), v3(1, 1, 1)), rgb('#b9bec4'));
  f.matte.add(new THREE.CylinderGeometry(0.048, 0.048, 0.03, q ? 16 : 8), M(jw.clone().add(v3(0, -0.15, 0)), v3(1, 1, 1), new THREE.Euler(0, 0, Math.PI / 2)), rubber);
  strut(f.chrome, jw.clone().add(v3(0, 0.06, 0)), jw.clone().add(v3(0, 0.07, -0.06)), 0.008, 0.008, rgb('#b9bec4'));

  // Wimpel hinten links
  const fp0 = v3(xc - w - 0.012, 0.62, z0 + len - 0.32);
  const fp1 = v3(xc - w - 0.02, 1.68, z0 + len - 0.34);
  f.chrome.add(new THREE.BoxGeometry(0.012, 0.05, 0.03), M(fp0.clone().add(v3(0.006, 0.02, 0)), v3(1, 1, 1)), rgb('#b9bec4'));
  pipe(f.satin, [fp0, fp1], 0.0045, q ? 6 : 4, rgb('#f2f2ef'));
  pennant(f.paint, fp1, 0.22, 0.13, rgb('#ff6a1a'));

  const geo = merge([f.alu, f.door, f.paint, f.chrome, f.satin, f.matte])!;
  const hy = -CARAVAN.hitch.y;
  geo.translate(0, hy, 0);
  if (plate) plate.geo.translate(0, hy, 0);
  void pathFrames;
  return { geo, plate };
}

let plateMatC: THREE.MeshPhongMaterial | null = null;
/** Kennzeichen (erfunden) */
function plateDecal(c: V, tilt: number): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (!plateMatC) {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 64;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#f4f4f2';
    x.fillRect(0, 0, 256, 64);
    x.strokeStyle = '#16171a';
    x.lineWidth = 4;
    x.strokeRect(3, 3, 250, 58);
    x.fillStyle = '#1d4fa8';
    x.fillRect(5, 5, 22, 54);
    x.fillStyle = '#16171a';
    x.font = '700 40px "DIN Alternate", "Arial Narrow", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('BÜX 27', 140, 35);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    plateMatC = new THREE.MeshPhongMaterial({ map: tex, shininess: 30, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  }
  const g = new THREE.PlaneGeometry(0.24, 0.058);
  // Fläche zeigt nach hinten (+z), leicht nach oben gekippt
  g.applyMatrix4(M(c, v3(1, 1, 1), new THREE.Euler(tilt, 0, 0)));
  return { geo: g, mat: plateMatC };
}
