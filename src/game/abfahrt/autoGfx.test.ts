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
/** n Bilder im 60er-Takt; Anteil late verpasst seinen Takt; cpu ms je Bild */
function run(g: Gov, n: number, late: number, cpu = 3, target = 1000 / 60) {
  const out: string[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += late;
    const miss = acc >= 1;
    if (miss) acc -= 1;
    const ch = g.frame(miss, target, cpu, DT, true);
    if (ch) out.push(`${ch.kind}:${ch.text}`);
  }
  return out;
}
/** ruhig fahren, bis ein Probebild gewünscht wird – dann mit gpu ms beantworten */
function calmUntilProbe(g: Gov, gpu: number, max = 60 * 400): string[] {
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const ch = g.frame(false, 1000 / 60, 3, DT, true);
    if (ch) { out.push(`${ch.kind}:${ch.text}`); return out; }
    if (g.wantProbe()) g.setProbe(gpu);
  }
  return out;
}

test('zu langsam (Grafik am Limit): erst die Auflösung bis drei Viertel, dann die Sichtweite bis zur kürzesten', () => {
  store.delete('gruppetto.gfx.auto.zeitfahren');
  const g = new AutoGfx('zeitfahren');
  assert.equal(g.quality, 1);
  assert.equal(V.viewRange().id, 'max');
  // die ersten Sekunden zählen nicht
  assert.deepEqual(run(g, 160, 0.3), []);
  const ch: string[] = [];
  // jedes Mal etwas besser, aber noch zu langsam (die Auflösung hilft also)
  for (const late of [0.3, 0.3, 0.18, 0.18, 0.12]) ch.push(...run(g, 70, late));
  assert.ok(ch[0].startsWith('res:Auflösung 2-fach → 1,75-fach'), ch[0]);
  assert.ok(ch[1].startsWith('res:Auflösung 1,75-fach → 1,5-fach'), ch[1]);
  assert.equal(g.quality, RES_STEPS[2]);
  assert.ok(ch[2].startsWith('range:Sichtweite Max → Weit'), ch[2]);
  // weiter zu langsam: bis zur kürzesten Sichtweite, nicht weiter
  for (let i = 0; i < 40; i++) run(g, 70, 0.3);
  assert.equal(V.viewRange().label, 'Einfach');
  assert.equal(g.quality, 0.75);
  assert.equal(autoView().reduced, true);
  assert.equal(autoView().res, 1.5);
  g.dispose();
  assert.equal(V.viewRange().id, 'max');
});

test('Rechenzeit ist die Grenze: die Auflösung bleibt, gleich die Sichtweite kürzer', () => {
  store.delete('gruppetto.gfx.auto.sprint');
  const g = new AutoGfx('sprint');
  run(g, 160, 0, 12);
  const ch = run(g, 70, 0.3, 12);
  assert.ok(ch[0].startsWith('range:Sichtweite Max → Weit'), ch[0]);
  run(g, 70 * 9, 0.3, 12);
  assert.equal(g.quality, 1);
  assert.ok(V.autoRangeDrop() >= 3);
  // ganz unten bei der Sichtweite: dann doch die Auflösung
  run(g, 70 * 12, 0.3, 12);
  assert.equal(V.viewRange().label, 'Einfach');
  assert.equal(g.quality, 0.75);
  g.dispose();
});

test('wieder Luft: erst ein Probebild, dann zuerst die Sichtweite zurück – mit zu wenig Luft nicht', () => {
  store.delete('gruppetto.gfx.auto.berg');
  const g = new AutoGfx('berg');
  run(g, 160, 0);
  for (const late of [0.3, 0.3, 0.2, 0.2, 0.15]) run(g, 70, late);
  assert.equal(g.quality, 0.75);
  assert.equal(V.autoRangeDrop(), 1);
  // Grafik 12 ms: eine Stufe mehr Sicht (×1,3) wäre 15,6 ms – zu knapp, nichts passiert
  assert.deepEqual(calmUntilProbe(g, 12, 60 * 30), []);
  assert.equal(V.autoRangeDrop(), 1);
  // Grafik 7 ms: Sicht zurück, dann die Auflösung
  const a = calmUntilProbe(g, 7);
  assert.ok(a[0]?.startsWith('range:Sichtweite Weit → Max'), String(a[0]));
  const b = calmUntilProbe(g, 7);
  assert.ok(b[0]?.startsWith('res:Auflösung 1,5-fach → 1,75-fach'), String(b[0]));
  g.dispose();
});

test('Schritt hinauf ruckelt gleich wieder: zurück, der nächste Versuch erst nach doppelt so langer Ruhe', () => {
  store.delete('gruppetto.gfx.auto.abfahrt');
  const g = new AutoGfx('abfahrt');
  run(g, 160, 0);
  run(g, 70, 0.3);
  assert.equal(g.quality, 0.875);
  // 5 ruhige Urteile, dann Probe – hinauf
  const up = calmUntilProbe(g, 6);
  assert.ok(up[0]?.startsWith('res:Auflösung 1,75-fach → 2-fach'), String(up[0]));
  const back = run(g, 140, 0.3);
  assert.ok(back[0]?.startsWith('res:Auflösung 2-fach → 1,75-fach (zurück)'), String(back[0]));
  // jetzt dauert es länger bis zum nächsten Probebild
  let n = 0;
  while (!g.wantProbe() && n < 60 * 400) { g.frame(false, 1000 / 60, 3, DT, true); n++; }
  assert.ok(n > 70 * 9, `erst nach mindestens zehn ruhigen Urteilen (${n} Bilder)`);
  g.dispose();
});

test('merkt sich den Stand je Spiel (nur für dieselbe Wahl), Automatik aus regelt nichts, 120er-Takt zählt nicht', () => {
  store.delete('gruppetto.gfx.auto.zeitfahren');
  const g = new AutoGfx('zeitfahren');
  run(g, 160, 0);
  run(g, 70, 0.3);
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
  run(k, 160, 0);
  assert.deepEqual(run(k, 70 * 5, 0.4, 3, 1000 / 120), []);
  // Automatik aus: nichts
  G.setGfxAuto(false);
  assert.deepEqual(run(k, 70 * 5, 0.5), []);
  assert.equal(k.reset(true), false);
  G.setGfxAuto(true);
  k.dispose();
  G.setGfxRes(2);
});
