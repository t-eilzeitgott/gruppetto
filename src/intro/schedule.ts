/**
 * Start-Animationen: welche wann läuft. Reine Logik ohne DOM – das Intro (index.html), die Admin-Übersicht und
 * die Tests benutzen dieselben Regeln.
 *
 * Reihenfolge:
 *   1. Vorschau (?intro=id oder id:parameter) – zählt nicht mit
 *   2. Thema des Tages: Renntag (Etappe heute, aus den zwischengespeicherten Etappen der App), sonst Feiertag
 *      bzw. Woche (Halloween, Herbstlaub, Laternen, Nebel, Frost, Advent, Weihnachten, Winter, Silvester,
 *      Neujahr; im neuen Jahr Valentinstag, Karneval, Ostern)
 *   3. Jedes dritte Öffnen eine Abwechslung (reihum Sprint, Windschatten, Zielfoto, Laufrad, Trikots) – an Tagen
 *      mit Thema aber nie beim ersten Öffnen des Tages
 *   4. sonst die gewohnte Animation
 */

export type IntroId =
  | 'base' | 'sprint' | 'windschatten' | 'zielfoto' | 'laufrad' | 'trikots'
  | 'halloween' | 'laub' | 'laterne' | 'nebel' | 'frost' | 'advent' | 'weihnachten' | 'winter' | 'silvester' | 'neujahr'
  | 'valentin' | 'karneval' | 'ostern' | 'renntag';

/** Etappe an einem Tag (von der App zwischengespeichert, siehe app/raceDays.ts) */
export interface RaceDay {
  /** Rundfahrt (id) */
  id?: string;
  /** Farbe der Rundfahrt: giro, tour, vuelta */
  t: string;
  /** Kurzname der Rundfahrt (z. B. „Giro“) */
  tour?: string;
  /** Etappennummer */
  n: number;
  /** Art: flat, hilly, mountain, itt, ttt */
  k: string;
  from?: string | null;
  to?: string | null;
  km?: number | null;
  /** letzte Etappe der Rundfahrt */
  last?: boolean;
}

export type IntroWhy = 'vorschau' | 'renntag' | 'tag' | 'woche' | 'abwechslung' | 'standard';

export interface IntroPick {
  id: IntroId;
  /** Parameter der Variante (Advent: Zahl der Kerzen, Neujahr: Jahr, Renntag: Etappenart) */
  p?: string;
  race?: RaceDay;
  why: IntroWhy;
}

/** Abwechslung bei jedem dritten Öffnen (reihum) */
export const ALTS: IntroId[] = ['sprint', 'windschatten', 'zielfoto', 'laufrad', 'trikots'];

export const INTRO_IDS: IntroId[] = [
  'base', ...ALTS,
  'halloween', 'laub', 'laterne', 'nebel', 'frost', 'advent', 'weihnachten', 'winter', 'silvester', 'neujahr',
  'valentin', 'karneval', 'ostern', 'renntag',
];

const isId = (s: string): s is IntroId => (INTRO_IDS as string[]).includes(s);

/** schon gebaute Varianten (die übrigen zeigen bis dahin das gewohnte Intro) */
export const BUILT: IntroId[] = INTRO_IDS;

// ---------------------------------------------------------------- Kalender

/** Tagesnummer (UTC, ohne Zeitzonen-Sprünge) */
export const dayNo = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000);

const parse = (key: string): [number, number, number] => key.split('-').map(Number) as [number, number, number];

/** Ostersonntag (gregorianisch, Gauß/Anonymous) als Tagesnummer */
export function easter(y: number): number {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNo(y, month, day);
}

/** 4. Advent: letzter Sonntag vor dem 25. Dezember (Tagesnummer) */
export function advent4(y: number): number {
  const d24 = dayNo(y, 12, 24);
  // Wochentag: Tag 0 (1.1.1970) war ein Donnerstag → (n + 4) % 7, Sonntag = 0
  const wd = (((d24 + 4) % 7) + 7) % 7;
  return d24 - wd;
}

export interface Season {
  id: IntroId;
  p?: string;
  /** der eigentliche Tag (Halloween, Heiligabend, Silvester …) – nicht nur die Woche */
  day: boolean;
}

/** Thema eines Kalendertags ('YYYY-MM-DD', Berlin) – oder null */
export function seasonOf(key: string): Season | null {
  const [y, m, d] = parse(key);
  const t = dayNo(y, m, d);
  const md = m * 100 + d;
  const a1 = advent4(y) - 21;
  if (md >= 1025 && md <= 1101) return { id: 'halloween', day: md === 1031 };
  if (md >= 1102 && md <= 1108) return { id: 'laub', day: false };
  if (md >= 1109 && md <= 1115) return { id: 'laterne', day: md === 1111 };
  if (md >= 1116 && md <= 1122) return { id: 'nebel', day: false };
  if (t >= a1 && md <= 1223) {
    const n = Math.min(4, 1 + Math.floor((t - a1) / 7));
    return { id: 'advent', p: String(n), day: (t - a1) % 7 === 0 };
  }
  if (md >= 1123 && t < a1) return { id: 'frost', day: false };
  if (md >= 1224 && md <= 1227) return { id: 'weihnachten', day: md === 1224 || md === 1225 };
  if (md >= 1228 && md <= 1230) return { id: 'winter', day: false };
  if (md === 1231 || md === 101) return { id: 'silvester', day: true };
  if (md >= 102 && md <= 106) return { id: 'neujahr', p: String(y), day: false };
  if (md === 214) return { id: 'valentin', day: true };
  const e = easter(y);
  // Weiberfastnacht bis Veilchendienstag; Rosenmontag ist der Tag
  if (t >= e - 52 && t <= e - 47) return { id: 'karneval', day: t === e - 48 };
  // Karfreitag bis Ostermontag
  if (t >= e - 2 && t <= e + 1) return { id: 'ostern', day: t === e };
  return null;
}

// ---------------------------------------------------------------- Auswahl

export interface PickInput {
  /** Kalendertag in Berlin */
  day: string;
  /** wie oft die App gestartet wurde (mit diesem Start) */
  n: number;
  /** erster Start an diesem Tag */
  firstToday: boolean;
  race?: RaceDay | null;
  /** Vorschau: „id“ oder „id:parameter“ */
  force?: string | null;
}

export function pickIntro(o: PickInput): IntroPick {
  if (o.force) {
    const [id, p] = o.force.split(':');
    if (isId(id)) {
      const pick: IntroPick = { id, why: 'vorschau' };
      if (p) pick.p = p;
      if (id === 'renntag') pick.race = o.race && !p ? o.race : demoRace(p);
      if (id === 'advent' && !p) pick.p = '2';
      if (id === 'neujahr' && !p) pick.p = String(Number(o.day.slice(0, 4)) + (o.day.slice(5, 7) === '12' ? 1 : 0));
      return pick;
    }
  }
  const alt = o.n % 3 === 0;
  if (o.race && (o.firstToday || !alt)) return { id: 'renntag', p: o.race.k, race: o.race, why: 'renntag' };
  const s = seasonOf(o.day);
  if (s && (o.firstToday || !alt)) {
    const pick: IntroPick = { id: s.id, why: s.day ? 'tag' : 'woche' };
    if (s.p) pick.p = s.p;
    return pick;
  }
  if (alt) return { id: ALTS[Math.floor(o.n / 3) % ALTS.length], why: 'abwechslung' };
  return { id: 'base', why: 'standard' };
}

/** Beispiel-Etappe für die Vorschau (Art aus dem Parameter) */
export function demoRace(kind?: string): RaceDay {
  const k = kind && ['flat', 'hilly', 'mountain', 'itt', 'ttt', 'start', 'last'].includes(kind) ? kind : 'mountain';
  if (k === 'start') return { t: 'giro', tour: 'Giro', n: 1, k: 'flat', from: 'Durrës', to: 'Tirana', km: 160 };
  if (k === 'last') return { t: 'giro', tour: 'Giro', n: 21, k: 'flat', from: 'Roma', to: 'Roma', km: 141, last: true };
  const sample: Record<string, RaceDay> = {
    flat: { t: 'tour', tour: 'Tour', n: 6, k: 'flat', from: 'Bayeux', to: 'Vire', km: 184 },
    hilly: { t: 'vuelta', tour: 'Vuelta', n: 9, k: 'hilly', from: 'Logroño', to: 'Burgos', km: 168 },
    mountain: { t: 'giro', tour: 'Giro', n: 16, k: 'mountain', from: 'Merano', to: 'Passo dello Stelvio', km: 203 },
    itt: { t: 'tour', tour: 'Tour', n: 13, k: 'itt', from: 'Lyon', to: 'Lyon', km: 34 },
    ttt: { t: 'vuelta', tour: 'Vuelta', n: 1, k: 'ttt', from: 'Barcelona', to: 'Barcelona', km: 21 },
  };
  return sample[k];
}

// ---------------------------------------------------------------- Übersicht (Admin)

export const INTRO_INFO: Record<IntroId, { name: string; desc: string }> = {
  base: { name: 'Gewohnt', desc: '„g." – der Punkt rollt das Wort aus' },
  sprint: { name: 'Zielsprint', desc: 'Der Punkt schießt von links herein, die Buchstaben springen in seinem Windschatten auf, kurzer Wurf auf den Zielstrich' },
  windschatten: { name: 'Windschatten', desc: 'Die Buchstaben rollen als enges Feld herein und ziehen sich hinter dem Punkt auseinander' },
  zielfoto: { name: 'Zielfoto', desc: 'Ein Zielkamera-Schlitz tastet das Wort ab, dazu läuft die Zeit' },
  laufrad: { name: 'Laufrad', desc: 'Der Punkt ist ein Laufrad mit Speichen, rollt aus und dreht sich still' },
  trikots: { name: 'Trikots', desc: 'Beim Rollen trägt der Punkt nacheinander Rosa, Gelb, Grün und das Bergtrikot' },
  halloween: { name: 'Halloween', desc: 'Ein Kürbis rollt das Wort aus, sein Gesicht glimmt; eine Fledermaus kreuzt den Mond' },
  laub: { name: 'Herbstlaub', desc: 'Der rollende Punkt wirbelt Blätter auf, die langsam zu Boden segeln' },
  laterne: { name: 'Laternen', desc: 'St. Martin: der Punkt ist eine leuchtende Laterne, die sanft pendelt' },
  nebel: { name: 'Novembernebel', desc: 'Das Wort taucht aus dem Nebel auf, der Punkt leuchtet wie ein Fahrradlicht hinein' },
  frost: { name: 'Raureif', desc: 'Eisblumen wachsen aus den Ecken, ein kalter Glanz läuft über das Wort' },
  advent: { name: 'Advent', desc: 'Vier Punkte wie ein Adventskranz – je Adventssonntag brennt eine Kerze mehr' },
  weihnachten: { name: 'Weihnachten', desc: 'Leiser Schneefall, der Punkt wird zum goldenen Stern' },
  winter: { name: 'Schneeball', desc: 'Der Punkt rollt als Schneeball und wird dabei größer, es schneit' },
  silvester: { name: 'Silvester', desc: 'Der Punkt steigt als Rakete auf und zerplatzt als Feuerwerk' },
  neujahr: { name: 'Neujahr', desc: 'Unter dem Wort springt die Jahreszahl auf die neue Saison' },
  valentin: { name: 'Valentinstag', desc: 'Der Punkt wird zum Herz und schlägt' },
  karneval: { name: 'Karneval', desc: 'Beim Aufsetzen platzt Konfetti, Luftschlangen fliegen' },
  ostern: { name: 'Ostern', desc: 'Ein Osterei hüpft wie ein Hase und wackelt beim Landen' },
  renntag: { name: 'Renntag', desc: 'Das Profil der Etappe zeichnet sich, der Punkt fährt es ab – in der Farbe der Rundfahrt, mit Etappe und Ziel' },
};

/** Themen der nächsten Tage als Abschnitte (für die Übersicht): von, bis, Thema */
export function plan(fromKey: string, days: number): { from: string; to: string; id: IntroId; p?: string }[] {
  const [y, m, d] = parse(fromKey);
  const t0 = dayNo(y, m, d);
  const out: { from: string; to: string; id: IntroId; p?: string }[] = [];
  for (let t = t0; t < t0 + days; t++) {
    const key = new Date(t * 86400000).toISOString().slice(0, 10);
    const s = seasonOf(key);
    if (!s) continue;
    const last = out[out.length - 1];
    if (last && last.id === s.id && last.p === s.p && dayNo(...parse(last.to)) === t - 1) last.to = key;
    else out.push({ from: key, to: key, id: s.id, ...(s.p ? { p: s.p } : {}) });
  }
  return out;
}
