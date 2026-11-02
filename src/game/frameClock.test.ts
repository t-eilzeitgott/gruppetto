import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock } from './frameClock';

/** Uhr mit den Aufrufen (Zeitstempel) füttern; liefert die Schritte der gezeichneten Bilder in ms */
function run(stamps: number[]): { dts: number[]; drawn: number[]; clock: FrameClock } {
  const clock = new FrameClock(stamps[0]);
  const dts: number[] = [];
  const drawn: number[] = [];
  for (let i = 1; i < stamps.length; i++) {
    if (!clock.ready(stamps[i])) continue;
    dts.push(clock.tick(stamps[i]) * 1000);
    drawn.push(stamps[i]);
  }
  return { dts, drawn, clock };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const P60 = 1000 / 60;
const P120 = 1000 / 120;

test('Safari-Stempel (auf ganze ms gerundet): gleichmäßige Schritte statt 17 – 17 – 16', () => {
  const stamps = Array.from({ length: 900 }, (_, i) => Math.floor(5000 + i * P60));
  const { dts } = run(stamps);
  for (const d of dts.slice(120)) assert.ok(Math.abs(d - P60) < 0.7, `Schritt ${d.toFixed(3)} ms`);
  // die Spielzeit läuft mit der echten Zeit
  assert.ok(Math.abs(sum(dts) - (stamps[stamps.length - 1] - stamps[0])) < P60);
});

test('verrauschte Stempel (±1,5 ms): Schritte bleiben fast genau ein Takt', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const stamps = Array.from({ length: 900 }, (_, i) => 1000 + i * P60 + (rnd() - 0.5) * 3);
  const { dts } = run(stamps);
  for (const d of dts.slice(120)) assert.ok(Math.abs(d - P60) < 0.8, `Schritt ${d.toFixed(3)} ms`);
  assert.ok(Math.abs(sum(dts) - (stamps[stamps.length - 1] - stamps[0])) < P60);
});

test('ein ausgefallenes Bild: das nächste rückt so weit vor, wie das alte stand – danach wieder ein Takt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 400; i++) { stamps.push(t); t += i === 300 ? 2 * P60 : P60; }
  const { dts } = run(stamps);
  assert.ok(Math.abs(dts[300] - 2 * P60) < 1, `Schritt nach dem Ausfall ${dts[300].toFixed(2)} ms`);
  for (const d of dts.slice(301, 330)) assert.ok(Math.abs(d - P60) < 0.8, `danach ${d.toFixed(2)} ms`);
  const real = stamps[339] - stamps[0];
  assert.ok(Math.abs(sum(dts.slice(0, 339)) - real) < 1.5, `Rückstand ${(real - sum(dts.slice(0, 339))).toFixed(2)} ms`);
});

test('120-Hz-Bildschirm, der jeden Takt schafft: voller Takt', () => {
  const stamps = Array.from({ length: 900 }, (_, i) => Math.floor(i * P120));
  const { dts, clock } = run(stamps);
  assert.ok(Math.abs(clock.period - P120) < 0.1, `Takt ${clock.period}`);
  assert.equal(clock.div, 1);
  for (const d of dts.slice(200)) assert.ok(Math.abs(d - P120) < 0.6, `Schritt ${d.toFixed(3)} ms`);
});

/**
 * 120-Hz-Telefon mit Grafik im Hintergrund (bis zu zwei Bilder unterwegs): ein Bild braucht 2 ms Rechenzeit und
 * 10–14 ms Grafik, gezeigt wird es zum ersten Takt nach seiner Fertigstellung. Liefert die Abstände, in denen die
 * Bilder auf dem Schirm erscheinen, und die Spielzeit-Schritte.
 */
function phone(pace: boolean) {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const clock = new FrameClock(0);
  clock.pace = pace;
  const shown: number[] = [];
  const dts: number[] = [];
  const flight: number[] = [];
  let gpuFree = 0;
  for (let v = 1; v < 3600; v++) {
    const now = v * P120;
    while (flight.length && flight[0] <= now + 1e-6) shown.push(flight.shift()!);
    if (flight.length >= 2) continue; // Warteschlange voll: kein Aufruf
    const t = Math.floor(now);
    if (!clock.ready(t)) continue;
    dts.push(clock.tick(t) * 1000);
    const done = Math.max(now + 2, gpuFree) + 10 + rnd() * 4;
    gpuFree = done;
    flight.push(Math.ceil(done / P120 - 1e-6) * P120);
  }
  const gaps = shown.slice(1).map((x, i) => x - shown[i]).slice(200);
  return { clock, gaps, dts: dts.slice(200) };
}

test('120-Hz-Telefon, das den vollen Takt nicht schafft: fester Takt von 60 Bildern je Sekunde, gleichmäßig', () => {
  const free = phone(false);
  const evenFree = free.gaps.filter((g) => Math.abs(g - P60) < 1).length / free.gaps.length;
  // ohne festen Takt: mal zwei, mal drei Takte (das Ruckeln)
  assert.ok(evenFree < 0.85, `ohne festen Takt ${Math.round(evenFree * 100)} % gleichmäßig`);
  const paced = phone(true);
  assert.equal(paced.clock.div, 2, 'jeder zweite Takt');
  const even = paced.gaps.filter((g) => Math.abs(g - P60) < 1).length / paced.gaps.length;
  assert.ok(even > 0.97, `mit festem Takt ${Math.round(even * 100)} % gleichmäßig`);
  for (const d of paced.dts) assert.ok(Math.abs(d - P60) < 1, `Schritt ${d.toFixed(2)} ms`);
});

test('Gerät schafft nur jeden zweiten Takt (30 Bilder/s): Schritte von zwei Takten', () => {
  const stamps = Array.from({ length: 600 }, (_, i) => i * 2 * P60);
  const { dts } = run(stamps);
  for (const d of dts.slice(200)) assert.ok(Math.abs(d - 2 * P60) < 0.5, `Schritt ${d.toFixed(3)} ms`);
});

test('abwechselnd ein und zwei Takte: jeder Schritt passt zu seinem Abstand, Spielzeit stimmt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 900; i++) { stamps.push(t); t += (i & 1) ? 2 * P60 : P60; }
  const { dts, drawn } = run(stamps);
  for (let i = 200; i < dts.length; i++) assert.ok(Math.abs(dts[i] - (drawn[i] - drawn[i - 1])) < 0.8, `Schritt ${i}`);
  const real = stamps[stamps.length - 1] - stamps[0];
  assert.ok(Math.abs(sum(dts) - real) < 3 * P60, `Spielzeit ${sum(dts).toFixed(0)} statt ${real.toFixed(0)} ms`);
});

test('75-Hz-Bildschirm: als 75 Hz erkannt (nicht 72)', () => {
  const stamps = Array.from({ length: 600 }, (_, i) => 100 + i * (1000 / 75));
  const { clock } = run(stamps);
  assert.ok(Math.abs(clock.period - 1000 / 75) < 0.05, `Takt ${clock.period}`);
});

test('nach einer langen Pause wird nichts nachgeholt', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 200; i++) { stamps.push(t); t += i === 150 ? 3000 : P60; }
  const { dts } = run(stamps);
  for (const d of dts) assert.ok(d < P60 * 2.1, `Schritt ${d.toFixed(2)} ms`);
});

test('kurz falsch erkannter Takt (90 Hz, dann 120 Hz): nie seltener als 60 Bilder je Sekunde', () => {
  const stamps: number[] = [];
  let t = 0;
  // erst 90 Hz in Zweierschritten, dann 120 Hz
  for (let i = 0; i < 200; i++) { t += 2000 / 90; stamps.push(t); }
  for (let i = 0; i < 1200; i++) { t += P120; stamps.push(t); }
  const { clock } = run(stamps);
  assert.ok(clock.target <= P60 + 1, `Takt ${clock.target.toFixed(1)} ms`);
});

test('falsch erkannter Takt (90, 100, 144, 240 Hz) und langsame Bilder: der feste Takt bleibt bei höchstens 16,7 ms', () => {
  for (const hz of [60, 72, 75, 90, 100, 120, 144, 165, 240]) {
    const clock = new FrameClock(0);
    clock.period = 1000 / hz;
    // Bilder, die jeden Takt verpassen (25 ms auf dem echten 120-Hz-Schirm)
    let t = 0;
    for (let i = 0; i < 2000; i++) { t += 25; clock.tick(t); }
    assert.ok(clock.target <= P60 + 1, `${hz} Hz: Takt ${clock.target.toFixed(1)} ms (jeder ${clock.div}.)`);
  }
});

test('langsames Gerät (Bilder brauchen 20 ms) in jeder Grafikstufe: der feste Takt bleibt bei 60, nie 30', () => {
  // 60-Hz-Schirm: mal 17, mal 33 ms – früher sprang die unterste Stufe fest auf 30
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 900; i++) { t += (i % 3 === 0) ? P60 : 2 * P60; stamps.push(t); }
  const clock = new FrameClock(0);
  for (const x of stamps) if (clock.ready(x)) clock.tick(x);
  assert.equal(clock.div, 1);
  assert.ok(clock.target <= P60 + 1);
});

test('120-Hz-iPhone unter Last (Aufrufe auch nach 12,5 und 21 ms): bleibt bei 120 Hz, nie 240', () => {
  // erst ruhig jeder Takt, dann unter Last mal 1, 2, 1,5, 2,5 Takte – nie ein Abstand von 4 ms
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 120; i++) { t += P120; stamps.push(Math.floor(t)); }
  const pat = [2, 1.5, 2, 2.5, 2, 3, 1.5, 2];
  for (let i = 0; i < 1500; i++) { t += pat[i % pat.length] * P120; stamps.push(Math.floor(t)); }
  const clock = new FrameClock(0);
  let p240 = false;
  for (const x of stamps) { if (clock.ready(x)) clock.tick(x); if (clock.period < 5) p240 = true; }
  assert.ok(!p240, '240 Hz erkannt');
  assert.ok(Math.abs(clock.period - P120) < 0.1, `Takt ${clock.period.toFixed(2)}`);
});

test('einzelne verpasste Takte (jedes zehnte Bild) senken nicht unter 60', () => {
  const stamps: number[] = [];
  let t = 0;
  for (let i = 0; i < 1500; i++) { t += i % 10 === 9 ? 2 * P60 : P60; stamps.push(t); }
  const clock = new FrameClock(0);
  for (const x of stamps) if (clock.ready(x)) clock.tick(x);
  assert.equal(clock.div, 1);
});

// ---------------------------------------------------------------- Safari auf dem iPhone

/**
 * Safari auf dem 120-Hz-iPhone: Aufrufe nur zu Bildschirmtakten, aber der Zeitstempel ist die Zeit, zu der das
 * Skript drankommt – auf ganze ms abgerundet, 0–3 ms nach dem Takt (tail: jeder 30. bis 5 ms; late: dieser Anteil
 * 3–7 ms, der Hauptfaden war beschäftigt – der nächste kommt wieder pünktlich). Solange die Grafik am
 * letzten Bild arbeitet, kommt kein Aufruf (Rückstau; inFlight: so viele Bilder dürfen unterwegs sein). Ein Bild
 * braucht 2 ms Rechenzeit und gpu() ms Grafik (±8 %); gezeigt wird es zwei Takte nach seinem Aufruf oder, wenn die
 * Grafik länger braucht, zum ersten Takt danach.
 */
function safari(o: { gpu: (v: number) => number; inFlight?: number; hz?: (v: number) => number; frames?: number; seed?: number; tail?: boolean; late?: number }) {
  let seed = o.seed ?? 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const clock = new FrameClock(0, { apple: true });
  const shown: number[] = [];
  const dts: number[] = [];
  const periods: number[] = [];
  const flight: { done: number; show: number }[] = [];
  let gpuFree = 0;
  let t = 0;
  for (let v = 1; v < (o.frames ?? 7200); v++) {
    const P = 1000 / (o.hz ? o.hz(v) : 120);
    t += P;
    while (flight.length && flight[0].show <= t + 1e-6) shown.push(flight.shift()!.show);
    if (flight.filter((f) => f.done > t).length >= (o.inFlight ?? 1)) continue;
    const jit = o.late && rnd() < o.late ? 3 + rnd() * 4 : o.tail && rnd() < 0.03 ? 3 + rnd() * 2 : rnd() * 3;
    const stamp = Math.floor(t + jit);
    if (!clock.ready(stamp)) { periods.push(clock.period); continue; }
    dts.push(clock.tick(stamp) * 1000);
    periods.push(clock.period);
    const done = Math.max(t + jit + 2, gpuFree) + o.gpu(v) * (0.92 + rnd() * 0.16);
    gpuFree = done;
    flight.push({ done, show: Math.max(t + 2 * P, Math.ceil(done / P - 1e-6) * P) });
  }
  const gaps = shown.slice(1).map((x, i) => x - shown[i]);
  return { clock, gaps, dts, periods };
}
const share = (a: number[], f: (x: number) => boolean) => a.filter(f).length / Math.max(1, a.length);

test('Safari, 120-Hz-iPhone, Grafik 11 ms: immer 120 Hz erkannt, gleichmäßig 60 Bilder je Sekunde, kein Ausfall', () => {
  for (const inFlight of [1, 2]) {
    const r = safari({ gpu: () => 11, inFlight });
    // (mit nur einem Bild unterwegs kommt nie ein Aufruf nach 8,3 ms – dann sieht es aus wie ein 60-Hz-Schirm, und das
    // ist dann auch richtig)
    assert.ok(Math.abs(r.clock.target - P60) < 0.01, `Bildtakt ${r.clock.target.toFixed(1)} ms`);
    if (inFlight > 1) assert.ok(r.periods.slice(60).every((p) => Math.abs(p - P120) < 0.01), `Takt ${[...new Set(r.periods.map((p) => Math.round(1000 / p)))].join('/')} Hz`);
    const g = r.gaps.slice(120);
    const even = share(g, (x) => Math.abs(x - P60) < 1);
    assert.ok(even > 0.99, `${inFlight} unterwegs: ${Math.round(even * 100)} % gleichmäßig`);
    assert.ok(g.every((x) => x < 2 * P60 - 1), `längste Lücke ${Math.max(...g).toFixed(1)} ms`);
    if (inFlight > 1) for (const d of r.dts.slice(120)) assert.ok(Math.abs(d - P60) < 1.2, `Schritt ${d.toFixed(2)} ms`);
  }
});

test('Safari: Aufrufe manchmal bis 5 ms spät dran – kein Bild fällt aus, fast alle gleichmäßig', () => {
  for (const inFlight of [1, 2]) {
    const r = safari({ gpu: () => 11, inFlight, tail: true });
    const g = r.gaps.slice(120);
    // (ein paar Bilder kommen einen Takt zu spät: der Aufruf kam spät dran und die Grafik wird nicht rechtzeitig fertig
    // – das liegt nicht am Takt)
    const even = share(g, (x) => Math.abs(x - P60) < 1);
    assert.ok(even > 0.94, `${inFlight} unterwegs: ${Math.round(even * 100)} % gleichmäßig`);
    assert.ok(g.every((x) => x < 2 * P60 - 1), `längste Lücke ${Math.max(...g).toFixed(1)} ms`);
  }
});

test('Safari, 120-Hz-iPhone, leichte Grafik (5 ms): volle 120 Bilder je Sekunde', () => {
  const r = safari({ gpu: () => 5, inFlight: 2 });
  assert.equal(r.clock.div, 1);
  assert.ok(Math.abs(r.clock.period - P120) < 0.01);
  const even = share(r.gaps.slice(200), (x) => Math.abs(x - P120) < 1);
  assert.ok(even > 0.97, `${Math.round(even * 100)} % im vollen Takt`);
});

test('Safari: erst schwer (nur Aufrufe alle 16,7 ms, sieht aus wie 60 Hz), dann leicht, dann wieder schwer – bleibt bei 120 Hz und gleichmäßigen 60', () => {
  for (const inFlight of [1, 2]) {
    const r = safari({ gpu: (v) => (v < 600 ? 11 : v < 1200 ? 5 : 11), inFlight });
    const after = r.periods.slice(1300);
    assert.ok(after.every((p) => Math.abs(p - P120) < 0.01), `${inFlight} unterwegs: zurück auf 60 Hz gefallen`);
    const tail = r.gaps.slice(-1500);
    const even = share(tail, (x) => Math.abs(x - P60) < 1);
    assert.ok(even > 0.99, `${inFlight} unterwegs: ${Math.round(even * 100)} % gleichmäßig`);
    assert.ok(r.gaps.slice(60).every((x) => x < 2 * P60 - 1), `${inFlight} unterwegs: längste Lücke ${Math.max(...r.gaps.slice(60)).toFixed(1)} ms`);
  }
});

test('Safari: Stromsparmodus (Schirm fällt auf 60 Hz) – Bilder weiter alle 16,7 ms', () => {
  const r = safari({ gpu: () => 9, hz: (v) => (v < 2400 ? 120 : 60), inFlight: 2 });
  const tail = r.gaps.slice(-600);
  const even = share(tail, (x) => Math.abs(x - P60) < 1);
  assert.ok(even > 0.98, `${Math.round(even * 100)} % gleichmäßig`);
  assert.ok(r.clock.target < P60 + 0.1, `Bildtakt ${r.clock.target.toFixed(1)} ms`);
});

test('Safari, 60-Hz-iPhone: 60 Hz, jeder Aufruf zeichnet', () => {
  const r = safari({ gpu: () => 9, hz: () => 60 });
  assert.ok(Math.abs(r.clock.period - P60) < 0.01, `Takt ${(1000 / r.clock.period).toFixed(0)} Hz`);
  const even = share(r.gaps.slice(100), (x) => Math.abs(x - P60) < 1);
  assert.ok(even > 0.98, `${Math.round(even * 100)} % gleichmäßig`);
});

test('Safari: Grafik schwankt um 14 ms – kein Bild fällt wegen des festen Takts aus', () => {
  let s = 5;
  const r = safari({ gpu: () => { s = (s * 16807) % 2147483647; return 12 + (s / 2147483647) * 3; } });
  const g = r.gaps.slice(120);
  assert.ok(g.every((x) => x < 2 * P60 - 1), `längste Lücke ${Math.max(...g).toFixed(1)} ms`);
});

test('Safari: jeder zwölfte Aufruf 3–7 ms spät (Hauptfaden beschäftigt) – Takt bleibt 120 Hz, kein Hin und Her, kein Ausfall', () => {
  // früher: die kurzen Abstände danach lasen sich als 240 Hz – „jeder 4. Takt" mit nur 2 ms Spielraum ließ pünktliche
  // Aufrufe aus (Bilder nach 33 ms), dazwischen 12,5 ms Bildtakt (mal ein, mal zwei Takte); bis zu 70 Wechsel
  for (const gpu of [6, 11]) {
    const r = safari({ gpu: () => gpu, inFlight: 2, late: 0.08 });
    assert.ok(r.clock.changes <= 3, `${gpu} ms: ${r.clock.changes} Wechsel des Takts`);
    assert.ok(r.periods.slice(60).every((p) => Math.abs(p - P120) < 0.01), `${gpu} ms: Takt verlassen`);
    // 6 ms Grafik: volle 120 Bilder je Sekunde; 11 ms: gleichmäßige 60
    const T = gpu < 8 ? P120 : P60;
    assert.ok(Math.abs(r.clock.target - T) < 0.01, `${gpu} ms: Bildtakt ${r.clock.target.toFixed(1)} ms`);
    const g = r.gaps.slice(120);
    assert.ok(g.every((x) => x < 2 * P60 - 1), `${gpu} ms: längste Lücke ${Math.max(...g).toFixed(1)} ms`);
    // (ein spät dran gekommenes Bild wird auch spät fertig – bei 11 ms Grafik manchmal; das liegt nicht am Takt)
    const even = share(g, (x) => Math.abs(x - T) < 1);
    assert.ok(even > 0.85, `${gpu} ms: ${Math.round(even * 100)} % gleichmäßig`);
  }
});

/**
 * Safari genauer: ein Aufruf zu jedem Takt, solange das letzte Bild fertig ist (sonst keiner); der Stempel ist die
 * Zeit, zu der das Skript drankommt (abgerundet, 0–3 ms spät; ein Anteil late 3–7 ms). Liefert je gezeichnetem Bild
 * den Takt (Nummer), den gemeldeten Ausrutscher und die Takte, zu denen die Bilder erscheinen
 */
function safariFine(o: { gpu: number; late: number; seed?: number }) {
  let seed = o.seed ?? 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const clock = new FrameClock(0, { apple: true });
  const drawnV: number[] = [];
  const slips: number[] = [];
  const shownV: number[] = [];
  let done = -1;
  let t = 0;
  for (let v = 1; v < 6000; v++) {
    t += P120;
    if (done > t) continue;
    const jit = rnd() < o.late ? 3 + rnd() * 4 : rnd() * 3;
    const stamp = Math.floor(t + jit);
    if (!clock.ready(stamp)) continue;
    clock.tick(stamp);
    drawnV.push(v);
    slips.push(clock.slip);
    done = t + jit + 2 + o.gpu * (0.92 + rnd() * 0.16);
    shownV.push(Math.max(v + 2, Math.ceil(done / P120 - 1e-6)));
  }
  return { clock, drawnV: drawnV.slice(300), slips: slips.slice(300), shownV: shownV.slice(300) };
}

test('Safari: jeder fünfte Aufruf 3–7 ms spät – kein Bild nach nur einem Takt (Doppel), Ausrutscher nur, wo ein Bild wirklich fehlt', () => {
  for (const gpu of [5, 9, 11]) {
    const r = safariFine({ gpu, late: 0.2 });
    const div = r.clock.div;
    const dv = r.drawnV.slice(1).map((x, i) => x - r.drawnV[i]);
    // (früher: 3–4 % der Bilder, mit halbem Takt Spielraum – jeder um 4 ms verspätete Aufruf zählte als nächster Takt)
    const dbl = dv.filter((x) => x < div).length / dv.length;
    assert.ok(dbl < 0.002, `${gpu} ms: ${(dbl * 100).toFixed(2)} % der Bilder nach weniger als ${div} Takt(en)`);
    const shownGaps = r.shownV.slice(1).map((x, i) => x - r.shownV[i]);
    const trueLate = share(shownGaps, (g) => g > 2);
    const slip = share(r.slips, (s) => s > 0);
    // (im 60er-Takt, wenn Safari nur alle 16,7 ms aufruft, ist das Raster 16,7 ms: ein um einen 120er-Takt zu spätes
    // Bild zählt dort erst ab 7 ms – fast immer)
    assert.ok(Math.abs(slip - trueLate) < 0.03, `${gpu} ms: ${Math.round(slip * 100)} % Ausrutscher gemeldet, ${Math.round(trueLate * 100)} % Bilder wirklich zu spät`);
    if (gpu === 5) assert.ok(trueLate < 0.01, `${gpu} ms: ${Math.round(trueLate * 100)} % zu spät`);
  }
});
