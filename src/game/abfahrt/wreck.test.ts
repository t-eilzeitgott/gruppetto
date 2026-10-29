import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wreckPose, wreckSettled, wreckTravel } from './wreck';
import { Abfahrt } from './engine';

test('Sturz: Körper rutscht aus, Rad bleibt zurück, am Ende liegt alles', () => {
  const w = { t: 0, v0: 16, side: 1, seed: 3, z0: 0, x0: 0 };
  let last = -1;
  for (let t = 0; t <= 6; t += 0.1) {
    w.t = t;
    const tr = wreckTravel(w);
    assert.ok(tr.s >= last - 1e-9, 'Weg nimmt nicht ab');
    last = tr.s;
  }
  w.t = 6;
  assert.ok(wreckSettled(w));
  const p = wreckPose(w);
  assert.ok(p.bike.z > 0.5, 'Rad liegt hinter dem Fahrer');
  assert.ok(Math.abs(p.bike.roll) > 1.3, 'Rad liegt auf der Seite');
  assert.ok(p.rider.y < -0.6, 'Fahrer liegt am Boden');
  w.t = 0.25;
  assert.ok(wreckPose(w).rider.y > -0.2, 'im Flug über den Lenker');
});

test('Massensturz: zu schnell aufs Hinterrad reißt dich und den Vordermann um, Hintere fallen drüber', () => {
  const e = new Abfahrt({ dayKey: '2026-10-29', names: [], friends: [], kit: { jersey: '#f00', side: '#fff', helmet: '#fff', shorts: '#000', skin: '#fc9', shoes: '#fff', number: '1' }, best: 0, missions: [], missionsDone: new Set(), tutorial: false, pileups: true });
  e.start();
  for (let i = 0; i < 60 * 3; i++) e.update(1 / 60);
  for (let i = 0; i < 60 * 3; i++) e.update(1 / 60);
  assert.equal(e.phase, 'playing');
  // Hindernisse sind weg
  for (let i = 0; i < 200; i++) for (const o of e.track.seg(i).objs ?? []) assert.ok(!['rock', 'cow', 'pothole', 'cone'].includes(o.k), o.k);
  const p = e.p;
  const mk = (id: number, dz: number, x: number) => ({ id, z: p.z + dz, x, vx: 0, v: p.v - 1, tx: x, f: 0.7, kit: p.kit, pedal: 0, lean: 0, tuck: 0, brake: 0, passed: false, group: 99, bump: 0, attacker: false });
  e.opps = [mk(900, 1.3, p.x), mk(901, -2.2, p.x), mk(902, -4.4, p.x + 0.1)];
  p.v = e.opps[0].v + 6;
  for (let i = 0; i < 60 * 3 && e.phase === 'playing'; i++) e.update(1 / 60);
  assert.equal(e.phase, 'crash');
  assert.ok(e.wreck, 'eigener Sturz');
  for (let i = 0; i < 60 * 8 && e.phase !== 'over'; i++) e.update(1 / 60);
  const down = e.opps.filter((o) => o.wreck).length;
  assert.ok(down >= 2, `nur ${down} Gegner gestürzt`);
  assert.equal(e.phase, 'over');
});
