import type {
  BonusResult, BonusTip, Climb, Profile, Rider, Sprint, Stage, StageKind, StageResult, StageTip, Tour,
} from '../lib/types';

// Nation und Alter der Demo-Fahrer (Beispielwerte)
const NAT: Record<string, [string, number]> = {
  'Tadej Pogačar': ['SI', 28], 'Isaac del Toro': ['MX', 23], 'Adam Yates': ['GB', 34], 'Felix Großschartner': ['AT', 33],
  'Jonas Vingegaard': ['DK', 30], 'Wout van Aert': ['BE', 32], 'Sepp Kuss': ['US', 32], 'Matteo Jorgenson': ['US', 27],
  'Remco Evenepoel': ['BE', 27], 'Primož Roglič': ['SI', 37], 'Florian Lipowitz': ['DE', 26], 'Giulio Pellizzari': ['IT', 23],
  'Paul Seixas': ['FR', 20], 'Olav Kooij': ['NL', 25], 'Felix Gall': ['AT', 29], 'Dorian Godon': ['FR', 30],
  'Juan Ayuso': ['ES', 24], 'Giulio Ciccone': ['IT', 32], 'Mads Pedersen': ['DK', 31], 'Jonathan Milan': ['IT', 26],
  'Antonio Tiberi': ['IT', 25], 'Lenny Martinez': ['FR', 23], 'Santiago Buitrago': ['CO', 27], 'Phil Bauhaus': ['DE', 32],
  'Mathieu van der Poel': ['NL', 32], 'Kaden Groves': ['AU', 28], 'Jasper Philipsen': ['BE', 29], 'Silvan Dillier': ['CH', 36],
  'Thymen Arensman': ['NL', 27], 'Egan Bernal': ['CO', 30], 'Filippo Ganna': ['IT', 30], 'Joshua Tarling': ['GB', 23],
  'Tim Merlier': ['BE', 34], 'Mikel Landa': ['ES', 37], 'Valentin Paret-Peintre': ['FR', 26], 'Ilan Van Wilder': ['BE', 27],
  'Arnaud De Lie': ['BE', 25], 'Lennert Van Eetvelt': ['BE', 25], 'Maxim Van Gils': ['BE', 27], 'Jarno Widar': ['BE', 21],
  'Tom Pidcock': ['GB', 27], 'Fabio Christen': ['CH', 24], 'Damiano Caruso': ['IT', 39], 'Matteo Moschetti': ['IT', 30],
  'Lorenzo Fortunato': ['IT', 31], 'Christian Scaroni': ['IT', 29], 'Simone Velasco': ['IT', 31], 'Wout Poels': ['NL', 39],
};

// Beispiel-Profile für einige Demo-Etappen
const PROFILES: Record<number, { climbs: Climb[]; sprints: Sprint[]; elevation_m: number }> = {
  2: { climbs: [{ name: 'Colle della Serra', cat: '4', km: 61.4 }], sprints: [{ km: 102.3 }, { km: 151 }], elevation_m: 1250 },
  4: { climbs: [{ name: 'Colle di Zambla', cat: '2', km: 74.2, len: 13.4, grad: 5.6 }, { name: 'Passo di Dossena', cat: '3', km: 96.8 }, { name: 'Passo San Marco', cat: '1', km: 186, len: 25.1, grad: 6.3 }], sprints: [{ km: 128.5 }], elevation_m: 4100 },
  7: { climbs: [{ name: 'Pietracolora', cat: '3', km: 128.7 }, { name: 'Corno alle Scale', cat: '1', km: 174, len: 10.8, grad: 6.1 }], sprints: [{ km: 92 }], elevation_m: 3350 },
  9: { climbs: [{ name: 'San Leo', cat: '3', km: 58.3, len: 4.9, grad: 7.2 }, { name: 'Monte Carpegna', cat: '1', km: 141.5, len: 6, grad: 9.6 }, { name: 'Monte Carpegna', cat: '1', km: 172, len: 6, grad: 9.6 }], sprints: [{ km: 104.7 }], elevation_m: 3900 },
  20: { climbs: [{ name: 'Passo dell\'Umbrail', cat: '1', km: 121 }, { name: 'Passo dello Stelvio', cat: 'CC', km: 168, len: 21.7, grad: 7.1 }], sprints: [{ km: 66 }], elevation_m: 4600 },
};

/** Beispieldaten: Giro d'Italia 2027, Sonntag 16. Mai vormittags (Etappe 8 gefahren). */
export const DEMO_NOW = new Date(2027, 4, 16, 9, 46).getTime();
export const DEMO_ME = 'u-christoph';

export const DEMO_TOURS: Tour[] = [
  { id: 'giro-2027', name: "Giro d'Italia 2027", short_name: 'Giro', theme: 'giro', year: 2027, start_date: '2027-05-08', end_date: '2027-05-30', is_visible: true, bonus_final: false, pcs_slug: 'giro-d-italia/2027', tip_limit: 3 },
  { id: 'tour-2027', name: 'Tour de France 2027', short_name: 'Tour', theme: 'tour', year: 2027, start_date: '2027-07-02', end_date: '2027-07-25', is_visible: true, bonus_final: false, pcs_slug: 'tour-de-france/2027', tip_limit: 3 },
  { id: 'vuelta-2027', name: 'La Vuelta 2027', short_name: 'Vuelta', theme: 'vuelta', year: 2027, start_date: '2027-09-04', end_date: '2027-09-26', is_visible: true, bonus_final: false, pcs_slug: 'vuelta-a-espana/2027', tip_limit: 3 },
];

const TEAMS: [string, [number, string][]][] = [
  ['UAE Team Emirates XRG', [[1, 'Tadej Pogačar'], [2, 'Isaac del Toro'], [3, 'Adam Yates'], [4, 'Felix Großschartner']]],
  ['Visma | Lease a Bike', [[11, 'Jonas Vingegaard'], [12, 'Wout van Aert'], [13, 'Sepp Kuss'], [14, 'Matteo Jorgenson']]],
  ['Red Bull – BORA – hansgrohe', [[21, 'Remco Evenepoel'], [22, 'Primož Roglič'], [23, 'Florian Lipowitz'], [24, 'Giulio Pellizzari']]],
  ['Decathlon CMA CGM', [[31, 'Paul Seixas'], [32, 'Olav Kooij'], [33, 'Felix Gall'], [34, 'Dorian Godon']]],
  ['Lidl-Trek', [[41, 'Juan Ayuso'], [42, 'Giulio Ciccone'], [43, 'Mads Pedersen'], [44, 'Jonathan Milan']]],
  ['Bahrain Victorious', [[51, 'Antonio Tiberi'], [52, 'Lenny Martinez'], [53, 'Santiago Buitrago'], [54, 'Phil Bauhaus']]],
  ['Alpecin – Premier Tech', [[61, 'Mathieu van der Poel'], [62, 'Kaden Groves'], [63, 'Jasper Philipsen'], [64, 'Silvan Dillier']]],
  ['INEOS Grenadiers', [[71, 'Thymen Arensman'], [72, 'Egan Bernal'], [73, 'Filippo Ganna'], [74, 'Joshua Tarling']]],
  ['Soudal Quick-Step', [[81, 'Tim Merlier'], [82, 'Mikel Landa'], [83, 'Valentin Paret-Peintre'], [84, 'Ilan Van Wilder']]],
  ['Lotto', [[91, 'Arnaud De Lie'], [92, 'Lennert Van Eetvelt'], [93, 'Maxim Van Gils'], [94, 'Jarno Widar']]],
  ['Pinarello Q36.5', [[101, 'Tom Pidcock'], [102, 'Fabio Christen'], [103, 'Damiano Caruso'], [104, 'Matteo Moschetti']]],
  ['XDS Astana', [[111, 'Lorenzo Fortunato'], [112, 'Christian Scaroni'], [113, 'Simone Velasco'], [114, 'Wout Poels']]],
];

export const DEMO_RIDERS: Rider[] = TEAMS.flatMap(([team, riders]) =>
  riders.map(([bib, name]) => ({
    id: bib,
    tour_id: 'giro-2027',
    bib,
    name,
    team,
    tip_limit: null,
    nationality: NAT[name]?.[0] ?? null,
    age: NAT[name]?.[1] ?? null,
    young: (NAT[name]?.[1] ?? 99) <= 25,
    excluded_from_rest: bib === 1 || bib === 11,
    status: bib === 64 ? 'out' as const : 'active' as const,
  })));

const riderId = (name: string): number => {
  const r = DEMO_RIDERS.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
  if (!r) throw new Error(`Demo-Fahrer fehlt: ${name}`);
  return r.id;
};

// Etappenplan (Beispiel): Datum, Startzeit, Profil, km, Start → Ziel
const PLAN: [number, number, number, StageKind, number, string, string][] = [
  [8, 14, 0, 'itt', 13.6, 'Torino', 'Torino'],
  [9, 12, 10, 'flat', 178, 'Torino', 'Novara'],
  [10, 12, 0, 'hilly', 192, 'Biella', 'Bergamo'],
  [11, 11, 40, 'mountain', 186, 'Bergamo', 'Passo San Marco'],
  [12, 12, 25, 'flat', 201, 'Sondrio', 'Cremona'],
  [13, 12, 0, 'hilly', 167, 'Parma', 'Reggio Emilia'],
  [14, 11, 50, 'mountain', 174, 'Modena', 'Corno alle Scale'],
  [15, 12, 15, 'hilly', 158, 'Bologna', 'Ravenna'],
  [16, 12, 15, 'mountain', 172, 'Rimini', 'Monte Carpegna'],
  [18, 12, 30, 'flat', 189, 'Pesaro', 'Ancona'],
  [19, 12, 0, 'hilly', 177, 'Macerata', 'Perugia'],
  [20, 12, 10, 'flat', 196, 'Arezzo', 'Siena'],
  [21, 13, 0, 'itt', 31, 'Siena', 'Montalcino'],
  [22, 11, 30, 'mountain', 205, 'Firenze', 'Abetone'],
  [23, 12, 20, 'mountain', 163, 'Lucca', 'Prato Nevoso'],
  [25, 12, 0, 'hilly', 181, 'Cuneo', 'Asti'],
  [26, 11, 45, 'mountain', 198, 'Pinerolo', 'Sestriere'],
  [27, 12, 30, 'flat', 207, 'Alessandria', 'Pavia'],
  [28, 11, 15, 'mountain', 182, 'Lecco', 'Bormio'],
  [29, 11, 30, 'mountain', 168, 'Bormio', 'Passo dello Stelvio'],
  [30, 15, 0, 'flat', 141, 'Verona', 'Verona'],
];

export const DEMO_STAGES: Stage[] = PLAN.map(([day, h, m, kind, km, from, to], i) => ({
  id: 1000 + i + 1,
  tour_id: 'giro-2027',
  number: i + 1,
  starts_at: new Date(2027, 4, day, h, m).toISOString(),
  kind,
  departure: from,
  arrival: to,
  distance_km: km,
  results_published: i < 8,
  climbs: PROFILES[i + 1]?.climbs ?? [],
  sprints: PROFILES[i + 1]?.sprints ?? [],
  elevation_m: PROFILES[i + 1]?.elevation_m ?? null,
}));

const RESULTS: string[][] = [
  ['Evenepoel', 'Vingegaard', 'Ganna', 'Pogačar', 'Tarling', 'Roglič', 'Seixas', 'Arensman', 'Lipowitz', 'Ayuso'],
  ['Milan', 'Pedersen', 'Kooij', 'Groves', 'Merlier', 'De Lie', 'Bauhaus', 'Moschetti', 'van Aert', 'Godon'],
  ['Pidcock', 'van der Poel', 'Pedersen', 'van Aert', 'Christen', 'Scaroni', 'Del Toro', 'Pogačar', 'Ciccone', 'Velasco'],
  ['Pogačar', 'Vingegaard', 'Seixas', 'Del Toro', 'Evenepoel', 'Lipowitz', 'Pellizzari', 'Ayuso', 'Gall', 'Tiberi'],
  ['Milan', 'Kooij', 'Groves', 'Merlier', 'De Lie', 'Pedersen', 'Bauhaus', 'Moschetti', 'Godon', 'van Aert'],
  ['Del Toro', 'Pogačar', 'Pellizzari', 'Vingegaard', 'Seixas', 'Ciccone', 'Scaroni', 'Fortunato', 'Ayuso', 'Gall'],
  ['Pogačar', 'Vingegaard', 'Seixas', 'Del Toro', 'Lipowitz', 'Evenepoel', 'Pellizzari', 'Martinez', 'Arensman', 'Kuss'],
  ['Groves', 'Milan', 'Kooij', 'Pedersen', 'De Lie', 'van Aert', 'Pidcock', 'van der Poel', 'Del Toro', 'Pogačar'],
];

export const DEMO_RESULTS: StageResult[] = RESULTS.flatMap((names, i) =>
  names.map((n, p) => ({ stage_id: 1000 + i + 1, position: p + 1, rider_id: riderId(n) })));

const PEOPLE: [string, string, string][] = [
  ['u-christoph', 'Christoph', '#2E7D4F'],
  ['u-felix', 'Felix', '#6A3FB5'],
  ['u-julian', 'Julian', '#1F6F8B'],
  ['u-lena', 'Lena', '#B23A6B'],
  ['u-jannik', 'Jannik', '#A0522D'],
  ['u-louis', 'Louis', '#3D5AFE'],
  ['u-sarah', 'Sarah', '#8E44AD'],
  ['u-max', 'Max', '#00796B'],
  ['u-tobi', 'Tobi', '#C0392B'],
  ['u-niklas', 'Niklas', '#455A64'],
  ['u-marie', 'Marie', '#6D4C41'],
  ['u-paul', 'Paul', '#5C6BC0'],
  ['u-jonas', 'Jonas', '#2E7D4F'],
  ['u-hannah', 'Hannah', '#B23A6B'],
  ['u-leon', 'Leon', '#1F6F8B'],
  ['u-mia', 'Mia', '#8E44AD'],
  ['u-finn', 'Finn', '#A0522D'],
  ['u-emma', 'Emma', '#00796B'],
  ['u-ben', 'Ben', '#3D5AFE'],
  ['u-clara', 'Clara', '#6A3FB5'],
  ['u-david', 'David', '#C0392B'],
  ['u-sophie', 'Sophie-Charlotte', '#455A64'],
  ['u-moritz', 'Moritz', '#6D4C41'],
  ['u-anna', 'Anna', '#5C6BC0'],
];

export const DEMO_PROFILES: Profile[] = PEOPLE.map(([id, name, color], i) => ({
  id,
  display_name: name,
  avatar_color: color,
  is_member: true,
  is_admin: id === DEMO_ME,
  is_pro: i % 5 === 1,
  pro_requested_at: i % 5 === 1 || i % 7 === 3 ? '2027-05-01T10:00:00Z' : null,
  created_at: '2027-04-20T18:00:00Z',
}));

// Feste Tipps für die ersten zehn Spieler (Etappe 1–8), Rest per Zufall mit festem Startwert
const FIXED: Record<string, string[]> = {
  'u-christoph': ['Vingegaard', 'Milan', 'Pedersen', 'Pogačar', 'Kooij', 'Vingegaard', 'Vingegaard', 'Milan'],
  'u-felix': ['Evenepoel', 'Kooij', 'Pedersen', 'Vingegaard', 'Groves', 'Pellizzari', 'Pogačar', 'Groves'],
  'u-julian': ['Pogačar', 'Milan', 'van der Poel', 'Pogačar', 'Milan', 'Pogačar', 'Lipowitz', 'Milan'],
  'u-lena': ['Ganna', 'Pedersen', 'Pidcock', 'Del Toro', 'De Lie', 'Pellizzari', 'Vingegaard', 'Groves'],
  'u-jannik': ['Evenepoel', 'Milan', 'van Aert', 'Vingegaard', 'Philipsen', 'Seixas', 'Vingegaard', 'Milan'],
  'u-louis': ['Vingegaard', 'Pedersen', 'Pedersen', 'Pogačar', 'De Lie', 'Ayuso', 'Vingegaard', 'Kooij'],
  'u-sarah': ['Ganna', 'Milan', 'Ciccone', 'Vingegaard', 'Bauhaus', 'Ayuso', 'Vingegaard', 'Milan'],
  'u-max': ['Ganna', 'Pedersen', 'Pedersen', 'Vingegaard', 'Kooij', 'Fortunato', 'Evenepoel', 'Pedersen'],
  'u-tobi': ['Evenepoel', 'Kooij', 'Pogačar', 'Pogačar', 'Groves', 'Gall', 'Vingegaard', 'Pogačar'],
  'u-niklas': ['Vingegaard', 'Kooij', 'Christen', 'Gall', 'Milan', 'Ciccone', 'Evenepoel', 'Merlier'],
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const POOLS: Record<StageKind, string[]> = {
  itt: ['Evenepoel', 'Ganna', 'Vingegaard', 'Pogačar', 'Tarling', 'Roglič', 'Arensman'],
  flat: ['Milan', 'Kooij', 'Groves', 'Merlier', 'De Lie', 'Pedersen', 'Bauhaus', 'Philipsen'],
  hilly: ['Pedersen', 'van der Poel', 'Pidcock', 'van Aert', 'Ciccone', 'Scaroni', 'Christen', 'Groves'],
  mountain: ['Pogačar', 'Vingegaard', 'Seixas', 'Del Toro', 'Evenepoel', 'Pellizzari', 'Ayuso', 'Lipowitz', 'Gall'],
  ttt: ['Pogačar'],
};

function buildTips(): StageTip[] {
  const tips: StageTip[] = [];
  const rand = rng(2027);
  for (const [id] of PEOPLE) {
    const used = new Map<number, number>();
    const fixed = FIXED[id];
    // Etappe 1–8 (gefahren), Etappe 9 (heute, außer Christoph und 5 weiteren), Etappe 10 bei manchen vorab
    const lastStage = id === DEMO_ME ? 8 : ['u-anna', 'u-moritz', 'u-david', 'u-emma', 'u-finn'].includes(id) ? 8 : id.length % 3 === 0 ? 10 : 9;
    for (let n = 1; n <= lastStage; n += 1) {
      const stage = DEMO_STAGES[n - 1];
      let name = fixed?.[n - 1];
      let rid = name ? riderId(name) : 0;
      if (!name) {
        const pool = POOLS[stage.kind];
        for (let tries = 0; tries < 20; tries += 1) {
          name = pool[Math.floor(rand() * pool.length)];
          rid = riderId(name);
          if ((used.get(rid) ?? 0) < 3) break;
        }
      }
      used.set(rid, (used.get(rid) ?? 0) + 1);
      tips.push({ stage_id: stage.id, user_id: id, rider_id: rid, updated_at: stage.starts_at });
    }
  }
  return tips;
}

export const DEMO_TIPS: StageTip[] = buildTips();

const BONUS_FIXED: Record<string, Partial<Record<BonusTip['category'], string>>> = {
  'u-christoph': { gc: 'Pogačar', rest: 'Del Toro', points: 'Milan', mountains: 'Ciccone', youth: 'Seixas', combative: 'Fortunato', stage_wins: 'Milan', team: 'UAE Team Emirates XRG' },
  'u-felix': { gc: 'Vingegaard', rest: 'Seixas', points: 'Milan', mountains: 'Fortunato', youth: 'Del Toro', combative: 'Scaroni', stage_wins: 'Pogačar', team: 'Visma | Lease a Bike' },
};

function buildBonusTips(): BonusTip[] {
  const rand = rng(99);
  const pick = (arr: string[]) => arr[Math.floor(rand() * arr.length)];
  const tips: BonusTip[] = [];
  for (const [id] of PEOPLE) {
    const fixed = BONUS_FIXED[id] ?? {
      gc: pick(['Pogačar', 'Vingegaard', 'Pogačar']),
      rest: pick(['Seixas', 'Del Toro', 'Ayuso', 'Pellizzari']),
      points: pick(['Milan', 'Pedersen', 'Kooij']),
      mountains: pick(['Ciccone', 'Fortunato', 'Pogačar', 'Martinez']),
      youth: pick(['Seixas', 'Del Toro', 'Pellizzari', 'Widar']),
      combative: pick(['Fortunato', 'Scaroni', 'Velasco', 'Christen']),
      stage_wins: pick(['Milan', 'Pogačar', 'Kooij']),
      team: pick(['UAE Team Emirates XRG', 'Visma | Lease a Bike', 'Red Bull – BORA – hansgrohe', 'Lidl-Trek']),
    };
    for (const [category, value] of Object.entries(fixed) as [BonusTip['category'], string][]) {
      if (category === 'team') tips.push({ tour_id: 'giro-2027', user_id: id, category, rider_id: null, team: value });
      else tips.push({ tour_id: 'giro-2027', user_id: id, category, rider_id: riderId(value), team: null });
    }
  }
  return tips;
}

export const DEMO_BONUS_TIPS: BonusTip[] = buildBonusTips();

const standing = (category: BonusResult['category'], names: string[]): BonusResult[] =>
  names.map((n, i) => (category === 'team'
    ? { tour_id: 'giro-2027', category, position: i + 1, rider_id: null, team: n }
    : { tour_id: 'giro-2027', category, position: i + 1, rider_id: riderId(n), team: null }));

export const DEMO_BONUS_RESULTS: BonusResult[] = [
  ...standing('gc', ['Pogačar', 'Vingegaard', 'Seixas']),
  ...standing('rest', ['Seixas', 'Del Toro', 'Evenepoel']),
  ...standing('points', ['Milan', 'Pedersen', 'Kooij']),
  ...standing('mountains', ['Pogačar', 'Fortunato', 'Martinez']),
  ...standing('youth', ['Seixas', 'Del Toro', 'Pellizzari']),
  ...standing('team', ['Visma | Lease a Bike', 'UAE Team Emirates XRG', 'Red Bull – BORA – hansgrohe']),
];
