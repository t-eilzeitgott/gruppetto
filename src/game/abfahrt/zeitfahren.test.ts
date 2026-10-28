import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEG, TT_FINISH, TT_SPLITS, TT_TOP, Track } from './track';
import { TimeTrial, simulateGhost, ttSectionAt } from './zeitfahren';
import { TRACE_DT, fmtGap, fmtTime, ghostAt, ghostTimeAt, pickGhosts, ttMs, ttScore, type GhostRider } from '../tt';
import type { Kit } from './rider';

const DAY = '2026-11-04';
const KIT: Kit = { jersey: '#ff5fa2', side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '1' };

test('Zeitfahrstrecke: Startort, Tal, Côte, Abfahrt, Zielort – Banner an ihren Stellen, keine Kehren, kein Pflaster', () => {
  const t = new Track(DAY, ['Felix', 'Lena'], 'tt', null);
  t.seg(TT_FINISH / SEG + 100);
  assert.deepEqual(t.sections.slice(0, 5).map((s) => s.biome), ['village', t.sections[1].biome, 'forest', 'vineyard', 'village']);
  assert.ok(t.sections[1].biome === 'lake' || t.sections[1].biome === 'vineyard');
  assert.equal(t.sections[0].start, 0);
  assert.equal(t.sections[2].end * SEG, TT_TOP);
  assert.equal(t.sections[4].start * SEG, 2000);
  assert.equal(t.seg(5).banner?.kind, 'start');
  for (const z of TT_SPLITS) assert.equal(t.seg(z / SEG).banner?.kind, 'split');
  assert.equal(t.seg(TT_TOP / SEG).banner?.text, t.climbName);
  assert.equal(t.seg(TT_FINISH / SEG).banner?.kind, 'finish');
  for (let i = 0; i < TT_FINISH / SEG; i++) {
    const s = t.seg(i);
    assert.equal(s.hairpin, 0);
    assert.ok(s.surface === 'asphalt' || s.surface === 'fresh', `Belag ${s.surface} bei ${i * SEG} m`);
    assert.ok(!s.tunnel);
    assert.ok(!s.objs?.length, 'keine Hindernisse');
  }
  // Höhenprofil: Kuppe ist der höchste Punkt, Ziel etwa auf Starthöhe
  const top = t.heightAt(TT_TOP);
  for (let z = 0; z < TT_FINISH; z += 10) assert.ok(t.heightAt(z) <= top + 0.01);
  assert.ok(Math.abs(t.heightAt(TT_FINISH) - t.heightAt(0)) < 12);
  assert.match(t.title, /→|Zeitfahren in/);
});

test('Zeitfahrstrecke hängt nur vom Tag ab – nicht von Namen, Rundfahrt oder Gegend', () => {
  const a = new Track(DAY, [], 'tt', null);
  const b = new Track(DAY, ['Anna', 'Ben', 'Christoph', 'Dora'], 'tt', {
    lang: 'it', tour: 'Giro d’Italia 2027', stage: 9, date: DAY, from: 'Imperia', to: 'Sanremo', town: 'Sanremo',
    climb: { name: 'Poggio', km: 1, len: 3.7, grad: 3.7, alt: 160, cat: 4 }, summitFinish: false, preview: false, finale: null, region: 'riviera',
  });
  for (let i = 0; i < TT_FINISH / SEG + 150; i++) {
    const x = a.seg(i);
    const y = b.seg(i);
    assert.equal(x.curve, y.curve, `Kurve bei ${i * SEG} m`);
    assert.equal(x.grade, y.grade, `Steigung bei ${i * SEG} m`);
    assert.equal(x.surface, y.surface);
    assert.equal(x.L.wall, y.L.wall);
    assert.equal(x.bridge, y.bridge);
  }
  assert.equal(b.title, 'Imperia → Sanremo');
  assert.equal(b.climbName, 'Poggio');
  assert.notEqual(new Track('2026-11-05', [], 'tt', null).seg(300).curve, a.seg(300).curve);
});

test('Tempomacher fährt die Strecke in gut dreieinhalb Minuten, Zwischenzeiten steigen, Spur im festen Raster', () => {
  const g = simulateGhost(DAY, { strength: 1, line: 0.8, seed: 3 });
  assert.ok(g.timeMs > 200000 && g.timeMs < 260000, `Zeit ${g.timeMs}`);
  assert.equal(g.splits.length, 2);
  assert.ok(g.splits[0] < g.splits[1] && g.splits[1] < g.timeMs);
  // ein Stützpunkt je TRACE_DT (plus Ausrollen)
  assert.ok(Math.abs(g.trace.length / 3 - g.timeMs / 1000 / TRACE_DT) < 20);
  // Spur steigt monoton und endet hinter der Linie
  for (let i = 3; i < g.trace.length; i += 3) assert.ok(g.trace[i] >= g.trace[i - 3]);
  assert.ok(g.trace[g.trace.length - 3] / 10 > TT_FINISH);
  // Lage auf der Straße
  for (let i = 1; i < g.trace.length; i += 3) assert.ok(Math.abs(g.trace[i]) <= 300);
  // Zeit an einer Stelle ↔ Stelle zu einer Zeit
  const pos = { z: 0, x: 0, m: 0 };
  for (let t = 1; t < g.timeMs / 1000; t += 7.3) {
    ghostAt(g.trace, t, pos);
    assert.ok(Math.abs(ghostTimeAt(g.trace, pos.z) - t) < 0.02);
  }
  assert.ok(Math.abs(ghostTimeAt(g.trace, TT_FINISH) * 1000 - g.timeMs) < 300);
  // stärker = schneller, Linie zählt
  const weak = simulateGhost(DAY, { strength: 0.92, line: 0.3, seed: 3 });
  assert.ok(weak.timeMs > g.timeMs + 3000);
});

function run(ctrl: (eng: TimeTrial) => void, ghosts: GhostRider[] = [], myBest: number | null = null) {
  const events: unknown[] = [];
  let res: Parameters<NonNullable<ConstructorParameters<typeof TimeTrial>[0]['onOver']>>[0] | null = null;
  const eng = new TimeTrial({ dayKey: DAY, names: ['Felix'], rider: 'Ich', kit: KIT, ghosts, myBest, onOver: (r) => { res = r; }, onEvent: (e) => events.push(e) });
  eng.start();
  for (let i = 0; i < 30 * 700 && eng.phase !== 'over'; i++) { ctrl(eng); eng.update(1 / 30); }
  assert.ok(res, 'Lauf kommt ins Ziel');
  return { res: res!, events, eng };
}

test('Zeitfahren: Countdown 5 … Los, Zwischenzeiten als Ereignisse, Einteilen schlägt Vollgas schlägt Rollen', () => {
  const neutral = run(() => {});
  const counts = neutral.events.filter((e): e is { type: 'count'; n: number } => (e as { type: string }).type === 'count').map((e) => e.n);
  assert.deepEqual(counts, [5, 4, 3, 2, 1, 0]);
  const splits = neutral.events.filter((e): e is { type: 'split'; index: number; timeMs: number } => (e as { type: string }).type === 'split');
  assert.deepEqual(splits.map((s) => s.index), [0, 1]);
  assert.deepEqual(neutral.res.splits, splits.map((s) => s.timeMs));
  assert.equal(neutral.res.reserve, 1, 'ohne Drücken bleibt der Vorrat voll');
  assert.equal(neutral.res.place, 1);
  assert.equal(neutral.res.gapMs, null);
  const full = run((e) => e.key('up', true));
  assert.ok(full.res.timeMs < neutral.res.timeMs - 5000);
  assert.ok(full.res.reserve < 0.05);
  const paced = run((e) => {
    const z = e.p.z;
    e.key('up', (z > 1040 && z < TT_TOP && e.energy > 0.2) || z > 2600 || (z > TT_TOP && z < 2000 && e.track.segAt(z + 40).curve === 0 && e.energy > 0.5));
  });
  assert.ok(paced.res.timeMs < full.res.timeMs, `eingeteilt ${paced.res.timeMs} < Vollgas ${full.res.timeMs}`);
  // Sektoren ergeben die Gesamtzeit
  assert.equal(paced.res.sectors.reduce((a, s) => a + s.me, 0), paced.res.timeMs);
  assert.equal(paced.res.trace.length % 3, 0);
  assert.ok(paced.res.avgKmh > 40 && paced.res.avgKmh < 55);
});

test('Zeitfahren gegen Geister: virtueller Platz, Schilder, Überholen, Tagesbestzeit und Bestlauf', () => {
  const bot = simulateGhost(DAY, { strength: 1, line: 0.8, seed: 3 });
  const slow = simulateGhost(DAY, { strength: 0.9, line: 0.2, seed: 5 });
  const ghosts: GhostRider[] = [
    { id: 'u-felix', name: 'Felix Müller', color: '#1f6feb', bike: 'aero', timeMs: bot.timeMs, splits: bot.splits, trace: bot.trace },
    { id: 'me', name: 'Ich', color: '#ff5fa2', bike: 'allround', timeMs: slow.timeMs, splits: slow.splits, trace: slow.trace, me: true },
  ];
  const r = run((e) => e.key('up', e.p.z > 1040 && e.p.z < TT_TOP), ghosts, slow.timeMs);
  const eng = r.eng;
  assert.equal(eng.opps.length, 2);
  assert.equal(eng.opps[0].kit.number, '1', 'Startnummer = Rang des Tages');
  assert.equal(eng.opps[0].kit.bike, 'aero', 'Geist fährt sein Rad');
  assert.ok(eng.opps[0].ghost > 0.3 && eng.opps[0].ghost < 0.6, 'halbdurchsichtig');
  assert.equal(r.res.riders, 2, 'der eigene Bestlauf zählt nicht als Gegner');
  assert.ok(r.res.timeMs < slow.timeMs, 'schneller als der eigene Bestlauf');
  assert.equal(r.res.pb, true);
  assert.ok(r.res.leader?.name === 'Felix Müller');
  assert.equal(r.res.gapMs, r.res.timeMs - bot.timeMs);
  assert.equal(r.res.place, r.res.timeMs < bot.timeMs ? 1 : 2);
  assert.ok(r.res.sectors.every((s) => s.best !== null && s.bestName !== null));
  // Zwischenzeit-Ereignisse tragen Abstand und Platz
  const split = r.events.find((e): e is { type: 'split'; gapMs: number | null; place: number; riders: number } => (e as { type: string }).type === 'split');
  assert.ok(split && split.gapMs !== null && split.riders === 3);
  // HUD nach dem Ziel: Zeit steht, Geister bleiben auf der Leiste
  const h = eng.hud();
  assert.equal(Math.round(h.time * 1000), r.res.timeMs);
  assert.equal(h.ghosts.length, 2);
  assert.ok(h.board.some((b) => b.me));
});

test('Zeitfahren: Abschnitte, Punktzahl aus Zeit, Zeit- und Abstandsformat, Auswahl der Geister', () => {
  assert.equal(ttSectionAt(100), 'start');
  assert.equal(ttSectionAt(1200), 'climb');
  assert.equal(ttSectionAt(1700), 'descent');
  assert.equal(ttSectionAt(2500), 'finish');
  assert.equal(ttMs(ttScore(224300)), 224300);
  assert.ok(ttScore(200000) > ttScore(230000), 'kürzere Zeit = höhere Punktzahl');
  assert.equal(fmtTime(224350), '3:44,4');
  assert.equal(fmtTime(59990), '1:00,0');
  assert.equal(fmtGap(1840), '+1,8″');
  assert.equal(fmtGap(-430), '−0,4″');
  assert.equal(fmtGap(20), '±0,0″');
  assert.equal(fmtGap(61500), '+1′02″');
  const mk = (id: string, t: number, me = false): GhostRider => ({ id, name: id, color: '#000', bike: 'allround', timeMs: t, splits: [], trace: [0, 0, 0, 100, 0, 0], me });
  const all = [mk('a', 230000), mk('b', 220000), mk('c', 240000), mk('d', 250000), mk('me', 245000, true)];
  const picked = pickGhosts(all, 245000, mk('bot', 225000), 3);
  assert.equal(picked[0].id, 'b', 'Tagesbestzeit immer dabei');
  assert.equal(picked[1].id, 'me', 'eigener Bestlauf immer dabei');
  assert.equal(picked[2].id, 'c', 'dann die nächste Zeit zur eigenen');
  assert.equal(picked.length, 3);
  assert.ok(!picked.some((g) => g.bot), 'Tempomacher nur, wenn kaum jemand gefahren ist');
  const few = pickGhosts([mk('a', 230000)], null, mk('bot', 225000));
  assert.ok(few.some((g) => g.id === 'bot'));
  assert.equal(pickGhosts([], null, null).length, 0);
});
