import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BIKES, bikeProgress, bikeStats, nextBike } from '../bikes';
import type { GameBest } from '../../data/source';
import { Mesher } from './gloss';
import { revolve, toothed, tube } from './prim3d';
import { bikeBuild } from './bike3d';
import { headBuild, shoeBuild } from './gear3d';

const row = (user_id: string, best: number, runs: number, total_m: number, best_m = 0): GameBest => ({ user_id, best, best_m, runs, total_m, last_at: '' });

test('Räder: Läufe und Meter nur aus den eigenen Zeilen aller drei Spiele', () => {
  const s = bikeStats({
    abfahrt: [row('a', 9000, 4, 12000, 4200), row('me', 7000, 3, 9000, 5100)],
    sprint: [row('me', 820, 5, 12000)],
    berg: undefined,
  }, 'me');
  assert.deepEqual(s, { runs: 8, meters: 21000 });
});

test('Räder: am Anfang 1 von 14, dann der Reihe nach erst Läufe, dann immer mehr Kilometer', () => {
  assert.equal(BIKES.length, 14);
  const ids = (p: ReturnType<typeof bikeProgress>) => BIKES.filter((b) => p[b.id].done).map((b) => b.id);
  const none = bikeProgress(bikeStats({}, 'me'));
  assert.deepEqual(ids(none), ['allround'], 'am Anfang nur das Teamrad');
  assert.equal(nextBike(none)?.id, 'lastesel', 'als Zweites gleich das Lastenrad');
  // die ersten Räder nach etwa zehn Läufen
  assert.deepEqual(ids(bikeProgress({ runs: 2, meters: 4000 })), ['allround', 'lastesel']);
  assert.deepEqual(ids(bikeProgress({ runs: 10, meters: 24000 })), ['allround', 'lastesel', 'acciaio', 'pave', 'matsch']);
  // danach Kilometer, jede Stufe weiter als die davor
  const km = BIKES.slice(5).map((b) => (b.unlock.kind === 'km' ? b.unlock.n : 0));
  assert.ok(km.every((n, i) => n > 0 && (i === 0 || n > km[i - 1])), 'Kilometer steigen');
  const mid = bikeProgress({ runs: 30, meters: 70000 });
  assert.deepEqual(ids(mid), ['allround', 'lastesel', 'acciaio', 'pave', 'matsch', 'feder', 'aero']);
  assert.equal(mid.fernweh.label, '70 / 85 km');
  // der Wohnwagen kommt kurz vor Schluss
  assert.equal(BIKES[BIKES.length - 2].id, 'wohnwagen');
  // der Reihe nach: viele Kilometer, aber zu wenige Läufe – Kilometerräder warten
  const queued = bikeProgress({ runs: 9, meters: 400000 });
  assert.ok(!queued.matsch.done && !queued.feder.done && !queued.legende.done);
  assert.equal(queued.feder.after, 'Matschkönig');
  assert.equal(queued.matsch.after, undefined);
  const all = bikeProgress({ runs: 120, meters: 300000 });
  assert.ok(BIKES.every((b) => all[b.id].done), 'mit 300 km alles frei');
  assert.equal(nextBike(all), null);
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
    assert.ok(r.fit.hood.y > 0.6 && r.fit.hood.z < (b.bar === 'city' ? -0.2 : -0.3), `${b.id}: Griff vorn oben`);
  }
  for (const h of ['helmet', 'aero', 'cap'] as const) assert.ok(consistent(headBuild(kit, h, 0)) > 0.97, `Kopf ${h}`);
  // Reifen berühren den Boden (auch breite und mit Stollen)
  for (const b of BIKES) {
    const r = bikeBuild(b.id, kit, 0);
    r.wheelR.computeBoundingBox();
    // Außenradius (Segment 0 liegt genau waagrecht vorn) = Achshöhe
    assert.ok(Math.abs(r.wheelR.boundingBox!.max.z - r.fit.rear.y) < 0.004, `${b.id}: Hinterrad steht auf dem Boden`);
  }
  assert.ok(consistent(shoeBuild(kit, 'toeclip', 0)) > 0.97, 'Schuh');
});

test('volle Detailstufe (Garage): Stollen, Schlamm, Taschen und Speichenräder bauen sauber', () => {
  // Schriftzüge brauchen eine Leinwand – hier nur eine Attrappe
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const kit = { jersey: '#e6007e', side: '#1b1b1b', helmet: '#ffffff', shorts: '#111111', skin: '#e2b48f', shoes: '#ffffff', number: '12' };
  for (const id of ['matsch', 'fernweh', 'bahn', 'regenbogen', 'lastesel', 'wohnwagen']) {
    const r = bikeBuild(id, kit, 1);
    for (const g of [r.frame, r.wheelF, r.wheelR, r.crank]) assert.ok(consistent(g) > 0.97, `${id}: Flächen und Normalen`);
    if (r.trailer) assert.ok(consistent(r.trailer.body) > 0.97 && consistent(r.trailer.wheel) > 0.97, `${id}: Anhänger`);
    r.wheelF.computeBoundingBox();
    assert.ok(Math.abs(r.wheelF.boundingBox!.max.z - r.fit.front.y) < 0.004, `${id}: Vorderrad auf dem Boden`);
  }
  // Bikepacking: Rücklicht hinten an der Satteltasche
  assert.ok(bikeBuild('fernweh', kit, 1).fit.lamp.z > 0.4);
  // Lastenrad: kleines Vorderrad weit vorn, dreht schneller
  const cargo = bikeBuild('lastesel', kit, 1);
  assert.ok(cargo.fit.front.z < -1.4 && (cargo.fit.spinF ?? 1) > 1.2);
  // Wohnwagen: Räder stehen auf dem Boden (Kupplung auf Achshöhe des Rads)
  const ww = bikeBuild('wohnwagen', kit, 1).trailer!;
  ww.wheel.computeBoundingBox();
  assert.ok(Math.abs(ww.wheels[0].y + ww.hitch.y - ww.wheel.boundingBox!.max.z) < 0.006, 'Anhängerräder auf dem Boden');
  delete (globalThis as { document?: unknown }).document;
});

test('Wohnwagen folgt der Spur: gerade hinten, in der Kurve schräg, danach wieder gerade', async () => {
  const { RiderModel } = await import('./rider3d');
  const kit = { jersey: '#e6007e', side: '#1b1b1b', helmet: '#ffffff', shorts: '#111111', skin: '#e2b48f', shoes: '#ffffff', number: '12', bike: 'wohnwagen' };
  // Trikot-Textur braucht eine Leinwand – hier nur eine Attrappe
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const m = new RiderModel(kit, new THREE.Texture(), 0);
  delete (globalThis as { document?: unknown }).document;
  const tr = (m as unknown as { trailer: THREE.Group }).trailer;
  assert.ok(tr, 'Anhänger vorhanden');
  let ry = 0;
  const pos = new THREE.Vector3();
  const step = (turn: number) => {
    ry += turn * 0.05;
    pos.x += -Math.sin(ry) * 0.05;
    pos.z += -Math.cos(ry) * 0.05;
    m.group.position.copy(pos);
    m.group.rotation.y = ry;
    m.pose({ lean: 0, pedal: 0, tuck: 0, brake: 0, light: 0, roll: 0 });
  };
  for (let i = 0; i < 80; i++) step(0);
  assert.ok(Math.abs(tr.rotation.y) < 0.01, 'geradeaus: gerade hinter dem Rad');
  for (let i = 0; i < 120; i++) step(1 / 8);
  const curve = tr.rotation.y;
  assert.ok(Math.abs(curve) > 0.08 && Math.abs(curve) < 0.6, `in der Kurve schräg (${curve.toFixed(3)})`);
  for (let i = 0; i < 200; i++) step(0);
  assert.ok(Math.abs(tr.rotation.y) < 0.02, 'nach der Kurve wieder gerade');
  // Neustart an anderer Stelle: keine Verrenkung
  pos.set(100, 0, 100);
  step(0);
  assert.ok(Math.abs(tr.rotation.y) < 0.01);
});
