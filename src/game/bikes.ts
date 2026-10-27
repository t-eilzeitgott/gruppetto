/**
 * Räder zum Freischalten: zwölf erfundene Modelle, gestaltet nach den großen Epochen und Gattungen des
 * Rennrads (keine echten Marken). Rein optisch – an der Fahrphysik ändert sich nichts, die Bestenlisten
 * bleiben fair.
 *
 * Freigeschaltet wird der Reihe nach: Am Anfang hat man nur das Teamrad, jedes weitere Rad hat eine Aufgabe,
 * die erst zählt, wenn das Rad davor freigeschaltet ist. Gezählt werden die eigenen Läufe aller Minispiele
 * seit Eröffnung der Garage (gilt so auf jedem Gerät).
 */
import type { GameBest, GameId } from '../data/source';

export type FrameKind = 'modern' | 'steel' | 'alu' | 'climb' | 'aero' | 'ti' | 'tt' | 'cross' | 'gravel' | 'track';
export type WheelKind = 'carbon45' | 'box36' | 'box32' | 'carbon30' | 'deep60' | 'tt' | 'spoke4';

/** ab hier zählen die Läufe für die Garage (Eröffnung) */
export const GARAGE_START = '2026-10-27T00:00:00+01:00';

export interface BikeSpec {
  id: string;
  name: string;
  /** Epoche / Gattung */
  era: string;
  blurb: string;
  specs: [string, string][];
  frame: FrameKind;
  wheels: WheelKind;
  brakes: 'rim' | 'disc' | 'canti' | 'none';
  bar: 'modern' | 'classic' | 'integrated' | 'tt' | 'track' | 'flare';
  saddle: 'race' | 'leather' | 'tt';
  pedals: 'clipless' | 'toeclip';
  tires: 'black' | 'tan';
  /** Reifen: halbe Breite (m) und Stollen */
  tire?: { w?: number; knobs?: number };
  /** Antrieb: zwei Kettenblätter (Standard), eins mit Schaltung, oder starrer Gang ohne Schaltung */
  drive?: 'double' | 'single' | 'fixed';
  /** Taschen fürs Bikepacking */
  bags?: boolean;
  /** Kopfbedeckung des Fahrers auf diesem Rad, eigene Helmfarbe */
  head: 'helmet' | 'aero' | 'cap';
  helmet?: string;
  /** Lackierung: Grundfarbe, Zweitfarbe (Verlauf/Paneel), Schriftzug, Metallteile ('silver' | 'black' | 'gold'), Oberfläche */
  paint: {
    base: string; second?: string; fade?: 'z' | 'y'; panel?: string; decal: string; metal: 'silver' | 'black' | 'gold'; finish?: 'gloss' | 'satin' | 'brushed' | 'chrome';
    /** Streifen um Ober- und Sitzrohr (von oben nach unten) */
    stripes?: string[];
    /** Schlamm unten am Rahmen */
    mud?: boolean;
  };
  /** Schriftzug auf dem Unterrohr (erfunden) */
  wordmark: string;
  /** Lenkerband */
  tape: string;
  unlock: Unlock;
}

/** Aufgabe zum Freischalten: am Anfang Läufe, danach gesammelte Kilometer */
export type Unlock =
  | { kind: 'free' }
  | { kind: 'runs'; n: number }
  | { kind: 'km'; n: number };

export const BIKES: BikeSpec[] = [
  {
    id: 'allround', name: 'Gruppetto Allround', era: 'Carbon-Rennrad · heute',
    blurb: 'Das Teamrad: steif, leicht, Scheibenbremsen, elektronische Schaltung – lackiert in deiner Farbe.',
    specs: [['Rahmen', 'Carbon'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,2 kg']],
    frame: 'modern', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet',
    paint: { base: 'team', decal: '#ffffff', metal: 'black' }, wordmark: 'GRUPPETTO', tape: '#16171a',
    unlock: { kind: 'free' },
  },
  {
    id: 'acciaio', name: "Acciaio '74", era: 'Stahlrenner · 1970er',
    blurb: 'Dünne Stahlrohre, verchromte Muffen, Rahmenschalthebel, Kastenfelgen mit Schlauchreifen und Ledersattel. Dazu die Stoffmütze.',
    specs: [['Rahmen', 'Stahl, gemufft'], ['Laufräder', 'Kastenfelge · 36 Speichen'], ['Gruppe', '2 × 6, Rahmenschalter'], ['Gewicht', '9,8 kg']],
    frame: 'steel', wheels: 'box36', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'toeclip', tires: 'tan', head: 'cap',
    paint: { base: '#6e1423', panel: '#efe4c8', decal: '#d9b25a', metal: 'silver' }, wordmark: 'Acciaio', tape: '#f1ede3',
    unlock: { kind: 'runs', n: 3 },

  },
  {
    id: 'pave', name: "Pavé '93", era: 'Alu-Klassiker · 1990er',
    blurb: 'Dicke Aluminiumrohre im Neon-Verlauf, breitere Reifen und doppelt gewickeltes Lenkerband – gebaut für Kopfsteinpflaster.',
    specs: [['Rahmen', 'Aluminium, oversized'], ['Laufräder', '32 Speichen · 28 mm'], ['Gruppe', '2 × 8, Brems-Schalthebel'], ['Gewicht', '8,9 kg']],
    frame: 'alu', wheels: 'box32', brakes: 'rim', bar: 'classic', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet',
    paint: { base: '#d9ff2a', second: '#ff2d95', fade: 'z', decal: '#16171a', metal: 'silver' }, wordmark: 'PAVÉ', tape: '#16171a',
    unlock: { kind: 'runs', n: 6 },

  },
  {
    id: 'matsch', name: 'Matschkönig', era: 'Querfeldein · 2000er',
    blurb: 'Alu-Crosser mit Cantilever-Bremsen, groben Stollenreifen und ordentlich Schlamm am Rahmen – gebaut für Wintermatsch, Sandgruben und Treppen.',
    specs: [['Rahmen', 'Aluminium'], ['Laufräder', '32 Speichen · Stollen 33 mm'], ['Gruppe', '2 × 10, Cantilever'], ['Gewicht', '8,6 kg']],
    frame: 'cross', wheels: 'box32', brakes: 'canti', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', tire: { w: 0.0165, knobs: 0.003 }, head: 'helmet',
    paint: { base: '#ff6a13', second: '#16171a', fade: 'z', decal: '#16171a', metal: 'black', mud: true }, wordmark: 'MATSCHKÖNIG', tape: '#16171a',
    unlock: { kind: 'runs', n: 10 },

  },
  {
    id: 'feder', name: 'Federgewicht', era: 'Kletterrad · heute',
    blurb: 'Zarte Carbonrohre, flache 30-mm-Felgen, Sichtcarbon mit Goldschrift – jedes Gramm zählt, wenn es steil wird.',
    specs: [['Rahmen', 'Carbon, unlackiert'], ['Laufräder', '30 mm Carbon'], ['Gruppe', '2 × 12 mechanisch'], ['Gewicht', '6,1 kg']],
    frame: 'climb', wheels: 'carbon30', brakes: 'rim', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'tan', head: 'helmet',
    paint: { base: '#232428', decal: '#d6b25e', metal: 'gold', finish: 'satin' }, wordmark: 'FEDERGEWICHT', tape: '#232428',
    unlock: { kind: 'km', n: 40 },

  },
  {
    id: 'aero', name: 'Aero Pfeil', era: 'Aero-Maschine · heute',
    blurb: 'Tropfenförmige Rohre, tief angesetzte Sitzstreben, integriertes Cockpit und 60-mm-Felgen. Lack mit Farbwechsel.',
    specs: [['Rahmen', 'Carbon, Aero-Profile'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,4 kg']],
    frame: 'aero', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet',
    paint: { base: '#0e1f3d', second: '#19c3b3', fade: 'y', decal: '#e9eef5', metal: 'black' }, wordmark: 'AERO PFEIL', tape: '#101114',
    unlock: { kind: 'km', n: 60 },

  },
  {
    id: 'fernweh', name: 'Fernweh', era: 'Gravel · Bikepacking',
    blurb: 'Breite Reifen mit feinem Profil, ausgestellter Lenker und Gepäck für mehrere Tage: Rahmentasche, Oberrohrtasche, große Satteltasche und Lenkerrolle.',
    specs: [['Rahmen', 'Stahl, pulverbeschichtet'], ['Laufräder', '32 Speichen · 45 mm Reifen'], ['Gruppe', '1 × 12 mechanisch'], ['Gewicht', '13,4 kg mit Gepäck']],
    frame: 'gravel', wheels: 'box32', brakes: 'disc', bar: 'flare', saddle: 'race', pedals: 'clipless', tires: 'tan', tire: { w: 0.021, knobs: 0.0014 }, drive: 'single', bags: true, head: 'helmet',
    paint: { base: '#6f8564', decal: '#f1ede3', metal: 'black', finish: 'satin' }, wordmark: 'FERNWEH', tape: '#5a4632',
    unlock: { kind: 'km', n: 85 },

  },
  {
    id: 'titan', name: 'Titan Ti-1', era: 'Titanrahmen · zeitlos',
    blurb: 'Gebürstetes Titan, schwarze Carbongabel, schlichte Schrift – das Rad für die Ewigkeit.',
    specs: [['Rahmen', 'Titan, gebürstet'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 mechanisch'], ['Gewicht', '7,6 kg']],
    frame: 'ti', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'tan', head: 'helmet',
    paint: { base: '#a7acb2', decal: '#16171a', metal: 'black', finish: 'brushed' }, wordmark: 'TITAN', tape: '#16171a',
    unlock: { kind: 'km', n: 115 },

  },
  {
    id: 'bahn', name: 'Bahnrakete', era: 'Bahnrad · heute',
    blurb: 'Starrer Gang, keine Bremsen, Vierspeichen-Laufräder und ein tiefer Bahnlenker – gemacht für die Holzbahn und die Jagd nach Hundertsteln. Dazu der Zeitfahrhelm.',
    specs: [['Rahmen', 'Carbon, Bahngeometrie'], ['Laufräder', 'Vierspeiche vorn und hinten'], ['Gruppe', 'Starrer Gang 58 × 15'], ['Gewicht', '7,9 kg']],
    frame: 'track', wheels: 'spoke4', brakes: 'none', bar: 'track', saddle: 'race', pedals: 'clipless', tires: 'black', drive: 'fixed', head: 'aero',
    paint: { base: '#3b1fd6', second: '#ff2d95', fade: 'z', decal: '#ffffff', metal: 'black' }, wordmark: 'BAHNRAKETE', tape: '#16171a',
    unlock: { kind: 'km', n: 150 },

  },
  {
    id: 'zeit', name: "Zeitmaschine '89", era: 'Zeitfahrrad · späte 1980er',
    blurb: 'Kleines Vorderrad, abfallendes Oberrohr, Scheibe hinten, Dreispeichenrad vorn und Auflieger – dazu der lange Zeitfahrhelm.',
    specs: [['Rahmen', 'Aluminium, Low Profile'], ['Laufräder', 'Scheibe · Dreispeiche'], ['Gruppe', '1 × 7'], ['Gewicht', '9,1 kg']],
    frame: 'tt', wheels: 'tt', brakes: 'rim', bar: 'tt', saddle: 'tt', pedals: 'clipless', tires: 'black', head: 'aero',
    paint: { base: '#f4f4f1', second: '#19c6d6', fade: 'z', panel: '#ff3d8b', decal: '#16171a', metal: 'black' }, wordmark: 'ZEITMASCHINE', tape: '#16171a',
    unlock: { kind: 'km', n: 190 },

  },
  {
    id: 'regenbogen', name: 'Regenbogen', era: 'Weltmeister-Rad · heute',
    blurb: 'Schneeweiß mit den Regenbogenstreifen der Weltmeister auf Oberrohr und Sitzrohr, schwarze Hochprofilfelgen, dazu ein weißer Helm – das Rad, das jeder fahren will.',
    specs: [['Rahmen', 'Carbon'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '6,9 kg']],
    frame: 'modern', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#f6f6f3',
    paint: { base: '#f6f6f3', decal: '#16171a', metal: 'black', stripes: ['#1f5fd8', '#e2231a', '#111111', '#ffd200', '#1ea34a'] }, wordmark: 'REGENBOGEN', tape: '#f6f6f3',
    unlock: { kind: 'km', n: 240 },

  },
  {
    id: 'legende', name: 'Goldene Legende', era: 'Sonderedition',
    blurb: 'Das Rad der Champions: Aero-Rahmen in Goldchrom, schwarze Hochprofilfelgen mit Goldschrift, goldener Helm.',
    specs: [['Rahmen', 'Carbon, Goldchrom'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,0 kg']],
    frame: 'aero', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#d4ad3c',
    paint: { base: '#c99a2e', second: '#f3d77a', fade: 'y', decal: '#16171a', metal: 'gold', finish: 'chrome' }, wordmark: 'LEGENDE', tape: '#16171a',
    unlock: { kind: 'km', n: 300 },

  },
];

export const bikeById = (id: string | null | undefined): BikeSpec => BIKES.find((b) => b.id === id) ?? BIKES[0];

// ---------------------------------------------------------------- Fortschritt

export interface BikeStats {
  runs: number;
  /** gefahrene Meter über alle Spiele */
  meters: number;
}

/** eigene Werte aus den Bestenlisten der Spiele (seit Eröffnung der Garage) */
export function bikeStats(boards: Partial<Record<GameId, GameBest[] | undefined>>, meId: string): BikeStats {
  const s: BikeStats = { runs: 0, meters: 0 };
  for (const g of ['abfahrt', 'sprint', 'berg'] as GameId[]) {
    const me = boards[g]?.find((b) => b.user_id === meId);
    if (!me) continue;
    s.runs += me.runs;
    s.meters += me.total_m;
  }
  return s;
}

export interface Progress {
  done: boolean;
  value: number;
  target: number;
  label: string;
  text: string;
  /** wartet noch auf das Rad davor (dessen Name) */
  after?: string;
}

const nf = (n: number) => Math.floor(n).toLocaleString('de-DE');

function single(u: Unlock, s: BikeStats): Progress {
  switch (u.kind) {
    case 'free': return { done: true, value: 1, target: 1, label: 'Startrad', text: 'Von Anfang an dabei' };
    case 'runs': {
      const v = Math.min(s.runs, u.n);
      return { done: s.runs >= u.n, value: v, target: u.n, label: `${v} / ${u.n} Läufe`, text: `Fahre ${u.n} Läufe in den Minispielen` };
    }
    case 'km': {
      const km = Math.min(s.meters / 1000, u.n);
      return { done: s.meters / 1000 >= u.n, value: km, target: u.n, label: `${nf(km)} / ${u.n} km`, text: `Sammle ${u.n} km in allen Minispielen` };
    }
  }
}

/** Fortschritt aller Räder – der Reihe nach: ein Rad zählt erst, wenn das davor freigeschaltet ist */
export function bikeProgress(s: BikeStats): Record<string, Progress> {
  const out: Record<string, Progress> = {};
  let prev: BikeSpec | null = null;
  let open = true;
  for (const b of BIKES) {
    const p = single(b.unlock, s);
    if (!open && prev) out[b.id] = { ...p, done: false, after: prev.name };
    else out[b.id] = p;
    open = open && out[b.id].done;
    prev = b;
  }
  return out;
}

/** das nächste Rad, das man sich erfahren kann (oder null, wenn alle frei sind) */
export function nextBike(progress: Record<string, Progress>): BikeSpec | null {
  return BIKES.find((b) => !progress[b.id]?.done) ?? null;
}

// ---------------------------------------------------------------- Auswahl (auf dem Gerät)

const LS_BIKE = 'gruppetto.bike';
const LS_SEEN = 'gruppetto.bikes.seen2';

export function selectedBike(): string {
  try { return localStorage.getItem(LS_BIKE) ?? 'allround'; } catch { return 'allround'; }
}

export function selectBike(id: string) {
  try { localStorage.setItem(LS_BIKE, id); } catch { /* egal */ }
}

/** schon in der Garage gesehene freigeschaltete Räder (für „Neu“) */
export function seenBikes(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) ?? '["allround"]') as string[]); } catch { return new Set(['allround']); }
}

export function markBikesSeen(ids: string[]) {
  try { localStorage.setItem(LS_SEEN, JSON.stringify([...new Set([...seenBikes(), ...ids])])); } catch { /* egal */ }
}
