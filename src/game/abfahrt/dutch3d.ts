/**
 * Hollandrad: Weidenkorb auf einem Träger vor dem Steuerrohr (geflochtene Wände aus Stäben und Bändern, Rand,
 * darin Tulpen mit Stielen und Blättern), Scheinwerfer an der Gabelkrone, Gepäckträger hinten mit Spanngurt,
 * Kleiderschutz aus bunten Schnüren über dem Hinterrad, Ringschloss und Seitenständer.
 * Alles steht mit dem Rahmen; Radkoordinaten (vorn = −z).
 */
import * as THREE from 'three';
import { rgb, type C3 } from './gloss';
import { M4, X, Z, along, pipe, strut } from './prim3d';
import { BIKE_BB, hash3, v3, type BikeFit, type Ctx, type FrameOut, type V } from './bikebase';

const BB = BIKE_BB;

export function buildDutchKit(x: Ctx, out: FrameOut, front: V, rear: V, fit: BikeFit) {
  const { q } = x;
  const { paint: P, metal: Mt, satin: St, matte: Ma } = x.f;
  const rack = rgb('#161617');
  const wick = rgb('#b98a4c');
  const wickDk = rgb('#8a6233');

  // ---- Korb vor dem Steuerrohr auf einem kleinen Träger (Streben zur Achse)
  const bx = 0.155;
  const bz0 = -0.49;
  const bz1 = -0.75;
  const by0 = 0.725;
  const by1 = 0.915;
  const bzc = (bz0 + bz1) / 2;
  // Boden
  Ma.add(new THREE.BoxGeometry(bx * 2, 0.012, bz0 - bz1), M4(0, by0, bzc), wickDk);
  // Wände: senkrechte Stäbe und waagrechte Flechtbänder
  const walls: [V, V][] = [[v3(-bx, 0, bz0), v3(bx, 0, bz0)], [v3(bx, 0, bz0), v3(bx, 0, bz1)], [v3(bx, 0, bz1), v3(-bx, 0, bz1)], [v3(-bx, 0, bz1), v3(-bx, 0, bz0)]];
  for (const [a, b] of walls) {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    // Wand als dünne Platte (dunkel), davor die Flechtbänder hell und abwechselnd versetzt
    const mid = a.clone().lerp(b, 0.5);
    Ma.add(new THREE.BoxGeometry(Math.abs(dir.x) * len + 0.008, by1 - by0, Math.abs(dir.z) * len + 0.008), M4(mid.x, (by0 + by1) / 2, mid.z), wickDk);
    const out2 = v3(-dir.z, 0, dir.x);
    if (out2.dot(mid.clone().setY(0).sub(v3(0, 0, bzc))) < 0) out2.negate();
    const rows = q ? 7 : 3;
    for (let r = 0; r < rows; r++) {
      const y = by0 + 0.014 + ((by1 - by0 - 0.028) * (r + 0.5)) / rows;
      const off = (r % 2 ? 0.5 : 0) * 0.04;
      const segs = Math.max(2, Math.round(len / 0.04));
      for (let s = 0; s < segs; s++) {
        const t0 = (s * len) / segs + off * 0.25;
        const t1 = t0 + (len / segs) * 0.78;
        if (t1 > len) continue;
        const p0 = a.clone().addScaledVector(dir, t0).addScaledVector(out2, 0.006).setY(y);
        const p1 = a.clone().addScaledVector(dir, t1).addScaledVector(out2, 0.006).setY(y);
        strut(Ma, p0, p1, 0.016, 0.008, (s + r) % 2 ? wick : rgb('#c79a5c'), v3(0, 1, 0));
      }
    }
  }
  // Rand oben (gewickelt) und Träger darunter
  pipe(Ma, [v3(-bx, by1, bz0), v3(bx, by1, bz0), v3(bx, by1, bz1), v3(-bx, by1, bz1), v3(-bx, by1, bz0)], 0.009, q ? 8 : 5, wick, X, false);
  pipe(St, [v3(-bx + 0.02, by0 - 0.012, bz0), v3(bx - 0.02, by0 - 0.012, bz0), v3(bx - 0.02, by0 - 0.012, bz1), v3(-bx + 0.02, by0 - 0.012, bz1), v3(-bx + 0.02, by0 - 0.012, bz0)], 0.006, q ? 6 : 4, rack, X, false);
  const hb = out.ax.at(0.8);
  for (const sx of [-1, 1]) {
    pipe(St, [v3(sx * (bx - 0.03), by0 - 0.012, bz0), hb.clone().add(v3(sx * 0.016, -0.004, -0.014))], 0.0055, q ? 6 : 4, rack);
    pipe(St, [v3(sx * (bx - 0.02), by0 - 0.014, bz1 + 0.03), front.clone().add(v3(sx * 0.062, 0.006, -0.006))], 0.006, q ? 6 : 4, rack);
  }
  St.add(new THREE.CylinderGeometry(0.024, 0.024, 0.03, q ? 14 : 6), along(hb, out.ax.u), rack);

  // ---- Tulpen: Stiele, Blätter, Blüten in Rot, Gelb, Rosa, Orange
  const petals = ['#d6202a', '#f4c20d', '#ef6fa0', '#ff8a1e', '#d6202a', '#f8f1e4', '#f4c20d', '#c2185b', '#ff8a1e'].map(rgb);
  const green = rgb('#3f8a3a');
  const NT = q ? 9 : 4;
  for (let i = 0; i < NT; i++) {
    const hx = (hash3(i, 2, 9) - 0.5) * (bx * 1.5);
    const hz = bzc + (hash3(i, 7, 3) - 0.5) * 0.18;
    const h = 0.1 + hash3(i, 5, 5) * 0.09;
    const lean = v3((hash3(i, 1, 1) - 0.5) * 0.08, 0, (hash3(i, 4, 4) - 0.5) * 0.08);
    const base = v3(hx, by1 - 0.06, hz);
    const top = base.clone().add(v3(0, h + 0.06, 0)).add(lean);
    pipe(St, [base, base.clone().lerp(top, 0.5).add(lean.clone().multiplyScalar(0.3)), top], 0.0035, q ? 5 : 3, green);
    // Blatt: schmal, schräg nach außen
    if (q) strut(St, base.clone().add(v3(0, 0.05, 0)), base.clone().add(v3(lean.x * 2 + 0.02, 0.14, lean.z * 2)), 0.004, 0.022, rgb('#4f9a46'), Z, 0.002, 0.006);
    // Blüte: geschlossener Kelch
    const c: C3 = petals[i % petals.length];
    P.add(new THREE.CylinderGeometry(0.019, 0.014, 0.036, q ? 10 : 6), M4(top.x, top.y + 0.016, top.z), c);
    P.add(new THREE.SphereGeometry(0.0145, q ? 10 : 6, q ? 6 : 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M4(top.x, top.y - 0.002, top.z), c);
  }

  // ---- Scheinwerfer an der Gabelkrone
  const lampP = out.crown.clone().addScaledVector(out.ax.n, -0.06).add(v3(0, -0.004, 0));
  strut(St, out.crown.clone().addScaledVector(out.ax.n, -0.02), lampP.clone().add(v3(0, 0, 0.02)), 0.01, 0.006, rack, X);
  Mt.add(new THREE.CylinderGeometry(0.036, 0.028, 0.06, q ? 18 : 8), along(lampP, v3(0, 0, -1)), x.silver);
  P.add(new THREE.CylinderGeometry(0.031, 0.031, 0.006, q ? 18 : 8), along(lampP.clone().add(v3(0, 0, -0.031)), v3(0, 0, -1)), rgb('#fff4d1'));

  // ---- Gepäckträger hinten, Spanngurt
  const ry = 0.775;
  const rz0 = 0.2;
  const rz1 = 0.64;
  const rw = 0.08;
  pipe(St, [v3(-rw, ry, rz0), v3(-rw, ry, rz1), v3(rw, ry, rz1), v3(rw, ry, rz0), v3(-rw, ry, rz0)], 0.0062, q ? 8 : 5, rack, X, false);
  for (const z of [0.32, 0.44, 0.56]) strut(St, v3(-rw, ry, z), v3(rw, ry, z), 0.012, 0.005, rack, Z);
  for (const sx of [-1, 1]) {
    pipe(St, [v3(sx * rw, ry - 0.004, rz1 - 0.03), rear.clone().add(v3(sx * 0.07, 0.004, 0.01))], 0.0058, q ? 6 : 4, rack);
    pipe(St, [v3(sx * rw, ry - 0.004, 0.42), rear.clone().add(v3(sx * 0.07, 0.004, -0.004))], 0.005, q ? 6 : 4, rack);
    pipe(St, [v3(sx * (rw - 0.01), ry - 0.003, rz0 + 0.01), out.ssTop.clone().lerp(rear, 0.08).add(v3(sx * 0.026, 0, 0))], 0.0045, q ? 6 : 4, rack);
  }
  // Spanngurt (rot) längs über den Träger
  for (const sx of [-0.035, 0.035]) pipe(Ma, [v3(sx, ry + 0.008, rz0 + 0.02), v3(sx, ry + 0.01, rz1 - 0.06), v3(sx, ry - 0.03, rz1 + 0.004)], 0.004, 4, rgb('#d6202a'));
  fit.lamp = v3(0, ry - 0.016, rz1 + 0.012);

  // ---- Kleiderschutz: Schnüre fächerförmig über dem Hinterrad (beide Seiten), abwechselnd rot und weiß
  const strings = q ? 13 : 5;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < strings; i++) {
      const a = ((14 + (i * 92) / (strings - 1)) * Math.PI) / 180;
      const inner = rear.clone().add(v3(sx * 0.07, Math.sin(a) * 0.085, Math.cos(a) * 0.085));
      const outer = rear.clone().add(v3(sx * 0.04, Math.sin(a) * 0.33, Math.cos(a) * 0.33));
      pipe(Ma, [inner, outer], 0.0016, 3, rgb(i % 2 ? '#f4f1ea' : '#d6202a'), X, false);
    }
    // Halteleiste am Schutzblech
    if (q) {
      const pts: V[] = [];
      for (let k = 0; k <= 8; k++) {
        const a = ((14 + (k * 92) / 8) * Math.PI) / 180;
        pts.push(rear.clone().add(v3(sx * 0.04, Math.sin(a) * 0.335, Math.cos(a) * 0.335)));
      }
      pipe(St, pts, 0.004, 5, rgb('#1c1c1d'), X, false);
    }
  }

  // ---- Ringschloss vor dem Hinterrad an den Sitzstreben, Seitenständer hochgeklappt
  const lock = out.ssTop.clone().lerp(rear, 0.5).add(v3(0, -0.02, -0.03));
  St.add(new THREE.BoxGeometry(0.11, 0.05, 0.03), M4(lock.x, lock.y, lock.z, 0.5), x.dark);
  if (q) Mt.add(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 10), M4(0.056, lock.y, lock.z, 0, 0, Math.PI / 2), x.silver);
  pipe(Mt, [BB.clone().add(v3(-0.05, -0.02, 0.1)), v3(-0.07, 0.24, 0.33), v3(-0.075, 0.25, 0.36)], 0.0075, q ? 8 : 4, x.silver);
}
