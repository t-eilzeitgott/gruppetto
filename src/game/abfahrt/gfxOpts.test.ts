import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GFX_OPTS, gfxOn, gfxOwn, onGfxChange, setGfx } from './gfxOpts';

test('Grafik-Schalter: anfangs nur Schatten an, Umschalten meldet sich', () => {
  for (const o of GFX_OPTS) assert.equal(gfxOn(o.id), o.id === 'schatten', `${o.id} Vorgabe`);
  setGfx('schatten', false);
  const seen: string[] = [];
  const off = onGfxChange((k, on) => seen.push(`${k}=${on}`));
  setGfx('details', true);
  setGfx('details', true); // keine Änderung → keine Meldung
  assert.equal(gfxOn('details'), true);
  setGfx('schatten', true);
  off();
  setGfx('details', false);
  setGfx('schatten', false);
  assert.deepEqual(seen, ['details=true', 'schatten=true']);
  setGfx('schatten', true);
  assert.equal(gfxOn('details'), false);
});

test('PC-Grafik schaltet alles andere mit ein und meldet das', () => {
  setGfx('licht', false);
  setGfx('details', false);
  const seen: string[] = [];
  const off = onGfxChange((k, on) => seen.push(`${k}=${on}`));
  setGfx('pc', true);
  assert.equal(gfxOn('licht'), true);
  assert.equal(gfxOn('details'), true);
  assert.equal(gfxOwn('details'), false, 'die eigene Wahl bleibt');
  setGfx('pc', false);
  off();
  assert.equal(gfxOn('licht'), false);
  assert.deepEqual(seen, ['pc=true', 'licht=true', 'details=true', 'pc=false', 'licht=false', 'details=false']);
});
