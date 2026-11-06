import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allVenues, venueOf, tourIdOf, SCAPES } from './venue';
import { stageOfDay, stageRef } from './stageRef';
import { SEASON_2027 } from '../../data/season2027';
import { Track, SEG } from './track';
import type { Stage } from '../../lib/types';
import { STYLE } from './facade';
import { LOOKS } from './region';

test('jede Etappe von Giro und Tour 2027 hat einen Schauplatz', () => {
  for (const t of SEASON_2027.filter((x) => x.id !== 'vuelta-2027')) {
    for (const s of t.stages) {
      const v = venueOf(tourIdOf(t.name), s.n);
      assert.ok(v, `${t.name} ${s.n}`);
      assert.ok(v!.blurb.length > 10 && v!.place.length > 1);
    }
  }
  assert.equal(allVenues().length, 42);
});

test('Ortsbilder: gültige Stile, Gegenden und genug Namen', () => {
  for (const sc of Object.values(SCAPES)) {
    for (const [k] of sc.styles) assert.ok(k in STYLE, `${sc.id}: ${k}`);
    assert.ok(sc.region in LOOKS, sc.id);
    const n = sc.names;
    for (const list of [n.villages, n.valleys, n.forests, n.lakes, n.hills]) assert.ok(list.length >= 4, sc.id);
    assert.ok(n.passes.length >= 8, `${sc.id} Pässe`);
  }
});

/** Etappen der Tour 2027 wie aus der Datenbank (Start 12 Uhr) */
const tourStages = (): Stage[] => SEASON_2027.find((x) => x.id === 'tour-2027')!.stages.map((s, i) => ({
  id: i + 1, tour_id: 't', number: s.n, starts_at: `${s.date}T10:00:00Z`, kind: s.kind, departure: s.from, arrival: s.to,
  distance_km: s.km, results_published: false, climbs: s.climbs,
}));

test('Etappe des Tages: Renntag, Ruhetag, außerhalb', () => {
  const st = tourStages();
  assert.equal(stageOfDay(st, '2027-07-25')?.number, 21);
  // Ruhetag nach der 9. Etappe (12.7.): Ort der Vortagsetappe
  assert.equal(stageOfDay(st, '2027-07-12')?.number, 9);
  assert.equal(stageOfDay(st, '2027-06-30'), null);
  assert.equal(stageOfDay(st, '2027-07-26'), null);
});

test('am Paris-Tag tragen alle Finale das Pariser Ortsbild', () => {
  const st = tourStages();
  for (const kind of ['sprint', 'mountain', 'tt'] as const) {
    const ref = stageRef(kind, 'Tour de France 2027', st, '2027-07-25');
    assert.equal(ref?.venue?.scape.id, 'paris', kind);
    assert.equal(ref?.lang, 'fr');
  }
  // Bergfinale in Paris: der Anstieg der Gegend (Montmartre)
  assert.match(stageRef('mountain', 'Tour de France 2027', st, '2027-07-25')!.climb!.name, /Montmartre/);
  // Sprint am Bergetappentag: kein Sprinttext aus einer Bergetappe
  const r = stageRef('sprint', 'Tour de France 2027', st, '2027-07-22');
  assert.equal(r?.venue?.place, 'Col du Portet');
  assert.equal(r?.finale, null);
});

test('Strecke bleibt mit Schauplatz genau gleich (alle Spiele)', () => {
  const st = tourStages();
  for (const day of SEASON_2027.find((x) => x.id === 'tour-2027')!.stages.map((x) => x.date).filter((_, i) => i % 2 === 0)) {
    for (const kind of ['descent', 'sprint', 'mountain', 'tt'] as const) {
      const ref = kind === 'descent' ? null : stageRef(kind, 'Tour de France 2027', st, day);
      const venueRef = kind === 'descent' ? stageRef('sprint', 'Tour de France 2027', st, day) : ref;
      // ohne Ortsbild: gleiche Vorlage, nur ohne Schauplatz
      const plain = venueRef ? { ...venueRef, venue: null, region: venueRef.region, lang: venueRef.lang } : null;
      const a = new Track(day, [], kind, kind === 'descent' ? venueRef : ref);
      const b = new Track(day, [], kind, kind === 'descent' ? null : plain);
      const n = kind === 'descent' ? 4000 : 1400;
      for (let i = 0; i < n; i += 7) {
        const sa = a.seg(i);
        const sb = b.seg(i);
        assert.ok(Math.abs(sa.wx - sb.wx) < 1e-6 && Math.abs(sa.wz - sb.wz) < 1e-6 && Math.abs(sa.y - sb.y) < 1e-6, `${kind} ${day} Segment ${i}`);
      }
      void SEG;
    }
  }
});

test('Namen der Gegend: Pässe und Orte der Abfahrt am Paris-Tag', () => {
  const ref = stageRef('sprint', 'Tour de France 2027', tourStages(), '2027-07-25')!;
  const t = new Track('2027-07-25', [], 'descent', ref);
  t.seg(3000);
  const names = t.sections.map((s) => s.name);
  assert.ok(names.some((n) => /^Col |Hourquette|Port de|Montée/.test(n)), names.join(', '));
  assert.ok(!names.some((n) => /^Passo |^Val |^Valle /.test(n)), names.join(', '));
});
