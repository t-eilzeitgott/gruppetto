import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock } from './frameClock';

/** Uhr mit einer Folge von Zeitstempeln füttern; liefert die Schritte in ms */
function run(stamps: number[]): { dts: number[]; clock: FrameClock } {
  const clock = new FrameClock(stamps[0]);
  const dts: number[] = [];
  for (let i = 1; i < stamps.length; i++) dts.push(clock.tick(stamps[i]) * 1000);
  return { dts, clock };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const P60 = 1000 / 60;

test('Safari-Stempel (auf ganze ms gerundet): gleichmäßige Schritte statt 17 – 17 – 16', () => {
  const stamps = Array.from({ length: 900 }, (_, i) => Math.floor(5000 + i * P60));
  const { dts } = run(stamps);
  const late = dts.slice(120);
  for (const d of late) assert.ok(Math.abs(d - P60) < 0.25, `Schritt ${d.toFixed(3)} ms`);
  // die Spielzeit läuft mit der echten Zeit
  assert.ok(Math.abs(sum(dts) - (stamps[stamps.length - 1] - stamps[0])) < P60);
});

test('verrauschte Stempel (±1,5 ms): Schritte bleiben fast genau ein Takt', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const stamps = Array.from({ length: 900 }, (_, i) => 1000 + i * P60 + (rnd() - 0.5) * 3);
  const { dts } = run(stamps);
  for (const d of dts.slice(120)) assert.ok(Math.abs(d - P60) < 0.6, `Schritt ${d.toFixed(3)} ms`);
  assert.ok(Math.abs(sum(dts) - (stamps[stamps.length - 1] - stamps[0])) < P60);
});

test('ein ausgefallenes Bild: kein doppelter Sprung, die Zeit wird über die nächsten Bilder nachgeholt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 400; i++) { stamps.push(t); t += i === 300 ? 2 * P60 : P60; }
  const { dts } = run(stamps);
  for (const d of dts) assert.ok(d < P60 * 1.26, `Schritt ${d.toFixed(2)} ms zu groß`);
  // 40 Bilder später ist alles nachgeholt
  const real = stamps[340] - stamps[0];
  assert.ok(Math.abs(sum(dts.slice(0, 340)) - real) < 1.5, `Rückstand ${(real - sum(dts.slice(0, 340))).toFixed(2)} ms`);
});

test('120-Hz-Bildschirm: Takt wird erkannt', () => {
  const stamps = Array.from({ length: 900 }, (_, i) => Math.floor(i * (1000 / 120)));
  const { dts, clock } = run(stamps);
  assert.ok(Math.abs(clock.period - 1000 / 120) < 0.1, `Takt ${clock.period}`);
  for (const d of dts.slice(200)) assert.ok(Math.abs(d - 1000 / 120) < 0.2, `Schritt ${d.toFixed(3)} ms`);
});

test('Gerät schafft nur jeden zweiten Takt (30 Bilder/s): Schritte von zwei Takten', () => {
  const stamps = Array.from({ length: 600 }, (_, i) => i * 2 * P60);
  const { dts } = run(stamps);
  for (const d of dts.slice(200)) assert.ok(Math.abs(d - 2 * P60) < 0.3, `Schritt ${d.toFixed(3)} ms`);
});

test('abwechselnd ein und zwei Takte: mittlere Geschwindigkeit stimmt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 900; i++) { stamps.push(t); t += (i & 1) ? 2 * P60 : P60; }
  const { dts } = run(stamps);
  const real = stamps[stamps.length - 1] - stamps[0];
  assert.ok(Math.abs(sum(dts) - real) < 3 * P60, `Spielzeit ${sum(dts).toFixed(0)} statt ${real.toFixed(0)} ms`);
});

test('nach einer langen Pause wird nichts nachgeholt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 200; i++) { stamps.push(t); t += i === 150 ? 3000 : P60; }
  const { dts } = run(stamps);
  for (const d of dts) assert.ok(d < P60 * 1.26, `Schritt ${d.toFixed(2)} ms`);
});
