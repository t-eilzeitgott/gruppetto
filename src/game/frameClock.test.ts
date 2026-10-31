import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock } from './frameClock';

/** Uhr mit den Aufrufen (Zeitstempel) füttern; liefert die Schritte der gezeichneten Bilder in ms */
function run(stamps: number[]): { dts: number[]; drawn: number[]; clock: FrameClock } {
  const clock = new FrameClock(stamps[0]);
  const dts: number[] = [];
  const drawn: number[] = [];
  for (let i = 1; i < stamps.length; i++) {
    if (!clock.ready(stamps[i])) continue;
    dts.push(clock.tick(stamps[i]) * 1000);
    drawn.push(stamps[i]);
  }
  return { dts, drawn, clock };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const P60 = 1000 / 60;
const P120 = 1000 / 120;

test('Safari-Stempel (auf ganze ms gerundet): gleichmäßige Schritte statt 17 – 17 – 16', () => {
  const stamps = Array.from({ length: 900 }, (_, i) => Math.floor(5000 + i * P60));
  const { dts } = run(stamps);
  for (const d of dts.slice(120)) assert.ok(Math.abs(d - P60) < 0.7, `Schritt ${d.toFixed(3)} ms`);
  // die Spielzeit läuft mit der echten Zeit
  assert.ok(Math.abs(sum(dts) - (stamps[stamps.length - 1] - stamps[0])) < P60);
});

test('verrauschte Stempel (±1,5 ms): Schritte bleiben fast genau ein Takt', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const stamps = Array.from({ length: 900 }, (_, i) => 1000 + i * P60 + (rnd() - 0.5) * 3);
  const { dts } = run(stamps);
  for (const d of dts.slice(120)) assert.ok(Math.abs(d - P60) < 0.8, `Schritt ${d.toFixed(3)} ms`);
  assert.ok(Math.abs(sum(dts) - (stamps[stamps.length - 1] - stamps[0])) < P60);
});

test('ein ausgefallenes Bild: das nächste rückt so weit vor, wie das alte stand – danach wieder ein Takt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 400; i++) { stamps.push(t); t += i === 300 ? 2 * P60 : P60; }
  const { dts } = run(stamps);
  assert.ok(Math.abs(dts[300] - 2 * P60) < 1, `Schritt nach dem Ausfall ${dts[300].toFixed(2)} ms`);
  for (const d of dts.slice(301, 330)) assert.ok(Math.abs(d - P60) < 0.8, `danach ${d.toFixed(2)} ms`);
  const real = stamps[339] - stamps[0];
  assert.ok(Math.abs(sum(dts.slice(0, 339)) - real) < 1.5, `Rückstand ${(real - sum(dts.slice(0, 339))).toFixed(2)} ms`);
});

test('120-Hz-Bildschirm, der jeden Takt schafft: voller Takt', () => {
  const stamps = Array.from({ length: 900 }, (_, i) => Math.floor(i * P120));
  const { dts, clock } = run(stamps);
  assert.ok(Math.abs(clock.period - P120) < 0.1, `Takt ${clock.period}`);
  assert.equal(clock.div, 1);
  for (const d of dts.slice(200)) assert.ok(Math.abs(d - P120) < 0.6, `Schritt ${d.toFixed(3)} ms`);
});

/**
 * 120-Hz-Telefon mit Grafik im Hintergrund (bis zu zwei Bilder unterwegs): ein Bild braucht 2 ms Rechenzeit und
 * 10–14 ms Grafik, gezeigt wird es zum ersten Takt nach seiner Fertigstellung. Liefert die Abstände, in denen die
 * Bilder auf dem Schirm erscheinen, und die Spielzeit-Schritte.
 */
function phone(pace: boolean) {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const clock = new FrameClock(0);
  clock.pace = pace;
  const shown: number[] = [];
  const dts: number[] = [];
  const flight: number[] = [];
  let gpuFree = 0;
  for (let v = 1; v < 3600; v++) {
    const now = v * P120;
    while (flight.length && flight[0] <= now + 1e-6) shown.push(flight.shift()!);
    if (flight.length >= 2) continue; // Warteschlange voll: kein Aufruf
    const t = Math.floor(now);
    if (!clock.ready(t)) continue;
    dts.push(clock.tick(t) * 1000);
    const done = Math.max(now + 2, gpuFree) + 10 + rnd() * 4;
    gpuFree = done;
    flight.push(Math.ceil(done / P120 - 1e-6) * P120);
  }
  const gaps = shown.slice(1).map((x, i) => x - shown[i]).slice(200);
  return { clock, gaps, dts: dts.slice(200) };
}

test('120-Hz-Telefon, das den vollen Takt nicht schafft: fester Takt von 60 Bildern je Sekunde, gleichmäßig', () => {
  const free = phone(false);
  const evenFree = free.gaps.filter((g) => Math.abs(g - P60) < 1).length / free.gaps.length;
  // ohne festen Takt: mal zwei, mal drei Takte (das Ruckeln)
  assert.ok(evenFree < 0.85, `ohne festen Takt ${Math.round(evenFree * 100)} % gleichmäßig`);
  const paced = phone(true);
  assert.equal(paced.clock.div, 2, 'jeder zweite Takt');
  const even = paced.gaps.filter((g) => Math.abs(g - P60) < 1).length / paced.gaps.length;
  assert.ok(even > 0.97, `mit festem Takt ${Math.round(even * 100)} % gleichmäßig`);
  for (const d of paced.dts) assert.ok(Math.abs(d - P60) < 1, `Schritt ${d.toFixed(2)} ms`);
});

test('Gerät schafft nur jeden zweiten Takt (30 Bilder/s): Schritte von zwei Takten', () => {
  const stamps = Array.from({ length: 600 }, (_, i) => i * 2 * P60);
  const { dts } = run(stamps);
  for (const d of dts.slice(200)) assert.ok(Math.abs(d - 2 * P60) < 0.5, `Schritt ${d.toFixed(3)} ms`);
});

test('abwechselnd ein und zwei Takte: jeder Schritt passt zu seinem Abstand, Spielzeit stimmt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 900; i++) { stamps.push(t); t += (i & 1) ? 2 * P60 : P60; }
  const { dts, drawn } = run(stamps);
  for (let i = 200; i < dts.length; i++) assert.ok(Math.abs(dts[i] - (drawn[i] - drawn[i - 1])) < 0.8, `Schritt ${i}`);
  const real = stamps[stamps.length - 1] - stamps[0];
  assert.ok(Math.abs(sum(dts) - real) < 3 * P60, `Spielzeit ${sum(dts).toFixed(0)} statt ${real.toFixed(0)} ms`);
});

test('75-Hz-Bildschirm: als 75 Hz erkannt (nicht 72)', () => {
  const stamps = Array.from({ length: 600 }, (_, i) => 100 + i * (1000 / 75));
  const { clock } = run(stamps);
  assert.ok(Math.abs(clock.period - 1000 / 75) < 0.05, `Takt ${clock.period}`);
});

test('nach einer langen Pause wird nichts nachgeholt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 200; i++) { stamps.push(t); t += i === 150 ? 3000 : P60; }
  const { dts } = run(stamps);
  for (const d of dts) assert.ok(d < P60 * 2.1, `Schritt ${d.toFixed(2)} ms`);
});

test('kurz falsch erkannter Takt (90 Hz, dann 120 Hz): nie seltener als 60 Bilder je Sekunde', () => {
  const stamps: number[] = [];
  let t = 0;
  // erst 90 Hz in Zweierschritten, dann 120 Hz
  for (let i = 0; i < 200; i++) { t += 2000 / 90; stamps.push(t); }
  for (let i = 0; i < 1200; i++) { t += P120; stamps.push(t); }
  const { clock } = run(stamps);
  assert.ok(clock.target <= P60 + 1, `Takt ${clock.target.toFixed(1)} ms`);
});

test('falsch erkannter Takt (90, 100, 144, 240 Hz) und langsame Bilder: der feste Takt bleibt bei höchstens 16,7 ms', () => {
  for (const hz of [60, 72, 75, 90, 100, 120, 144, 165, 240]) {
    const clock = new FrameClock(0);
    clock.period = 1000 / hz;
    // Bilder, die jeden Takt verpassen (25 ms auf dem echten 120-Hz-Schirm)
    let t = 0;
    for (let i = 0; i < 2000; i++) { t += 25; clock.tick(t); }
    assert.ok(clock.target <= P60 + 1, `${hz} Hz: Takt ${clock.target.toFixed(1)} ms (jeder ${clock.div}.)`);
  }
});
