import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPeaks, isPcPeaks, peakLight, peakSunUpdate } from './peaks3d';

test('Berge am Horizont: PC-Fassung feiner, mit Schlagschatten, die der Sonne folgen', () => {
  const L = peakLight();
  L.uSunDir.value.set(0.6, 0.25, -0.4).normalize();
  const lo = buildPeaks('pass', L);
  const pc = buildPeaks('pass', L, true);
  assert.equal(isPcPeaks(lo), false);
  assert.equal(isPcPeaks(pc), true);
  const nLo = lo.geometry.getAttribute('position').count;
  const nPc = pc.geometry.getAttribute('position').count;
  assert.ok(nPc > nLo * 15, `fein: ${nPc} Punkte statt ${nLo}`);
  const sun = pc.geometry.getAttribute('aSun0').array as Float32Array;
  let lit = 0;
  let shade = 0;
  for (const v of sun) { assert.ok(v >= 0 && v <= 1); if (v > 0.9) lit++; if (v < 0.1) shade++; }
  assert.ok(lit > sun.length * 0.1 && shade > sun.length * 0.05, `Licht und Schatten: ${lit} hell, ${shade} dunkel von ${sun.length}`);
  // Sonne höher: weniger Schatten; neu gerechnet in aSun1, Überblendung beginnt bei 0
  const it = peakSunUpdate(pc, new THREE.Vector3(0.3, 0.8, -0.2).normalize());
  let r = it.next();
  while (!r.done) r = it.next();
  assert.equal(r.value, true);
  const next = pc.geometry.getAttribute('aSun1').array as Float32Array;
  let shade2 = 0;
  for (const v of next) if (v < 0.1) shade2++;
  assert.ok(shade2 < shade, `hohe Sonne, weniger Schatten: ${shade2} statt ${shade}`);
  assert.equal((pc.material as THREE.ShaderMaterial).uniforms.uSunMix.value, 0);
});
