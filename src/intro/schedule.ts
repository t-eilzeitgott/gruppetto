/**
 * Start-Animationen: welche wann läuft. Reine Logik ohne DOM – das Intro (index.html), die Admin-Übersicht und
 * die Tests benutzen dieselben Regeln.
 *
 * Reihenfolge:
 *   1. Vorschau (?intro=id oder id:parameter) – zählt nicht mit
 *   2. Renntag (Etappe heute, aus den zwischengespeicherten Etappen der App) – beim ersten Öffnen des Tages
 *      immer, danach außer bei jedem dritten Öffnen
 *   3. Jedes dritte Öffnen eine Abwechslung (reihum)
 *   4. sonst die gewohnte Animation
 */

export type IntroId =
  | 'base' | 'sprint' | 'windschatten' | 'zielfoto' | 'laufrad' | 'trikots' | 'fokus' | 'welle' | 'fall'
  | 'renntag';

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

export type IntroWhy = 'vorschau' | 'renntag' | 'abwechslung' | 'standard';

export interface IntroPick {
  id: IntroId;
  /** Parameter der Variante (Renntag: Etappenart) */
  p?: string;
  race?: RaceDay;
  why: IntroWhy;
}

/** Abwechslung bei jedem dritten Öffnen (reihum) */
export const ALTS: IntroId[] = ['sprint', 'fokus', 'windschatten', 'zielfoto', 'welle', 'laufrad', 'fall', 'trikots'];

export const INTRO_IDS: IntroId[] = ['base', ...ALTS, 'renntag'];

const isId = (s: string): s is IntroId => (INTRO_IDS as string[]).includes(s);

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
      return pick;
    }
  }
  const alt = o.n % 3 === 0;
  if (o.race && (o.firstToday || !alt)) return { id: 'renntag', p: o.race.k, race: o.race, why: 'renntag' };
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
  fokus: { name: 'Fokus', desc: 'Die Buchstaben werden nacheinander scharf, der Punkt fällt zuletzt von oben auf seinen Platz' },
  welle: { name: 'Welle', desc: 'Die Buchstaben wachsen als Welle aus der Grundlinie, wie ein Feld über eine Kuppe' },
  fall: { name: 'Aufprall', desc: 'Der Punkt fällt von oben, beim Aufprall fächert sich das Wort nach links auf' },
  renntag: { name: 'Renntag', desc: 'Das Profil der Etappe zeichnet sich, der Punkt fährt es ab – in der Farbe der Rundfahrt, mit Etappe und Ziel' },
};
