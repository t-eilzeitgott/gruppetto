import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QualityGovernor, storedQuality } from './quality.ts';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
};

/** Fahrt durchspielen: Bildzeiten (ms) der Reihe nach; liefert die Stufe am Ende und alle Änderungen */
function run(frames: number[], q0 = 1): { q: number; changes: number[] } {
  const gov = new QualityGovernor(0.5);
  let q = q0;
  const changes: number[] = [];
  for (const ms of frames) {
    const nq = gov.frame(ms / 1000, q);
    if (nq !== null) { q = nq; changes.push(nq); }
  }
  return { q, changes };
}

const rep = (ms: number, n: number) => Array.from({ length: n }, () => ms);

test('120 Hz mit einzelnen Rucklern: Auflösung bleibt voll', () => {
  // jedes siebte Bild ein Ruckler von 30 ms (Nachladen), sonst 8,3 ms – wie ein iPhone im Sprintfinale
  const frames: number[] = [];
  for (let i = 0; i < 1500; i++) frames.push(i % 7 === 0 ? 30 : 8.3);
  const r = run(frames);
  assert.equal(r.q, 1);
  assert.deepEqual(r.changes, []);
});

test('60 Hz gleichmäßig: keine Änderung', () => {
  const r = run(rep(16.7, 600));
  assert.equal(r.q, 1);
});

test('Anlaufzeit zählt nicht: zähe erste Sekunden senken nichts', () => {
  const r = run([...rep(40, 60), ...rep(8.3, 600)]);
  assert.equal(r.q, 1);
});

test('dauerhaft zu langsam: senken, bis es flüssig ist – nicht weiter', () => {
  // 25 ms je Bild, nach dem ersten Senken reicht es (15 ms)
  const gov = new QualityGovernor(0.5);
  let q = 1;
  let ms = 25;
  for (let i = 0; i < 700; i++) {
    const nq = gov.frame(ms / 1000, q);
    if (nq !== null) { q = nq; ms = 15; }
  }
  assert.ok(q < 1 && q >= 0.86, `gesenkt auf ${q}`);
  assert.equal(storedQuality(), q);
});

test('Senken bringt nichts (Rechenzeit): zurück auf die alte Stufe und dabei bleiben', () => {
  // 25 ms je Bild, egal wie klein das Bild ist
  const r = run(rep(25, 1000));
  assert.equal(r.q, 1);
  // genau einmal gesenkt und wieder zurück
  assert.deepEqual(r.changes.map((x) => Math.round(x * 100)), [90, 100]);
});

test('abwechselnd ein und zwei Takte bei 60 Hz (45 fps): gilt als zu langsam', () => {
  // nach dem Senken läuft es gleichmäßig
  const gov = new QualityGovernor(0.5);
  let q = 1;
  let lowered = false;
  for (let i = 0; i < 600; i++) {
    const ms = lowered ? 16.7 : i % 2 ? 16.7 : 33.3;
    const nq = gov.frame(ms / 1000, q);
    if (nq !== null) { q = nq; lowered = true; }
  }
  assert.ok(q < 1, `gesenkt auf ${q}`);
});

test('gespeicherte niedrige Stufe erholt sich auf einem flüssigen Gerät zügig', () => {
  // 40 s bei 120 Bildern je Sekunde
  const r = run(rep(8.3, 120 * 40), 0.5);
  assert.equal(r.q, 1);
  assert.ok(r.changes.length >= 4);
});

test('ein Ruckelfenster zu Beginn hält die Fahrt nicht dauerhaft unscharf', () => {
  // nach der Anlaufzeit 3 s mit 30 ms je Bild (zu langsam), danach 60 s flüssig bei 8,3 ms
  const frames = [...rep(8.3, 400), ...rep(30, 100), ...rep(8.3, 120 * 60)];
  const r = run(frames);
  assert.equal(r.q, 1, `am Ende ${r.q}, Änderungen ${r.changes.join(', ')}`);
});
