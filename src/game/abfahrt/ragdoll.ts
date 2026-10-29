/**
 * Ragdoll für Stürze (WebGPU-Abfahrt): der Körper des Fahrers als Gliederpuppe aus 15 Punkten (Verlet-Integration)
 * mit festen Knochenlängen, steifem Rumpf, Beuge-Grenzen an Knien und Ellbogen, Schwerkraft, Aufprall und
 * Rutschreibung auf dem Asphalt. Liegende stoßen sich gegenseitig (wer in einen Haufen fährt, fällt darüber).
 *
 * Rein rechnerisch (Weltkoordinaten in Metern, kein three.js): Die Darstellung liest die Punkte und setzt daraus
 * die Knochen des Fahrermodells (RiderModel.ragdollPose).
 */

/** Gelenke (Index in den Punktlisten) */
export const J = {
  pelvis: 0, chest: 1, head: 2,
  shL: 3, elL: 4, haL: 5, shR: 6, elR: 7, haR: 8,
  hipL: 9, knL: 10, anL: 11, hipR: 12, knR: 13, anR: 14,
} as const;
export const JOINTS = 15;

/** Radius je Gelenk (Kollision mit dem Boden und anderen Körpern) */
const RAD = [0.13, 0.14, 0.12, 0.08, 0.06, 0.05, 0.08, 0.06, 0.05, 0.08, 0.07, 0.06, 0.08, 0.07, 0.06];
/** Masse je Gelenk (Anteil) – schwerer Rumpf, leichte Hände */
const MASS = [3, 3, 1.2, 1, 0.6, 0.3, 1, 0.6, 0.3, 1.2, 1, 0.5, 1.2, 1, 0.5];

const G = 9.81;
/** Gleitreibung auf Asphalt (Kleidung) */
const MU = 0.55;
const SUB = 1 / 120;

/** Bodenhöhe an (x, z) */
export type Ground = (x: number, z: number) => number;

interface Link { a: number; b: number; len: number; min?: boolean; k: number }

export class Ragdoll {
  /** aktuelle und vorige Lage (x, y, z je Gelenk) */
  readonly p = new Float32Array(JOINTS * 3);
  private q = new Float32Array(JOINTS * 3);
  private links: Link[] = [];
  private acc = 0;
  /** Sekunden seit dem Sturz */
  t = 0;
  /** liegt still */
  rest = false;
  private still = 0;

  /**
   * start: Gelenke in der Fahrhaltung (Welt); vel: Tempo des Fahrers (m/s, Welt); fwd: Fahrtrichtung (Einheitsvektor
   * x, z); kick: wie heftig (0–1). Das Rad steht schlagartig: Füße und Hüfte bleiben zurück, der Oberkörper fliegt
   * weiter – so kippt der Körper über den Lenker.
   */
  constructor(start: Float32Array, vel: [number, number, number], fwd: [number, number], kick: number, side: number, seed: number) {
    this.p.set(start);
    const len = (a: number, b: number) => Math.hypot(start[a * 3] - start[b * 3], start[a * 3 + 1] - start[b * 3 + 1], start[a * 3 + 2] - start[b * 3 + 2]);
    const link = (a: number, b: number, k = 1) => this.links.push({ a, b, len: len(a, b), k });
    const minLink = (a: number, b: number, l: number) => this.links.push({ a, b, len: l, min: true, k: 0.5 });
    // Knochen
    link(J.pelvis, J.chest); link(J.chest, J.head);
    link(J.chest, J.shL); link(J.chest, J.shR); link(J.shL, J.shR);
    link(J.shL, J.elL); link(J.elL, J.haL); link(J.shR, J.elR); link(J.elR, J.haR);
    link(J.pelvis, J.hipL); link(J.pelvis, J.hipR); link(J.hipL, J.hipR);
    link(J.hipL, J.knL); link(J.knL, J.anL); link(J.hipR, J.knR); link(J.knR, J.anR);
    // Rumpf steif (Kasten aus Schultern und Hüften), Kopf auf den Schultern
    link(J.hipL, J.shL, 0.9); link(J.hipR, J.shR, 0.9); link(J.hipL, J.shR, 0.9); link(J.hipR, J.shL, 0.9);
    link(J.pelvis, J.shL, 0.9); link(J.pelvis, J.shR, 0.9);
    link(J.head, J.shL, 0.5); link(J.head, J.shR, 0.5); link(J.head, J.pelvis, 0.4);
    // Beuge-Grenzen: Knie und Ellbogen klappen nicht ganz zusammen, Arme/Beine nicht durch den Rumpf
    minLink(J.hipL, J.anL, 0.32); minLink(J.hipR, J.anR, 0.32);
    minLink(J.shL, J.haL, 0.2); minLink(J.shR, J.haR, 0.2);
    minLink(J.anL, J.anR, 0.12); minLink(J.knL, J.knR, 0.12);
    minLink(J.haL, J.chest, 0.12); minLink(J.haR, J.chest, 0.12);
    minLink(J.head, J.knL, 0.35); minLink(J.head, J.knR, 0.35);
    // Startgeschwindigkeit (als Verschiebung der vorigen Lage)
    const r = (k: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const [fx, fz] = fwd;
    const sx = -fz, sz = fx; // rechts
    for (let i = 0; i < JOINTS; i++) {
      // Beine und Becken bleiben am Rad hängen, der Oberkörper fliegt weiter und etwas hoch
      const upper = i === J.chest || i === J.head || (i >= J.shL && i <= J.haR);
      const legs = i >= J.hipL;
      const keep = upper ? 1.0 : legs ? 0.55 : 0.75;
      const up = (upper ? 1.6 : 2.3) * kick + 0.4;
      const lat = side * (0.5 + 0.8 * r(i)) * kick;
      const vx = vel[0] * keep + sx * lat, vy = vel[1] * keep + up, vz = vel[2] * keep + sz * lat;
      // Hände greifen nach vorn
      const reach = i === J.haL || i === J.haR ? 1.2 * kick : 0;
      this.q[i * 3] = start[i * 3] - (vx + fx * reach) * SUB;
      this.q[i * 3 + 1] = start[i * 3 + 1] - vy * SUB;
      this.q[i * 3 + 2] = start[i * 3 + 2] - (vz + fz * reach) * SUB;
    }
  }

  /** Mittelpunkt (Becken) */
  get x() { return this.p[0]; }
  get y() { return this.p[1]; }
  get z() { return this.p[2]; }

  /** Schritt (feste Teilschritte); others: andere liegende Körper (stoßen sich) */
  step(dt: number, ground: Ground, others: Ragdoll[]) {
    if (dt <= 0) return;
    this.t += dt;
    if (this.rest) return;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) {
      this.acc -= SUB;
      this.sub(ground, others);
    }
  }

  private sub(ground: Ground, others: Ragdoll[]) {
    const p = this.p, q = this.q;
    const h = SUB;
    let motion = 0;
    // Verlet: Schwerkraft, leichte Luftdämpfung
    for (let i = 0; i < JOINTS; i++) {
      const o = i * 3;
      const vx = (p[o] - q[o]) * 0.998, vy = (p[o + 1] - q[o + 1]) * 0.998, vz = (p[o + 2] - q[o + 2]) * 0.998;
      q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
      p[o] += vx; p[o + 1] += vy - G * h * h; p[o + 2] += vz;
      motion += vx * vx + vy * vy + vz * vz;
    }
    // Bindungen (einige Durchläufe), Boden und andere Körper dazwischen
    for (let it = 0; it < 6; it++) {
      for (const L of this.links) {
        const a = L.a * 3, b = L.b * 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (L.min && d >= L.len) continue;
        const wa = 1 / MASS[L.a], wb = 1 / MASS[L.b];
        const f = ((d - L.len) / d) * L.k / (wa + wb);
        p[a] += dx * f * wa; p[a + 1] += dy * f * wa; p[a + 2] += dz * f * wa;
        p[b] -= dx * f * wb; p[b + 1] -= dy * f * wb; p[b + 2] -= dz * f * wb;
      }
      if (it % 2 === 1) this.collide(ground, others);
    }
    // liegt still?
    this.still = motion < JOINTS * 1e-7 ? this.still + h : 0;
    if (this.still > 0.6 && this.t > 1.5) this.rest = true;
  }

  private collide(ground: Ground, others: Ragdoll[]) {
    const p = this.p, q = this.q;
    for (let i = 0; i < JOINTS; i++) {
      const o = i * 3;
      const r = RAD[i];
      // andere Körper: Kugel gegen Kugel (nur die großen Teile der anderen), der Ankommende wird weggedrückt
      for (const B of others) {
        if (B === this || Math.abs(B.p[2] - p[o + 2]) > 2.5 || Math.abs(B.p[0] - p[o]) > 2.5) continue;
        for (const j of [J.pelvis, J.chest, J.head, J.knL, J.knR, J.hipL, J.hipR]) {
          const b = j * 3;
          const dx = p[o] - B.p[b], dy = p[o + 1] - B.p[b + 1], dz = p[o + 2] - B.p[b + 2];
          const rr = r + RAD[j];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-10) continue;
          const d = Math.sqrt(d2);
          const push = (rr - d) / d;
          p[o] += dx * push; p[o + 1] += dy * push; p[o + 2] += dz * push;
        }
      }
      // Boden: nicht hinein, beim Aufprall wenig Rückprall, beim Rutschen Reibung (Coulomb)
      const gy = ground(p[o], p[o + 2]) + r;
      if (p[o + 1] < gy) {
        const pen = gy - p[o + 1];
        p[o + 1] = gy;
        const vy = p[o + 1] - q[o + 1];
        if (vy < 0) q[o + 1] = p[o + 1] + vy * 0.25;
        const vx = p[o] - q[o], vz = p[o + 2] - q[o + 2];
        const vt = Math.hypot(vx, vz);
        if (vt > 1e-9) {
          // Reibung je Teilschritt: Normalkraft ~ Schwerkraft plus Eindringen (harter Aufprall bremst stärker)
          const slow = Math.min(vt, MU * (G * SUB * SUB + pen * 0.6));
          q[o] += (vx / vt) * slow;
          q[o + 2] += (vz / vt) * slow;
        }
      }
    }
  }
}
