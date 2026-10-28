import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finaleGrade, parseFinale } from './finale';

test('Neapel: Linkskurve 650 m, zwei Rechtskurven 400 m, Pflaster, 8 m, 4 %', () => {
  const s = parseFinale('Die letzten 3 km gerade am Hafen entlang. Linkskurve 650 m vor dem Ziel in einen leichten Anstieg (4 %) über die gepflasterte Via Acton, zwei Rechtskurven 400 m vor dem Ziel auf die 8 m breite, gepflasterte Zielgerade.')!;
  assert.deepEqual(s.corners, [{ at: 650, dir: 'L', n: 1 }, { at: 400, dir: 'R', n: 2 }]);
  assert.equal(s.lastCorner, 400);
  assert.equal(s.width, 8);
  assert.equal(s.cobblesFrom, 650);
  assert.equal(s.grade, 0.04);
  assert.equal(s.waterfront, true);
  assert.equal(finaleGrade(s, 200), 0.04);
});

test('Burgas: letzte Kurve 300 m, letzter Kilometer steigt leicht an', () => {
  const s = parseFinale('Breite, überwiegend gerade Straßen. Der letzte Kilometer steigt leicht an, letzte Kurve 300 m vor dem Ziel, Zielgerade 8 m breit.')!;
  assert.equal(s.lastCorner, 300);
  assert.equal(s.corners[0].dir, null);
  assert.equal(s.width, 8);
  assert.equal(s.lastKmGrade, 0.02);
  assert.equal(finaleGrade(s, 800), 0.02);
  assert.equal(finaleGrade(s, 1500), null);
  assert.equal(s.cobblesFrom, null);
});

test('Cosenza: Zielgerade 450 m mit 3,7 %', () => {
  const s = parseFinale('Die letzten 3 km auf breiten Stadtstraßen mit einigen Kurven, leicht steigend bis zur Brücke über den Crati. Über weite Kurven auf die Zielgerade (450 m, 3,7 % Steigung), 8 m breit.')!;
  assert.equal(s.straight, 450);
  assert.equal(s.lastCorner, 450);
  assert.equal(s.grade, 0.037);
  assert.match(s.line, /3,7 %/);
});

test('Novi Ligure: letzte Kurve 3 km, Zielgerade 2.800 m, Kreisverkehre', () => {
  const s = parseFinale('Die letzten 3 km fast gerade mit Kreisverkehren ohne große Umwege. Letzte Kurve 3.000 m vor dem Ziel – die Zielgerade ist 2.800 m lang, 7,5 m breit.')!;
  assert.equal(s.lastCorner, 3000);
  assert.equal(s.straight, 2800);
  assert.equal(s.width, 7.5);
  assert.equal(s.roundabouts, true);
});

test('Verbania: Zielgerade 300 m, 7 m breit, sonst nichts', () => {
  const s = parseFinale('Die letzten 3 km am See: erst breit und fast gerade, dann kurviger entlang des Ufers und etwas schmaler. Zielgerade 300 m, 7 m breit.')!;
  assert.equal(s.straight, 300);
  assert.equal(s.lastCorner, 300);
  assert.equal(s.grade, null);
  assert.equal(s.waterfront, true);
});

test('Sofia: Ziel auf 8 m breiter Straße, letzter Kilometer flach, kein Kurvenmaß', () => {
  const s = parseFinale('Die letzten 8 km praktisch gerade und ganz leicht abfallend, der letzte Kilometer flach. Ziel auf 8 m breiter Straße.')!;
  assert.equal(s.lastCorner, null);
  assert.equal(s.width, 8);
  assert.equal(s.lastKmGrade, 0);
});

test('Chiavari: Uferpromenade 1 km vor dem Ziel, kleiner Anstieg 150 m', () => {
  const s = parseFinale('Nur zwei Kurven im Finale: rechts auf die Uferpromenade 1 km vor dem Ziel und ein letzter kleiner Anstieg 150 m vor dem Ziel auf die 8 m breite Zielgerade.')!;
  assert.equal(s.corners[0].at, 1000);
  assert.equal(s.corners[0].dir, 'R');
  assert.equal(s.corners.length, 1);
  assert.equal(s.lastCorner, 1000);
});

test('leer → null', () => {
  assert.equal(parseFinale(''), null);
  assert.equal(parseFinale(null), null);
});
