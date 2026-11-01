import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emblemsFor, shelf } from './emblems';
import type { Profile, Rider, Stage, StageKind, StageResult, StageTip, TourData, TourTheme } from './types';

const member = (id: string): Profile => ({ id, display_name: id[0].toUpperCase() + id.slice(1), avatar_color: '#000', is_member: true, is_admin: false, is_pro: false, created_at: '' });
const A = member('anna');
const B = member('ben');
const C = member('carl');
const D = member('dora');
const ALL = [A, B, C, D];

let nextStage = 1;
/** Rundfahrt: je Etappe Ergebnis (Fahrer nach Platz) und Tipps (Mitglied → Fahrer) */
function tour(id: string, theme: TourTheme, start: string, days: { order: number[]; tips: Record<string, number>; kind?: StageKind; saved?: Record<string, string> }[], opts: { total?: number; final?: boolean } = {}): TourData {
  const total = opts.total ?? days.length;
  const base = nextStage;
  nextStage += 100;
  const stages: Stage[] = Array.from({ length: total }, (_, i) => ({
    id: base + i, tour_id: id, number: i + 1, starts_at: new Date(Date.parse(`${start}T11:00:00Z`) + i * 864e5).toISOString(),
    kind: days[i]?.kind ?? 'flat', departure: null, arrival: null, distance_km: null, results_published: i < days.length,
  }));
  const tips: StageTip[] = days.flatMap((d, i) => Object.entries(d.tips).map(([u, r]) => ({ stage_id: base + i, user_id: u, rider_id: r, updated_at: d.saved?.[u] ?? new Date(Date.parse(stages[i].starts_at) - 3600e3).toISOString() })));
  const results: StageResult[] = days.flatMap((d, i) => d.order.map((rider_id, p) => ({ stage_id: base + i, position: p + 1, rider_id })));
  const riders: Rider[] = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, tour_id: id, bib: i + 1, name: `Fahrer ${i + 1}`, team: 'T', tip_limit: null, excluded_from_rest: false, status: 'active' }));
  return {
    tour: { id, name: id, short_name: { giro: 'Giro', tour: 'Tour', vuelta: 'Vuelta', neutral: 'Test' }[theme], theme, year: Number(start.slice(0, 4)), start_date: start, end_date: start, is_visible: true, bonus_final: !!opts.final, pcs_slug: null },
    stages, riders, tips, results, bonusTips: [], bonusResults: [], scale: [],
  };
}
const keys = (list: { key: string }[]) => list.map((e) => e.key);

test('Name der Rundfahrt mit Jahr, auch bei Kurznamen mit Jahreszahl', () => {
  const t = tour('giro-2026', 'giro', '2026-10-26', [{ order: [1], tips: { anna: 1, ben: 2 } }], { total: 21 });
  t.tour.short_name = 'Giro 26';
  assert.match(emblemsFor('anna', [t], ALL)[0].text, /Giro 2026, Etappe 1/);
});

test('nur für Mitglieder, nur ab dem Giro 2026', () => {
  const t = tour('alt', 'giro', '2026-05-09', [{ order: [1], tips: { anna: 1, ben: 2 } }]);
  assert.deepEqual(emblemsFor('anna', [t], ALL), []);
  const t2 = tour('giro-2026', 'giro', '2026-10-26', [{ order: [1], tips: { anna: 1, ben: 2 } }]);
  assert.deepEqual(emblemsFor('zoe', [t2], ALL), []);
  assert.ok(emblemsFor('anna', [t2], ALL).length > 0);
});

test('erster Tipp, Volltreffer, Tagessieg, Maglia Rosa', () => {
  const t = tour('giro-2026', 'giro', '2026-10-26', [{ order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } }], { total: 21 });
  const list = emblemsFor('anna', [t], ALL);
  assert.deepEqual(keys(list).sort(), ['aussenseiter', 'start', 'tagessieg:giro-2026:1', 'treffer', 'trikot:giro-2026'].sort());
  const jersey = list.find((e) => e.id === 'trikot-giro')!;
  assert.equal(jersey.name, 'Maglia Rosa');
  assert.equal(jersey.look.shape, 'jersey');
  assert.match(jersey.text, /Giro 2026/);
  // Ben: erster Tipp, als Einziger auf Platz zwei – aber weder Treffer noch Führung
  assert.deepEqual(keys(emblemsFor('ben', [t], ALL)).sort(), ['kopf:giro-2026:1', 'start']);
});

test('Hattrick: dreimal hintereinander die meisten Punkte (auch geteilt), mit fünf „Unaufhaltsam“', () => {
  const day = { order: [1, 2, 3], tips: { anna: 1, ben: 1, carl: 3 } };
  const t = tour('tour-2027', 'tour', '2027-07-02', [day, day, day, day, day, { order: [9], tips: { anna: 2, ben: 9 } }], { total: 21 });
  const list = emblemsFor('anna', [t], ALL);
  assert.ok(keys(list).includes('hattrick:tour-2027:3'));
  assert.ok(keys(list).includes('unaufhaltsam:tour-2027:5'));
  assert.ok(!keys(list).some((k) => k.startsWith('hattrick:tour-2027:6')));
  assert.equal(list.find((e) => e.id === 'trikot-tour')!.name, 'Maillot Jaune');
  // geteilte Führung, also keine Trikotverteidigung
  assert.ok(!keys(list).includes('trikot5:tour-2027'));
});

test('Medaillen nach dem Endstand: Gold, Silber, Bronze, geteilt; Fotofinish, Start-Ziel-Sieg', () => {
  const days = Array.from({ length: 5 }, () => ({ order: [1, 2, 3, 4], tips: { anna: 1, ben: 2, carl: 3, dora: 4 } }));
  days[4] = { order: [2, 1, 3, 4], tips: { anna: 1, ben: 2, carl: 3, dora: 4 } };
  const open = tour('giro-2026', 'giro', '2026-10-26', days);
  assert.ok(!emblemsFor('anna', [open], ALL).some((e) => e.rarity === 'medaille'), 'erst mit Endstand');
  const t = { ...open, tour: { ...open.tour, bonus_final: true } };
  const anna = emblemsFor('anna', [t], ALL);
  const gold = anna.find((e) => e.key === 'gold:giro-2026')!;
  assert.equal(gold.name, 'Gold · Giro 2026');
  assert.equal(gold.look.ribbon, 'giro');
  assert.ok(keys(anna).includes('startziel:giro-2026'));
  assert.ok(keys(anna).includes('lueckenlos:giro-2026'));
  assert.ok(keys(anna).includes('punkte:giro-2026'));
  assert.ok(keys(anna).includes('trikot5:giro-2026'));
  assert.ok(keys(emblemsFor('ben', [t], ALL)).includes('silver:giro-2026'));
  assert.ok(keys(emblemsFor('carl', [t], ALL)).includes('bronze:giro-2026'));
  const dora = emblemsFor('dora', [t], ALL);
  assert.ok(keys(dora).includes('laterne:giro-2026'));
  assert.ok(!dora.some((e) => e.rarity === 'medaille'));
  // geteilter zweiter Platz: zweimal Silber
  const tie = tour('vuelta-2027', 'vuelta', '2027-09-04', [{ order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 2 } }], { final: true });
  assert.ok(keys(emblemsFor('ben', [tie], ALL)).includes('silver:vuelta-2027'));
  assert.ok(keys(emblemsFor('carl', [tie], ALL)).includes('silver:vuelta-2027'));
  assert.match(emblemsFor('carl', [tie], ALL).find((e) => e.key === 'silver:vuelta-2027')!.text, /geteilt/);
});

test('Spezialisten, Schlussakkord, Glaskugel', () => {
  const days = [
    { order: [1], tips: { anna: 1, ben: 2 }, kind: 'mountain' as StageKind },
    { order: [1], tips: { anna: 1, ben: 2 }, kind: 'mountain' as StageKind },
    { order: [2], tips: { anna: 1, ben: 2 }, kind: 'mountain' as StageKind },
    { order: [1], tips: { anna: 1, ben: 2 }, kind: 'itt' as StageKind },
    { order: [2, 1], tips: { anna: 1, ben: 2 }, kind: 'itt' as StageKind },
  ];
  const t = tour('giro-2026', 'giro', '2026-10-26', days, { final: true });
  t.bonusTips = [{ tour_id: 'giro-2026', user_id: 'anna', category: 'gc', rider_id: 7, team: null }];
  t.bonusResults = [{ tour_id: 'giro-2026', category: 'gc', position: 1, rider_id: 7, team: null }];
  const anna = keys(emblemsFor('anna', [t], ALL));
  assert.ok(anna.includes('bergfloh:giro-2026'));
  assert.ok(anna.includes('uhrwerk:giro-2026'));
  assert.ok(anna.includes('glaskugel:giro-2026'));
  assert.ok(!anna.includes('schluss:giro-2026'));
  assert.ok(keys(emblemsFor('ben', [t], ALL)).includes('schluss:giro-2026'));
});

test('Zeitpunkt des Tipps: Nachteule, letzter Drücker, früher Vogel', () => {
  const t = tour('giro-2026', 'giro', '2026-10-26', [
    { order: [1, 2], tips: { anna: 1, ben: 2 }, saved: { anna: '2026-10-26T01:30:00Z' } }, // 02:30 in Berlin
    { order: [1, 2], tips: { anna: 1, ben: 2 }, saved: { anna: '2026-10-27T10:58:30Z' } }, // 90 s vor dem Start
    { order: [3, 1], tips: { anna: 1, ben: 2 }, saved: { anna: '2026-10-20T10:00:00Z' } }, // Tage vorher, Platz 2
  ], { total: 21 });
  const anna = keys(emblemsFor('anna', [t], ALL));
  assert.ok(anna.includes('eule'));
  assert.ok(anna.includes('drucker'));
  assert.ok(anna.includes('vogel'));
});

test('über Rundfahrten: Saisonkarte, Stammgast, Titelverteidigung, Triple, Treppchen-Abo', () => {
  const win = [{ order: [1, 2], tips: { anna: 1, ben: 2 } }];
  const g = tour('giro-2027', 'giro', '2027-05-08', win, { final: true });
  const t = tour('tour-2027', 'tour', '2027-07-02', win, { final: true });
  const v = tour('vuelta-2027', 'vuelta', '2027-09-04', win, { final: true });
  const anna = keys(emblemsFor('anna', [v, g, t], ALL));
  for (const k of ['saison:2027', 'stammgast', 'titel:tour-2027', 'titel:vuelta-2027', 'triple:2027', 'treppchen']) assert.ok(anna.includes(k), k);
  const ben = keys(emblemsFor('ben', [v, g, t], ALL));
  assert.ok(ben.includes('saison:2027'));
  assert.ok(!ben.includes('triple:2027'));
});

test('Vitrine: Medaillen vorn, gleiche Abzeichen in einem Fach mit Anzahl', () => {
  const day = { order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } };
  const g = tour('giro-2026', 'giro', '2026-10-26', [day, day], { final: true });
  const t = tour('tour-2027', 'tour', '2027-07-02', [day, day, day], { final: true });
  const s = shelf(emblemsFor('anna', [g, t], ALL));
  assert.deepEqual(s.medals.map((m) => m.latest.key), ['gold:tour-2027', 'gold:giro-2026']);
  assert.deepEqual(s.count, { gold: 2, silver: 0, bronze: 0 });
  const day1 = s.badges.find((b) => b.id === 'tagessieg')!;
  assert.equal(day1.all.length, 5);
  assert.equal(s.badges[0].latest.rarity === 'legendaer' || s.badges[0].latest.rarity === 'episch', true);
});

test('Zufallsrunden: saubere Texte, eindeutige Schlüssel, immer gleich', () => {
  let seed = 7;
  const r = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const kinds: StageKind[] = ['flat', 'hilly', 'mountain', 'itt'];
  for (let n = 0; n < 60; n++) {
    const members = ALL.slice(0, 2 + Math.floor(r() * 3));
    const tours = (['giro', 'tour', 'vuelta'] as TourTheme[]).map((theme, k) => {
      const len = 3 + Math.floor(r() * 8);
      const days = Array.from({ length: len }, () => ({
        order: Array.from({ length: 10 }, (_, i) => i + 1).sort(() => r() - 0.5),
        tips: Object.fromEntries(members.filter(() => r() > 0.1).map((m) => [m.id, 1 + Math.floor(r() * 6)])),
        kind: kinds[Math.floor(r() * kinds.length)],
      }));
      return tour(`${theme}-2027`, theme, `2027-0${5 + 2 * k}-01`, days, { final: r() > 0.4 });
    });
    for (const m of members) {
      const list = emblemsFor(m.id, tours, members);
      assert.deepEqual(emblemsFor(m.id, tours, members), list);
      assert.equal(new Set(keys(list)).size, list.length);
      for (const e of list) {
        assert.doesNotMatch(`${e.name} ${e.text}`, /undefined|NaN|null|\s{2}/, e.text);
        assert.ok(Number.isFinite(Date.parse(e.at)));
      }
    }
  }
});
