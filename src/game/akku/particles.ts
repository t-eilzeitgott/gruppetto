/**
 * Partikel für „Akku leer!“: Staub, Splitter, Scherben, Funken, Wasser, Schaum, Sahne, Konfetti.
 * Feste Puffer statt Objekte – kein Speicherhunger, auch bei vielen Trümmern.
 */

export const P = {
  Puff: 0,
  Chip: 1,
  Shard: 2,
  Spark: 3,
  Drop: 4,
  Foam: 5,
  Cream: 6,
  Confetti: 7,
  Ring: 8,
  Smoke: 9,
  Leaf: 10,
  Bolt: 11,
  Star: 12,
} as const;
export type PType = (typeof P)[keyof typeof P];

const MAX = 700;

export class Particles {
  readonly x = new Float32Array(MAX);
  readonly y = new Float32Array(MAX);
  readonly vx = new Float32Array(MAX);
  readonly vy = new Float32Array(MAX);
  readonly life = new Float32Array(MAX);
  readonly max = new Float32Array(MAX);
  readonly size = new Float32Array(MAX);
  readonly rot = new Float32Array(MAX);
  readonly vr = new Float32Array(MAX);
  readonly grav = new Float32Array(MAX);
  readonly drag = new Float32Array(MAX);
  readonly type = new Uint8Array(MAX);
  readonly color: string[] = new Array(MAX).fill('#fff');
  /** Boden für Abpraller (y), -Infinity = keiner */
  floor = 0;
  count = 0;

  spawn(type: PType, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, grav = 0, drag = 0, rot = 0, vr = 0) {
    let i = this.count;
    if (i >= MAX) {
      // ältesten (kürzesten Rest) ersetzen
      let best = 0;
      let bestL = Infinity;
      for (let k = 0; k < MAX; k += 7) if (this.life[k] < bestL) { bestL = this.life[k]; best = k; }
      i = best;
    } else this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.color[i] = color;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.rot[i] = rot;
    this.vr[i] = vr;
    this.type[i] = type;
  }

  update(dt: number, floorAt: (x: number) => number) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const d = this.drag[i];
      if (d > 0) {
        const f = Math.exp(-d * dt);
        this.vx[i] *= f;
        this.vy[i] *= f;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      const t = this.type[i];
      if (this.grav[i] > 0 && t !== P.Spark && t !== P.Bolt) {
        const fl = floorAt(this.x[i]);
        if (this.y[i] < fl) {
          this.y[i] = fl;
          if (t === P.Cream || t === P.Drop) {
            // kleben bleiben / versickern
            this.vx[i] = 0;
            this.vy[i] = 0;
            this.grav[i] = 0;
            this.life[i] = Math.min(this.life[i], t === P.Cream ? 2.5 : 0.35);
          } else {
            this.vy[i] = -this.vy[i] * 0.35;
            this.vx[i] *= 0.6;
            this.vr[i] *= 0.5;
            if (Math.abs(this.vy[i]) < 0.6) { this.vy[i] = 0; this.grav[i] = 0; this.vr[i] = 0; this.life[i] = Math.min(this.life[i], 1.2); }
          }
        }
      }
    }
    this.count = n;
  }

  private copy(from: number, to: number) {
    this.x[to] = this.x[from];
    this.y[to] = this.y[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.size[to] = this.size[from];
    this.rot[to] = this.rot[from];
    this.vr[to] = this.vr[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.type[to] = this.type[from];
    this.color[to] = this.color[from];
  }

  clear() {
    this.count = 0;
  }
}
