import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAR_EXTRA, Track } from './track';
import { BOOST, carBlock, handOf, spawnCar, stepCar } from './teamcar';

const day = '2026-10-31';

test('Teamwagen-Stellen: Straße dort breiter, sonst Normalbreite, regelmäßig verteilt', () => {
  const t = new Track(day);
  t.carZones = true;
  const zones: [number, number][] = [];
  let z = t.startZ;
  for (let k = 0; k < 4; k++) {
    const zn = t.nextCarZone(z);
    assert.ok(zn, `Stelle ${k + 1} nach ${Math.round(z)} m`);
    zones.push(zn!);
    z = zn![1] + 1;
  }
  for (let k = 1; k < zones.length; k++) assert.ok(zones[k][0] - zones[k - 1][0] > 1000, 'nicht zu dicht hintereinander');
  for (const [a, b] of zones) {
    const mid = (a + b) / 2;
    assert.ok(Math.abs(t.extraAt(mid) - CAR_EXTRA) < 0.05, `in der Mitte breit: ${t.extraAt(mid).toFixed(2)}`);
    assert.equal(t.carZoneAt(mid)?.[0], a);
    // kein Tunnel in der Stelle, keine Kehre im Teil, in dem der Wagen neben dir fährt
    for (let q = a; q < b; q += 4) { const s = t.segAt(q); assert.ok(!s.tunnel && !s.bridge, `kein Tunnel bei ${q}`); }
    for (let q = a + 44; q < b - 44; q += 4) assert.ok(!t.segAt(q).hairpin, `keine Kehre bei ${q}`);
  }
  // zwischen den Stellen Normalbreite
  const gapZ = (zones[0][1] + zones[1][0]) / 2;
  assert.equal(t.extraAt(gapZ), 0);
  // ohne Teamwagen-Stellen: keine Verbreiterung
  const t2 = new Track(day);
  assert.equal(t2.extraAt((zones[0][0] + zones[0][1]) / 2), 0);
  // mit wechselnder Breite (Abfahrt mit Fahrerfeld): an der Stelle noch breiter als sonst
  const t3 = new Track(day);
  t3.widthVar = true;
  t3.carZones = true;
  const zn3 = t3.nextCarZone(t3.startZ)!;
  assert.ok(t3.extraAt((zn3[0] + zn3[1]) / 2) > CAR_EXTRA - 0.05, 'breiter als die übliche Breite');
});

/** Fahrer fährt mit festem Tempo auf Spur x durch die Stelle; Ergebnis der Teamwagen-Begegnung */
function ride(x: number) {
  const t = new Track(day);
  t.carZones = true;
  const zn = t.nextCarZone(t.startZ)!;
  const p = { z: zn[0] + 20, x, v: 15 };
  const c = spawnCar(t, zn, p);
  const events: string[] = [];
  let minGap = Infinity;
  let blocked = false;
  for (let i = 0; i < 2000; i++) {
    const dt = 1 / 60;
    const r = stepCar(c, t, p, dt);
    if (r) events.push(r);
    if (r === 'got') p.v += BOOST;
    if (c.tow > 0) p.v = Math.max(p.v, c.v);
    if (carBlock(c, p.z, p.x) !== null) blocked = true;
    p.z += p.v * dt;
    minGap = Math.min(minGap, Math.abs(handOf(c).z - p.z));
    if (r === 'gone') break;
  }
  return { events, v: p.v, minGap, blocked, c };
}

test('Teamwagen: kommt neben dich, Flasche an der ausgestreckten Hand gibt +5 km/h, dann fällt er zurück', () => {
  // Hand: links neben dem Wagen auf der breiten Straße – dort fährt der Fahrer
  const t = new Track(day);
  t.carZones = true;
  const zn = t.nextCarZone(t.startZ)!;
  const hx = handOf({ ...spawnCar(t, zn, { z: zn[0] + 120, v: 15 }), reach: 1, z: zn[0] + 120 } as never).x;
  const got = ride(hx);
  assert.deepEqual(got.events, ['got', 'gone']);
  assert.ok(got.v > 15 + BOOST * 0.95, `schneller: ${(got.v * 3.6).toFixed(1)} km/h`);
  assert.ok(!got.blocked, 'an der Hand nicht gegen den Wagen');
  // ganz links: nicht erreichbar – verpasst, kein Schub
  const miss = ride(-2.2);
  assert.deepEqual(miss.events, ['missed', 'gone']);
  assert.equal(miss.v, 15);
});

test('Teamwagen: rechts gegen den Wagen wird abgedrängt (Lage links neben ihm)', () => {
  const t = new Track(day);
  t.carZones = true;
  const zn = t.nextCarZone(t.startZ)!;
  const c = spawnCar(t, zn, { z: zn[0] + 100, v: 15 });
  c.z = zn[0] + 100;
  const b = carBlock(c, c.z, c.x);
  assert.ok(b !== null && b < c.x - 0.9, 'abgedrängt nach links');
  assert.equal(carBlock(c, c.z + 6, c.x), null, 'vor dem Wagen frei');
});
