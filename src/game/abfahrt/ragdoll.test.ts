import { test } from 'node:test';
import assert from 'node:assert/strict';
import { J, JOINTS, Ragdoll } from './ragdoll';

/** Fahrhaltung grob: Becken 0.95 m, Oberkörper nach vorn (−z) */
function pose(): Float32Array {
  const pts: [number, number, number][] = [
    [0, 0.95, 0], [0, 1.25, -0.4], [0, 1.4, -0.6],
    [-0.2, 1.25, -0.45], [-0.22, 1.05, -0.65], [-0.22, 0.95, -0.85],
    [0.2, 1.25, -0.45], [0.22, 1.05, -0.65], [0.22, 0.95, -0.85],
    [-0.12, 0.92, 0], [-0.12, 0.6, -0.25], [-0.12, 0.25, -0.1],
    [0.12, 0.92, 0], [0.12, 0.6, -0.25], [0.12, 0.25, -0.1],
  ];
  return new Float32Array(pts.flat());
}

test('Ragdoll fällt, rutscht aus und bleibt liegen – Knochen halten ihre Länge', () => {
  const start = pose();
  const d = new Ragdoll(start, [0, 0, -15], [0, -1], 1, 1, 0.37);
  const len = (p: Float32Array, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  const thigh = len(start, J.hipL, J.knL);
  for (let i = 0; i < 60 * 8; i++) d.step(1 / 60, () => 0, [d]);
  for (const v of d.p) assert.ok(Number.isFinite(v));
  assert.ok(d.y < 0.3, `Becken liegt (y=${d.y})`);
  assert.ok(d.z < -3 && d.z > -30, `rutscht ein Stück (z=${d.z})`);
  for (let i = 0; i < JOINTS; i++) assert.ok(d.p[i * 3 + 1] > -0.01, 'nichts im Boden');
  assert.ok(Math.abs(len(d.p, J.hipL, J.knL) - thigh) < 0.05, 'Oberschenkel bleibt gleich lang');
  assert.ok(d.rest, 'liegt still');
});
