import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eleAt, kmSegments, parseGpx, stageNumberFromName } from './gpx';

// 20 km nach Norden: 10 km flach auf 200 m, dann 10 km Anstieg auf 1.000 m (8 %)
function track(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 200; i += 1) {
    const km = i * 0.1;
    const lat = 45 + km / 111.195;
    const ele = km <= 10 ? 200 : 200 + (km - 10) * 80;
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="7.000000"><ele>${ele.toFixed(1)}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Testetappe</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('GPX: Distanz, Höhenmeter und Höhen', () => {
  const p = parseGpx(track())!;
  assert.ok(Math.abs(p.distanceKm - 20) < 0.1, `Distanz ${p.distanceKm}`);
  assert.ok(Math.abs(p.gainM - 800) < 30, `Höhenmeter ${p.gainM}`);
  assert.equal(p.startM, 200);
  assert.ok(Math.abs(p.finishM - 1000) < 30);
  assert.equal(p.name, 'Testetappe');
  assert.ok(p.points.length <= 700);
});

test('GPX: Steigung je Kilometer', () => {
  const p = parseGpx(track())!;
  const segs = kmSegments(p.points, 11, 19);
  assert.equal(segs.length, 8);
  for (const s of segs) assert.ok(Math.abs(s.grade - 8) < 0.6, `Steigung ${s.grade}`);
  assert.ok(Math.abs(eleAt(p.points, 15) - 600) < 15);
});

test('GPX: kaputte Datei ergibt null', () => {
  assert.equal(parseGpx('<gpx></gpx>'), null);
});

test('Etappennummer aus Dateinamen', () => {
  assert.equal(stageNumberFromName('giro-2026-stage-7.gpx'), 7);
  assert.equal(stageNumberFromName('Tappa 07 Formia-Blockhaus.gpx'), 7);
  assert.equal(stageNumberFromName('E12.gpx'), 12);
  assert.equal(stageNumberFromName('giro2026_21.gpx'), 21);
});
