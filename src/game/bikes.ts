/**
 * Räder zum Freischalten: acht erfundene Modelle, gestaltet nach den großen Epochen des Rennrads
 * (keine echten Marken). Rein optisch – an der Fahrphysik ändert sich nichts, die Bestenlisten bleiben fair.
 * Freigeschaltet wird über die eigenen Ergebnisse in den Bestenlisten (gilt so auf jedem Gerät).
 */
import type { GameBest, GameId } from '../data/source';

export type FrameKind = 'modern' | 'steel' | 'alu' | 'climb' | 'aero' | 'ti' | 'tt';
export type WheelKind = 'carbon45' | 'box36' | 'box32' | 'carbon30' | 'deep60' | 'tt';

export interface BikeSpec {
  id: string;
  name: string;
  /** Epoche / Gattung */
  era: string;
  blurb: string;
  specs: [string, string][];
  frame: FrameKind;
  wheels: WheelKind;
  brakes: 'rim' | 'disc';
  bar: 'modern' | 'classic' | 'integrated' | 'tt';
  saddle: 'race' | 'leather' | 'tt';
  pedals: 'clipless' | 'toeclip';
  tires: 'black' | 'tan';
  /** Kopfbedeckung des Fahrers auf diesem Rad */
  head: 'helmet' | 'aero' | 'cap';
  /** Lackierung: Grundfarbe, Zweitfarbe (Verlauf/Paneel), Schriftzug, Metallteile ('silver' | 'black' | 'gold'), Oberfläche */
  paint: { base: string; second?: string; fade?: 'z' | 'y'; panel?: string; decal: string; metal: 'silver' | 'black' | 'gold'; finish?: 'gloss' | 'satin' | 'brushed' | 'chrome' };
  /** Schriftzug auf dem Unterrohr (erfunden) */
  wordmark: string;
  /** Lenkerband */
  tape: string;
  unlock: Unlock;
}

export type Unlock =
  | { kind: 'free' }
  | { kind: 'runs'; n: number }
  | { kind: 'km'; n: number }
  | { kind: 'score'; game: Extract<GameId, 'sprint' | 'berg'>; n: number }
  | { kind: 'meters'; n: number }
  | { kind: 'win' }
  | { kind: 'all' };

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
    unlock: { kind: 'km', n: 25 },
  },
  {
    id: 'feder', name: 'Federgewicht', era: 'Kletterrad · heute',
    blurb: 'Zarte Carbonrohre, flache 30-mm-Felgen, Sichtcarbon mit Goldschrift – jedes Gramm zählt, wenn es steil wird.',
    specs: [['Rahmen', 'Carbon, unlackiert'], ['Laufräder', '30 mm Carbon'], ['Gruppe', '2 × 12 mechanisch'], ['Gewicht', '6,1 kg']],
    frame: 'climb', wheels: 'carbon30', brakes: 'rim', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'tan', head: 'helmet',
    paint: { base: '#232428', decal: '#d6b25e', metal: 'gold', finish: 'satin' }, wordmark: 'FEDERGEWICHT', tape: '#232428',
    unlock: { kind: 'score', game: 'berg', n: 800 },
  },
  {
    id: 'aero', name: 'Aero Pfeil', era: 'Aero-Maschine · heute',
    blurb: 'Tropfenförmige Rohre, tief angesetzte Sitzstreben, integriertes Cockpit und 60-mm-Felgen. Lack mit Farbwechsel.',
    specs: [['Rahmen', 'Carbon, Aero-Profile'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,4 kg']],
    frame: 'aero', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet',
    paint: { base: '#0e1f3d', second: '#19c3b3', fade: 'y', decal: '#e9eef5', metal: 'black' }, wordmark: 'AERO PFEIL', tape: '#101114',
    unlock: { kind: 'score', game: 'sprint', n: 800 },
  },
  {
    id: 'titan', name: 'Titan Ti-1', era: 'Titanrahmen · zeitlos',
    blurb: 'Gebürstetes Titan, schwarze Carbongabel, schlichte Schrift – das Rad für die Ewigkeit.',
    specs: [['Rahmen', 'Titan, gebürstet'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 mechanisch'], ['Gewicht', '7,6 kg']],
    frame: 'ti', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'tan', head: 'helmet',
    paint: { base: '#a7acb2', decal: '#16171a', metal: 'black', finish: 'brushed' }, wordmark: 'TITAN', tape: '#16171a',
    unlock: { kind: 'meters', n: 5000 },
  },
  {
    id: 'zeit', name: "Zeitmaschine '89", era: 'Zeitfahrrad · späte 1980er',
    blurb: 'Kleines Vorderrad, abfallendes Oberrohr, Scheibe hinten, Dreispeichenrad vorn und Auflieger – dazu der lange Zeitfahrhelm.',
    specs: [['Rahmen', 'Aluminium, Low Profile'], ['Laufräder', 'Scheibe · Dreispeiche'], ['Gruppe', '1 × 7'], ['Gewicht', '9,1 kg']],
    frame: 'tt', wheels: 'tt', brakes: 'rim', bar: 'tt', saddle: 'tt', pedals: 'clipless', tires: 'black', head: 'aero',
    paint: { base: '#f4f4f1', second: '#19c6d6', fade: 'z', panel: '#ff3d8b', decal: '#16171a', metal: 'black' }, wordmark: 'ZEITMASCHINE', tape: '#16171a',
    unlock: { kind: 'win' },
  },
  {
    id: 'legende', name: 'Goldene Legende', era: 'Sonderedition',
    blurb: 'Das Rad der Champions: Aero-Rahmen in Goldchrom, schwarze Hochprofilfelgen mit Goldschrift, goldener Helm.',
    specs: [['Rahmen', 'Carbon, Goldchrom'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,0 kg']],
    frame: 'aero', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet',
    paint: { base: '#c99a2e', second: '#f3d77a', fade: 'y', decal: '#16171a', metal: 'gold', finish: 'chrome' }, wordmark: 'LEGENDE', tape: '#16171a',
    unlock: { kind: 'all' },
  },
];

export const bikeById = (id: string | null | undefined): BikeSpec => BIKES.find((b) => b.id === id) ?? BIKES[0];

// ---------------------------------------------------------------- Fortschritt

export interface BikeStats {
  runs: number;
  /** gefahrene Meter über alle Spiele */
  meters: number;
  best: Record<GameId, number>;
  /** längste Abfahrt */
  bestM: number;
}

/** eigene Werte aus den Saison-Bestenlisten der Spiele */
export function bikeStats(boards: Partial<Record<GameId, GameBest[] | undefined>>, meId: string): BikeStats {
  const s: BikeStats = { runs: 0, meters: 0, best: { abfahrt: 0, sprint: 0, berg: 0 }, bestM: 0 };
  for (const g of ['abfahrt', 'sprint', 'berg'] as GameId[]) {
    const me = boards[g]?.find((b) => b.user_id === meId);
    if (!me) continue;
    s.runs += me.runs;
    s.meters += me.total_m;
    s.best[g] = me.best;
    if (g === 'abfahrt') s.bestM = me.best_m;
  }
  return s;
}

export interface Progress { done: boolean; value: number; target: number; label: string; text: string }

const nf = (n: number) => Math.round(n).toLocaleString('de-DE');

function single(u: Unlock, s: BikeStats): Progress {
  switch (u.kind) {
    case 'free': return { done: true, value: 1, target: 1, label: 'Startrad', text: 'Von Anfang an dabei' };
    case 'runs': return { done: s.runs >= u.n, value: Math.min(s.runs, u.n), target: u.n, label: `${Math.min(s.runs, u.n)} / ${u.n} Rennen`, text: `Fahre ${u.n} Rennen in den Minispielen` };
    case 'km': {
      const km = s.meters / 1000;
      return { done: km >= u.n, value: Math.min(km, u.n), target: u.n, label: `${nf(Math.min(km, u.n))} / ${u.n} km`, text: `Sammle ${u.n} km in allen Minispielen` };
    }
    case 'score': {
      const v = s.best[u.game];
      const game = u.game === 'berg' ? 'Bergfinale' : 'Sprintfinale';
      return { done: v >= u.n, value: Math.min(v, u.n), target: u.n, label: `${nf(Math.min(v, u.n))} / ${nf(u.n)} Punkte`, text: `Hol ${nf(u.n)} Punkte im ${game}` };
    }
    case 'meters': {
      const v = s.bestM;
      return { done: v >= u.n, value: Math.min(v, u.n), target: u.n, label: `${(Math.min(v, u.n) / 1000).toFixed(1).replace('.', ',')} / ${u.n / 1000} km`, text: `Fahr ${u.n / 1000} km weit in einer Abfahrt` };
    }
    case 'win': {
      const v = Math.max(s.best.sprint, s.best.berg);
      return { done: v >= 1000, value: Math.min(v, 1000), target: 1000, label: `${nf(Math.min(v, 1000))} / 1.000 Punkte`, text: 'Hol 1.000 Punkte in einem Finale (Sprint oder Berg)' };
    }
    case 'all': return { done: false, value: 0, target: 1, label: '', text: '' };
  }
}

/** Fortschritt aller Räder (die Legende braucht alle anderen) */
export function bikeProgress(s: BikeStats): Record<string, Progress> {
  const out: Record<string, Progress> = {};
  for (const b of BIKES) if (b.unlock.kind !== 'all') out[b.id] = single(b.unlock, s);
  const others = BIKES.filter((b) => b.unlock.kind !== 'all');
  const n = others.filter((b) => out[b.id].done).length;
  for (const b of BIKES) {
    if (b.unlock.kind === 'all') out[b.id] = { done: n === others.length, value: n, target: others.length, label: `${n} / ${others.length} Räder`, text: 'Schalte alle anderen Räder frei' };
  }
  return out;
}

// ---------------------------------------------------------------- Auswahl (auf dem Gerät)

const LS_BIKE = 'gruppetto.bike';
const LS_SEEN = 'gruppetto.bikes.seen';

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
