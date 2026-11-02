/**
 * Die zehn Teams der gruppetto-Welt – erfundene Rennställe mit eigener Corporate Identity. Du fährst für Team
 * gruppetto; die anderen neun sind die Konkurrenz im Feld, auf den Banden, an den Werbebögen und im Fernsehen.
 *
 * Je Team: Name und Kürzel (wie die UCI-Codes), Hauptsponsor als Schriftzug mit eigener Schriftart, Farben
 * (Grund, Zweitfarbe, Akzent), das Trikotmuster, Herkunft, Gründungsjahr, sportlicher Leiter, Slogan und ein paar
 * Funksprüche. Alles hier ist reine Beschreibung – gezeichnet wird in rider3d.ts (Trikot), tex3d.ts (Banden,
 * Bögen) und hud.tsx (Fernsehwerbung). Keine 3D-Abhängigkeiten.
 */
import type { Kit } from './abfahrt/rider';

export type TeamId =
  | 'gruppetto' | 'alpengluh' | 'serpentina' | 'windschatten' | 'polenta'
  | 'nordkap' | 'vuelta' | 'carbon' | 'col' | 'hungerast';

/** Schriftcharakter des Sponsorschriftzugs */
export type TeamFont = 'round' | 'heavy' | 'italic' | 'serif' | 'condensed' | 'script';
/** Trikotmuster (rider3d.ts zeichnet sie) */
export type TeamPattern = 'dot' | 'peaks' | 'pinstripe' | 'band' | 'sash' | 'fade' | 'hoops' | 'split' | 'checker' | 'flash';

export interface Team {
  id: TeamId;
  /** offizieller Teamname */
  name: string;
  /** dreistelliges Kürzel wie bei der UCI */
  code: string;
  /** Hauptsponsor – Schriftzug auf Brust, Banden und Bögen */
  sponsor: string;
  /** Zusatz unter dem Schriftzug (Banden, Fernsehen) */
  tagline: string;
  /** Herkunft (Flagge) und Sitz */
  country: string;
  flag: string;
  home: string;
  founded: number;
  /** sportlicher Leiter – spricht im Teamfunk */
  ds: string;
  font: TeamFont;
  pattern: TeamPattern;
  /** Grundfarbe, Zweitfarbe (Seiten, Kragen), Akzent (Muster, Kante), Schrift auf Grund */
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  kit: Omit<Kit, 'skin' | 'number' | 'bike'>;
  /** kurze Geschichte, eine Zeile */
  lore: string;
  /** Sprüche im Teamfunk (vor dem Start) */
  radio: string[];
}

const T = (t: Omit<Team, 'kit'> & { kit: Omit<Kit, 'skin' | 'number' | 'bike' | 'team' | 'jersey' | 'side'> }): Team => ({
  ...t,
  kit: { ...t.kit, jersey: t.primary, side: t.secondary, team: t.id },
});

export const TEAMS: Team[] = [
  T({
    id: 'gruppetto', name: 'Team gruppetto', code: 'GRU', sponsor: 'gruppetto.', tagline: 'Hinten ist das neue Vorne',
    country: 'Tipprunde', flag: '🚲', home: 'irgendwo hinten im Feld', founded: 2027, ds: 'Beppe',
    font: 'round', pattern: 'dot', primary: '#ff5fa2', secondary: '#1f2a44', accent: '#ffffff', ink: '#ffffff',
    kit: { helmet: '#1f2a44', shorts: '#1f2a44', shoes: '#ffffff' },
    lore: 'Gegründet am Küchentisch einer Tipprunde. Budget: ein Spritz pro Etappe.',
    radio: [
      'Ruhig bleiben. Wir kommen an – wie immer.',
      'Zeitlimit ist auch ein Ziel.',
      'Der Spritz im Ziel ist kalt gestellt.',
      'Heute nur lächeln, wenn die Kamera kommt.',
      'Wer zuerst bremst, zahlt die Pizza.',
      'Hinten ist das neue Vorne. Los!',
      'Denk an den Außenseiter-Bonus.',
      'Kein Risiko in den Kehren – das Rad ist geliehen.',
    ],
  }),
  T({
    id: 'alpengluh', name: 'Alpenglüh Energie Racing', code: 'AGE', sponsor: 'ALPENGLÜH', tagline: 'Strom von ganz oben',
    country: 'Österreich', flag: '🇦🇹', home: 'Innsbruck', founded: 2009, ds: 'Sepp Hörtnagl',
    font: 'heavy', pattern: 'peaks', primary: '#d72631', secondary: '#ffffff', accent: '#ffffff', ink: '#ffffff',
    kit: { helmet: '#ffffff', shorts: '#1b1d22', shoes: '#ffffff' },
    lore: 'Wasserkraft aus Tirol, Waden aus Granit. Fährt jede Abfahrt, als wäre sie ein Bergauf.',
    radio: ['Volle Kraft, Burschen!'],
  }),
  T({
    id: 'serpentina', name: 'Banca Serpentina', code: 'BSE', sponsor: 'Banca Serpentina', tagline: 'Es geht aufwärts. Seit 1871.',
    country: 'Italien', flag: '🇮🇹', home: 'Bergamo', founded: 1998, ds: 'Dott. Ernesto Valli',
    font: 'serif', pattern: 'pinstripe', primary: '#0f5c45', secondary: '#d9b24c', accent: '#d9b24c', ink: '#f6ecd0',
    kit: { helmet: '#0f5c45', shorts: '#0a3a2c', shoes: '#ffffff' },
    lore: 'Die älteste Bank am Fuß des Stelvio. Fährt in Nadelstreifen – und zahlt pünktlich.',
    radio: ['Con calma. Die Zinsen kommen am Berg.'],
  }),
  T({
    id: 'windschatten', name: 'Windschatten Versicherung', code: 'WSV', sponsor: 'WINDSCHATTEN', tagline: 'Wir fahren für Sie hinterher',
    country: 'Deutschland', flag: '🇩🇪', home: 'Hannover', founded: 2014, ds: 'Uwe Brakmann',
    font: 'condensed', pattern: 'band', primary: '#169c88', secondary: '#ffffff', accent: '#0b4f45', ink: '#ffffff',
    kit: { helmet: '#ffffff', shorts: '#0b3b34', shoes: '#ffffff' },
    lore: 'Versichert alles außer Attacken. Gewinnt Rennen am liebsten aus der zweiten Reihe.',
    radio: ['Hinterrad halten. Nicht in den Wind.'],
  }),
  T({
    id: 'polenta', name: 'Polenta Power – Molino Rossi', code: 'PPM', sponsor: 'POLENTA POWER', tagline: 'Gemahlen seit 1923',
    country: 'Italien', flag: '🇮🇹', home: 'Treviso', founded: 1987, ds: 'Nonna Pina',
    font: 'italic', pattern: 'sash', primary: '#ffd400', secondary: '#c0392b', accent: '#c0392b', ink: '#1a1a1a',
    kit: { helmet: '#c0392b', shorts: '#1a1a1a', shoes: '#ffd400' },
    lore: 'Die Mühle der Familie Rossi. Im Teamwagen fährt immer ein Topf Polenta mit.',
    radio: ['Mangia, e poi attacca!'],
  }),
  T({
    id: 'nordkap', name: 'Nordkap Fisk Cycling', code: 'NFC', sponsor: 'NORDKAP', tagline: 'Frisch bis ins Ziel',
    country: 'Norwegen', flag: '🇳🇴', home: 'Tromsø', founded: 2016, ds: 'Ingrid Solberg',
    font: 'condensed', pattern: 'fade', primary: '#0b4f8a', secondary: '#bfe6ff', accent: '#ffffff', ink: '#ffffff',
    kit: { helmet: '#ffffff', shorts: '#082c4d', shoes: '#ffffff' },
    lore: 'Trainiert im Polarlicht, mag keine Hitze. Erkennt man am eisblauen Verlauf.',
    radio: ['Kaldt hode, varme bein.'],
  }),
  T({
    id: 'vuelta', name: 'Bodegas Puerto Alto', code: 'BPA', sponsor: 'Puerto Alto', tagline: 'Tinto de altura',
    country: 'Spanien', flag: '🇪🇸', home: 'Rioja', founded: 2003, ds: 'Don Aurelio Ibáñez',
    font: 'script', pattern: 'hoops', primary: '#7d1f2a', secondary: '#f3e2c7', accent: '#e8b04b', ink: '#f3e2c7',
    kit: { helmet: '#7d1f2a', shorts: '#3e0f15', shoes: '#f3e2c7' },
    lore: 'Weingut auf 900 m. Feiert jeden Bergpreis – mit Traubensaft, offiziell.',
    radio: ['¡Vamos, despacio!'],
  }),
  T({
    id: 'carbon', name: 'Carbon-Kummer Racing', code: 'CKR', sponsor: 'CARBON-KUMMER', tagline: 'Leichter als dein Konto',
    country: 'USA', flag: '🇺🇸', home: 'Boulder', founded: 2021, ds: 'Brad Kessler',
    font: 'heavy', pattern: 'split', primary: '#121316', secondary: '#c6ff3d', accent: '#c6ff3d', ink: '#c6ff3d',
    kit: { helmet: '#121316', shorts: '#121316', shoes: '#c6ff3d' },
    lore: 'Jedes Rad 6,8 kg, jedes Trikot ein Datenblatt. Misst Watt sogar beim Frühstück.',
    radio: ['Stay in zone two. Data never lies.'],
  }),
  T({
    id: 'col', name: 'Café du Col – Lavande', code: 'CDC', sponsor: 'Café du Col', tagline: 'Un express, et on monte',
    country: 'Frankreich', flag: '🇫🇷', home: 'Provence', founded: 2011, ds: 'Madame Odile Fabre',
    font: 'script', pattern: 'checker', primary: '#8a6dd8', secondary: '#ffffff', accent: '#2a1f4d', ink: '#ffffff',
    kit: { helmet: '#ffffff', shorts: '#2a1f4d', shoes: '#ffffff' },
    lore: 'Lavendelfelder, Espresso am Gipfel, karierte Tischdecken als Trikot.',
    radio: ['Allez, doucement, puis à fond.'],
  }),
  T({
    id: 'hungerast', name: 'Hungerast Riegel Pro', code: 'HRP', sponsor: 'HUNGERAST', tagline: 'Der Riegel für Kilometer 180',
    country: 'Niederlande', flag: '🇳🇱', home: 'Utrecht', founded: 2012, ds: 'Joop van Dijk',
    font: 'heavy', pattern: 'flash', primary: '#ff8c1a', secondary: '#1b1b1d', accent: '#ffffff', ink: '#1b1b1d',
    kit: { helmet: '#1b1b1d', shorts: '#1b1b1d', shoes: '#ff8c1a' },
    lore: 'Flach wie zu Hause, schnell wie der Wind. Isst im Rennen mehr als alle anderen.',
    radio: ['Eten, drinken, sprinten.'],
  }),
];

const BY_ID = new Map(TEAMS.map((t) => [t.id, t]));

export function team(id: TeamId | string | undefined | null): Team | null {
  return (id && BY_ID.get(id as TeamId)) || null;
}

/** dein Team */
export const MY_TEAM = TEAMS[0];
/** die Konkurrenz im Feld */
export const RIVALS = TEAMS.slice(1);

/** Trikot eines Teams mit Startnummer (Hautfarbe und Rad dazu) */
export function teamKit(id: TeamId, number: string, extra: Partial<Kit> = {}): Kit {
  const t = team(id) ?? MY_TEAM;
  return { ...t.kit, skin: '#f0c4a0', number, ...extra };
}

/** Funkspruch des sportlichen Leiters für heute (fest je Tag und Spiel) */
export function teamRadio(day: string, game: string): { ds: string; line: string } {
  let h = 2166136261;
  for (const ch of `${day}:${game}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const lines = MY_TEAM.radio;
  return { ds: MY_TEAM.ds, line: lines[(h >>> 0) % lines.length] };
}

const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Arial, sans-serif';
/** CSS-Schrift für den Sponsorschriftzug eines Teams (Leinwand: Trikot, Banden, Bögen) */
export function teamFont(t: Team, px: number): string {
  switch (t.font) {
    case 'round': return `800 ${px}px "Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, ${SANS}`;
    case 'heavy': return `900 ${px}px ${SANS}`;
    case 'italic': return `italic 900 ${px}px ${SANS}`;
    case 'serif': return `700 ${px}px "Didot", "Bodoni 72", Georgia, "Times New Roman", serif`;
    case 'condensed': return `800 ${px}px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", ${SANS}`;
    case 'script': return `italic 700 ${px}px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive`;
  }
}

/** Schriftzug so groß wie möglich in eine Breite (Leinwand, Mitte = x) */
export function drawWordmark(c: CanvasRenderingContext2D, t: Team, text: string, x: number, y: number, maxW: number, maxPx: number, color: string, dot = color) {
  let px = maxPx;
  c.font = teamFont(t, px);
  while (c.measureText(text).width > maxW && px > 6) { px -= 1; c.font = teamFont(t, px); }
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (t.id === 'gruppetto' && text.endsWith('.')) {
    // die Wortmarke: Punkt in eigener Farbe
    const body = text.slice(0, -1);
    const wb = c.measureText(body).width;
    const wd = c.measureText('.').width;
    const x0 = x - (wb + wd) / 2;
    c.textAlign = 'left';
    c.fillText(body, x0, y);
    c.fillStyle = dot;
    c.fillText('.', x0 + wb, y);
    c.textAlign = 'center';
    return;
  }
  c.fillText(text, x, y);
}
