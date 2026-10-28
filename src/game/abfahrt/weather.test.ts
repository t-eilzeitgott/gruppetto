import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHERS, weatherForRun, noteRunStart, runsToday } from './weather.ts';

test('Abfolge über den Tag: fünfmal Goldene Stunde, dann Wetterumschwung und Nebel je zweimal im Wechsel', () => {
  const seq = Array.from({ length: 19 }, (_, i) => weatherForRun(i + 1));
  assert.deepEqual(seq.slice(0, 9), ['gold', 'gold', 'gold', 'gold', 'gold', 'storm', 'nebel', 'storm', 'nebel']);
  // danach von vorn
  assert.deepEqual(seq.slice(9, 18), seq.slice(0, 9));
  assert.equal(seq[18], 'gold');
  // unsinnige Eingaben fallen auf die erste Fahrt zurück
  assert.equal(weatherForRun(0), 'gold');
  assert.equal(weatherForRun(-3), 'gold');
});

test('Fahrten des Tages zählen (Speicher je Tag)', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  assert.equal(runsToday('2027-05-09'), 0);
  assert.equal(noteRunStart('2027-05-09'), 1);
  assert.equal(noteRunStart('2027-05-09'), 2);
  assert.equal(runsToday('2027-05-09'), 2);
  // neuer Tag: von vorn
  assert.equal(runsToday('2027-05-10'), 0);
  assert.equal(noteRunStart('2027-05-10'), 1);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('jeder Stil hat eine Tageszeit vor dem Sonnenuntergang und plausible Werte', () => {
  for (const L of Object.values(WEATHERS)) {
    assert.ok(L.tod[0] >= 0 && L.tod[1] <= 0.7 && L.tod[0] <= L.tod[1], L.name);
    assert.ok(L.contrast > 0.8 && L.contrast < 1.5, L.name);
    assert.ok(L.vignette >= 0 && L.vignette <= 1, L.name);
  }
});
