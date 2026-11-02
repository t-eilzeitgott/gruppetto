import { test } from 'node:test';
import assert from 'node:assert/strict';

// Speicher vor dem Laden der Module (sie lesen beim Start): Stufe 7 „Hoch“ (Sichtweite Max), 2-fache Auflösung
const store = new Map<string, string>([['gruppetto.gfx.stufe', '7'], ['gruppetto.gfx.aufl', '2']]);
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const G = await import('./gfxOpts.ts');
const V = await import('./viewRange.ts');
const { AutoGfx, RES_STEPS, autoView } = await import('./autoGfx.ts');
type Gov = InstanceType<typeof AutoGfx>;

const DT = 1 / 60;
const FRAME = 1000 / 60;

/**
 * Gerät als Modell: Grafikzeit je Bild aus der Auflösung (Bildpunkte) und der Sichtweite (je Stufe kürzer gut 12 %
 * weniger, rangeK), dazu ein fester Anteil (fixed – z. B. das ganze Fahrerfeld, unabhängig von beidem). Daraus der
 * Anteil verspäteter Bilder. Extra: Ruckler unabhängig von der Last (Anteil).
 */
interface Dev { pix: number; fixed?: number; rangeK?: number; cpu?: number; extra?: number }
function gpuOf(g: Gov, d: Dev) {
  return d.pix * g.quality ** 2 * (1 - (d.rangeK ?? 0.12) * V.autoRangeDrop()) + (d.fixed ?? 0);
}
function lateOf(gpu: number, extra = 0) {
  return Math.min(1, extra + (gpu > FRAME ? 0.6 : gpu > 14.5 ? 0.15 : 0));
}
/** n Bilder fahren; liefert die Änderungen */
function drive(g: Gov, d: Dev, n: number): string[] {
  const out: string[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const gpu = gpuOf(g, d);
    acc += lateOf(gpu, d.extra);
    const miss = acc >= 1;
    if (miss) acc -= 1;
    const ch = g.frame(miss, FRAME, d.cpu ?? 3, DT, true);
    if (ch) out.push(`${ch.kind}:${ch.text}`);
    if (g.wantProbe()) g.setProbe(gpu);
  }
  return out;
}

test('Grafik am Limit: erst die Auflösung bis drei Viertel, dann die Sichtweite – jeder Schritt mit Messung', () => {
  store.delete('gruppetto.gfx.auto.zeitfahren');
  const g = new AutoGfx('zeitfahren');
  assert.equal(g.quality, 1);
  assert.equal(V.viewRange().id, 'max');
  const dev: Dev = { pix: 28 };
  // die ersten Sekunden zählen nicht
  assert.deepEqual(drive(g, dev, 150), []);
  const ch = drive(g, dev, 70 * 40);
  assert.ok(ch[0].startsWith('res:Auflösung 2-fach → 1,75-fach'), ch[0]);
  assert.ok(ch[1].startsWith('res:Auflösung 1,75-fach → 1,5-fach'), ch[1]);
  assert.ok(ch[2].startsWith('range:Sichtweite Max → Weit'), ch[2]);
  assert.equal(g.quality, RES_STEPS[2]);
  // so weit, bis die Grafik passt (28 × 0,5625 × (1 − 0,12 d) unter 14,5 → eine Stufe kürzer), nicht weiter
  assert.equal(V.autoRangeDrop(), 1);
  assert.ok(gpuOf(g, dev) < 14.5);
  assert.equal(autoView().reduced, true);
  assert.equal(autoView().res, 1.5);
  g.dispose();
  assert.equal(V.viewRange().id, 'max');
});

test('Ruckler ohne Last (Grafik und Rechnen weit unter dem Takt): nichts wird gesenkt', () => {
  store.delete('gruppetto.gfx.auto.abfahrt');
  const g = new AutoGfx('abfahrt');
  const ch = drive(g, { pix: 7, extra: 0.12 }, 70 * 40);
  assert.equal(g.quality, 1);
  assert.equal(V.autoRangeDrop(), 0);
  assert.ok(ch.length >= 1 && ch.every((c) => c.startsWith('info:')), ch.join(' | '));
  assert.ok(ch[0].includes('keine Last'));
  g.dispose();
});

test('Rechenzeit ist die Grenze: die Auflösung bleibt, gleich die Sichtweite', () => {
  store.delete('gruppetto.gfx.auto.sprint');
  const g = new AutoGfx('sprint');
  // Rechnen 12 ms: zu spät, solange die Sicht lang ist (Modell: Grafik bleibt klein, Verspätung aus der Rechenzeit)
  const out: string[] = [];
  let acc = 0;
  for (let i = 0; i < 70 * 30; i++) {
    const cpu = 12 - 1.5 * V.autoRangeDrop();
    acc += cpu > 9.5 ? 0.2 : 0;
    const miss = acc >= 1;
    if (miss) acc -= 1;
    const ch = g.frame(miss, FRAME, cpu, DT, true);
    if (ch) out.push(`${ch.kind}:${ch.text}`);
    if (g.wantProbe()) g.setProbe(8 * (1 - 0.12 * V.autoRangeDrop()));
  }
  assert.ok(out[0].startsWith('range:Sichtweite Max → Weit'), out[0]);
  assert.equal(g.quality, 1);
  assert.equal(V.autoRangeDrop(), 2);
  g.dispose();
});

test('Senken bringt nichts (die Last ist das Fahrerfeld): zurück, und diese Art nicht weiter senken', () => {
  store.delete('gruppetto.gfx.auto.berg');
  const g = new AutoGfx('berg');
  // Bildpunkte wenig, fester Anteil (Fahrer) viel: die Auflösung hilft etwas, die Sichtweite gar nicht
  const dev: Dev = { pix: 4, fixed: 15, rangeK: 0 };
  const ch = drive(g, dev, 70 * 40);
  const ranges = ch.filter((c) => c.startsWith('range:'));
  assert.ok(ranges.length >= 1 && ranges[ranges.length - 1].includes('brachte nichts'), ch.join(' | '));
  assert.equal(V.autoRangeDrop(), 0);
  // und nicht wieder und wieder probiert
  assert.ok(ranges.length <= 2, `${ranges.length} Wechsel der Sichtweite`);
  g.dispose();
});

test('wieder Luft: erst ein Probebild, dann zuerst die Sichtweite zurück, dann die Auflösung – mit zu wenig Luft nicht', () => {
  store.delete('gruppetto.gfx.auto.berg');
  const g = new AutoGfx('berg');
  drive(g, { pix: 28 }, 70 * 40);
  assert.equal(g.quality, 0.75);
  assert.equal(V.autoRangeDrop(), 1);
  // gleiche Last: bleibt (Luft reicht nicht für den nächsten Schritt)
  assert.deepEqual(drive(g, { pix: 28 }, 70 * 30).filter((c) => !c.startsWith('info')), []);
  // Last fällt weg (Fahrerfeld zieht davon): Sicht zurück, dann Auflösung
  const up = drive(g, { pix: 10 }, 70 * 200);
  assert.ok(up[0]?.startsWith('range:Sichtweite Weit → Max'), String(up[0]));
  assert.equal(V.autoRangeDrop(), 0);
  assert.equal(g.quality, 1);
  g.dispose();
});

test('Schritt hinauf ruckelt gleich wieder: zurück, der nächste Versuch erst nach doppelt so langer Ruhe', () => {
  store.delete('gruppetto.gfx.auto.abfahrt');
  const g = new AutoGfx('abfahrt');
  drive(g, { pix: 17 }, 70 * 10);
  assert.equal(g.quality, 0.875);
  // Probebild misst wenig (ein ruhiger Moment), danach ist es wieder schwer
  let n = 0;
  while (!g.wantProbe() && n < 70 * 30) { g.frame(false, FRAME, 3, DT, true); n++; }
  g.setProbe(6);
  const up: string[] = [];
  for (let i = 0; i < 70 * 2 && !up.length; i++) { const ch = g.frame(false, FRAME, 3, DT, true); if (ch) up.push(ch.text); }
  assert.ok(up[0]?.startsWith('Auflösung 1,75-fach → 2-fach'), String(up[0]));
  const back = drive(g, { pix: 17 }, 70 * 3);
  assert.ok(back[0]?.startsWith('res:Auflösung 2-fach → 1,75-fach (zurück)'), String(back[0]));
  // jetzt dauert es länger bis zum nächsten Probebild
  n = 0;
  while (!g.wantProbe() && n < 70 * 400) { g.frame(false, FRAME, 3, DT, true); n++; }
  assert.ok(n > 70 * 9, `erst nach mindestens zehn ruhigen Urteilen (${n} Bilder)`);
  g.dispose();
});

test('merkt sich den Stand je Spiel (nur für dieselbe Wahl), Automatik aus regelt nichts, 120er-Takt zählt nicht', () => {
  store.delete('gruppetto.gfx.auto.zeitfahren');
  const g = new AutoGfx('zeitfahren');
  drive(g, { pix: 17 }, 70 * 6);
  assert.equal(g.quality, 0.875);
  g.dispose();
  // nächste Fahrt: beginnt dort
  const h = new AutoGfx('zeitfahren');
  assert.equal(h.quality, 0.875);
  h.dispose();
  // andere Auflösung gewählt: von vorn
  G.setGfxRes(1.5);
  const k = new AutoGfx('zeitfahren');
  assert.equal(k.quality, 1);
  // im 120er-Takt (Bild alle 8,3 ms) verpasste Takte: kein Grund zu senken
  for (let i = 0; i < 70 * 6; i++) { k.frame(i % 3 === 0, 1000 / 120, 3, DT, true); if (k.wantProbe()) k.setProbe(20); }
  assert.equal(k.quality, 1);
  // Automatik aus: nichts
  G.setGfxAuto(false);
  assert.deepEqual(drive(k, { pix: 40 }, 70 * 6), []);
  assert.equal(k.reset(true), false);
  G.setGfxAuto(true);
  k.dispose();
  G.setGfxRes(2);
});
