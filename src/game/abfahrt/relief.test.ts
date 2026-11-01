import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_HALF, SEG, TT_FINISH, Track } from './track';

test('sichtbare Steigung: überhöht, gleichmäßig steigend, symmetrisch, steile Rampen kaum', () => {
  let prev = -Infinity;
  for (let g = -0.2; g <= 0.2; g += 0.0025) {
    const v = Track.shown(g);
    assert.ok(v > prev, `steigend bei ${g}`);
    assert.ok(Math.abs(v + Track.shown(-g)) < 1e-12, 'symmetrisch');
    prev = v;
  }
  assert.equal(Track.shown(0), 0);
  // 2 % sieht man deutlich (über 4 %), 9 % werden keine Wand (unter 12 %)
  assert.ok(Track.shown(0.02) > 0.04 && Track.shown(0.02) < 0.05);
  assert.ok(Track.shown(0.09) > 0.1 && Track.shown(0.09) < 0.12);
  for (const g of [0.01, 0.03, 0.06, 0.12]) assert.ok(Track.shown(g) >= g, 'nie flacher als echt');
});

test('Abfahrt bleibt echt, Rennen überhöht – Fahrphysik und Profilkarte rechnen mit der echten Steigung', () => {
  const d = new Track('2027-05-09');
  for (let i = 0; i < 2000; i += 13) assert.equal(d.seg(i).dy, d.seg(i).grade);
  const t = new Track('2027-05-09', [], 'tt');
  // Startrampe (Podest und Rampe sind feste Modelle): echt
  for (let z = 0; z < 40; z += SEG) assert.equal(t.segAt(z).dy, t.segAt(z).grade);
  for (let i = 30; i < TT_FINISH / SEG; i += 7) {
    const s = t.seg(i);
    assert.equal(s.dy, Track.shown(s.grade));
    // Höhen passen zu den Steigungen (sichtbar wie echt)
    assert.ok(Math.abs(t.seg(i + 1).y - (s.y + s.dy * SEG)) < 1e-9);
    assert.ok(Math.abs(t.seg(i + 1).yr - (s.yr + s.grade * SEG)) < 1e-9);
  }
});

test('Relief der Fahrbahn: nur mit relief, eben in Tunneln und auf der Startrampe, stetig, begrenzt, läuft neben der Straße aus', () => {
  const t = new Track('2027-05-09', [], 'tt');
  assert.equal(t.lift(500, 1), 0, 'ohne relief eben');
  const w = { x: 0, y: 0, z: 0, th: 0 };
  const flat = t.world(500, 1, 0, w).y;
  t.relief = true;
  for (let z = 0; z < 40; z += 1) for (const x of [-2.5, 0, 2.5]) assert.equal(t.lift(z, x), 0, 'Startrampe eben');
  let maxD = 0, any = 0;
  for (let z = 80; z < TT_FINISH; z += 0.5) {
    for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 0.35) {
      const l = t.lift(z, x);
      assert.ok(Math.abs(l) < 0.45, `begrenzt bei ${z}/${x}: ${l}`);
      maxD = Math.max(maxD, Math.abs(t.lift(z + 0.05, x) - l), Math.abs(t.lift(z, x + 0.05) - l));
      any = Math.max(any, Math.abs(l));
    }
    assert.equal(t.lift(z, 10), 0, 'weit neben der Straße kein Relief');
  }
  assert.ok(any > 0.05, 'das Relief ist zu sehen');
  assert.ok(maxD < 0.03, `stetig (größter Sprung ${maxD})`);
  // Lage auf der Straße folgt dem Relief, die Mitte für die Physik (heightAt) nicht
  assert.ok(Math.abs(t.world(500, 1, 0, w).y - (flat + t.lift(500, 1))) < 1e-9);
  assert.ok(Math.abs(t.world(500, 1, 0, w, true).y - flat) < 1e-9);
  // Abfahrt: im Tunnel eben
  const d = new Track('2027-05-09');
  d.relief = true;
  let tunnels = 0;
  for (let i = 0; i < 3000; i++) {
    const s = d.seg(i);
    if (!s.tunnel || !d.seg(i + 1).tunnel) continue;
    tunnels++;
    for (const x of [-2, 0, 2]) assert.equal(d.liftRow(i, x), 0);
  }
  assert.ok(tunnels > 0);
});
