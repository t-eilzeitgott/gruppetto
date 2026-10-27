/**
 * Postrad der 60er: großer Frontgepäckträger am Steuerrohr mit lederner Posttasche voller Briefe und einer
 * Zeitung, hinten ein Träger mit zwei Packtaschen und einem verschnürten Päckchen, Scheinwerfer vorn am
 * Träger, Seitenläufer-Dynamo am Hinterrad mit Kabel, Doppelständer (hochgeklappt) und Rahmenschloss.
 * Alles steht mit dem Rahmen; gebaut in Radkoordinaten (vorn = −z).
 */
import * as THREE from 'three';
import { rgb } from './gloss';
import { M4, X, Z, along, pipe, prism, strut } from './prim3d';
import { BIKE_BB, hash3, v3, type BikeFit, type Ctx, type FrameOut, type V } from './bikebase';

const BB = BIKE_BB;

export function buildPostKit(x: Ctx, out: FrameOut, front: V, rear: V, fit: BikeFit) {
  const { q } = x;
  const { paint: P, metal: Mt, satin: St, matte: Ma } = x.f;
  const rack = rgb('#1b1c1e');
  const leather = rgb('#6e4428');
  const leatherDk = rgb('#4f2f1b');
  const brass = rgb('#c79b3e');
  const canvas = rgb('#e1a40c');
  const smooth = (ctrl: V[], k: number) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(k);
  const rr = (x0: number, x1: number, z0: number, z1: number, y: number, r: number) => {
    // Rahmen eines Trägers: Rechteck mit runden Ecken
    const c = (xc: number, zc: number, a0: number) => {
      const pts: V[] = [];
      for (let k = 0; k <= 3; k++) {
        const a = a0 + (k / 3) * (Math.PI / 2);
        pts.push(v3(xc + Math.cos(a) * r, y, zc + Math.sin(a) * r));
      }
      return pts;
    };
    return [...c(x1 - r, z0 + r, -Math.PI / 2), ...c(x1 - r, z1 - r, 0), ...c(x0 + r, z1 - r, Math.PI / 2), ...c(x0 + r, z0 + r, Math.PI), v3(x1 - r, y, z0)];
  };

  // ---- Frontgepäckträger: fest am Steuerrohr, vorn auf Streben zur Achse
  const fy = 0.792;
  const fz0 = -0.44;
  const fz1 = -0.83;
  const hw = 0.155;
  pipe(St, rr(-hw, hw, fz1, fz0, fy, 0.03), 0.0065, q ? 8 : 5, rack, X, false);
  for (const z of [-0.52, -0.6, -0.68, -0.76]) strut(St, v3(-hw + 0.004, fy, z), v3(hw - 0.004, fy, z), 0.014, 0.005, rack, Z);
  const hb = out.ax.at(0.79);
  St.add(new THREE.CylinderGeometry(0.024, 0.024, 0.03, q ? 14 : 6), along(hb, out.ax.u), rack);
  for (const sx of [-1, 1]) {
    pipe(St, [v3(sx * (hw - 0.02), fy, fz0 + 0.005), hb.clone().add(v3(sx * 0.016, -0.004, -0.012))], 0.0055, q ? 6 : 4, rack);
    pipe(St, [v3(sx * (hw - 0.012), fy - 0.004, fz1 + 0.03), front.clone().add(v3(sx * 0.062, 0.006, -0.006))], 0.006, q ? 6 : 4, rack);
  }

  // ---- Posttasche aus Leder, Deckel nach hinten umgeschlagen, oben Briefe und eine Zeitung
  const by0 = fy + 0.007;
  const by1 = by0 + 0.2;
  const bz0 = fz0 - 0.02;
  const bz1 = fz1 + 0.012;
  prism(Ma, [[bz0, by0], [bz1, by0], [bz1 - 0.008, by1 - 0.01], [bz1, by1], [bz0, by1], [bz0 + 0.008, by1 - 0.01]], 0.142, 0.014, leather);
  // umgeschlagener Deckel hinten, Riemen und Messingschnallen vorn
  prism(Ma, [[bz0 + 0.004, by1 + 0.004], [bz0 + 0.022, by1 + 0.004], [bz0 + 0.026, by1 - 0.12], [bz0 + 0.008, by1 - 0.13]], 0.136, 0.006, leatherDk);
  if (q) {
    for (const sx of [-1, 1]) {
      strut(Ma, v3(sx * 0.07, by0 + 0.02, bz1 - 0.0145), v3(sx * 0.07, by1 - 0.02, bz1 - 0.0145), 0.022, 0.004, leatherDk, X);
      St.add(new THREE.BoxGeometry(0.03, 0.026, 0.006), M4(sx * 0.07, by0 + 0.09, bz1 - 0.017), brass);
      St.add(new THREE.BoxGeometry(0.018, 0.016, 0.007), M4(sx * 0.07, by0 + 0.09, bz1 - 0.0172), leatherDk);
    }
    // Messingschild mit Lederrand
    St.add(new THREE.BoxGeometry(0.06, 0.035, 0.004), M4(0, by0 + 0.06, bz1 - 0.016), brass);
  }
  // Briefe: dicht gestaffelt, verschiedene Papiere, leicht schräg
  const papers = ['#f6f2e6', '#fbfaf5', '#e9e3cf', '#dfe9f2', '#f3dfe4', '#efe7c9', '#ffffff'].map(rgb);
  const NL = q ? 14 : 5;
  for (let i = 0; i < NL; i++) {
    const h = hash3(i, 3, 7);
    const z = bz0 - 0.03 - (i / (NL - 1)) * (bz0 - bz1 - 0.07);
    const xc = (hash3(i, 1, 2) - 0.5) * 0.12;
    const lift = 0.025 + h * 0.05;
    const tilt = (hash3(i, 5, 1) - 0.5) * 0.35;
    St.add(new THREE.BoxGeometry(0.16 + h * 0.05, 0.14, 0.0035), M4(xc, by1 - 0.07 + lift, z, tilt * 0.4, 0, tilt), papers[i % papers.length]);
    if (q && h > 0.4) St.add(new THREE.BoxGeometry(0.018, 0.022, 0.004), M4(xc + 0.05, by1 - 0.012 + lift, z - 0.0005, tilt * 0.4, 0, tilt), rgb(h > 0.7 ? '#c0392b' : '#2e6db4'));
  }
  // zusammengerollte Zeitung quer über den Briefen
  const np = v3(0.02, by1 + 0.028, (bz0 + bz1) / 2 - 0.03);
  St.add(new THREE.CylinderGeometry(0.024, 0.024, 0.31, q ? 14 : 6), M4(np.x, np.y, np.z, 0, 0.5, Math.PI / 2), rgb('#d9d6cc'));
  if (q) St.add(new THREE.CylinderGeometry(0.0245, 0.0245, 0.03, 14), M4(np.x, np.y, np.z, 0, 0.5, Math.PI / 2), rgb('#c0392b'));

  // ---- Scheinwerfer vorn am Träger, Kabel zum Dynamo
  const lampP = v3(0, fy - 0.045, fz1 - 0.035);
  strut(St, v3(0, fy - 0.004, fz1 + 0.006), lampP.clone().add(v3(0, 0.02, 0.02)), 0.012, 0.006, rack, X);
  Mt.add(new THREE.CylinderGeometry(0.042, 0.034, 0.07, q ? 20 : 8), along(lampP, v3(0, 0, -1)), x.silver);
  Mt.add(new THREE.CylinderGeometry(0.044, 0.044, 0.008, q ? 20 : 8), along(lampP.clone().add(v3(0, 0, -0.036)), v3(0, 0, -1)), x.silver);
  P.add(new THREE.CylinderGeometry(0.037, 0.037, 0.0085, q ? 20 : 8), along(lampP.clone().add(v3(0, 0, -0.0362)), v3(0, 0, -1)), rgb('#fff4d1'));
  if (q) St.add(new THREE.BoxGeometry(0.012, 0.01, 0.018), M4(lampP.x, lampP.y + 0.043, lampP.z + 0.01), x.dark);

  // ---- Gepäckträger hinten, zwei Packtaschen, Päckchen mit Schnur
  const ry = 0.762;
  const rz0 = 0.22;
  const rz1 = 0.64;
  const rw = 0.086;
  pipe(St, rr(-rw, rw, rz0, rz1, ry, 0.025), 0.0058, q ? 8 : 5, rack, X, false);
  for (const z of [0.32, 0.42, 0.52]) strut(St, v3(-rw + 0.004, ry, z), v3(rw - 0.004, ry, z), 0.012, 0.005, rack, Z);
  for (const sx of [-1, 1]) {
    pipe(St, [v3(sx * rw, ry - 0.004, rz1 - 0.03), rear.clone().add(v3(sx * 0.07, 0.004, 0.01))], 0.0058, q ? 6 : 4, rack);
    pipe(St, [v3(sx * rw, ry - 0.004, 0.43), rear.clone().add(v3(sx * 0.07, 0.004, -0.004))], 0.005, q ? 6 : 4, rack);
    pipe(St, [v3(sx * (rw - 0.01), ry - 0.003, rz0 + 0.01), out.ssTop.clone().lerp(rear, 0.08).add(v3(sx * 0.026, 0, 0))], 0.0045, q ? 6 : 4, rack);
    // Packtasche: Postgelb, schwarzer Lederdeckel mit Riemen
    const xc = sx * (rw + 0.05);
    prism(Ma, [[0.37, ry - 0.005], [0.635, ry - 0.005], [0.63, 0.445], [0.6, 0.43], [0.4, 0.43], [0.37, 0.445]], 0.042, 0.012, canvas, Ma, xc);
    prism(Ma, [[0.364, ry + 0.006], [0.64, ry + 0.006], [0.638, ry - 0.11], [0.366, ry - 0.11]], 0.045, 0.006, rgb('#1c1a18'), Ma, xc);
    if (q) {
      for (const z of [0.43, 0.575]) {
        strut(Ma, v3(xc + sx * 0.046, ry - 0.1, z), v3(xc + sx * 0.0455, ry - 0.2, z), 0.018, 0.003, rgb('#1c1a18'), Z);
        St.add(new THREE.BoxGeometry(0.004, 0.018, 0.022), M4(xc + sx * 0.048, ry - 0.165, z), brass);
      }
    }
  }
  const pk = v3(0, ry + 0.06, 0.47);
  St.add(new THREE.BoxGeometry(0.19, 0.11, 0.22), M4(pk.x, pk.y, pk.z), rgb('#b4864f'));
  if (q) {
    const twine = rgb('#efe6cf');
    St.add(new THREE.BoxGeometry(0.192, 0.112, 0.006), M4(pk.x, pk.y, pk.z), twine);
    St.add(new THREE.BoxGeometry(0.006, 0.112, 0.222), M4(pk.x, pk.y, pk.z), twine);
    St.add(new THREE.BoxGeometry(0.07, 0.002, 0.05), M4(pk.x + 0.045, pk.y + 0.056, pk.z + 0.05), rgb('#fbfaf5'));
    for (const k of [0, 1, 2]) St.add(new THREE.BoxGeometry(0.05, 0.0024, 0.003), M4(pk.x + 0.045, pk.y + 0.056, pk.z + 0.036 + k * 0.01), rgb('#3a3a3a'));
  }
  // Rücklicht am Träger
  fit.lamp = v3(0, ry - 0.016, rz1 + 0.012);

  // ---- Seitenläufer-Dynamo an der rechten Sitzstrebe, Rolle an der Reifenflanke; Kabel nach vorn
  const dyn0 = v3(0.064, 0.66, 0.255);
  const dyn1 = v3(0.03, 0.606, 0.279);
  const dd = dyn1.clone().sub(dyn0).normalize();
  Mt.add(new THREE.CylinderGeometry(0.016, 0.018, 0.064, q ? 14 : 6), along(dyn0.clone().lerp(dyn1, 0.4), dd), x.silver);
  St.add(new THREE.CylinderGeometry(0.009, 0.009, 0.012, q ? 12 : 6), along(dyn1, dd), x.dark);
  strut(St, dyn0.clone().add(v3(-0.012, 0.012, -0.012)), out.ssTop.clone().lerp(rear, 0.42).add(v3(0.032, 0, 0)), 0.01, 0.01, x.dark);
  if (q) {
    const cab = smooth([dyn0.clone().add(v3(0, 0.03, -0.01)), v3(0.02, 0.76, 0.17), v3(0.016, 0.82, 0.02), v3(0.014, 0.83, -0.26), out.ax.at(0.8).add(v3(0.018, 0, -0.01)), v3(0.03, fy - 0.01, fz0 - 0.06), v3(0.02, fy - 0.012, fz1 + 0.02), lampP.clone().add(v3(0.012, 0.01, 0.03))], 40);
    pipe(Ma, cab, 0.0018, 4, rgb('#141414'));
  }

  // ---- Doppelständer, hochgeklappt hinter dem Tretlager; Rahmenschloss an den Sitzstreben
  const piv = BB.clone().add(v3(0, -0.035, 0.07));
  Mt.add(new THREE.CylinderGeometry(0.013, 0.013, 0.09, q ? 12 : 6), M4(piv.x, piv.y, piv.z, 0, 0, Math.PI / 2), x.silver);
  for (const sx of [-1, 1]) pipe(Mt, [piv.clone().add(v3(sx * 0.03, 0, 0)), v3(sx * 0.052, 0.31, 0.27), v3(sx * 0.07, 0.322, 0.3)], 0.0075, q ? 8 : 4, x.silver);
  if (q) {
    const lock = out.ssTop.clone().lerp(rear, 0.5);
    St.add(new THREE.BoxGeometry(0.03, 0.05, 0.026), M4(0.045, lock.y - 0.04, lock.z + 0.01, 0.3), x.dark);
    Mt.add(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 10), M4(0.061, lock.y - 0.04, lock.z + 0.01, 0, 0, Math.PI / 2), x.silver);
  }
}
