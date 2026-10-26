import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BIKES, bikeProgress, bikeStats } from '../bikes';
import type { GameBest } from '../../data/source';
import { Mesher } from './gloss';
import { revolve, toothed, tube } from './prim3d';
import { bikeBuild } from './bike3d';
import { headBuild, shoeBuild } from './gear3d';

const row = (user_id: string, best: number, runs: number, total_m: number, best_m = 0): GameBest => ({ user_id, best, best_m, runs, total_m, last_at: '' });

test('Räder: Werte nur aus den eigenen Zeilen aller drei Spiele', () => {
  const s = bikeStats({
    abfahrt: [row('a', 9000, 4, 12000, 4200), row('me', 7000, 3, 9000, 5100)],
    sprint: [row('me', 820, 5, 12000)],
    berg: undefined,
  }, 'me');
  assert.equal(s.runs, 8);
  assert.equal(s.meters, 21000);
  assert.equal(s.best.sprint, 820);
  assert.equal(s.best.berg, 0);
  assert.equal(s.bestM, 5100);
});

test('Räder: Freischaltungen nach Rennen, Kilometern, Punkten, Abfahrtslänge und Sieg', () => {
  const none = bikeProgress(bikeStats({}, 'me'));
  assert.deepEqual(BIKES.filter((b) => none[b.id].done).map((b) => b.id), ['allround'], 'am Anfang nur das Teamrad');
  const p = bikeProgress({ runs: 3, meters: 25000, best: { abfahrt: 0, sprint: 800, berg: 799 }, bestM: 5000 });
  assert.ok(p.acciaio.done && p.pave.done && p.aero.done && p.titan.done);
  assert.ok(!p.feder.done, '799 von 800 Punkten reicht nicht');
  assert.ok(!p.zeit.done && !p.legende.done);
  assert.equal(p.legende.label, '5 / 7 Räder');
  const all = bikeProgress({ runs: 10, meters: 99000, best: { abfahrt: 0, sprint: 1200, berg: 900 }, bestM: 8000 });
  assert.ok(BIKES.every((b) => all[b.id].done), 'mit allem freigeschaltet auch die Legende');
  assert.match(p.pave.label, /25 \/ 25 km/);
});

/** zeigen die Flächen eines Teils nach außen (weg von der Achse)? Anteil der Dreiecke */
function outward(m: Mesher, center: (p: THREE.Vector3) => THREE.Vector3): number {
  const P = m.pos;
  let ok = 0;
  let n = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < m.idx.length; i += 3) {
    a.fromArray(P, m.idx[i] * 3); b.fromArray(P, m.idx[i + 1] * 3); c.fromArray(P, m.idx[i + 2] * 3);
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (nrm.lengthSq() < 1e-14) continue;
    const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    n++;
    if (nrm.dot(mid.clone().sub(center(mid))) > 0) ok++;
  }
  return ok / n;
}

test('Grundformen: Rohre, Drehkörper und Kettenblätter zeigen nach außen', () => {
  const t = new Mesher(0.5);
  const a = new THREE.Vector3(0, 0, 0);
  const b = new THREE.Vector3(0.1, 0.5, -0.3);
  tube(t, a, b, { w0: 0.04, n: 12, rings: 3, caps: false, col: () => [1, 1, 1] });
  const axis = b.clone().sub(a).normalize();
  assert.ok(outward(t, (p) => a.clone().addScaledVector(axis, p.clone().sub(a).dot(axis))) > 0.99, 'Rohr');
  const tr = new Mesher(0.5);
  tube(tr, a, b, { w0: 0.03, d0: 0.06, kind: 'aero', n: 14, caps: false, col: () => [1, 1, 1] });
  assert.ok(outward(tr, (p) => a.clone().addScaledVector(axis, p.clone().sub(a).dot(axis))) > 0.95, 'Aero-Rohr');
  const r = new Mesher(0.5);
  revolve(r, [[0.33, 0.01, [1, 1, 1]], [0.31, 0.012, [1, 1, 1]], [0.3, 0, [1, 1, 1]], [0.31, -0.012, [1, 1, 1]], [0.33, -0.01, [1, 1, 1]], [0.335, 0, [1, 1, 1]]], 32, new THREE.Vector3(), true);
  // Ring um die x-Achse: von der Mittellinie des Querschnitts (Radius ~0.318) weg
  assert.ok(outward(r, (p) => { const d = new THREE.Vector3(0, p.y, p.z).normalize().multiplyScalar(0.318); return new THREE.Vector3(0, d.y, d.z); }) > 0.97, 'Felge');
  const k = new Mesher(0.5);
  toothed(k, new THREE.Vector3(), 0, 0.1, 0.08, 0, 0.004, [1, 1, 1], 24);
  assert.ok(outward(k, (p) => { const d = new THREE.Vector3(0, p.y, p.z).normalize().multiplyScalar(0.09); return new THREE.Vector3(0, d.y, d.z); }) > 0.97, 'Kettenblatt');
});

/** gespeicherte Normalen passen zum Drehsinn der Dreiecke, keine kaputten Werte */
function consistent(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const idx = g.getIndex()!;
  for (let i = 0; i < pos.count * 3; i++) assert.ok(Number.isFinite((pos.array as Float32Array)[i]), 'Position ist eine Zahl');
  let ok = 0;
  let n = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    const f = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (f.lengthSq() < 1e-16) continue;
    s.fromBufferAttribute(nrm, ia).add(t.fromBufferAttribute(nrm, ib)).add(t.fromBufferAttribute(nrm, ic));
    n++;
    if (f.dot(s) > 0) ok++;
  }
  return ok / n;
}

test('Räder, Köpfe und Schuhe der Gegner bauen sauber (Normalen passen zu den Flächen)', () => {
  const kit = { jersey: '#e6007e', side: '#1b1b1b', helmet: '#ffffff', shorts: '#111111', skin: '#e2b48f', shoes: '#ffffff', number: '12' };
  for (const b of BIKES) {
    const r = bikeBuild(b.id, kit, 0);
    for (const g of [r.frame, r.wheelF, r.wheelR, r.crank]) assert.ok(consistent(g) > 0.98, `${b.id}: Flächen und Normalen`);
    assert.ok(r.fit.hood.y > 0.6 && r.fit.hood.z < -0.3, `${b.id}: Griff vorn oben`);
  }
  for (const h of ['helmet', 'aero', 'cap'] as const) assert.ok(consistent(headBuild(kit, h, 0)) > 0.97, `Kopf ${h}`);
  assert.ok(consistent(shoeBuild(kit, 'toeclip', 0)) > 0.97, 'Schuh');
});
