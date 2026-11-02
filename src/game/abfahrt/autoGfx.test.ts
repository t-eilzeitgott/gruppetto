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
const fresh = (scope: string) => { store.delete(`gruppetto.gfx.auto3.${scope}`); return new AutoGfx(scope); };

/**
 * Gerät als Modell: Grafikzeit je Bild aus der Auflösung (Bildpunkte) und der Sichtweite (je Stufe kürzer gut 12 %
 * weniger, rangeK), dazu ein fester Anteil (fixed – z. B. das ganze Fahrerfeld, unabhängig von beidem). Wie in den
 * Messfahrten auf dem iPhone verpassen schon ab gut 6 ms Grafikzeit Bilder ihren Takt (das Zusammensetzen des
 * Bildschirms kommt dazu) – je mehr Grafik, desto mehr und desto länger. Extra: Ruckler unabhängig von der Last.
 */
interface Dev { pix: number; fixed?: number; rangeK?: number; cpu?: number; extra?: number }
function gpuOf(g: Gov, d: Dev) {
  return d.pix * g.quality ** 2 * (1 - (d.rangeK ?? 0.12) * V.autoRangeDrop()) + (d.fixed ?? 0);
}
/** Anteil verspäteter Bilder und Bildzeit eines verspäteten (ms) */
function lateOf(gpu: number, extra = 0): [number, number] {
  const p = Math.min(1, Math.max(0, (gpu - 6) / 20) + extra);
  return [p, Math.max(25, Math.ceil(gpu / (1000 / 120)) * (1000 / 120))];
}
/** n Bilder fahren (mit Modell oder fester Vorgabe je Zustand); liefert die Änderungen */
function run(g: Gov, n: number, model: (g: Gov) => { p: number; lateMs: number; cpu?: number; gpu: number }): string[] {
  const out: string[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const m = model(g);
    acc += m.p;
    const miss = acc >= 1;
    if (miss) acc -= 1;
    const ch = g.frame(miss, FRAME, m.cpu ?? 3, (miss ? m.lateMs : FRAME) / 1000, true);
    if (ch) out.push(`${ch.kind}:${ch.text}`);
    if (g.wantProbe()) g.setProbe(m.gpu);
  }
  return out;
}
function drive(g: Gov, d: Dev, n: number): string[] {
  return run(g, n, (gg) => { const gpu = gpuOf(gg, d); const [p, lateMs] = lateOf(gpu, d.extra); return { p, lateMs, gpu, cpu: d.cpu }; });
}
const changes = (ch: string[]) => ch.filter((c) => !c.startsWith('info:'));
/** Gerät, das nur in voller Auflösung zu langsam ist */
const onlyFull = (p = 0.3) => (gg: Gov) => ({ p: gg.quality === 1 ? p : 0, lateMs: 25, gpu: gg.quality === 1 ? 9 : 3 });

test('Grafik am Limit: erst die Auflösung bis drei Viertel (weit daneben: zwei Schritte auf einmal), dann die Sichtweite – solange es hilft', () => {
  const g = fresh('zeitfahren');
  assert.equal(g.quality, 1);
  assert.equal(V.viewRange().id, 'max');
  const dev: Dev = { pix: 20 };
  // die ersten Sekunden zählen nicht
  assert.deepEqual(drive(g, dev, 80), []);
  const ch = changes(drive(g, dev, 70 * 40));
  assert.ok(ch[0].startsWith('res:Auflösung 2-fach → 1,5-fach'), ch[0]);
  assert.ok(ch[1].startsWith('range:Sichtweite Max → Weit'), ch[1]);
  assert.ok(!ch.some((c) => c.includes('zurück')), ch.join(' | '));
  assert.equal(g.quality, RES_STEPS[2]);
  // so weit, bis kaum noch Bilder zu spät kommen – nicht weiter
  const p = lateOf(gpuOf(g, dev))[0];
  assert.ok(p <= 0.08, `noch ${p} zu spät`);
  assert.ok(lateOf(gpuOf(g, dev) / (1 - 0.12 * V.autoRangeDrop()) * (1 - 0.12 * (V.autoRangeDrop() - 1)))[0] > 0.08, 'eine Stufe weniger hätte gereicht');
  assert.equal(autoView().reduced, true);
  assert.equal(autoView().res, 1.5);
  g.dispose();
  assert.equal(V.viewRange().id, 'max');
});

test('weit daneben (alle Bilder zu spät): der erste Schritt fällt nach einem halben Fenster, in gut zwei Sekunden Fahrt', () => {
  const g = fresh('zeitfahren');
  let frames = 0;
  let first = '';
  for (; frames < 70 * 10 && !first; frames++) {
    const ch = g.frame(true, FRAME, 3, 0.03, true);
    if (ch && ch.kind !== 'info') first = ch.text;
    if (g.wantProbe()) g.setProbe(20);
  }
  assert.ok(first.startsWith('Auflösung 2-fach → 1,5-fach'), first);
  // 1,5 s Aufwärmen bei 33 Bildern je Sekunde (50 Bilder), dann 35 zu späte Bilder, ein Probebild
  assert.ok(frames <= 50 + 37, `${frames} Bilder bis zum ersten Schritt`);
  g.dispose();
});

test('reicht auch die kürzeste Sicht nicht: die Auflösung weiter bis zur Hälfte', () => {
  const g = fresh('zeitfahren');
  const ch = changes(drive(g, { pix: 30 }, 70 * 80));
  const kinds = ch.map((c) => c.split(':')[0]);
  assert.equal(kinds[0], 'res');
  assert.ok(ch[0].startsWith('res:Auflösung 2-fach → 1,5-fach'), ch[0]);
  const firstRes2 = kinds.indexOf('res', 1);
  assert.ok(firstRes2 > 1 && kinds.slice(1, firstRes2).every((k) => k === 'range'), ch.join(' | '));
  assert.equal(V.autoRangeDrop(), V.rangeDropMax());
  assert.ok(g.quality < 0.75 && g.quality >= 0.5, String(g.quality));
  // wieder Luft: zuerst die Auflösung bis drei Viertel zurück, dann die Sicht
  const up = changes(drive(g, { pix: 5 }, 70 * 400));
  assert.ok(up[0]?.startsWith('res:Auflösung'), String(up[0]));
  assert.ok(up.some((c) => c.startsWith('range:')), up.join(' | '));
  assert.equal(g.quality, 1);
  assert.equal(V.autoRangeDrop(), 0);
  g.dispose();
});

test('die Sichtweite gehört dem laufenden Spiel: ein altes, das sich später verabschiedet, setzt sie nicht zurück', () => {
  const g = fresh('berg');
  drive(g, { pix: 20 }, 70 * 40);
  const d = V.autoRangeDrop();
  assert.ok(d >= 1);
  // altes Spiel (vorher angelegt) räumt erst jetzt auf: darf nichts zurücksetzen
  const old = new AutoGfx('zeitfahren');
  const g2 = new AutoGfx('berg');
  old.dispose();
  assert.equal(V.autoRangeDrop(), d);
  // und hat es doch jemand zurückgesetzt: beim nächsten Bild wieder der eigene Stand
  V.setAutoRangeDrop(0);
  g2.frame(false, FRAME, 3, DT, true);
  assert.equal(V.autoRangeDrop(), d);
  g.dispose();
  g2.dispose();
  assert.equal(V.autoRangeDrop(), 0);
});

test('leicht zu spät bei kleiner Grafik (Ruckler, die kein Senken behebt): Probebild, dann nichts gesenkt', () => {
  const g = fresh('abfahrt');
  const ch = drive(g, { pix: 4, extra: 0.15 }, 70 * 60);
  assert.equal(g.quality, 1);
  assert.equal(V.autoRangeDrop(), 0);
  assert.deepEqual(changes(ch), []);
  assert.ok(ch.some((c) => c.startsWith('info:') && c.includes('nicht gesenkt')), ch.join(' | '));
  // (nicht jedes Fenster ein Probebild – jedes wartet auf die Grafik)
  assert.ok(ch.length <= 8, `${ch.length} Notizen`);
  g.dispose();
});

test('Schub zu später Bilder bei kleiner Grafik (Hauptfaden stand): nichts gesenkt – auch bei 30 oder 60 %', () => {
  for (const p of [0.3, 0.6]) {
    const g = fresh('abfahrt');
    const ch = run(g, 70 * 6, () => ({ p, lateMs: 33, gpu: 6 }));
    assert.deepEqual(changes(ch), [], ch.join(' | '));
    assert.ok(ch.some((c) => c.includes('nicht gesenkt')), ch.join(' | '));
    g.dispose();
  }
});

test('leicht zu spät, aber die Grafik braucht gut die Hälfte des Takts: wird gesenkt', () => {
  const g = fresh('abfahrt');
  // 13 % zu spät, Probebild 10 ms (wie Messfahrt 255 bei 1,5-fach/Kurz)
  const ch = changes(run(g, 70 * 6, (gg) => ({ p: gg.quality === 1 ? 0.13 : 0, lateMs: 25, gpu: gg.quality === 1 ? 10 : 6 })));
  assert.ok(ch[0]?.startsWith('res:Auflösung 2-fach → 1,75-fach'), String(ch[0]));
  assert.ok(ch[0].includes('Grafik 10.0 ms'), ch[0]);
  g.dispose();
});

test('Rechenzeit ist die Grenze: die Auflösung bleibt, gleich die Sichtweite', () => {
  const g = fresh('sprint');
  // Rechnen 12 ms bei voller Sicht, je Stufe kürzer 1,5 ms weniger; Grafik klein
  const out = changes(run(g, 70 * 30, () => {
    const cpu = 12 - 1.5 * V.autoRangeDrop();
    return { p: Math.min(1, Math.max(0, (cpu - 8) / 10)), lateMs: 25, cpu, gpu: 4 };
  }));
  assert.ok(out[0].startsWith('range:Sichtweite Max → Weit'), out[0]);
  assert.equal(g.quality, 1);
  assert.ok(V.autoRangeDrop() >= 2, String(V.autoRangeDrop()));
  g.dispose();
});

test('das Telefon drosselt mitten in der Fahrt (Grafik plötzlich doppelt so teuer): weiter senken, nie zurück, solange es ruckelt', () => {
  const g = fresh('berg');
  // erst kühl: 11 % zu spät bei 8 ms Grafik – bleibt oben (Messfahrt 255, die ersten 16 s)
  const cool = drive(g, { pix: 8, extra: 0.03 }, 70 * 12);
  assert.deepEqual(changes(cool), [], cool.join(' | '));
  assert.equal(g.quality, 1);
  // dann gedrosselt: dieselbe Szene kostet das Doppelte – Fenster für Fenster hinab
  const hot = drive(g, { pix: 22 }, 70 * 40);
  const ch = changes(hot);
  assert.ok(ch.length >= 3, hot.join(' | '));
  assert.ok(!hot.some((c) => c.includes('zurück') || c.includes('brachte nichts')), hot.join(' | '));
  // am Ende kaum noch zu spät – oder nur noch leicht, bei einer Grafik unter der halben Taktzeit (Bodensatz)
  const p = lateOf(gpuOf(g, { pix: 22 }))[0];
  assert.ok(p <= 0.08 || (p <= 0.12 && gpuOf(g, { pix: 22 }) < 0.5 * FRAME), `am Ende noch ${Math.round(p * 100)} % zu spät bei ${gpuOf(g, { pix: 22 }).toFixed(1)} ms Grafik`);
  // ein Ausreißer-Fenster (94 % zu spät, Ortsdurchfahrt) nimmt nichts zurück
  const q = g.quality;
  const d = V.autoRangeDrop();
  run(g, 70, () => ({ p: 0.94, lateMs: 33, gpu: 15 }));
  assert.ok(g.quality <= q && V.autoRangeDrop() >= d);
  g.dispose();
});

test('wieder Luft: erst ein Probebild, dann zuerst die Sichtweite zurück, dann die Auflösung – mit zu wenig Luft nicht', () => {
  const g = fresh('berg');
  drive(g, { pix: 20 }, 70 * 40);
  assert.equal(g.quality, 0.75);
  const d0 = V.autoRangeDrop();
  assert.ok(d0 >= 1);
  // gleiche Last: bleibt (Luft reicht nicht für den nächsten Schritt)
  assert.deepEqual(changes(drive(g, { pix: 20 }, 70 * 30)), []);
  // Last fällt weg (Fahrerfeld zieht davon): Sicht zurück, dann Auflösung
  const up = changes(drive(g, { pix: 5 }, 70 * 300));
  assert.ok(up[0]?.startsWith('range:Sichtweite'), String(up[0]));
  assert.equal(V.autoRangeDrop(), 0);
  assert.equal(g.quality, 1);
  g.dispose();
});

test('Schritt hinauf ruckelt gleich wieder: zurück, der nächste Versuch erst nach doppelt so langer Ruhe', () => {
  const g = fresh('abfahrt');
  for (let i = 0; i < 20 && g.quality === 1; i++) run(g, 70, onlyFull());
  assert.equal(g.quality, 0.875);
  // Probebild misst wenig (ein ruhiger Moment), danach ist es wieder schwer
  let n = 0;
  while (!g.wantProbe() && n < 70 * 30) { g.frame(false, FRAME, 3, DT, true); n++; }
  g.setProbe(3);
  const up: string[] = [];
  for (let i = 0; i < 70 * 2 && !up.length; i++) { const ch = g.frame(false, FRAME, 3, DT, true); if (ch) up.push(ch.text); }
  assert.ok(up[0]?.startsWith('Auflösung 1,75-fach → 2-fach'), String(up[0]));
  const back = run(g, 70 * 3, onlyFull());
  assert.ok(back[0]?.startsWith('res:Auflösung 2-fach → 1,75-fach (zurück)'), String(back[0]));
  // jetzt dauert es länger bis zum nächsten Probebild
  n = 0;
  while (!g.wantProbe() && n < 70 * 400) { g.frame(false, FRAME, 3, DT, true); n++; }
  assert.ok(n > 70 * 9, `erst nach mindestens zehn ruhigen Urteilen (${n} Bilder)`);
  g.dispose();
});

test('merkt sich den Stand je Spiel und Wahl; eine neue Wahl beginnt bei derselben Pixeldichte; Automatik aus regelt nichts; 120er-Takt zählt nicht', () => {
  const g = fresh('zeitfahren');
  run(g, 70 * 6, onlyFull());
  assert.equal(g.quality, 0.875);
  g.dispose();
  // nächste Fahrt: beginnt dort
  const h = new AutoGfx('zeitfahren');
  assert.equal(h.quality, 0.875);
  h.dispose();
  // größere Auflösung gewählt: beginnt bei der Pixeldichte, die zuletzt reichte (1,75 → 2,5 · 0,625 = 1,56)
  G.setGfxRes(2.5);
  const j = new AutoGfx('zeitfahren');
  assert.equal(j.quality, 0.625);
  j.dispose();
  // andere Stufe: ebenso (die Sichtweite aber wie gewählt)
  G.setGfxLevel(5);
  const m = new AutoGfx('zeitfahren');
  assert.equal(m.quality, 0.625);
  assert.equal(V.autoRangeDrop(), 0);
  m.dispose();
  G.setGfxLevel(7);
  // kleinere Auflösung gewählt (1,5 ≤ 1,75): ganz oben
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
