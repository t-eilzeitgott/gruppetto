import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journeyAt, mapXY, ROUTE, ROUTE_KM } from './journey';

test('Europareise: Route steigt in Kilometern, Ortslage liegt auf der Karte', () => {
  for (let i = 1; i < ROUTE.length; i++) assert.ok(ROUTE[i].km > ROUTE[i - 1].km, `${ROUTE[i].name} nach ${ROUTE[i - 1].name}`);
  for (const s of ROUTE) {
    const [x, y] = mapXY(s.lon, s.lat);
    assert.ok(x >= 20 && x <= 300 && y >= 20 && y <= 550, `${s.name} auf der Karte (${x.toFixed(0)}, ${y.toFixed(0)})`);
  }
  assert.equal(ROUTE[0].name, 'Wuppertal');
  assert.equal(ROUTE[ROUTE.length - 1].name, 'Palermo');
});

test('Europareise: Stand aus Metern – Ort, nächster Ort, Restweg, Runden', () => {
  const start = journeyAt(0);
  assert.equal(start.at, 0);
  assert.equal(ROUTE[start.next].name, 'Köln');
  assert.equal(start.toNext, 45);
  const p = journeyAt(620_000);
  assert.equal(ROUTE[p.at].name, 'Basel');
  assert.equal(ROUTE[p.next].name, 'Luzern');
  assert.equal(Math.round(p.toNext), 90);
  assert.ok(p.frac > 0.05 && p.frac < 0.15);
  const end = journeyAt(ROUTE_KM * 1000 - 1);
  assert.equal(ROUTE[end.at].name, 'Agrigent');
  const again = journeyAt(ROUTE_KM * 1000 + 50_000);
  assert.equal(again.lap, 2);
  assert.equal(ROUTE[again.at].name, 'Köln');
});
