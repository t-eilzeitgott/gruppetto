import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceFor, effortFor, pedalStep, smooth, spring, springStep, type Pedaller } from './motion';

const DT = 1 / 120;
const run = (o: Pedaller, want: number, secs: number) => { for (let t = 0; t < secs; t += DT) pedalStep(o, want, DT); };
/** Abstand zur nächsten waagrechten Kurbelstellung (0 oder π) */
const level = (a: number) => Math.min(Math.abs(Math.sin(a)), 1);

test('Antritt: die Kurbel kommt in einer knappen halben Sekunde auf Touren – ohne Sprung', () => {
  const o: Pedaller = { pedal: 0 };
  let last = 0;
  let maxJump = 0;
  for (let t = 0; t < 1; t += DT) {
    pedalStep(o, 8, DT);
    maxJump = Math.max(maxJump, (o.cad ?? 0) - last);
    last = o.cad ?? 0;
  }
  assert.ok(last > 7.7, `Drehzahl nach 1 s: ${last.toFixed(2)}`);
  assert.ok(maxJump < 0.4, `größter Drehzahlsprung je Schritt: ${maxJump.toFixed(3)}`);
  const half: Pedaller = { pedal: 0 };
  run(half, 8, 0.45);
  assert.ok((half.cad ?? 0) > 5, `nach 0,45 s: ${half.cad?.toFixed(2)}`);
});

test('Rollen lassen: die Beine laufen aus und pendeln gedämpft in die Waagrechte', () => {
  // aus jeder Kurbelstellung heraus (auch fast senkrecht, wo das Pendel lange zögert)
  for (let a0 = 0; a0 < Math.PI * 2; a0 += 0.35) {
    const o: Pedaller = { pedal: a0, cad: 8 };
    let minCad = 0;
    for (let t = 0; t < 2.5; t += DT) { pedalStep(o, 0, DT); minCad = Math.min(minCad, o.cad ?? 0); }
    assert.ok(Math.abs(o.cad ?? 0) < 0.12, `Drehzahl nach 2,5 s (Start ${a0.toFixed(2)}): ${o.cad?.toFixed(3)}`);
    assert.ok(level(o.pedal) < 0.05, `Kurbel nicht waagrecht (Start ${a0.toFixed(2)}): ${o.pedal.toFixed(3)}`);
    // höchstens ein kleines Zurückrollen, nie herumgeschleudert
    assert.ok(minCad > -1.6, `rückwärts: ${minCad.toFixed(2)}`);
  }
  // der übliche Fall ist nach gut einer Sekunde ruhig
  const o: Pedaller = { pedal: 3.4, cad: 8 };
  run(o, 0, 1.4);
  assert.ok(level(o.pedal) < 0.08 && Math.abs(o.cad ?? 0) < 0.4, `nach 1,4 s: ${o.pedal.toFixed(2)} / ${o.cad?.toFixed(2)}`);
  // das Auslaufen selbst ist sanft: keine ruckartige Bremsung der Beine
  const r: Pedaller = { pedal: 1, cad: 8 };
  let maxDrop = 0;
  for (let t = 0; t < 2; t += DT) { const w0 = r.cad ?? 0; pedalStep(r, 0, DT); maxDrop = Math.max(maxDrop, w0 - (r.cad ?? 0)); }
  assert.ok(maxDrop < 0.25, `größter Abfall je Schritt: ${maxDrop.toFixed(3)}`);
  // beide waagrechten Stellungen sind Ruhelagen (von π aus bleibt sie bei π)
  const q: Pedaller = { pedal: Math.PI + 0.3, cad: 0 };
  run(q, 0, 2);
  assert.ok(Math.abs(q.pedal - Math.PI) < 0.03, `Ruhelage bei π: ${q.pedal.toFixed(3)}`);
});

test('Kurbelwinkel bleibt im Kreis, Trittfrequenz wächst mit dem Tempo und ist gedeckelt', () => {
  const o: Pedaller = { pedal: 6 };
  run(o, 11, 30);
  assert.ok(o.pedal >= 0 && o.pedal < Math.PI * 2);
  assert.ok(cadenceFor(0) < cadenceFor(13) && cadenceFor(13) < cadenceFor(20));
  assert.equal(cadenceFor(40), 11);
});

test('weiche Stufe und Feder: kein Überschwingen, weicher Ansatz, Ziel erreicht', () => {
  assert.equal(smooth(0, 1, -1), 0);
  assert.equal(smooth(0, 1, 2), 1);
  assert.ok(Math.abs(smooth(0, 1, 0.5) - 0.5) < 1e-9);
  assert.equal(smooth(1, 0, 1), 0);  // umgekehrt: 0 bei a, 1 bei b
  const s = spring(0);
  const xs: number[] = [];
  for (let t = 0; t < 1; t += 1 / 60) xs.push(springStep(s, 1, 12, 1 / 60));
  assert.ok(Math.max(...xs) <= 1 + 1e-9, 'kein Überschwingen');
  assert.ok(xs[0] < 0.05, `setzt weich an: ${xs[0].toFixed(3)}`);
  assert.ok(xs[xs.length - 1] > 0.99, `kommt an: ${xs[xs.length - 1].toFixed(3)}`);
  // große Schritte (langsames Gerät): stabil
  const g = spring(0);
  for (let i = 0; i < 20; i++) springStep(g, 1, 20, 0.1);
  assert.ok(Math.abs(g.x - 1) < 1e-6 && Math.abs(g.v) < 1e-6);
});

test('Haltung nach Steigung: bergab ducken, in der Ebene kräftiger im Sitzen, steil aus dem Sattel', () => {
  const at = (g: number, push = 1) => effortFor(g, push);
  // bergab: ganz geduckt, nicht im Wiegetritt
  assert.ok(at(-0.06).tuck > 0.98 && at(-0.06).stand === 0);
  // Ebene und leichter Anstieg: sitzend, etwas tiefer, deutlich mehr Anstrengung als locker
  for (const g of [0, 0.02, 0.035]) {
    const e = at(g);
    assert.ok(e.stand < 0.05 && e.tuck > 0.08 && e.tuck < 0.4, `${g}: ${JSON.stringify(e)}`);
    assert.ok(e.effort > at(g, 0).effort + 0.25);
  }
  // Stufen: am leichten Anstieg kräftiger als in der Ebene, steil am meisten (und stehend)
  assert.ok(at(0.035).effort > at(0).effort);
  assert.ok(at(0.08).stand > 0.98 && at(0.08).effort > 0.98);
  // ohne Druck: nie geduckt, nie im Wiegetritt
  for (const g of [-0.08, 0, 0.09]) assert.ok(at(g, 0).tuck === 0 && at(g, 0).stand === 0);
});
