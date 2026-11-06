/**
 * Ergebnisblatt der Minispiele als kleiner Rennbericht – gemeinsame Bausteine für alle vier Spiele:
 *  - Beppe (sportlicher Leiter von Team gruppetto) kommentiert den Lauf über Funk
 *  - „Dieser Lauf“: Platz im Rennen, Schnitt, Kraft übrig, Spitze als Kacheln in der Farbe des Spiels
 *  - „Deine Wertung“: Platz heute und in der Saison – mit dem besten Lauf gerechnet; ist das nicht dieser,
 *    steht dabei, mit welchem (so widersprechen sich „2. Platz“ im Rennen und „1. heute“ nicht mehr)
 *  - unten Nochmal und Bestenliste (mit Beschriftung statt nur Symbol)
 */
import type { ReactNode } from 'react';
import type { GameBest, GameId } from '../data/source';
import { MY_TEAM } from '../game/teams';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/kit';
import { Kraft } from './runBoard';

export const fmtKmh = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface Tile { key: string; label: string; value: ReactNode; unit?: string; note?: ReactNode; tone?: 'good' | 'bad' }

/** Kennzahlen dieses Laufs als Kacheln */
export function RunTiles({ tiles }: { tiles: (Tile | null | false)[] }) {
  const list = tiles.filter(Boolean) as Tile[];
  if (!list.length) return null;
  return (
    <dl className={cx('rp-tiles', list.length === 4 && 'is-4')} aria-label="Dieser Lauf">
      {list.map((t, i) => (
        <div key={t.key} className={cx('rp-tile', t.tone && `is-${t.tone}`)} style={{ animationDelay: `${0.12 + i * 0.05}s` }}>
          <dt>{t.label}</dt>
          <dd>{t.value}{t.unit ? <small>&nbsp;{t.unit}</small> : null}</dd>
          {t.note ? <span className="rp-tile__note">{t.note}</span> : null}
        </div>
      ))}
    </dl>
  );
}

/** übliche Kacheln: Platz im Rennen, Schnitt, Kraft, Spitze */
export function raceTiles({ place, riders, avgKmh, reserve, topKmh }: { place?: number; riders?: number; avgKmh?: number; reserve?: number; topKmh?: number }): (Tile | null)[] {
  return [
    place && riders && riders > 1 ? { key: 'p', label: 'Im Rennen', value: `${place}.`, unit: `von ${riders}`, tone: place === 1 ? 'good' : undefined } : null,
    avgKmh ? { key: 'v', label: 'Schnitt', value: fmtKmh(avgKmh), unit: 'km/h' } : null,
    reserve !== undefined ? { key: 'k', label: 'Kraft übrig', value: <Kraft k={reserve} /> } : null,
    topKmh ? { key: 't', label: 'Spitze', value: String(Math.round(topKmh)), unit: 'km/h' } : null,
  ];
}

/** vorläufiger Platz in einer Bestenliste: mit dem besseren aus diesem Lauf und dem gespeicherten Bestwert */
export function standingOf(list: GameBest[], meId: string, score: number): { place: number; stored: number | null } {
  const stored = list.find((b) => b.user_id === meId)?.best ?? null;
  const mine = Math.max(score, stored ?? 0);
  const place = list.filter((b) => b.user_id !== meId && b.best > mine).length + 1;
  return { place, stored: stored !== null && stored > score ? stored : null };
}

/** Deine Wertung: heute und Saison; tippen öffnet die Bestenliste */
export function Standing({ today, season, meId, score, fmt, bestWord, up, onBoard }: {
  today: GameBest[]; season: GameBest[]; meId: string; score: number;
  /** Bestwert als Text (Zeit oder Punkte) */
  fmt: (best: number) => string;
  /** „Bestzeit“ oder „Bestleistung“ */
  bestWord: string;
  /** Plätze gutgemacht in der Saison */
  up?: number;
  onBoard: () => void;
}) {
  const d = standingOf(today, meId, score);
  const s = standingOf(season, meId, score);
  const note = d.stored !== null ? `gewertet mit deiner ${bestWord} von heute (${fmt(d.stored)})`
    : s.stored !== null ? `Saison mit deiner ${bestWord} (${fmt(s.stored)})` : null;
  return (
    <button type="button" className="rp-standing" onClick={onBoard} aria-label={`Deine Wertung: ${d.place}. heute, ${s.place}. in der Saison – Bestenliste öffnen`}>
      <span className="rp-standing__label">Deine Wertung</span>
      <span className="rp-standing__cells">
        <span className="rp-standing__cell"><Icon name="podium" size={15} /><b>{d.place}.</b>heute</span>
        <span className="rp-standing__cell"><Icon name="trophy" size={15} /><b>{s.place}.</b>Saison{up && up > 0 ? <em>↑{up}</em> : null}</span>
      </span>
      {note ? <small className="rp-standing__note">{note}</small> : null}
      <Icon name="chevron" size={16} className="rp-standing__chev" />
    </button>
  );
}

/** Beppe am Funk: ein Satz zum Lauf */
export function Verdict({ line }: { line: string }) {
  return (
    <p className="rp-verdict">
      <span className="team-radio__badge" aria-hidden="true">g<i>.</i></span>
      <span className="rp-verdict__bubble"><b>{MY_TEAM.ds}</b>{line}</span>
    </p>
  );
}

export interface VerdictIn {
  game: GameId;
  /** fester Würfel je Lauf (z. B. Punkte oder Zeit): derselbe Lauf, derselbe Satz */
  seed: number;
  place?: number;
  riders?: number;
  win?: boolean;
  /** persönliche Bestleistung */
  pb?: boolean;
  dayBest?: boolean;
  reserve?: number;
  /** Rückstand auf den Ersten in Sekunden */
  gapS?: number;
  slides?: number;
  /** Abfahrt: Sturz / Grund fürs Ende */
  crash?: string;
  leader?: string;
  /** dein Rivale (rival.tsx): geschlagen oder wie knapp */
  rival?: { name: string; beaten: boolean; close?: string } | null;
}

const pick = (lines: string[], seed: number) => lines[Math.abs(Math.round(seed)) % lines.length];

/** Beppes Kommentar: erst das Besondere (Sieg, Bestzeit, Sturz), dann die Kraft, dann der Abstand */
export function verdict(v: VerdictIn): string {
  const k = v.reserve !== undefined ? Math.round(v.reserve * 100) : null;
  if (v.win || v.dayBest) {
    return pick([
      'Che spettacolo! Heute Abend zahlt das Team den Spritz.',
      'So fährt ein Kapitän. Ich hab Gänsehaut am Funkgerät.',
      'Vorne! Ganz vorne! Wer hat das bitte trainiert?',
      'Das war Weltklasse. Morgen fahren die anderen dir hinterher.',
    ], v.seed);
  }
  if (v.rival?.beaten) {
    const n = v.rival.name;
    return pick([
      `${n} geschlagen! Der war fällig.`,
      `An ${n} vorbei – das schmeckt ihm heute Abend nicht.`,
      `${n} ist Geschichte. Such dir einen neuen Rivalen.`,
      `Rivale erledigt: ${n} schaut jetzt auf deine Rückennummer.`,
    ], v.seed);
  }
  if (v.crash) {
    return pick([
      'Erst bremsen, dann lenken. Und zwischendurch atmen.',
      'Dem Rad tut’s mehr weh als dir. Hoffe ich.',
      'Aufstehen, Kette prüfen, weiter. So machen wir das.',
      'Mutig war’s. Schlau vielleicht nicht ganz.',
    ], v.seed);
  }
  if (v.pb) {
    return pick([
      'Persönliche Bestleistung! Ich hab’s immer gesagt.',
      'Schneller als je zuvor – das bleibt im Rennbuch stehen.',
      'Neue Bestmarke. Der Mechaniker will ein Autogramm.',
    ], v.seed);
  }
  if (k !== null && k >= 25) {
    return pick([
      `${k} % Kraft übrig? Die nimmst du nicht mit ins Hotel!`,
      `Da waren noch ${k} % im Tank. Beim nächsten Mal früher antreten.`,
      `${k} % übrig – schön gespart, aber Punkte gibt’s fürs Leeren.`,
    ], v.seed);
  }
  if (k !== null && k <= 3) {
    return pick([
      'Komplett leer gefahren. Genau so will ich das sehen.',
      'Alles rausgehauen – mehr ging heute nicht.',
      'Im Ziel nichts mehr drin. Lehrbuch!',
    ], v.seed);
  }
  if (v.slides && v.slides >= 2) {
    return pick([
      `${v.slides}× gerutscht. Die Kurven laufen dir nicht weg.`,
      'Etwas weniger Rodeo in den Kurven, dann klappt’s auch vorne.',
    ], v.seed);
  }
  if (v.rival?.close) {
    return pick([
      `Noch ${v.rival.close} auf ${v.rival.name}. Der ist reif.`,
      `${v.rival.close} fehlen auf ${v.rival.name} – beim nächsten Mal hast du ihn.`,
    ], v.seed);
  }
  if (v.place && v.place <= 3) {
    return pick([
      'Podium! Fehlt nur noch die oberste Stufe.',
      'Knapp dran. Morgen holen wir uns das.',
      'Ganz vorne dabei – der Rest ist Feinarbeit.',
    ], v.seed);
  }
  if (v.gapS !== undefined && v.gapS > 0 && v.gapS < 4) {
    return pick([
      `Nur ${v.gapS.toFixed(1).replace('.', ',')} s – das holst du im nächsten Lauf.`,
      `${v.leader ? `${v.leader} war` : 'Die Spitze war'} in Rufweite. Noch einmal!`,
    ], v.seed);
  }
  return pick([
    'Hinten ist das neue Vorne. Aber vorne ist auch schön.',
    'Ankommen ist auch ein Ergebnis. Noch eine Runde?',
    'Kopf hoch – auch die Großen haben mal im Gruppetto angefangen.',
    'Das Zeitlimit hätten wir geschafft. Jetzt das Podium.',
  ], v.seed);
}

/** Nochmal (Hauptaktion) und Bestenliste */
export function ReportActions({ onAgain, onBoard }: { onAgain: () => void; onBoard: () => void }) {
  return (
    <div className="abf-actions">
      <button type="button" className="btn btn--primary btn--full" onClick={onAgain}><Icon name="refresh" size={18} /><span>Nochmal</span></button>
      <button type="button" className="btn btn--secondary abf-actions__board rp-board" onClick={onBoard}><Icon name="podium" size={18} /><span>Bestenliste</span></button>
    </div>
  );
}
