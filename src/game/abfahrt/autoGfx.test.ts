import { test } from 'node:test';
import assert from 'node:assert/strict';

// Speicher vor dem Laden der Module (sie lesen beim Start): Stufe 7 „Hoch“ (Sichtweite Max, Sonnenschatten), 2-fache Auflösung
const store = new Map<string, string>([['gruppetto.gfx.stufe', '7'], ['gruppetto.gfx.aufl', '2']]);
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const G = await import('./gfxOpts.ts');
const V = await import('./viewRange.ts');
const S = await import('./shadowRate.ts');
const { AutoGfx, RES_STEPS, autoView } = await import('./autoGfx.ts');
type Gov = InstanceType<typeof AutoGfx>;

const DT = 1 / 60;
const FRAME = 1000 / 60;
const fresh = (scope: string) => { store.delete(`gruppetto.gfx.auto3.${scope}`); return new AutoGfx(scope); };

/**
 * Gerät als Modell: Grafikzeit je Bild aus der Auflösung (Bildpunkte), der Sichtweite (je Stufe kürzer gut 12 %
 * weniger, rangeK) und der Schattenkarte (jedes Bild: 15 % der Grafik; seltener entsprechend weniger), dazu ein
 * fester Anteil (fixed – z. B. das ganze Fahrerfeld). Wie in den Wechselfahrten auf dem iPhone (Version 261–264):
 * bis 8 ms Grafik fast kein Bild zu spät (3–4 je Minute), ab 9 ms gut ein Dutzend je Minute und je ms mehr noch
 * einmal so viele, ab 17 ms (die Grafik braucht länger als der Takt) jedes zweite. Extra: Ruckler unabhängig von
 * der Last (Hochladen, Hauptfaden)
 */
interface Dev { pix: number; fixed?: number; rangeK?: number; cpu?: number; extra?: number }
function gpuOf(g: Gov, d: Dev) {
  const shade = 1 - 0.15 * (1 - 1 / g.shadowEvery);
  return d.pix * g.quality ** 2 * (1 - (d.rangeK ?? 0.12) * V.autoRangeDrop()) * shade + (d.fixed ?? 0);
}
/** Anteil verspäteter Bilder und Bildzeit eines verspäteten (ms) */
function lateOf(gpu: number, extra = 0): [number, number] {
  const p = Math.min(1, (gpu >= 17 ? 0.5 : gpu <= 8 ? 0.001 : 0.004 * (gpu - 8)) + extra);
  return [p, gpu >= 17 ? Math.ceil(gpu / (1000 / 120)) * (1000 / 120) : 33.3];
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
const kindsOf = (ch: string[]) => ch.map((c) => c.split(':')[0]);
/** Gerät, das nur in voller Auflösung zu langsam ist (Grafik 14 ms, darunter 3 ms) */
const onlyFull = (p = 0.3) => (gg: Gov) => ({ p: gg.quality === 1 ? p : 0.001, lateMs: 33, gpu: gg.quality === 1 ? 14 : 3 });

test('Grafik am Limit: erst die Auflösung bis drei Viertel (weit daneben: zwei Schritte auf einmal), dann die Sichtweite – bis die Grafik unter der Grenze liegt', () => {
  const g = fresh('zeitfahren');
  assert.equal(g.quality, 1);
  assert.equal(V.viewRange().id, 'max');
  const dev: Dev = { pix: 26 };
  // die ersten Sekunden zählen nicht
  assert.deepEqual(drive(g, dev, 80), []);
  const ch = changes(drive(g, dev, 70 * 60));
  assert.ok(ch[0].startsWith('res:Auflösung 2-fach → 1,5-fach'), ch[0]);
  assert.ok(ch[1].startsWith('range:Sichtweite Max → Weit'), ch[1]);
  assert.ok(!ch.some((c) => c.includes('zurück')), ch.join(' | '));
  assert.equal(g.quality, RES_STEPS[2]);
  // bis die Grafik unter der Grenze (9,2 ms) liegt
  const gpu = gpuOf(g, dev);
  assert.ok(gpu < 0.55 * FRAME, `Grafik ${gpu.toFixed(1)} ms`);
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

test('reicht auch die kürzeste Sicht nicht: Schattenkarte jedes zweite Bild, dann die Auflösung weiter bis zur Hälfte – und hinauf in umgekehrter Folge', () => {
  const g = fresh('zeitfahren');
  const ch = changes(drive(g, { pix: 52 }, 70 * 120));
  const kinds = kindsOf(ch);
  assert.ok(ch[0].startsWith('res:Auflösung 2-fach → 1,5-fach'), ch[0]);
  const shadow = kinds.indexOf('shadow');
  const res2 = kinds.indexOf('res', 1);
  assert.ok(shadow > 1 && kinds.slice(1, shadow).every((k) => k === 'range'), ch.join(' | '));
  assert.ok(res2 > shadow, `Schatten (${shadow}) vor der zweiten Auflösungsphase (${res2}): ${ch.join(' | ')}`);
  assert.ok(ch[shadow].includes('Schattenkarte jedes Bild → alle 2 Bilder'), ch[shadow]);
  assert.equal(V.autoRangeDrop(), V.rangeDropMax());
  assert.equal(S.shadowEveryN(), 2);
  assert.equal(g.quality, 0.5);
  assert.equal(autoView().shadow, 2);
  const gpu = gpuOf(g, { pix: 52 });
  assert.ok(gpu < 0.55 * FRAME, `Grafik ${gpu.toFixed(1)} ms`);
  // wieder Luft: die Auflösung bis drei Viertel zurück, dann die Schattenkarte jedes Bild, dann die Sicht, dann ganz
  const up = changes(drive(g, { pix: 5 }, 70 * 500));
  const uk = kindsOf(up);
  assert.deepEqual(uk, ['res', 'res', 'shadow', 'range', 'range', 'range', 'range', 'res', 'res'], up.join(' | '));
  assert.equal(g.quality, 1);
  assert.equal(V.autoRangeDrop(), 0);
  assert.equal(S.shadowEveryN(), 1);
  g.dispose();
});

test('ohne Sonnenschatten (Stufe 5) wird der Schatten-Schritt übersprungen; mit Schatten geht es bis „alle 4 Bilder“', () => {
  G.setGfxLevel(5);
  const g = fresh('zeitfahren');
  const ch = changes(drive(g, { pix: 52 }, 70 * 120));
  assert.ok(!kindsOf(ch).includes('shadow'), ch.join(' | '));
  assert.equal(g.quality, 0.5);
  g.dispose();
  G.setGfxLevel(7);
  // (ein fester Anteil, den weder Auflösung noch Sicht senken – nur die Schattenkarte)
  const h = fresh('zeitfahren');
  const ch2 = changes(drive(h, { pix: 20, fixed: 7 }, 70 * 160));
  assert.ok(ch2.some((c) => c.includes('alle 2 Bilder → alle 4 Bilder')), ch2.join(' | '));
  assert.equal(S.shadowEveryN(), 4);
  h.dispose();
  assert.equal(S.shadowEveryN(), 1);
});

test('die Sichtweite gehört dem laufenden Spiel: ein altes, das sich später verabschiedet, setzt sie nicht zurück', () => {
  const g = fresh('berg');
  drive(g, { pix: 30 }, 70 * 40);
  const d = V.autoRangeDrop();
  assert.ok(d >= 1);
  // altes Spiel (vorher angelegt) räumt erst jetzt auf: darf nichts zurücksetzen
  const old = new AutoGfx('zeitfahren');
  const g2 = new AutoGfx('berg');
  old.dispose();
  assert.equal(V.autoRangeDrop(), d);
  // und hat es doch jemand zurückgesetzt (auch die Schattenkarte): beim nächsten Bild wieder der eigene Stand
  V.setAutoRangeDrop(0);
  S.setShadowEvery(8);
  g2.frame(false, FRAME, 3, DT, true);
  assert.equal(V.autoRangeDrop(), d);
  assert.equal(S.shadowEveryN(), g2.shadowEvery);
  g.dispose();
  g2.dispose();
  assert.equal(V.autoRangeDrop(), 0);
});

test('Ruckler bei kleiner Grafik (die kein Senken behebt): Probebild, dann nichts gesenkt – auch in Schüben von 30 oder 60 %', () => {
  const g = fresh('abfahrt');
  const ch = drive(g, { pix: 4, extra: 0.15 }, 70 * 60);
  assert.equal(g.quality, 1);
  assert.equal(V.autoRangeDrop(), 0);
  assert.deepEqual(changes(ch), []);
  assert.ok(ch.some((c) => c.startsWith('info:') && c.includes('nicht gesenkt')), ch.join(' | '));
  // (nicht jedes Fenster ein Probebild – jedes wartet auf die Grafik)
  assert.ok(ch.length <= 8, `${ch.length} Notizen`);
  g.dispose();
  for (const p of [0.3, 0.6]) {
    const h = fresh('abfahrt');
    const ch2 = run(h, 70 * 6, () => ({ p, lateMs: 33, gpu: 8 }));
    assert.deepEqual(changes(ch2), [], ch2.join(' | '));
    assert.ok(ch2.some((c) => c.includes('nicht gesenkt')), ch2.join(' | '));
    h.dispose();
  }
});

test('ein gutes Dutzend Ruckler je Minute genügt – wenn die Grafik über der Grenze liegt (10 ms: gesenkt; 8 ms: nicht)', () => {
  // 0,5 % der Bilder zu spät (18 je Minute), Probebild 10 ms
  const g = fresh('abfahrt');
  const ch = changes(run(g, 70 * 14, (gg) => ({ p: gg.quality === 1 ? 0.005 : 0, lateMs: 33, gpu: gg.quality === 1 ? 10 : 6 })));
  assert.ok(ch[0]?.startsWith('res:Auflösung 2-fach → 1,75-fach'), String(ch[0]));
  assert.ok(ch[0].includes('Grafik 10.0 ms'), ch[0]);
  g.dispose();
  // dieselben Ruckler bei 8 ms Grafik (der saubere Bereich): bleibt
  const h = fresh('abfahrt');
  const ch2 = run(h, 70 * 20, () => ({ p: 0.005, lateMs: 33, gpu: 8 }));
  assert.deepEqual(changes(ch2), [], ch2.join(' | '));
  h.dispose();
  // nur ein Ruckler in zehn Sekunden (6 je Minute): kein Urteil, kein Probebild
  const k = fresh('abfahrt');
  const ch3 = run(k, 70 * 20, () => ({ p: 1 / 600, lateMs: 33, gpu: 12 }));
  assert.deepEqual(ch3, []);
  k.dispose();
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
  // erst kühl: Ruckler bei 8 ms Grafik – bleibt oben
  const cool = drive(g, { pix: 8, extra: 0.08 }, 70 * 12);
  assert.deepEqual(changes(cool), [], cool.join(' | '));
  assert.equal(g.quality, 1);
  // dann gedrosselt: dieselbe Szene kostet das Doppelte (16 → 22 ms) – hinab, bis die Grafik unter der Grenze liegt
  const hot = drive(g, { pix: 22 }, 70 * 60);
  const ch = changes(hot);
  assert.ok(ch.length >= 1, hot.join(' | '));
  assert.ok(!hot.some((c) => c.includes('zurück') || c.includes('brachte nichts')), hot.join(' | '));
  const gpu = gpuOf(g, { pix: 22 });
  assert.ok(gpu < 0.55 * FRAME, `am Ende ${gpu.toFixed(1)} ms Grafik`);
  // ein Schub zu später Bilder bei kleiner Grafik (Ausreißer-Fenster) ändert nichts
  const q = g.quality;
  const d = V.autoRangeDrop();
  run(g, 70 * 3, () => ({ p: 0.94, lateMs: 33, gpu: 8 }));
  assert.ok(g.quality === q && V.autoRangeDrop() === d);
  g.dispose();
});

test('wieder Luft: erst ein Probebild, dann Schritt für Schritt zurück – mit zu wenig Luft nicht, und nicht, solange es noch ein Dutzend mal je Minute ruckelt', () => {
  const g = fresh('berg');
  drive(g, { pix: 30 }, 70 * 60);
  assert.ok(g.quality <= 0.75, String(g.quality));
  const d0 = V.autoRangeDrop();
  assert.ok(d0 >= 1);
  // gleiche Last: bleibt (Luft reicht nicht für den nächsten Schritt)
  assert.deepEqual(changes(drive(g, { pix: 30 }, 70 * 40)), []);
  // etwas Luft, aber noch gut ein Dutzend Ruckler je Minute (alle 250 Bilder): bleibt
  const q = g.quality;
  assert.deepEqual(changes(run(g, 70 * 40, () => ({ p: 1 / 250, lateMs: 33, gpu: 3 }))), []);
  assert.equal(g.quality, q);
  // Last fällt weg (Fahrerfeld zieht davon): zurück bis ganz oben
  const up = changes(drive(g, { pix: 5 }, 70 * 400));
  assert.ok(up.length >= 2, up.join(' | '));
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
  const back = run(g, 70 * 4, onlyFull());
  assert.ok(back[0]?.startsWith('res:Auflösung 2-fach → 1,75-fach (zurück'), String(back[0]));
  // jetzt dauert es länger bis zum nächsten Probebild
  n = 0;
  while (!g.wantProbe() && n < 70 * 400) { g.frame(false, FRAME, 3, DT, true); n++; }
  assert.ok(n > 70 * 9, `erst nach mindestens zehn ruhigen Urteilen (${n} Bilder)`);
  g.dispose();
});

test('merkt sich den Stand je Spiel und Wahl (auch die Schattenkarte); eine neue Wahl beginnt bei derselben Pixeldichte; Automatik aus regelt nichts; 120er-Takt zählt nicht', () => {
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
  // Schattenkarte gemerkt: nach der Fahrt beginnt die nächste gleich mit „alle 2 Bilder“ – eine Stufe ohne Schatten nicht
  const s = fresh('berg');
  drive(s, { pix: 20, fixed: 7 }, 70 * 100);
  assert.ok(s.shadow >= 1, `Schatten-Schritt ${s.shadow}`);
  const every = s.shadowEvery;
  s.dispose();
  assert.equal(S.shadowEveryN(), 1);
  const s2 = new AutoGfx('berg');
  assert.equal(s2.shadowEvery, every);
  assert.equal(S.shadowEveryN(), every);
  s2.dispose();
  G.setGfxLevel(5);
  const s3 = new AutoGfx('berg');
  assert.equal(s3.shadowEvery, 1);
  s3.dispose();
  G.setGfxLevel(7);
});
