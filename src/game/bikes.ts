/**
 * Räder zum Freischalten: erfundene Modelle, gestaltet nach den großen Epochen und Gattungen des Rennrads vom
 * Hochrad bis zur Aero-Maschine – dazu Kult- und Alltagsräder (Postrad, Bonanzarad, Lowrider, Bambusrad), Spaßräder
 * (Lastenrad mit Hund, Rad mit Alu-Wohnwagen) und nach der Legende eine zweite Runde Traumräder (Stealth-Aero,
 * Celeste-Stahl, Schillerlack, Fixie, E-Rennrad …). Keine echten Marken.
 * Rein optisch – an der Fahrphysik ändert sich nichts, die Bestenlisten bleiben fair.
 *
 * Freigeschaltet wird der Reihe nach: Am Anfang hat man nur das Teamrad, jedes weitere Rad hat eine Aufgabe,
 * die erst zählt, wenn das Rad davor freigeschaltet ist. Gezählt werden die eigenen Läufe aller Minispiele
 * (auch die Fahrten im Zeitfahren) seit Eröffnung der Garage (gilt so auf jedem Gerät).
 */
import type { GameBest, GameId } from '../data/source';

export type FrameKind = 'modern' | 'steel' | 'alu' | 'climb' | 'aero' | 'ti' | 'tt' | 'cross' | 'gravel' | 'track' | 'cargo'
  | 'post' | 'bamboo' | 'bonanza' | 'lowrider' | 'ordinary'
  /** Fixie (Stahl, WIG-geschweißt, Bahn-Ausfallenden), E-Rennrad (dickes Unterrohr mit Akku, Mittelmotor) */
  | 'fixie' | 'ebike'
  /** Triathlon (Aero, tiefe Front, Box auf dem Oberrohr, Flaschen hinter dem Sattel), Carbon-Gravel */
  | 'tri' | 'gravelc'
  /** Hollandrad mit Damenrahmen (geschwungenes Rohr statt Oberrohr), Faltrad mit 16-Zoll-Rädern */
  | 'dutch' | 'fold'
  /** Fatbike (breiter Hinterbau und Naben), Holzrahmen (Maserung), Monocoque-Flügel der 90er (ohne Sitzrohr, Einarmgabel) */
  | 'fat' | 'wood' | 'wing';
/** deep80: 80-mm-Carbonfelgen; deepv: 40-mm-Alu-Hochprofil (Deep-V), Farbe aus rim */
export type WheelKind = 'carbon45' | 'box36' | 'box32' | 'carbon30' | 'deep60' | 'deep80' | 'deepv' | 'tt' | 'spoke4' | 'spoke144' | 'ordinary'
  /** tri: 80 mm vorn, Scheibe hinten; disc2: Scheibe vorn und hinten; cspoke: Carbonfelge mit breiten Carbonspeichen */
  | 'tri' | 'disc2' | 'cspoke';

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
  /** Lenker; Hochlenker (ape), Lenkrad (wheel), Schnurrbartlenker des Hochrads (moustache) */
  bar: 'modern' | 'classic' | 'integrated' | 'tt' | 'track' | 'flare' | 'city' | 'ape' | 'wheel' | 'moustache' | 'bullhorn' | 'flat';
  /** Sattel; Federsattel mit Spiralfedern (spring), langer Bananensattel (banana) */
  saddle: 'race' | 'leather' | 'tt' | 'spring' | 'banana';
  /** Pedale; Gummiklotzpedale (block) */
  pedals: 'clipless' | 'toeclip' | 'block';
  tires: 'black' | 'tan';
  /** Reifen: halbe Breite (m), Stollen, Reflexstreifen an der Flanke, Weißwand, farbiger Gummi */
  tire?: { w?: number; knobs?: number; reflex?: boolean; white?: boolean; col?: string; studs?: boolean };
  /** Felgen in Farbe (Deep-V, lackiert); Speichen dann schwarz */
  rim?: string;
  /** Schriftzug auf den Felgen (sonst hell, bei Goldteilen golden) */
  rimDecal?: string;
  /** Trinkflaschen in eigener Farbe (sonst weiß bzw. Alu) */
  bottle?: string;
  /** Laufräder kleiner als 28 Zoll: Außenradius vorn und hinten (m) */
  size?: { f: number; r: number };
  /** Antrieb: zwei Kettenblätter (Standard), eins mit Schaltung, starrer Gang, Nabenschaltung im Kettenkasten,
   *  Nabenschaltung mit Kettenschutz (guard), Stangenschaltung der 50er (rod) */
  drive?: 'double' | 'single' | 'fixed' | 'hub' | 'guard' | 'rod';
  /** Taschen fürs Bikepacking (light: nur Oberrohrtasche und kleine Satteltasche) */
  bags?: boolean | 'light';
  /** Schutzbleche: Alu (true), in Rahmenfarbe, Chrom, Holz */
  fenders?: boolean | 'paint' | 'chrome' | 'wood';
  /** Kleinkram: Flaschen am Lenker, Ersatz-Schlauchreifen unter dem Sattel, Flügelmuttern an den Naben */
  bits?: { barBottles?: boolean; spare?: boolean; wingnuts?: boolean; noBottles?: boolean };
  /** Anhänger */
  trailer?: 'caravan';
  /** Kopfbedeckung des Fahrers auf diesem Rad, eigene Helmfarbe: Helm, Zeitfahrhelm, Stoffmütze, Mütze mit
   *  Rennbrille, Melone (mit Schnurrbart), Dienstmütze, Stirnband, Bandana mit Sonnenbrille */
  head: 'helmet' | 'aero' | 'cap' | 'capgoggles' | 'bowler' | 'peaked' | 'band' | 'bandana';
  helmet?: string;
  /** Lackierung: Grundfarbe, Zweitfarbe (Verlauf/Paneel), Schriftzug, Metallteile ('silver' | 'black' | 'gold'), Oberfläche */
  paint: {
    base: string; second?: string; fade?: 'z' | 'y'; panel?: string; decal: string; metal: 'silver' | 'black' | 'gold'; finish?: 'gloss' | 'satin' | 'brushed' | 'chrome' | 'candy';
    /** Streifen um Ober- und Sitzrohr (von oben nach unten) */
    stripes?: string[];
    /** Schlamm unten am Rahmen */
    mud?: boolean;
    /** Verlauf über mehrere Farben (statt base → second), längs von vorn nach hinten oder senkrecht (fade) */
    stops?: string[];
    /** Hinterbau und Gabel verchromt (italienische Stahlrenner der 80er) */
    chromeRear?: boolean;
    /** Schnee auf Rahmen und Reifen (Flocken statt Schlamm) */
    snow?: boolean;
    /** jedes Rohr in eigener Farbe (sonst Grundfarbe) */
    tubes?: { tt?: string; dt?: string; st?: string; ht?: string; stays?: string; fork?: string };
    /** Schweißnähte als kräftige Linien in dieser Farbe */
    joints?: string;
    /** Muffen in eigener Farbe (sonst verchromt) */
    lugs?: string;
    /** Holzmaserung: helle und dunkle Jahresringe (statt Grundfarbe) */
    wood?: [string, string];
    /** Punkte auf den Rohren (Bergpreis) in dieser Farbe */
    dots?: string;
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
    id: 'lastesel', name: 'Lastesel', era: 'Lastenrad · Stadtverkehr',
    blurb: 'Vorn die Holzkiste, darin Bello – mit Rennmütze, fliegenden Ohren und heraushängender Zunge. Das kleine Vorderrad lenkt über eine Stange unter der Kiste, die Nabenschaltung sitzt im Kettenkasten. Dazu Klingel, Ständer, Wimpel und ein Baguette.',
    specs: [['Rahmen', 'Stahl, Long John'], ['Laufräder', '26" hinten · 20" vorn'], ['Gruppe', '8-Gang-Nabe, Rollenbremsen'], ['Gewicht', '41 kg plus Bello']],
    frame: 'cargo', wheels: 'box36', brakes: 'none', bar: 'city', saddle: 'leather', pedals: 'toeclip', tires: 'black', tire: { w: 0.019, reflex: true }, drive: 'hub', fenders: true, head: 'helmet',
    paint: { base: '#2f8f83', decal: '#2b2118', metal: 'silver', finish: 'satin' }, wordmark: 'LASTESEL', tape: '#7a5234',
    unlock: { kind: 'runs', n: 2 },
  },
  {
    id: 'acciaio', name: "Acciaio '74", era: 'Stahlrenner · 1970er',
    blurb: 'Dünne Stahlrohre, verchromte Muffen, Rahmenschalthebel, Kastenfelgen mit Schlauchreifen und Ledersattel. Dazu die Stoffmütze.',
    specs: [['Rahmen', 'Stahl, gemufft'], ['Laufräder', 'Kastenfelge · 36 Speichen'], ['Gruppe', '2 × 6, Rahmenschalter'], ['Gewicht', '9,8 kg']],
    frame: 'steel', wheels: 'box36', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'toeclip', tires: 'tan', head: 'cap',
    paint: { base: '#6e1423', panel: '#efe4c8', decal: '#d9b25a', metal: 'silver' }, wordmark: 'Acciaio', tape: '#f1ede3',
    unlock: { kind: 'runs', n: 4 },
  },
  {
    id: 'pave', name: "Pavé '93", era: 'Alu-Klassiker · 1990er',
    blurb: 'Dicke Aluminiumrohre im Neon-Verlauf, breitere Reifen und doppelt gewickeltes Lenkerband – gebaut für Kopfsteinpflaster.',
    specs: [['Rahmen', 'Aluminium, oversized'], ['Laufräder', '32 Speichen · 28 mm'], ['Gruppe', '2 × 8, Brems-Schalthebel'], ['Gewicht', '8,9 kg']],
    frame: 'alu', wheels: 'box32', brakes: 'rim', bar: 'classic', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet',
    paint: { base: '#d9ff2a', second: '#ff2d95', fade: 'z', decal: '#16171a', metal: 'silver' }, wordmark: 'PAVÉ', tape: '#16171a',
    unlock: { kind: 'runs', n: 7 },
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
    id: 'bonanza', name: "Hochlenker '72", era: 'Bonanzarad · 1970er',
    blurb: 'Das Kultrad der Siebziger: Hochlenker mit Querstrebe und Quasten, Bananensattel mit Silberstreifen, Rückenlehne mit Fuchsschwanz, Schaltknüppel auf dem Oberrohr und Federgabel mit Faltenbälgen. Vorn 16, hinten 20 Zoll, Candy-Lack und viel Chrom – dazu das Stirnband.',
    specs: [['Rahmen', 'Stahl, geschwungen'], ['Laufräder', '16" vorn · 20" hinten'], ['Gruppe', '3-Gang-Nabe, Schaltknüppel'], ['Gewicht', '18 kg']],
    frame: 'bonanza', wheels: 'box36', brakes: 'none', bar: 'ape', saddle: 'banana', pedals: 'block', tires: 'black', tire: { w: 0.022 }, drive: 'guard', fenders: 'chrome', head: 'band',
    paint: { base: '#d9481a', second: '#f39a1e', fade: 'y', decal: '#141414', metal: 'silver', finish: 'candy' }, wordmark: 'PRÄRIE 3', tape: '#f3f1ea',
    unlock: { kind: 'runs', n: 14 },
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
    id: 'landpost', name: "Landpost '62", era: 'Postrad · 1960er',
    blurb: 'Gelber Muffenrahmen, vorn ein großer Träger mit der Ledertasche voller Briefe und der Zeitung obendrauf, hinten Packtaschen und ein verschnürtes Päckchen. Dazu Kettenkasten, Seitenläufer-Dynamo mit Scheinwerfer, Federsattel, Klingel, Doppelständer – und die Dienstmütze. Bei Wind und Wetter pünktlich.',
    specs: [['Rahmen', 'Stahl, gemufft'], ['Laufräder', '28" · 36 Speichen · Ballon'], ['Gruppe', '3-Gang-Nabe, Rücktritt'], ['Zuladung', '25 kg Post']],
    frame: 'post', wheels: 'box36', brakes: 'rim', bar: 'city', saddle: 'spring', pedals: 'block', tires: 'black', tire: { w: 0.019, reflex: true }, drive: 'hub', fenders: 'paint', head: 'peaked',
    paint: { base: '#f2b705', decal: '#1b1b1b', metal: 'silver' }, wordmark: 'Landpost', tape: '#6b4a2e',
    unlock: { kind: 'km', n: 50 },
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
    id: 'gregario', name: "Gregario '53", era: 'Rennrad · 1950er',
    blurb: 'So fuhr man die Tour in den Fünfzigern: zwei Alu-Flaschen mit Korken vorn am Lenker, der Ersatz-Schlauchreifen als Acht unter dem Sattel, Flügelmuttern statt Schnellspanner und eine Stangenschaltung an der Sitzstrebe. Cremeweißer Muffenrahmen mit roten Feldern – dazu Stoffmütze und Rennbrille.',
    specs: [['Rahmen', 'Stahl, gemufft'], ['Laufräder', 'Schlauchreifen · 36 Speichen'], ['Gruppe', '1 × 4, Stangenschaltung'], ['Gewicht', '10,6 kg']],
    frame: 'steel', wheels: 'box36', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'toeclip', tires: 'tan', drive: 'rod', head: 'capgoggles', bits: { barBottles: true, spare: true, wingnuts: true },
    paint: { base: '#ebe3cd', panel: '#b3262d', decal: '#b3262d', metal: 'silver' }, wordmark: 'Gregario', tape: '#c9a77a',
    unlock: { kind: 'km', n: 72 },
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
    id: 'bambus', name: 'Halm & Hanf', era: 'Bambusrahmen · Handarbeit',
    blurb: 'Rahmen aus geflammtem Bambus mit Knoten, die Verbindungen in Hanf gewickelt und mit Harz getränkt, Ausfallenden aus Stahl. Dazu Holzschutzbleche aus verleimten Lagen, Korkband am Lenker und ein Ledersattel – jedes Rad ein Unikat.',
    specs: [['Rahmen', 'Bambus, Hanfwicklung'], ['Laufräder', '32 Speichen · 38 mm'], ['Gruppe', '1 × 11 mechanisch'], ['Gewicht', '9,8 kg']],
    frame: 'bamboo', wheels: 'box32', brakes: 'disc', bar: 'flare', saddle: 'leather', pedals: 'clipless', tires: 'tan', tire: { w: 0.0175 }, drive: 'single', fenders: 'wood', head: 'helmet',
    paint: { base: '#c99a52', decal: '#3d2412', metal: 'black', finish: 'satin' }, wordmark: 'HALM & HANF', tape: '#b58b5a',
    unlock: { kind: 'km', n: 100 },
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
    unlock: { kind: 'km', n: 185 },
  },
  {
    id: 'lowrider', name: "Lowrider '79", era: 'Lowrider · Westküste',
    blurb: 'Tief, lang und voller Chrom: Springergabel mit Federn, gedrehte Streben, ein Lenkrad aus Kettengliedern, 144 Speichen je Rad, Weißwandreifen, Samtsattel mit Knöpfen, runde Spiegel und das Ersatzrad hinter der Lehne. Candy-Lack in Violett – und das Bandana.',
    specs: [['Rahmen', 'Stahl, Candy-Lack'], ['Laufräder', '20" · 144 Speichen · Weißwand'], ['Gabel', 'Springer mit zwei Federn'], ['Gewicht', '27 kg Chrom']],
    frame: 'lowrider', wheels: 'spoke144', brakes: 'none', bar: 'wheel', saddle: 'banana', pedals: 'block', tires: 'black', tire: { w: 0.021, white: true }, drive: 'guard', fenders: 'chrome', head: 'bandana',
    paint: { base: '#4a1477', second: '#c22f8f', fade: 'z', decal: '#141414', metal: 'silver', finish: 'candy' }, wordmark: 'Tiefgang', tape: '#7a0f1e',
    unlock: { kind: 'km', n: 205 },
  },
  {
    id: 'regenbogen', name: 'Regenbogen', era: 'Weltmeister-Rad · heute',
    blurb: 'Schneeweiß mit den Regenbogenstreifen der Weltmeister auf Oberrohr und Sitzrohr, schwarze Hochprofilfelgen, dazu ein weißer Helm – das Rad, das jeder fahren will.',
    specs: [['Rahmen', 'Carbon'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '6,9 kg']],
    frame: 'modern', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#f6f6f3',
    paint: { base: '#f6f6f3', decal: '#16171a', metal: 'black', stripes: ['#1f5fd8', '#e2231a', '#111111', '#ffd200', '#1ea34a'] }, wordmark: 'REGENBOGEN', tape: '#f6f6f3',
    unlock: { kind: 'km', n: 225 },
  },
  {
    id: 'wohnwagen', name: 'Blechbüchse', era: 'Rad mit Wohnwagen · Eigenbau',
    blurb: 'Stahl-Reiserad mit selbst genietetem Alu-Wohnwagen in Tropfenform: Bullaugen mit karierten Gardinen, Dachluke, Ofenrohr, Gasflasche, Stützrad und Wimpel. Bergab schiebt er, bergauf zieht er – Hauptsache, abends gibt es Kaffee.',
    specs: [['Rad', 'Stahl-Reiserad, Schutzbleche'], ['Anhänger', 'Alu genietet · 1,5 m'], ['Schlafplätze', '1 (quer, mit Kissen)'], ['Gewicht', '58 kg mit Kaffeemaschine']],
    frame: 'steel', wheels: 'box36', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'toeclip', tires: 'tan', tire: { w: 0.0155 }, fenders: true, trailer: 'caravan', head: 'cap',
    paint: { base: '#78c2b0', panel: '#f1e7cf', decal: '#1f4a43', metal: 'silver' }, wordmark: 'Blechbüchse', tape: '#f1ede3',
    unlock: { kind: 'km', n: 260 },
  },
  {
    id: 'hochrad', name: 'Hochrad 1884', era: 'Hochrad · 1880er',
    blurb: 'Vorn 49 Zoll mit 64 Speichen, hinten ein kleines Stützrad: Die Pedale sitzen direkt an der Vorderradnabe, gelenkt wird mit dem Schnurrbartlenker, gebremst mit dem Löffel auf dem Vollgummireifen. Ledersattel auf der Blattfeder, Aufstiegstritt, Nabenlaterne und Glocke aus Messing – schwarz emailliert mit Goldlinien. Melone und Schnurrbart gehören dazu.',
    specs: [['Rahmen', 'Stahlrohr, emailliert'], ['Laufräder', '49" vorn · 17" hinten'], ['Antrieb', 'Pedale an der Nabe, ohne Kette'], ['Gewicht', '19 kg']],
    frame: 'ordinary', wheels: 'ordinary', brakes: 'none', bar: 'moustache', saddle: 'leather', pedals: 'block', tires: 'black', head: 'bowler',
    paint: { base: '#151515', decal: '#d6ae4f', metal: 'silver' }, wordmark: 'HOCHRAD', tape: '#5c2e1b',
    unlock: { kind: 'km', n: 280 },
  },
  {
    id: 'legende', name: 'Goldene Legende', era: 'Sonderedition',
    blurb: 'Das Rad der Champions: Aero-Rahmen in Goldchrom, schwarze Hochprofilfelgen mit Goldschrift, goldener Helm.',
    specs: [['Rahmen', 'Carbon, Goldchrom'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,0 kg']],
    frame: 'aero', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#d4ad3c',
    paint: { base: '#c99a2e', second: '#f3d77a', fade: 'y', decal: '#16171a', metal: 'gold', finish: 'chrome' }, wordmark: 'LEGENDE', tape: '#16171a',
    unlock: { kind: 'km', n: 300 },
  },
  // ---- zweite Runde: Traumräder und mehr Vielfalt (alle 50 km eins, ab 340 km)
  {
    id: 'nachtfalke', name: 'Nachtfalke', era: 'Aero-Maschine · Stealth',
    blurb: 'Alles schwarz: matter Aero-Rahmen mit tief angesetzten Sitzstreben, glänzend schwarze Schrift, die man nur im Licht sieht, 80-mm-Felgen und ein integriertes Cockpit. Sieht im Stand schon schnell aus.',
    specs: [['Rahmen', 'Carbon, Aero, mattschwarz'], ['Laufräder', '80 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,3 kg']],
    frame: 'aero', wheels: 'deep80', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#1c1d20',
    paint: { base: '#1b1c1f', decal: '#3c3f46', metal: 'black', finish: 'satin' }, rimDecal: '#34363c', bottle: '#1e1f23', wordmark: 'NACHTFALKE', tape: '#101114',
    unlock: { kind: 'km', n: 340 },
  },
  {
    id: 'celeste', name: "Celeste '86", era: 'Italienischer Stahl · 1980er',
    blurb: 'Himmelblau-grüner Muffenrahmen mit verchromter Gabel und verchromtem Hinterbau, Rahmenschalthebel, Schlauchreifen mit hellen Flanken, weißes Lenkerband und Ledersattel – das Rad, von dem man als Kind geträumt hat.',
    specs: [['Rahmen', 'Stahl, gemufft, Chromhinterbau'], ['Laufräder', 'Kastenfelge · 36 Speichen'], ['Gruppe', '2 × 6, Rahmenschalter'], ['Gewicht', '9,4 kg']],
    frame: 'steel', wheels: 'box36', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'toeclip', tires: 'tan', head: 'cap',
    paint: { base: '#7ccfbd', panel: '#f3efe4', decal: '#1c2a2a', metal: 'silver', chromeRear: true }, wordmark: 'Celeste', tape: '#f4f2ea',
    unlock: { kind: 'km', n: 390 },
  },
  {
    id: 'schiller', name: 'Ölfilm', era: 'Allround-Carbon · Schillerlack',
    blurb: 'Der Lack schillert wie ein Ölfilm auf der Straße: von Violett über Petrol und Grün bis Gold, dazu goldene Kettenblätter, Naben und Felgenschrift. Unter dem Lack ein leichter Allround-Rahmen mit Scheibenbremsen.',
    specs: [['Rahmen', 'Carbon, Schillerlack'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 elektronisch, Gold'], ['Gewicht', '7,1 kg']],
    frame: 'modern', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#2b1d4a',
    paint: { base: '#4b1f8f', stops: ['#4b1f8f', '#1c5d9a', '#13917c', '#79b43a', '#d9a62e'], fade: 'z', decal: '#f3e7c2', metal: 'gold', finish: 'candy' }, wordmark: 'ÖLFILM', tape: '#1a1426',
    unlock: { kind: 'km', n: 440 },
  },
  {
    id: 'kiez', name: 'Kiezkurier', era: 'Fixie · Großstadt',
    blurb: 'Starrer Gang, keine Bremsen, Bullhorn-Lenker mit orangefarbenem Band, leuchtend orangefarbene Deep-V-Felgen mit schwarzen Speichen und Naben, Pedalhaken mit Riemen. Mattschwarzer Stahlrahmen mit Bahn-Ausfallenden – fürs Ampelrennen.',
    specs: [['Rahmen', 'Stahl, WIG-geschweißt'], ['Laufräder', 'Deep-V 40 mm · 32 Speichen'], ['Gruppe', 'Starrer Gang 46 × 16'], ['Gewicht', '8,7 kg']],
    frame: 'fixie', wheels: 'deepv', brakes: 'none', bar: 'bullhorn', saddle: 'race', pedals: 'toeclip', tires: 'black', tire: { w: 0.0125 }, rim: '#ff7a1a', rimDecal: '#16171a', drive: 'fixed', head: 'cap',
    paint: { base: '#1d1e22', decal: '#ff7a1a', metal: 'black', finish: 'satin' }, wordmark: 'KIEZKURIER', tape: '#ff7a1a',
    unlock: { kind: 'km', n: 490 },
  },
  {
    id: 'epass', name: 'E-Pass', era: 'E-Rennrad · heute',
    blurb: 'Sieht aus wie ein Rennrad, hat aber Rückenwind eingebaut: Akku im dicken Unterrohr mit Ladebuchse, Mittelmotor am Tretlager, Display am Lenker und ein Blatt vorn. Anthrazit mit giftgrünen Akzenten. (Im Spiel tritt man trotzdem selbst.)',
    specs: [['Rahmen', 'Carbon, Akku integriert'], ['Motor', 'Mittelmotor · 250 W'], ['Gruppe', '1 × 12 elektronisch'], ['Gewicht', '12,9 kg']],
    frame: 'ebike', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', drive: 'single', head: 'helmet',
    paint: { base: '#2a2e34', second: '#6b7480', fade: 'y', decal: '#c6ff3d', metal: 'black', finish: 'satin' }, rimDecal: '#c6ff3d', wordmark: 'E-PASS', tape: '#16171a',
    unlock: { kind: 'km', n: 540 },
  },
  {
    id: 'hitze', name: 'Hitzeflimmern', era: 'Triathlon · Langdistanz',
    blurb: 'Gebaut für 180 km gegen den Wind: tiefe Front, Auflieger mit Trinkflasche und Strohhalm dazwischen, Box für Riegel auf dem Oberrohr, zwei Flaschen hinter dem Sattel, vorn 80 mm, hinten die Scheibe. Weiß mit Verlauf in Neonkoralle.',
    specs: [['Rahmen', 'Carbon, Triathlon-Geometrie'], ['Laufräder', '80 mm vorn · Scheibe hinten'], ['Gruppe', '2 × 12 elektronisch'], ['Verpflegung', '3 Flaschen, 6 Riegel']],
    frame: 'tri', wheels: 'tri', brakes: 'disc', bar: 'tt', saddle: 'tt', pedals: 'clipless', tires: 'black', head: 'aero', helmet: '#f4f4f2',
    paint: { base: '#f4f4f2', second: '#ff4f5e', fade: 'z', decal: '#16171a', metal: 'black' }, wordmark: 'HITZEFLIMMERN', tape: '#16171a',
    unlock: { kind: 'km', n: 590 },
  },
  {
    id: 'schotter', name: 'Schotterkönig', era: 'Gravel-Rennmaschine · heute',
    blurb: 'Carbon-Gravel für Rennen auf Schotter: tief angesetzte Sitzstreben, 40-mm-Reifen mit feinem Profil und hellen Flanken, ausgestellter Lenker, ein Blatt vorn, Oberrohrtasche und kleine Satteltasche. Sandfarben mit olivgrünem Verlauf und ordentlich Staub.',
    specs: [['Rahmen', 'Carbon, Gravel-Race'], ['Laufräder', '30 mm Carbon · 40 mm Reifen'], ['Gruppe', '1 × 13 mechanisch'], ['Gewicht', '8,3 kg']],
    frame: 'gravelc', wheels: 'carbon30', brakes: 'disc', bar: 'flare', saddle: 'race', pedals: 'clipless', tires: 'tan', tire: { w: 0.0185, knobs: 0.0013 }, drive: 'single', bags: 'light', head: 'helmet', helmet: '#c9b48a',
    paint: { base: '#cdb68a', second: '#5d6a43', fade: 'y', decal: '#2b2a22', metal: 'black', finish: 'satin' }, wordmark: 'SCHOTTERKÖNIG', tape: '#3f4a2e',
    unlock: { kind: 'km', n: 640 },
  },
  {
    id: 'eiszeit', name: 'Eiszeit', era: 'Winterrad · Spikes',
    blurb: 'Für Januar am Pass: Spikereifen mit Stahlstiften, Schutzbleche, breite Reifen und Schnee auf Rahmen, Streben und Flanken. Alu-Rahmen im Verlauf von Nachtblau zu Eisblau, schwarze Teile – und der weiße Helm passt zur Landschaft.',
    specs: [['Rahmen', 'Aluminium, Schutzblechösen'], ['Laufräder', '32 Speichen · Spikes 35 mm'], ['Gruppe', '2 × 11, Scheibenbremsen'], ['Spikes', '2 × 120 Stück']],
    frame: 'cross', wheels: 'box32', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', tire: { w: 0.0175, knobs: 0.0024, studs: true }, fenders: true, head: 'helmet', helmet: '#f4f6f8',
    paint: { base: '#163f86', second: '#2f86e0', fade: 'y', decal: '#f4f7fb', metal: 'black', snow: true }, wordmark: 'EISZEIT', tape: '#16171a',
    unlock: { kind: 'km', n: 690 },
  },
  {
    id: 'floh', name: 'Kletterfloh', era: 'Leichtbau · Bergzeitfahren',
    blurb: 'Fünf Kilo und ein bisschen: unlackiertes Carbon, Laufräder mit breiten Carbonspeichen, ein winziger Sattel und keine Flaschenhalter – jedes Gramm muss den Berg hinauf. Rote Akzente an Schrift, Lenkerband und Felgen.',
    specs: [['Rahmen', 'Carbon, unlackiert'], ['Laufräder', 'Carbonspeichen · 35 mm'], ['Gruppe', '2 × 12, leichteste Teile'], ['Gewicht', '5,4 kg']],
    frame: 'climb', wheels: 'cspoke', brakes: 'rim', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'tan', head: 'helmet', helmet: '#e2231a',
    paint: { base: '#26272b', decal: '#e2231a', metal: 'black', finish: 'satin', stripes: ['#e2231a'] }, rimDecal: '#e2231a', bits: { noBottles: true }, wordmark: 'KLETTERFLOH', tape: '#e2231a',
    unlock: { kind: 'km', n: 740 },
  },
  {
    id: 'stunde', name: 'Stundenrekord', era: 'Bahn · Weltrekord',
    blurb: 'Eine Stunde, so weit es geht: Bahnrahmen mit Profilrohren, vorn und hinten Scheibenräder, Auflieger, starrer Gang mit riesigem Blatt und die goldene Kette. Weiß mit rotem Verlauf – dazu der Zeitfahrhelm.',
    specs: [['Rahmen', 'Carbon, Bahngeometrie'], ['Laufräder', 'Scheibe vorn und hinten'], ['Gruppe', 'Starrer Gang 58 × 14'], ['Rekord', '55,1 km in der Stunde']],
    frame: 'track', wheels: 'disc2', brakes: 'none', bar: 'tt', saddle: 'tt', pedals: 'clipless', tires: 'black', drive: 'fixed', head: 'aero', helmet: '#f4f4f2',
    paint: { base: '#f2f2ef', second: '#c8102e', fade: 'z', panel: '#c8102e', decal: '#16171a', metal: 'black' }, wordmark: 'STUNDE', tape: '#16171a',
    unlock: { kind: 'km', n: 790 },
  },
  {
    id: 'oma', name: 'Omafiets', era: 'Hollandrad · Amsterdam',
    blurb: 'Schwarzer Damenrahmen mit geschwungenem Doppelrohr, geschlossener Kettenkasten, Rollenbremsen, Kleiderschutz aus bunten Schnüren am Hinterrad, Gepäckträger mit Spanngurt, Ringschloss und vorn der Weidenkorb voller Tulpen. Aufrecht sitzen, klingeln, ankommen.',
    specs: [['Rahmen', 'Stahl, Damenrahmen'], ['Laufräder', '28" · 36 Speichen · Ballon'], ['Gruppe', '3-Gang-Nabe, Rollenbremsen'], ['Gewicht', '23 kg plus Tulpen']],
    frame: 'dutch', wheels: 'box36', brakes: 'none', bar: 'city', saddle: 'spring', pedals: 'block', tires: 'black', tire: { w: 0.02, reflex: true }, drive: 'hub', fenders: 'paint', head: 'cap',
    paint: { base: '#141414', decal: '#d6b25e', metal: 'silver' }, wordmark: 'Omafiets', tape: '#6b4a2e',
    unlock: { kind: 'km', n: 840 },
  },
  {
    id: 'rosso', name: 'Rosso Corsa', era: 'Superbike · Italien',
    blurb: 'Rennrot mit Trikolore-Streifen auf Ober- und Sitzrohr, Aero-Rahmen, 60-mm-Felgen mit weißer Schrift und ein integriertes Cockpit – das Rad, das man vor dem Café so abstellt, dass es jeder sieht.',
    specs: [['Rahmen', 'Carbon, Aero'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '7,0 kg']],
    frame: 'aero', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#c8102e',
    paint: { base: '#b30f28', second: '#d6202a', fade: 'y', decal: '#f4f4f4', metal: 'black', stripes: ['#1e9a47', '#f4f4f4', '#d6202a'] }, rimDecal: '#f4f4f4', wordmark: 'ROSSO CORSA', tape: '#16171a',
    unlock: { kind: 'km', n: 890 },
  },
  {
    id: 'spiegel', name: 'Spiegelglanz', era: 'Chromrahmen · Rahmenbauer',
    blurb: 'Der ganze Rahmen verchromt und poliert, die Muffen schwarz abgesetzt mit feinen Goldlinien, schwarze Schrift, Kastenfelgen, schwarzes Lenkerband. Spiegelt die Landschaft – und dich.',
    specs: [['Rahmen', 'Stahl, verchromt, gemufft'], ['Laufräder', 'Kastenfelge · 32 Speichen'], ['Gruppe', '2 × 11 mechanisch'], ['Gewicht', '9,1 kg']],
    frame: 'steel', wheels: 'box32', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#16171a',
    paint: { base: '#d6dadf', decal: '#16171a', metal: 'silver', finish: 'chrome', lugs: '#16171a' }, wordmark: 'SPIEGELGLANZ', tape: '#16171a',
    unlock: { kind: 'km', n: 940 },
  },
  {
    id: 'mondrian', name: 'Komposition', era: 'Kunstrad · De Stijl',
    blurb: 'Ein Rahmen wie ein Gemälde: Oberrohr rot, Unterrohr blau, Sitzrohr gelb, alles andere weiß – und an jeder Naht eine kräftige schwarze Linie. Schwarze Felgen, schwarzes Band, weißer Helm.',
    specs: [['Rahmen', 'Aluminium, handlackiert'], ['Laufräder', '32 Speichen · schwarz'], ['Gruppe', '2 × 11 mechanisch'], ['Farben', 'Rot, Blau, Gelb, Weiß, Schwarz']],
    frame: 'alu', wheels: 'box32', brakes: 'rim', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#f4f2ea',
    paint: { base: '#f4f2ea', decal: '#111111', metal: 'black', tubes: { tt: '#d6202a', dt: '#1f4fa8', st: '#f4c20d' }, joints: '#111111' }, wordmark: 'KOMPOSITION', tape: '#111111',
    unlock: { kind: 'km', n: 990 },
  },
  {
    id: 'falt', name: 'Faltwunder', era: 'Faltrad · Stadt und Zug',
    blurb: 'Klappt in zwanzig Sekunden auf Koffergröße: Gelenk im Hauptrohr, hoher Lenkerschaft mit Scharnier, lange Sattelstütze, gefederter Hinterbau, 16-Zoll-Räder, Schutzbleche und ein Gepäckträger mit kleinen Rollen. Feuerrot, Teile in Silber.',
    specs: [['Rahmen', 'Stahl, Faltgelenk'], ['Laufräder', '16" · 28 Speichen'], ['Gruppe', '2-Gang-Nabe, Kettenschutz'], ['Gefaltet', '58 × 56 × 27 cm']],
    frame: 'fold', wheels: 'box32', brakes: 'none', bar: 'city', saddle: 'race', pedals: 'block', tires: 'black', tire: { w: 0.0155 }, drive: 'guard', fenders: 'paint', head: 'helmet', helmet: '#16171a',
    paint: { base: '#d93a22', decal: '#f4f4f2', metal: 'silver' }, wordmark: 'FALTWUNDER', tape: '#1b1c1f',
    unlock: { kind: 'km', n: 1040 },
  },
  {
    id: 'fuchs', name: 'Wüstenfuchs', era: 'Fatbike · Sand und Schnee',
    blurb: 'Reifen so breit wie eine Hand mit groben Stollen, extra breiter Hinterbau und breite Naben, flacher Lenker, Scheibenbremsen. Sandfarben mit braunen Akzenten – fährt über Strand, Düne und Neuschnee.',
    specs: [['Rahmen', 'Aluminium, 197 mm Hinterbau'], ['Laufräder', '26" · Reifen 4,6"'], ['Gruppe', '1 × 12 mechanisch'], ['Gewicht', '14,8 kg']],
    frame: 'fat', wheels: 'box32', brakes: 'disc', bar: 'flat', saddle: 'race', pedals: 'block', tires: 'black', tire: { w: 0.048, knobs: 0.0042 }, drive: 'single', head: 'helmet', helmet: '#c9a76a',
    paint: { base: '#d6b98a', second: '#a9845a', fade: 'y', decal: '#4a3220', metal: 'black', finish: 'satin' }, wordmark: 'WÜSTENFUCHS', tape: '#4a3220',
    unlock: { kind: 'km', n: 1090 },
  },
  {
    id: 'holz', name: 'Holzwurm', era: 'Holzrahmen · Tischlerei',
    blurb: 'Rahmen und Gabel aus verleimtem Nussbaum mit sichtbarer Maserung, geölt statt lackiert, dazu Holzfelgen mit silbernen Speichen, Holzschutzbleche, Korkband und Ledersattel. Riecht ein bisschen nach Werkstatt.',
    specs: [['Rahmen', 'Nussbaum, verleimt und geölt'], ['Laufräder', 'Holzfelgen · 36 Speichen'], ['Gruppe', '2 × 10 mechanisch'], ['Gewicht', '11,2 kg']],
    frame: 'wood', wheels: 'box36', brakes: 'rim', bar: 'classic', saddle: 'leather', pedals: 'toeclip', tires: 'tan', tire: { w: 0.0145 }, rim: '#a8743f', fenders: 'wood', head: 'cap',
    paint: { base: '#7a4f2c', decal: '#f1e3c4', metal: 'silver', finish: 'satin', wood: ['#b07c48', '#4e2f17'] }, wordmark: 'Holzwurm', tape: '#b58b5a',
    unlock: { kind: 'km', n: 1140 },
  },
  {
    id: 'bergkoenig', name: 'Bergkönig', era: 'Kletterrad · Bergpreis',
    blurb: 'Weiß mit roten Punkten wie das Trikot des besten Bergfahrers: schlanker Carbonrahmen, die Punkte auf jedem Rohr, rote Felgenschrift, rotes Lenkerband und rote Kappe am Helm. Wer damit oben ankommt, ist König.',
    specs: [['Rahmen', 'Carbon, Bergpreis-Lack'], ['Laufräder', '45 mm Carbon'], ['Gruppe', '2 × 12 elektronisch'], ['Gewicht', '6,5 kg']],
    frame: 'climb', wheels: 'carbon45', brakes: 'disc', bar: 'modern', saddle: 'race', pedals: 'clipless', tires: 'black', head: 'helmet', helmet: '#d6202a',
    paint: { base: '#f6f6f3', decal: '#d6202a', metal: 'black', dots: '#d6202a' }, rimDecal: '#d6202a', wordmark: 'BERGKÖNIG', tape: '#d6202a',
    unlock: { kind: 'km', n: 1190 },
  },
  {
    id: 'fluegel', name: "Flügel '96", era: 'Monocoque · 1990er',
    blurb: 'Ein Flügel statt eines Rahmens: Carbon aus einem Stück ohne Sitzrohr, vom Steuerrohr bis zur Hinterachse ein einziges Profil, Einarmgabel, Dreispeiche vorn, Scheibe hinten, Auflieger. Schwarz mit Neongelb – so sahen die Rekorde der Neunziger aus.',
    specs: [['Rahmen', 'Carbon-Monocoque, Flügelprofil'], ['Laufräder', 'Dreispeiche · Scheibe'], ['Gruppe', '1 × 9'], ['Gewicht', '8,6 kg']],
    frame: 'wing', wheels: 'tt', brakes: 'none', bar: 'tt', saddle: 'tt', pedals: 'clipless', tires: 'black', drive: 'single', head: 'aero', helmet: '#16171a',
    paint: { base: '#17181b', panel: '#e8f000', decal: '#e8f000', metal: 'black' }, wordmark: 'FLÜGEL', tape: '#16171a',
    unlock: { kind: 'km', n: 1240 },
  },
  {
    id: 'polarstern', name: 'Polarstern', era: 'Traumrad · Einzelstück',
    blurb: 'Das letzte und schönste: perlweißer Schillerlack, der ins Eisblaue läuft, goldene Kettenblätter, goldene Kette und Naben, 60-mm-Felgen mit Goldschrift, weißer Sattel, weißes Band, helle Reifenflanken. Wer bis hierher gefahren ist, hat es verdient.',
    specs: [['Rahmen', 'Carbon, Perlmuttlack'], ['Laufräder', '60 mm Carbon'], ['Gruppe', '2 × 12 elektronisch, Gold'], ['Gewicht', '6,6 kg']],
    frame: 'climb', wheels: 'deep60', brakes: 'disc', bar: 'integrated', saddle: 'race', pedals: 'clipless', tires: 'tan', head: 'helmet', helmet: '#f6f6f3',
    paint: { base: '#f7f6f2', stops: ['#fbfaf6', '#eef0f4', '#d9e8f6', '#bcd8f0'], fade: 'z', decal: '#c9a548', metal: 'gold', finish: 'candy' }, rimDecal: '#d9b25a', bottle: '#f7f6f2', wordmark: 'POLARSTERN', tape: '#f6f6f3',
    unlock: { kind: 'km', n: 1290 },
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
  for (const g of ['abfahrt', 'sprint', 'berg', 'zeitfahren'] as GameId[]) {
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
