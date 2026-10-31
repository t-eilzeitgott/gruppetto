import { test } from 'node:test';
import assert from 'node:assert/strict';

// Speicher mit der früheren Einzelwahl (Landschaftsdetails an) – erst danach das Modul laden (es liest beim Start)
const store = new Map<string, string>([['gruppetto.gfx.details', '1']]);
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const G = await import('./gfxOpts.ts');
const { viewRange } = await import('./viewRange.ts');

test('frühere Einzelschalter werden zur Stufe (Landschaftsdetails an → Stufe 7 „Hoch“)', () => {
  assert.equal(G.gfxLevel(), 7);
  assert.equal(store.get('gruppetto.gfx.stufe'), '7');
  assert.equal(G.gfxOn('details'), true);
  assert.equal(G.gfxOn('schatten'), true);
  assert.equal(G.gfxOn('licht'), false);
  assert.equal(viewRange().id, 'max');
});

test('zehn Stufen von Low bis PC: nach oben kommt nur hinzu, nichts fällt weg', () => {
  assert.equal(G.GFX_LEVELS.length, 10);
  const order = ['lite', 'eco', 'normal', 'far', 'max', 'ultra', 'extreme'];
  for (let i = 1; i < G.GFX_LEVELS.length; i++) {
    const a = G.GFX_LEVELS[i - 1];
    const b = G.GFX_LEVELS[i];
    assert.ok(order.indexOf(b.range) >= order.indexOf(a.range), `Sichtweite ${i + 1}`);
    for (const k of ['schatten', 'details', 'licht', 'pc', 'aa'] as const) assert.ok(!a[k] || b[k], `${k} bleibt an (Stufe ${i + 1})`);
    assert.ok(a.lite || !b.lite, `schlicht nur unten (Stufe ${i + 1})`);
  }
  assert.equal(G.GFX_LEVELS[0].lite, true);
  assert.equal(G.GFX_LEVELS[9].pc, true);
});

test('Stufe wechseln: Schalter, Sichtweite, Takt und Meldungen folgen', () => {
  const seen: string[] = [];
  let any = 0;
  const off = G.onGfxChange((k, on) => seen.push(`${k}=${on}`));
  const offAny = G.onGfxSettings(() => { any += 1; });
  G.setGfxLevel(1);
  assert.equal(G.gfxOn('lite'), true);
  assert.equal(G.gfxAA(), false);
  assert.equal(G.gfxMinFps(), 30);
  assert.equal(viewRange().label, 'Einfach');
  assert.deepEqual(seen, ['lite=true', 'schatten=false', 'details=false']);
  G.setGfxLevel(10);
  assert.equal(G.gfxOn('pc'), true);
  assert.equal(G.gfxOn('licht'), true);
  assert.equal(G.gfxMinFps(), 60);
  assert.equal(viewRange().id, 'extreme');
  G.setGfxLevel(10); // keine Änderung → keine Meldung
  assert.equal(any, 2);
  off();
  offAny();
  assert.equal(store.get('gruppetto.gfx.stufe'), '10');
});

test('Auflösung getrennt von der Stufe: bleibt beim Stufenwechsel, meldet sich beim Ändern', () => {
  let any = 0;
  const off = G.onGfxSettings(() => { any += 1; });
  G.setGfxRes(1.75);
  assert.equal(G.gfxRes(), 1.75);
  G.setGfxLevel(3);
  assert.equal(G.gfxRes(), 1.75);
  assert.equal(any, 2);
  off();
  assert.equal(store.get('gruppetto.gfx.aufl'), '1.75');
  // wählbar ab 0,5-fach in Viertelschritten
  const st = G.resSteps();
  assert.equal(st[0], 0.5);
  for (let i = 1; i < st.length; i++) assert.ok(st[i] > st[i - 1]);
});
