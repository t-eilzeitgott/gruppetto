import { test } from 'node:test';
import assert from 'node:assert/strict';

// vorgedrehte Uhr (die Messfahrt liest performance.now; der Wechseltest schaltet nach Wanduhr) – die echte läuft
// darunter weiter (der Testläufer braucht sie)
const realNow = performance.now.bind(performance);
let ahead = 0;
performance.now = () => realNow() + ahead;
(globalThis as { window?: unknown }).window = { setTimeout: () => 0 };
const { Perf3D, AB_PERIOD_S } = await import('./perf3d.ts');

const FRAME = 1000 / 60;
function frameInfo(dt: number, phase = 'playing') {
  return { dt, period: FRAME, calls: 150, tris: 200000, progs: 90, quality: 1, px: 1, range: 6, z: 100, v: 14, phase, place: 0, riders: 3, screen: FRAME / 2, off: 0 };
}

test('Wechseltest: A und B wechseln alle 20 s, je Variante zählen nur Bilder ab zwei Sekunden nach dem Wechsel', () => {
  const P = new Perf3D();
  const applied: boolean[] = [];
  P.startRec({ art: 'Test' }, { name: 'Probe', labels: ['A', 'B'], apply: (b) => applied.push(b) });
  // drei Abschnitte: A, B, A – in B jedes zehnte Bild ein Ruckler (33 ms)
  const t0 = performance.now();
  for (let i = 0; performance.now() - t0 < 3 * AB_PERIOD_S * 1000 - 100; i++) {
    const seg = Math.floor((performance.now() - t0) / 1000 / AB_PERIOD_S);
    const hitch = seg === 1 && i % 10 === 0;
    const dt = hitch ? 2 * FRAME : FRAME;
    ahead += dt;
    P.begin(performance.now());
    P.end(frameInfo(dt));
  }
  const r = P.stopRec();
  assert.ok(r);
  assert.deepEqual(applied, [false, true, false, false], 'A, B, A – am Ende wieder A');
  const ab = r.summary.ab!;
  assert.equal(ab.length, 2);
  assert.equal(ab[0].label, 'A');
  assert.equal(ab[1].label, 'B');
  // A: gut 36 s (zwei Abschnitte abzüglich der ersten zwei Sekunden), keine Ruckler; B: knapp 18 s, 6 Ruckler je 2 s
  assert.ok(ab[0].s > 34 && ab[0].s < 38, `A ${ab[0].s} s`);
  assert.ok(ab[1].s > 16 && ab[1].s < 19, `B ${ab[1].s} s`);
  assert.equal(ab[0].hitchesPerMin, 0);
  assert.ok(ab[1].hitchesPerMin > 300 && ab[1].hitchesPerMin < 400, `B ${ab[1].hitchesPerMin} Ruckler/min`);
  assert.ok(r.full.includes('"wechseltest"'));
});

test('ohne Wechseltest: keine Varianten im Bericht', () => {
  const P = new Perf3D();
  P.startRec({ art: 'Test' });
  for (let i = 0; i < 200; i++) { ahead += FRAME; P.begin(performance.now()); P.end(frameInfo(FRAME)); }
  const r = P.stopRec();
  assert.ok(r);
  assert.equal(r.summary.ab, null);
});
