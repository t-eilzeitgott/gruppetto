import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
};
// erst nach dem Speicher-Ersatz laden (die Sichtweite liest ihn beim Start)
const { QualityGovernor, storedQuality } = await import('./quality.ts');
const { rangeDrop, setRangeDrop, setViewRange, viewRange } = await import('./viewRange.ts');

/** Fahrt durchspielen: Bildzeiten (ms) der Reihe nach; liefert die Auflösung am Ende und alle Änderungen */
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
const reset = () => { setViewRange('max'); setRangeDrop(0); store.set('gruppetto.gfx', '1'); };

test('120 Hz mit einzelnen Rucklern: nichts ändert sich', () => {
  reset();
  // jedes siebte Bild ein Ruckler von 30 ms (Nachladen), sonst 8,3 ms – wie ein iPhone im Sprintfinale
  const frames: number[] = [];
  for (let i = 0; i < 1500; i++) frames.push(i % 7 === 0 ? 30 : 8.3);
  const r = run(frames);
  assert.equal(r.q, 1);
  assert.deepEqual(r.changes, []);
  assert.equal(rangeDrop(), 0);
});

test('60 Hz gleichmäßig: keine Änderung', () => {
  reset();
  assert.equal(run(rep(16.7, 600)).q, 1);
  assert.equal(rangeDrop(), 0);
});

test('Anlaufzeit zählt nicht: zähe erste Sekunden senken nichts', () => {
  reset();
  assert.equal(run([...rep(40, 60), ...rep(8.3, 600)]).q, 1);
  assert.equal(rangeDrop(), 0);
});

test('zu langsam: erst die Sichtweite kürzer, die Auflösung bleibt', () => {
  reset();
  // 25 ms je Bild; eine Stufe kürzer reicht (15 ms)
  const gov = new QualityGovernor(0.5);
  let ms = 25;
  for (let i = 0; i < 900; i++) {
    assert.equal(gov.frame(ms / 1000, 1), null);
    if (rangeDrop() > 0) ms = 15;
  }
  assert.equal(rangeDrop(), 1);
  assert.equal(viewRange().id, 'far');
  assert.equal(storedQuality(), 1);
});

test('kürzeste Sichtweite reicht nicht: dann die Auflösung', () => {
  reset();
  // zu langsam, egal wie kurz die Sicht – erst die kleinere Auflösung hilft
  const gov = new QualityGovernor(0.5);
  let q = 1;
  let ms = 25;
  const drops: number[] = [];
  const qs: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const nq = gov.frame(ms / 1000, q);
    if (nq !== null) { q = nq; qs.push(nq); ms = 15; }
    if (drops[drops.length - 1] !== rangeDrop()) drops.push(rangeDrop());
  }
  // Sichtweite ging eine Stufe runter, brachte nichts, zurück – dann die Auflösung (die sich danach wieder erholt)
  assert.deepEqual(drops, [0, 1, 0]);
  assert.equal(Math.round(qs[0] * 100), 90);
  assert.equal(rangeDrop(), 0);
});

test('Senken der Auflösung bringt nichts (Rechenzeit): zurück auf die alte Stufe und dabei bleiben', () => {
  reset();
  setViewRange('eco');
  const r = run(rep(25, 1000));
  assert.equal(r.q, 1);
  assert.deepEqual(r.changes.map((x) => Math.round(x * 100)), [90, 100]);
});

test('abwechselnd ein und zwei Takte bei 60 Hz (45 fps): gilt als zu langsam', () => {
  reset();
  const gov = new QualityGovernor(0.5);
  let acted = false;
  for (let i = 0; i < 600; i++) {
    const ms = acted ? 16.7 : i % 2 ? 16.7 : 33.3;
    gov.frame(ms / 1000, 1);
    if (rangeDrop() > 0) acted = true;
  }
  assert.ok(acted);
});

test('gespeicherte niedrige Stufe erholt sich auf einem flüssigen Gerät zügig: erst Auflösung, dann Sichtweite', () => {
  reset();
  setRangeDrop(2);
  // 60 s bei 120 Bildern je Sekunde
  const r = run(rep(8.3, 120 * 60), 0.5);
  assert.equal(r.q, 1);
  assert.equal(rangeDrop(), 0);
  assert.equal(viewRange().id, 'max');
});

test('ein Ruckelfenster zu Beginn hält die Fahrt nicht dauerhaft kurz oder unscharf', () => {
  reset();
  // nach der Anlaufzeit 3 s mit 30 ms je Bild (zu langsam), danach 90 s flüssig bei 8,3 ms
  const r = run([...rep(8.3, 400), ...rep(30, 100), ...rep(8.3, 120 * 90)]);
  assert.equal(r.q, 1);
  assert.equal(rangeDrop(), 0);
});

test('Wahl im Pausenmenü setzt die automatische Kürzung zurück', () => {
  reset();
  setRangeDrop(2);
  setViewRange('far');
  assert.equal(rangeDrop(), 0);
  assert.equal(viewRange().id, 'far');
});
