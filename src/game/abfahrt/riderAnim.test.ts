import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Abfahrt } from './engine';
import { dailyMissions } from './missions';
import { RiderAnim, type RiderState } from './riderAnim';
import type { RiderPose } from './rider3d';

const kit = { jersey: '#ff5fa2', side: '#fff', helmet: '#fff', shorts: '#111', skin: '#f0c4a0', shoes: '#fff', number: '27' };
const DT = 1 / 60;

function game(day = '2027-05-09', cruise?: number): Abfahrt {
  const g = new Abfahrt({ dayKey: day, names: [], friends: [], kit, best: 0, missions: dailyMissions(day), missionsDone: new Set(), tutorial: false, cruise });
  g.start();
  for (let t = 0; t < 3; t += DT) g.update(DT);
  return g;
}

function stateOf(g: Abfahrt): RiderState {
  const p = g.p;
  const seg = g.track.segAt(p.z);
  return { lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, stand: p.stand ?? 0, sprint: 0, v: p.v, air: Math.max(0, p.y - g.track.heightAt(p.z)), surface: seg.surface, wobble: p.wobble, light: 0, roll: p.z / 0.34 };
}

test('Haltungswechsel: Ducken und Bremsen setzen weich an, springen nicht und kommen zügig an', () => {
  const g = game();
  const an = new RiderAnim(1, true);
  let prev: RiderPose | null = null;
  const dTuck: number[] = [];
  const dBrake: number[] = [];
  const poses: { t: number; tuck: number; brake: number }[] = [];
  for (let t = 0; t < 8; t += DT) {
    g.key('up', t > 1 && t < 3.5);
    g.key('down', t > 4 && t < 5.5);
    g.update(DT);
    const p = an.step(stateOf(g), DT);
    if (prev) { dTuck.push(Math.abs((p.tuck ?? 0) - (prev.tuck ?? 0))); dBrake.push(Math.abs(p.brake - prev.brake)); }
    poses.push({ t, tuck: p.tuck, brake: p.brake });
    prev = { ...p };
  }
  // kein Sprung: je Bild höchstens ein kleines Stück (bei 60 Hz)
  assert.ok(Math.max(...dTuck) < 0.06, `größter Schritt ducken: ${Math.max(...dTuck).toFixed(3)}`);
  assert.ok(Math.max(...dBrake) < 0.08, `größter Schritt bremsen: ${Math.max(...dBrake).toFixed(3)}`);
  // weicher Ansatz: im ersten Bild nach dem Daumen passiert fast nichts, nach 0,6 s ist der Fahrer unten
  const i1 = poses.findIndex((p) => p.t > 1);
  assert.ok(poses[i1 + 1].tuck < 0.02, `Ansatz: ${poses[i1 + 1].tuck.toFixed(3)}`);
  assert.ok(poses[i1 + 36].tuck > 0.55, `nach 0,6 s: ${poses[i1 + 36].tuck.toFixed(3)}`);
  assert.ok(poses[i1 + 72].tuck > 0.92, `nach 1,2 s: ${poses[i1 + 72].tuck.toFixed(3)}`);
  // und wieder hoch
  const i2 = poses.findIndex((p) => p.t > 3.5);
  assert.ok(poses[i2 + 72].tuck < 0.08, `aufgerichtet: ${poses[i2 + 72].tuck.toFixed(3)}`);
  // Bremsen kommt an
  const i3 = poses.findIndex((p) => p.t > 4);
  assert.ok(poses[i3 + 40].brake > 0.8, `Bremshaltung: ${poses[i3 + 40].brake.toFixed(3)}`);
});

test('Nebenbewegungen: Oberkörper arbeitet beim Treten, nicht beim Rollen; Rütteln auf Pflaster', () => {
  const an = new RiderAnim(5);
  const base: RiderState = { lean: 0, pedal: 0, tuck: 0, brake: 0, stand: 0, sprint: 0, v: 10, air: 0, surface: 'asphalt', wobble: 0, light: 0, roll: 0 };
  // treten mit 8 rad/s
  let ped = 0;
  let p: RiderPose = an.step(base, DT);
  for (let t = 0; t < 2; t += DT) { ped += 8 * DT; p = an.step({ ...base, pedal: ped % (Math.PI * 2) }, DT); }
  assert.ok((p.pump ?? 0) > 0.5, `Oberkörper beim Treten: ${p.pump?.toFixed(2)}`);
  assert.ok((p.shake ?? 0) < 0.2, `ruhig auf Asphalt: ${p.shake?.toFixed(2)}`);
  // Kurbel steht: der Oberkörper beruhigt sich
  for (let t = 0; t < 2; t += DT) p = an.step({ ...base, pedal: ped % (Math.PI * 2) }, DT);
  assert.ok((p.pump ?? 0) < 0.05, `ruhig beim Rollen: ${p.pump?.toFixed(2)}`);
  // Pflaster bei Tempo: deutliches Rütteln
  for (let t = 0; t < 2; t += DT) p = an.step({ ...base, pedal: ped % (Math.PI * 2), surface: 'cobble', v: 14 }, DT);
  assert.ok((p.shake ?? 0) > 0.6, `Rütteln auf Pflaster: ${p.shake?.toFixed(2)}`);
  // Sprung: in der Luft aus dem Sattel, Landung federt und klingt ab
  for (let t = 0; t < 0.6; t += DT) p = an.step({ ...base, pedal: ped % (Math.PI * 2), air: 0.5 }, DT);
  assert.ok((p.absorb ?? 0) > 0.5, `in der Luft: ${p.absorb?.toFixed(2)}`);
  let peak = 0;
  for (let t = 0; t < 1.5; t += DT) { p = an.step({ ...base, pedal: ped % (Math.PI * 2), air: 0 }, DT); peak = Math.max(peak, p.absorb ?? 0); }
  assert.ok(peak > 0.6 && (p.absorb ?? 0) < 0.05, `Landung: Spitze ${peak.toFixed(2)}, danach ${p.absorb?.toFixed(2)}`);
  // Blick in die Kurve mit der Schräglage
  for (let t = 0; t < 1; t += DT) p = an.step({ ...base, lean: 0.5 }, DT);
  assert.ok((p.look ?? 0) > 0.2 && (p.look ?? 0) <= 0.4, `Blick: ${p.look?.toFixed(2)}`);
});

test('3D-Fahrer: Kopf, Rumpf, Schultern und Knie bewegen sich stetig – auch bei Tempo, Kurven und Haltungswechseln', async () => {
  // Trikot-Textur braucht eine Leinwand – hier nur eine Attrappe (wie in bikes.test.ts)
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const { RiderModel } = await import('./rider3d');
  const m = new RiderModel(kit, new THREE.Texture(), 1);
  delete (globalThis as { document?: unknown }).document;
  const parts = m as unknown as { head: THREE.Object3D; torso: THREE.Object3D; thighs: THREE.Object3D[]; shins: THREE.Object3D[]; uppers: THREE.Object3D[]; fores: THREE.Object3D[]; body: THREE.Object3D };
  const watch: [string, THREE.Object3D, number][] = [
    ['Kopf', parts.head, 0.012], ['Rumpf', parts.torso, 0.012], ['Schulter links', parts.uppers[0], 0.016], ['Schulter rechts', parts.uppers[1], 0.016],
    ['Hüfte links', parts.thighs[0], 0.012], ['Hüfte rechts', parts.thighs[1], 0.012], ['Knie links', parts.shins[0], 0.035], ['Knie rechts', parts.shins[1], 0.035],
    ['Ellbogen links', parts.fores[0], 0.025], ['Ellbogen rechts', parts.fores[1], 0.025],
  ];
  const g = game('2027-05-11', 1);
  const an = new RiderAnim(1, true);
  const last = watch.map(([, o]) => o.position.clone());
  const lastHead = new THREE.Vector3();
  let lastRoll = 0;
  let worst = '';
  let n = 0;
  for (let t = 0; t < 40; t += DT) {
    // ducken, bremsen, lenken in wechselnden Phasen
    const ph = Math.floor(t / 2.5) % 4;
    g.key('up', ph === 1);
    g.key('down', ph === 3);
    g.key('left', ph === 2 && t % 2.5 < 1.2);
    g.key('right', ph === 2 && t % 2.5 >= 1.2);
    g.update(DT);
    if (g.phase !== 'playing') break;
    m.pose(an.step(stateOf(g), DT));
    n++;
    if (n > 1) {
      watch.forEach(([name, o, lim], i) => {
        const d = o.position.distanceTo(last[i]);
        if (d > lim) worst += `${name} springt um ${(d * 1000).toFixed(0)} mm bei ${t.toFixed(2)} s\n`;
      });
      const hr = Math.abs(parts.head.rotation.x - lastHead.x) + Math.abs(parts.head.rotation.y - lastHead.y) + Math.abs(parts.head.rotation.z - lastHead.z);
      if (hr > 0.06) worst += `Kopf dreht um ${hr.toFixed(3)} rad bei ${t.toFixed(2)} s\n`;
      const dr = Math.abs(parts.body.rotation.z - lastRoll);
      if (dr > 0.04) worst += `Schräglage springt um ${dr.toFixed(3)} rad bei ${t.toFixed(2)} s\n`;
    }
    watch.forEach(([, o], i) => last[i].copy(o.position));
    lastHead.set(parts.head.rotation.x, parts.head.rotation.y, parts.head.rotation.z);
    lastRoll = parts.body.rotation.z;
  }
  assert.ok(n > 1500, `nur ${n} Bilder gefahren`);
  assert.equal(worst, '', worst);
});

test('Gegner: Bremshaltung und Trittfrequenz wechseln stufenlos', () => {
  const g = game('2027-05-12', 1);
  const cads = new Map<number, number>();
  const brakes = new Map<number, number>();
  let maxDc = 0;
  let maxDb = 0;
  let mid = 0;
  for (let t = 0; t < 90 && g.phase === 'playing'; t += DT) {
    g.update(DT);
    for (const o of g.opps) {
      const c = o.cad ?? 0;
      const pc = cads.get(o.id);
      if (pc !== undefined) maxDc = Math.max(maxDc, Math.abs(c - pc));
      cads.set(o.id, c);
      const pb = brakes.get(o.id);
      if (pb !== undefined) maxDb = Math.max(maxDb, Math.abs(o.brake - pb));
      brakes.set(o.id, o.brake);
      if (o.brake > 0.1 && o.brake < 0.9) mid++;
    }
  }
  // der Antritt aus dem Stand ist das Schnellste (von 0 auf Touren in einer guten halben Sekunde)
  assert.ok(maxDc < 0.8, `Drehzahlsprung je Bild: ${maxDc.toFixed(2)} rad/s`);
  assert.ok(maxDb < 0.12, `Bremssprung je Bild: ${maxDb.toFixed(3)}`);
  assert.ok(mid > 0, 'Bremsen hat Zwischenwerte');
});

test('Kopf bleibt ruhig: im Sitzen kein Auf und Ab im Tritttakt – auch bei Tempo und auf Pflaster', async () => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const { RiderModel } = await import('./rider3d');
  const m = new RiderModel(kit, new THREE.Texture(), 0);
  delete (globalThis as { document?: unknown }).document;
  const head = (m as unknown as { head: THREE.Object3D }).head;
  for (const [v, cad, surface, tuck] of [[8, 6, 'asphalt', 0], [14, 9, 'asphalt', 0], [22, 0, 'asphalt', 1], [12, 8, 'cobble', 0]] as const) {
    const an = new RiderAnim(3);
    let ped = 0;
    let lo = 9;
    let hi = -9;
    let plo = 9;
    let phi = -9;
    for (let i = 0; i < 600; i++) {
      ped = (ped + cad * DT) % (Math.PI * 2);
      m.pose(an.step({ lean: 0, pedal: ped, tuck, brake: 0, stand: 0, sprint: 0, v, air: 0, surface, wobble: 0, light: 0, roll: 0 }, DT));
      if (i < 300) continue;
      lo = Math.min(lo, head.position.y); hi = Math.max(hi, head.position.y);
      plo = Math.min(plo, head.rotation.x); phi = Math.max(phi, head.rotation.x);
    }
    assert.ok(hi - lo < 0.006, `${v} m/s ${surface}: Kopf hüpft ${((hi - lo) * 1000).toFixed(1)} mm`);
    assert.ok(phi - plo < 0.02, `${v} m/s ${surface}: Kopf nickt ${((phi - plo) * 57.3).toFixed(1)}°`);
  }
});
