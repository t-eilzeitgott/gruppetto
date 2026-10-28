import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from './track';
import { LEVELS, Terrain } from './terrain3d';
import { fallDist, type FallSpec } from './falls3d';

/** Wasserfälle entlang der ersten Kilometer einer Tagesstrecke */
function fallsAlong(day: string, km: number) {
  const t = new Track(day);
  const T = new Terrain(t);
  const w = { x: 0, y: 0, z: 0, th: 0 };
  const out: { f: FallSpec; T: Terrain; d: number }[] = [];
  const seen = new Set<FallSpec>();
  for (let d = 0; d < km * 1000; d += 500) {
    T.window(Math.max(0, d - 900), d + 4600);
    T.prefetchLim(Infinity);
    t.world(d, 0, 0, w);
    const it = T.fallsNear(w.x - 600, w.z - 600, w.x + 600, w.z + 600);
    let r = it.next();
    while (!r.done) r = it.next();
    for (const f of r.value) if (!seen.has(f)) { seen.add(f); out.push({ f, T, d }); }
  }
  return out;
}

test('Wasserfälle: es gibt welche, mit freien Stufen, Becken und plausibler Lage', () => {
  const list = fallsAlong('2026-10-28', 8);
  assert.ok(list.length >= 3, `Wasserfälle gefunden: ${list.length}`);
  for (const { f } of list) {
    assert.ok(f.steps.some((s) => s.F >= 3.2), 'mindestens eine richtige Stufe');
    for (const s of f.steps) assert.ok(s.s1 > s.s0 && s.F > 0 && s.s0 >= f.s[f.top] - 1e-3 && s.s1 <= f.sEnd + 1e-3, 'Stufe im steilen Teil');
    for (let q = 1; q < f.n; q++) assert.ok(f.s[q] > f.s[q - 1], 'Bogenlänge steigt');
    // der ganze Lauf liegt im freien Bereich (dort keine Bäume) und im Kasten
    for (let q = 0; q < f.n; q++) {
      assert.ok(fallDist([f], f.x[q], f.z[q]).e < 0, 'Lauf ist frei');
      assert.ok(f.x[q] > f.box[0] && f.x[q] < f.box[2] && f.z[q] > f.box[1] && f.z[q] < f.box[3], 'im Kasten');
    }
    // passt ganz in seine Kachel der mittleren Stufe
    const S1 = LEVELS[1].size;
    const tx = Math.floor(f.x[f.top] / S1);
    const tz = Math.floor(f.z[f.top] / S1);
    for (let q = 0; q < f.n; q++) assert.ok(Math.floor(f.x[q] / S1) === tx && Math.floor(f.z[q] / S1) === tz, 'in einer Kachel');
    // es geht bergab
    assert.ok(f.hi[f.top] - f.hi[f.n - 1] > 25);
  }
});

test('Wasserfälle: Kacheln der mittleren Stufe bauen Felsen, Wasser und Gischt mit gültigen Werten', () => {
  const list = fallsAlong('2026-10-28', 5);
  assert.ok(list.length > 0);
  const { f, T, d } = list[0];
  // Probenfenster wie beim Fund
  T.window(Math.max(0, d - 900), d + 4600);
  T.prefetchLim(Infinity);
  const S1 = LEVELS[1].size;
  const td = T.buildTile(1, Math.floor(f.x[f.top] / S1), Math.floor(f.z[f.top] / S1));
  assert.ok(td.falls, 'Kachel hat Wasserfälle');
  const { rock, water, mist } = td.falls!;
  assert.equal(rock.pos.length / 3, rock.dy.length);
  assert.equal(rock.dy.length, rock.d1.length);
  assert.equal(rock.col.length, rock.pos.length);
  assert.ok(rock.pos.every(Number.isFinite) && rock.col.every(Number.isFinite), 'Felsen: Zahlen');
  for (const g of [water, mist]) {
    const p = g.getAttribute('position').array as Float32Array;
    assert.ok(p.length > 0 && p.every(Number.isFinite), 'Lage: Zahlen');
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) assert.ok(idx.getX(i) < p.length / 3, 'Index im Bereich');
  }
  const a = water.getAttribute('aAlpha').array as Float32Array;
  assert.ok(a.every((v) => v >= 0 && v <= 1), 'Deckkraft 0–1');
  // feine Stufe: keine Bäume im Bett
  const L0 = LEVELS[0].size;
  const t0 = T.buildTile(0, Math.floor(f.x[f.top + 3] / L0), Math.floor(f.z[f.top + 3] / L0));
  for (const tr of t0.trees) assert.ok(fallDist([f], tr.x, tr.z).e >= 1, 'kein Baum im Bett');
});
