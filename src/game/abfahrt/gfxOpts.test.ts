import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GFX_OPTS, gfxOn, onGfxChange, setGfx } from './gfxOpts';

test('Grafik-Schalter: anfangs alles aus, Umschalten meldet sich', () => {
  for (const o of GFX_OPTS) assert.equal(gfxOn(o.id), false, `${o.id} anfangs aus`);
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
  assert.equal(gfxOn('details'), false);
});
