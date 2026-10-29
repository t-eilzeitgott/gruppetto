import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowUnits, roofKind, wallSet } from './house3d';
import { STYLE, TINTABLE, WALL_PAL, awningDetail, upperDetail } from './facade';
import { GB } from './models3d';
import { buildHouse, type HouseSpec } from './house3d';

test('Häuserzeile: lückenlos in ganze Fensterachsen geteilt, Nachbarn mit anderer Farbe, Höhen im Rahmen', () => {
  const pal = wallSet('toskana', 'it');
  for (let seed = 1; seed < 400; seed += 7) {
    for (const L of [6.1, 8, 9.7, 12, 14.3]) {
      for (const style of [STYLE.ocker, STYLE.haussmann, STYLE.fachwerk, STYLE.chalet]) {
        const u = rowUnits(L, style, 3, seed, pal);
        assert.ok(u.length >= 1);
        assert.equal(u[0].s0, 0);
        assert.ok(Math.abs(u[u.length - 1].s1 - L) < 1e-9, 'bis ans Ende');
        for (let i = 0; i < u.length; i++) {
          assert.ok(u[i].s1 - u[i].s0 >= 3.49, `breit genug (${(u[i].s1 - u[i].s0).toFixed(2)})`);
          if (i > 0) assert.equal(u[i].s0, u[i - 1].s1, 'ohne Lücke');
          if (i > 0 && u[i].tint >= 0) assert.notEqual(u[i].tint, u[i - 1].tint, 'Nachbarn verschieden');
          assert.ok(u[i].floors >= 1 && u[i].floors <= 5);
          if (TINTABLE[u[i].style]) assert.ok(u[i].tint >= 0 && u[i].tint < WALL_PAL.length, 'Wandfarbe aus der Palette');
        }
        if (style === STYLE.chalet) assert.equal(u.length, 1, 'Chalets stehen frei');
      }
    }
  }
});

test('Häuser: alle Dachformen bauen gültige Geometrie, Balkone und Markisen nur, wo sie hingehören', () => {
  const T = { facade: new GB(), tiles: new GB(), plain: new GB(), signs: new GB(), detail: new GB(), lanterns: [] as number[], bulbs: [] as number[], occ: [] as number[] };
  T.facade.uv = true; T.tiles.uv = true; T.signs.uv = true;
  const at = (lat: number, along: number, h: number) => [lat, h, along];
  for (const roof of ['gable', 'front', 'hip', 'mansard', 'flat'] as const) {
    for (const style of [STYLE.ocker, STYLE.haussmann, STYLE.chalet, STYLE.backstein, STYLE.fachwerk]) {
      for (const sg of [-1, 1]) {
        const spec: HouseSpec = {
          s0: 0, s1: 8, setback: 5, depth: 10, sg, style, floors: 3, seed: 42 + style, tint: TINTABLE[style] ? 3 : -1, roof,
          roofCol: [0.4, 0.15, 0.1], foot: -3.2, ovA: true, ovB: true, street: true, shop: { sign: 1, badge: -1 }, lantern: true, annex: true,
        };
        buildHouse(T, at, spec, 'it');
      }
    }
  }
  let uv: ArrayLike<number> = [];
  for (const g of [T.facade, T.tiles, T.plain, T.detail]) {
    const geo = g.build();
    const p = geo.getAttribute('position').array as Float32Array;
    assert.ok(p.length > 0 && p.length % 9 === 0);
    assert.ok(p.every(Number.isFinite), 'Lage: Zahlen');
    if (g === T.facade) uv = geo.getAttribute('uv').array as Float32Array;
  }
  // Fassade: ganzzahliger Anteil von u = Wandfarbe (3 bei den gefärbten Stilen)
  let maxU = 0;
  for (let i = 0; i < uv.length; i += 2) maxU = Math.max(maxU, uv[i]);
  assert.ok(maxU >= 3 && maxU <= 4.0001, `Farbindex im u (${maxU})`);
  // Balkone: Chalet aus Holz über die ganze Breite, Stadthaus in Variante 1 je Fensterachse aus Eisen
  assert.ok(upperDetail(STYLE.chalet, 0).balconies.every((b) => b.wood && b.x1 - b.x0 >= 3.9));
  assert.equal(upperDetail(STYLE.ocker, 1).balconies.length, 2);
  assert.equal(upperDetail(STYLE.ocker, 0).balconies.length, 0);
  assert.ok(awningDetail(STYLE.ocker, 1) && !awningDetail(STYLE.ocker, 0) && !awningDetail(STYLE.backstein, 1));
});

test('Dachformen: Flachdach nur im Süden, Walmdach nur frei stehend', () => {
  for (let k = 0; k < 200; k++) {
    const r = k / 200;
    assert.notEqual(roofKind(STYLE.ocker, 'dolomiten', 'it', true, r), 'flat');
    assert.notEqual(roofKind(STYLE.ocker, 'po', 'it', false, r), 'hip');
  }
  assert.ok(Array.from({ length: 50 }, (_, k) => roofKind(STYLE.ocker, 'andalusien', 'es', true, k / 50)).includes('flat'));
});
