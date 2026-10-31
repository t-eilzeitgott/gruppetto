import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRINT_FINISH, Track } from './track';
import { SprintRace, type SprintResult } from './sprint';
import { riderOptions, rivalNames } from './sprintRiders';
import type { Profile, TourData } from '../../lib/types';
import type { StageRef } from './stageRef';
import { parseFinale } from './finale';

const kit = { jersey: '#ff5fa2', side: '#fff', helmet: '#fff', shorts: '#111', skin: '#f0c4a0', shoes: '#fff', number: '27' };

test('Sprintstrecke: flach, gleich für alle, Zielort lässt sich setzen', () => {
  const a = new Track('2027-05-09', [], 'sprint', 'Napoli');
  const b = new Track('2027-05-09', [], 'sprint', 'Napoli');
  assert.equal(a.title, 'Sprintfinale in Napoli');
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < SPRINT_FINISH / 2; i += 7) {
    assert.equal(a.seg(i).curve, b.seg(i).curve);
    minY = Math.min(minY, a.seg(i).y);
    maxY = Math.max(maxY, a.seg(i).y);
    assert.ok(!a.seg(i).objs?.length, 'keine Hindernisse im Sprint');
  }
  assert.ok(maxY - minY < 40, `flach genug (${(maxY - minY).toFixed(1)} m)`);
  assert.equal(a.seg(Math.round(SPRINT_FINISH / 2)).banner?.kind, 'finish');
});

test('Sprint: Rennen endet, Platz und Punkte sind plausibel, niemand bleibt stehen', () => {
  for (const day of ['2027-05-09', '2027-05-10', '2027-05-11']) {
    let over: SprintResult | null = null;
    const g = new SprintRace({ dayKey: day, names: [], rider: { name: 'Test', type: 'sprinter', number: '27' }, rivals: ['Milan', 'Philipsen', 'Merlier'], kit, onOver: (r) => { over = r; } });
    g.start();
    let t = 0;
    while (!over && t < 320) {
      g.key('up', SPRINT_FINISH - g.p.z < 230);
      g.update(1 / 30);
      t += 1 / 30;
      // (wer im Massensturz liegt, steht natürlich – der Spieler steigt danach wieder auf)
      if (t > 5 && g.phase === 'playing' && SPRINT_FINISH - g.p.z > 0) {
        if (!g.wreck && !g.pileAt) assert.ok(g.p.v > 9 || g.crashes > 0, `Spieler fährt (${g.p.v.toFixed(1)} m/s)`);
        for (const o of g.opps) if (!o.wreck && !g.pileAt) assert.ok(o.v > 8, `${(o as unknown as { name: string }).name} fährt`);
      }
    }
    assert.ok(over, `Rennen am ${day} beendet`);
    const r = over as SprintResult;
    assert.ok(r.place >= 1 && r.place <= r.riders);
    assert.equal(r.podium.length, 3);
    assert.ok(r.score > 0 && r.score === r.parts.place + r.parts.draft + r.parts.gain + r.parts.type);
  }
});

test('Fahrerauswahl: je Typ ein Fahrer, eigener Tipp zuerst, ohne Rundfahrt trotzdem spielbar', () => {
  const me = { id: 'u1', display_name: 'Jerome' } as Profile;
  const empty = riderOptions(null, me, '2027-05-09');
  assert.equal(empty.length, 5);
  const riders = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, tour_id: 't', bib: i + 1, name: `Fahrer ${i + 1}`, team: 'Team', tip_limit: null, excluded_from_rest: false, status: 'active' as const }));
  const stages = [
    { id: 1, tour_id: 't', number: 1, starts_at: '2027-05-08T11:00:00Z', kind: 'flat' as const, departure: null, arrival: 'Bari', distance_km: 180, results_published: true },
    { id: 2, tour_id: 't', number: 2, starts_at: '2027-05-09T11:00:00Z', kind: 'mountain' as const, departure: null, arrival: 'Blockhaus', distance_km: 160, results_published: false },
  ];
  const data = {
    tour: {} as TourData['tour'], stages, riders, bonusTips: [], bonusResults: [], scale: [],
    results: [{ stage_id: 1, position: 1, rider_id: 7 }, { stage_id: 1, position: 2, rider_id: 9 }],
    tips: [{ stage_id: 2, user_id: 'u1', rider_id: 12, updated_at: '' }],
  } as unknown as TourData;
  const opts = riderOptions(data, me, '2027-05-09');
  assert.equal(opts[0].id, 12);
  assert.ok(opts[0].tip);
  assert.equal(opts.find((o) => o.type === 'sprinter')?.id, 7);
  assert.equal(new Set(opts.map((o) => o.id)).size, opts.length, 'keine doppelten Fahrer');
  assert.equal(new Set(opts.map((o) => o.type)).size, 5, 'alle Typen');
  const rivals = rivalNames(data, 12);
  assert.equal(rivals[0], 'Fahrer 7');
  assert.ok(!rivals.includes('Fahrer 12'));
});

test('Echtes Finale (Neapel): Kurven an ihrer Stelle, Zielgerade gerade und 4 % steil, Pflaster ab 650 m', () => {
  const ref: StageRef = {
    lang: 'it', tour: 'Giro 2026', stage: 6, date: '2026-05-14', from: 'Paestum', to: 'Napoli', town: 'Napoli', climb: null, summitFinish: false, preview: false, region: 'riviera',
    finale: parseFinale('Die letzten 3 km gerade am Hafen entlang. Linkskurve 650 m vor dem Ziel in einen leichten Anstieg (4 %) über die gepflasterte Via Acton, zwei Rechtskurven 400 m vor dem Ziel auf die 8 m breite, gepflasterte Zielgerade.'),
  };
  const t = new Track('2026-05-14', [], 'sprint', ref);
  const iF = SPRINT_FINISH / 2;
  const at = (m: number) => t.seg(iF - m / 2);
  // ab der letzten Kurve (400 m) schnurgerade
  for (let m = 0; m <= 380; m += 10) assert.equal(at(m).curve, 0, `gerade bei ${m} m vor dem Ziel`);
  // davor: Linkskurve endet bei 650 m, Rechtskurven zwischen 400 und 520 m
  let left = 0;
  let right = 0;
  for (let m = 400; m < 530; m += 2) if (at(m).curve > 0) right++;
  for (let m = 650; m < 720; m += 2) if (at(m).curve < 0) left++;
  assert.ok(right > 10, `Rechtskurven vor der Zielgeraden (${right})`);
  assert.ok(left > 8, `Linkskurve bei 650 m (${left})`);
  // Steigung der Zielgeraden um 4 %, der Rest sanft
  assert.ok(Math.abs(at(200).grade - 0.04) < 0.012, `Zielgerade steigt (${at(200).grade.toFixed(3)})`);
  assert.ok(Math.abs(at(1500).grade) < 0.02, `Anfahrt flach (${at(1500).grade.toFixed(3)})`);
  // Pflaster ab 650 m
  assert.equal(at(300).surface, 'cobble');
  assert.equal(at(600).surface, 'cobble');
  assert.notEqual(at(900).surface, 'cobble');
  // ohne Streckentext: Tageszufall wie bisher, keine Steigung
  const plain = new Track('2026-05-14', [], 'sprint', 'Napoli');
  assert.ok(plain.seg(iF - 100).grade <= 0.01);
});

test('Zielstadt: Stadttor am Ortseingang, Piazza mit zurückgesetzten Palazzi, Laubengängen, Campanile und Brunnen', () => {
  const t = new Track('2026-05-14', [], 'sprint', 'Napoli');
  t.seg(SPRINT_FINISH / 2);   // Abschnitte entstehen beim ersten Zugriff
  const town = t.sections[1];
  assert.equal(town.biome, 'village');
  assert.ok(town.piazza, 'Piazza angelegt');
  const [p0, p1] = town.piazza!;
  assert.ok(p0 > town.start + 40 && p1 < town.start + (town.end - town.start) * 0.6, 'Piazza in der ersten Hälfte der Stadt');
  let arcades = 0;
  let tall = 0;
  let fountains = 0;
  for (let i = p0; i < p1; i++) {
    const s = t.seg(i);
    for (const b of [s.bL, s.bR]) {
      if (!b) continue;
      assert.ok(b.setback > 10, `Haus an der Piazza steht zurück (${b.setback.toFixed(1)} m)`);
      if (b.arcade) arcades++;
      if (b.tall) tall++;
    }
    fountains += s.sprites?.filter((x) => x.k === 'fountain').length ?? 0;
  }
  assert.ok(arcades > 0, 'Laubengänge');
  assert.ok(tall > 0, 'Campanile');
  assert.equal(fountains, 2);
  const gate = t.seg(town.start + 24).banner;
  assert.equal(gate?.kind, 'gate');
  assert.equal(gate?.text, 'Napoli');
});
