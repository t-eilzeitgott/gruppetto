import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRINT_FINISH, Track } from './track';
import { SprintRace, gridSlot, type SprintResult } from './sprint';
import { newFeed, rtSet } from '../live';
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

// ------------------------------------------------------------ Lobby-Rennen in Echtzeit

/** zwei Rennen (zwei Handys), die sich jede Runde gegenseitig ihren Stand melden – wie über den Lobby-Kanal */
function duel(day = '2027-05-09') {
  const mk = () => new SprintRace({ dayKey: day, names: [], rider: { name: 'Test', type: 'sprinter', number: '27' }, rivals: ['Milan', 'Philipsen', 'Merlier'], kit });
  const a = mk();
  const b = mk();
  a.setGrid(0);
  b.setGrid(1);
  // was A von B sieht und umgekehrt
  const seesB = newFeed({ userId: 'B', name: 'Ben Beispiel', color: '#36c', bike: 'aero', run: 'r' });
  const seesA = newFeed({ userId: 'A', name: 'Anna Beispiel', color: '#c33', bike: 'aero', run: 'r' });
  for (const f of [seesA, seesB]) { f.solid = true; f.racing = true; }
  a.setLive([seesB]);
  b.setLive([seesA]);
  const step = (dt = 1 / 60) => {
    const now = performance.now();
    const sa = a.rtOut();
    const sb = b.rtOut();
    if (sa) { rtSet(seesA, sa, 0, now); seesA.down = sa.down; }
    if (sb) { rtSet(seesB, sb, 0, now); seesB.down = sb.down; }
    a.update(dt);
    b.update(dt);
    // Rempler gehen an den Betroffenen
    for (const h of a.takeHits()) b.rtHit('A', h);
    for (const h of b.takeHits()) a.rtHit('B', h);
  };
  return { a, b, step };
}

/** auf gleiche Höhe bringen (das Feld kann einen aufhalten): wer vorn ist, nimmt Tempo raus */
function align(a: SprintRace, b: SprintRace, step: () => void) {
  let guard = 0;
  while (Math.abs(a.p.z - b.p.z) > 0.6 && guard++ < 60 * 20) {
    const lead = a.p.z > b.p.z ? a : b;
    lead.setPedal(-1);
    step();
    lead.setPedal(0);
  }
  assert.ok(Math.abs(a.p.z - b.p.z) <= 1.2, 'nebeneinander');
}

test('Lobby-Rennen: alle starten nebeneinander in einer Reihe, jeder auf seinem Platz', () => {
  const slots = [0, 1, 2, 3, 4, 5].map(gridSlot);
  assert.ok(slots.slice(0, 5).every(([z]) => z === slots[0][0]), 'die ersten fünf in einer Reihe');
  assert.equal(new Set(slots.slice(0, 5).map(([, x]) => x)).size, 5);
  assert.ok(slots[5][0] < slots[0][0], 'der sechste eine Reihe dahinter');
  const { a, b } = duel();
  assert.equal(a.p.z, b.p.z);
  assert.ok(Math.abs(Math.abs(a.p.x - b.p.x) - 1.05) < 1e-9, 'Nachbarspuren');
  // niemand aus dem Feld steht auf einem der Plätze
  for (const g of [a, b]) for (const o of g.opps) assert.ok(Math.abs(o.z - g.p.z) > 1.2 || Math.abs(o.x - g.p.x) > 0.5, 'Platz frei');
  // ohne Lobby-Rennen bleibt der Platz mitten im Feld
  const solo = new SprintRace({ dayKey: '2027-05-09', names: [], rider: { name: 'Test', type: 'sprinter', number: '27' }, rivals: [], kit });
  assert.ok(solo.p.z > a.p.z);
});

test('Lobby-Rennen: Mitspieler sind echte Gegner – nebeneinander ins Rennen, kein Durchfahren', () => {
  const { a, b, step } = duel();
  a.start();
  b.start();
  for (let i = 0; i < 60 * 5; i++) step();
  assert.equal(a.phase, 'playing');
  // beide rollen gleich los: nach fünf Sekunden noch Seite an Seite
  assert.ok(Math.abs(a.p.z - b.p.z) < 8, `dicht beieinander (${(a.p.z - b.p.z).toFixed(2)} m)`);
  // A sieht B dort, wo B wirklich ist (die Darstellung hängt nicht hinterher)
  const seen = a.ghosts[a.ghosts.length - 1];
  assert.ok(Math.abs(seen.z - b.p.z) < 0.35 && Math.abs(seen.x - b.p.x) < 0.1, `Lage stimmt (${(seen.z - b.p.z).toFixed(2)} m)`);
  assert.equal(a.ghosts.filter((o) => o.ghost! > 0.9).length, 1, 'Mitspieler voll sichtbar, kein Geist');
  assert.equal(a.riders, a.opps.length + 2);
  // A zieht langsam zu B hinüber: bleibt an ihm hängen, fährt nicht hinein
  const side = Math.sign(b.p.x - a.p.x);
  for (let i = 0; i < 60 * 4; i++) { a.steerBy(side * 0.6); step(); }
  if (Math.abs(a.p.z - b.p.z) < 1.5) assert.ok(Math.abs(a.p.x - b.p.x) > 0.55, `nicht ineinander (${Math.abs(a.p.x - b.p.x).toFixed(2)} m)`);
});

test('Lobby-Rennen: Rammen schiebt den anderen weg und kostet ihn Tempo – bei beiden gleich', () => {
  const { a, b, step } = duel();
  a.start();
  b.start();
  for (let i = 0; i < 60 * 6; i++) step();
  // auf gleiche Höhe bringen (das Feld kann einen aufhalten): Rammen braucht den anderen neben sich
  align(a, b, step);
  const side = Math.sign(b.p.x - a.p.x) || 1;
  const bx0 = b.p.x;
  const bv0 = b.p.v;
  const eb0 = b.energy;
  let pops = 0;
  // A reißt den Lenker herum
  for (let i = 0; i < 90 && !pops; i++) {
    a.steerBy(side * 60);
    step();
    pops = b.popups.filter((q) => q.text.startsWith('Rempler von Anna')).length;
  }
  assert.equal(pops, 1, 'B bekommt den Rempler von Anna angesagt');
  assert.ok(a.popups.some((q) => q.text === 'Ben gerempelt'), 'A hat gerempelt');
  for (let i = 0; i < 20; i++) step();
  if (!b.wreck) {
    assert.ok((b.p.x - bx0) * side > 0.15 || Math.abs(b.p.x) > 2.5, `B wurde weggeschoben (${((b.p.x - bx0) * side).toFixed(2)} m)`);
    assert.ok(b.p.v < bv0 + 0.2 && b.energy < eb0, 'B verliert Tempo und Kraft');
  }
});

test('Lobby-Rennen: der zweite Rempler kurz darauf bringt zu Boden – am Start ist noch Schonfrist', () => {
  const { a, b, step } = duel();
  a.start();
  b.start();
  for (let i = 0; i < 60 * 2.6; i++) step();
  // kurz nach „Los“: noch kein Rempeln
  b.rtHit('A', { power: 4.5, role: 'v', dir: 1 });
  assert.equal(b.popups.length, 0);
  for (let i = 0; i < 60 * 3; i++) step();
  // Meldung von jemandem, der gar nicht neben einem fährt, zählt nicht
  b.rtHit('X', { power: 4.5, role: 'v', dir: 1 });
  assert.equal(b.popups.some((q) => q.text.startsWith('Rempler')), false);
  align(a, b, step);
  assert.ok(Math.abs(a.p.x - b.p.x) < 1.5, 'Nachbarn');
  const dir = b.p.x >= a.p.x ? 1 : -1;
  b.rtHit('A', { power: 4.5, role: 'v', dir });
  assert.equal(b.wreck, null, 'der erste Rempler schiebt nur weg');
  assert.ok(b.popups.some((q) => q.text === 'Rempler von Anna!'));
  // dieselbe Berührung zählt nicht doppelt
  b.rtHit('A', { power: 4.5, role: 'v', dir });
  assert.equal(b.wreck, null);
  // A setzt nach und rempelt gleich noch einmal: B ist noch wacklig
  for (let i = 0; i < 120 && !b.wreck; i++) {
    a.steerBy(dir * 40);
    a.setPedal(a.p.z > b.p.z + 0.3 ? -1 : 0);
    step();
  }
  assert.ok(b.wreck, 'B liegt');
  assert.ok(b.popups.some((q) => q.sub === 'Von Anna abgeräumt' || q.sub === 'An die Bande gedrängt'), b.popups.map((q) => `${q.text}/${q.sub}`).join(' · '));
  assert.equal(a.wreck, null, 'A hat gerammt und sitzt noch');
  // wer liegt, ist für die anderen kein Hindernis mehr
  for (let i = 0; i < 30; i++) step();
  assert.equal(a.ghosts.filter((o) => (o as { solid?: boolean }).solid).length, 0);
});
