/**
 * Live in den Minispielen: wer gerade dieselbe Strecke fährt, fährt als Live-Geist mit.
 *
 * Jedes Spiel meldet im Rennen ein- bis zweimal je Sekunde seinen Stand (game_live in der Datenbank, src/app/live.ts):
 * die letzten LIVE_TAIL Proben seiner Fahrspur (Format wie die Geister, tt.ts: alle TRACE_DT Sekunden Streckenmeter
 * ×10, Lage in cm, Haltung) und wie viele Proben der Lauf bis dahin hat. Wer dieselbe Strecke fährt, hängt die neuen
 * Proben an seine Kopie der Spur (LiveFeed) und zeigt den anderen dort, wo er jetzt ist: letzter Stand plus die Zeit
 * seitdem (Alter der Meldung laut Server, Weg zu einem selbst). Was noch nicht angekommen ist, wird mit seinem letzten
 * Tempo fortgeschrieben (höchstens LIVE_EXTRAP Sekunden) – so fahren zwei, die zusammen gestartet sind, auch
 * nebeneinander und nicht um den Weg durchs Netz versetzt. Die Uhr des Geistes läuft mit dem Spiel und gleicht sich
 * sanft an (Zeitlupe, Pausen, Schwankungen im Netz); kleine Sprünge der Lage glättet die Darstellung (ghosts.ts).
 */
import { TRACE_DT, ghostAt } from './tt';

/** kleiner Puffer (s) gegen Schwankungen im Netz */
export const LIVE_DELAY = 0.25;
/** so weit (s) wird über die letzte Probe hinaus mit dem letzten Tempo fortgeschrieben */
export const LIVE_EXTRAP = 2.5;
/** so viele Proben je Meldung (die letzten 10 s – ausgefallene Meldungen werden nachgeholt) */
export const LIVE_TAIL = 40;
/** nach dem Ende der Spur noch so lange ausrollen (s), dann ausblenden */
export const LIVE_ROLL = 2.5;

export type LiveState = 'menu' | 'race' | 'over';

/** eigener Stand für die anderen, aus der Engine */
export interface LiveOut {
  /** im Startblatt (noch kein Lauf), im Rennen, fertig (Ziel, Sturz) */
  state: LiveState;
  /** Fahrspur des laufenden (oder letzten) Laufs */
  trace: number[];
}

/** ein anderer, der gerade dieselbe Strecke fährt */
export interface LiveFeed {
  userId: string;
  name: string;
  color: string;
  bike: string;
  /** Kennung des Laufs (neuer Lauf = neue Spur) */
  run: string;
  /** Fahrspur, wächst mit jeder Meldung; wer später dazukommt, bekommt den Anfang mit der ersten Probe aufgefüllt */
  trace: number[];
  /** fährt noch (sonst im Ziel, gestürzt oder aufgehört) */
  racing: boolean;
  /** nicht mehr gemeldet (Spiel verlassen): rollt aus und verschwindet */
  gone: boolean;
  /** Spielzeit der letzten Probe (s), wie alt die Meldung beim Empfang war (s), Empfang (ms, performance.now) */
  tLast: number;
  age: number;
  at: number;
  /** angezeigte Spielzeit des anderen (s) */
  shown: number;
  started: boolean;
}

export function newFeed(p: { userId: string; name: string; color: string; bike: string; run: string }): LiveFeed {
  return { ...p, trace: [], racing: true, gone: false, tLast: 0, age: 0, at: 0, shown: 0, started: false };
}

/** Proben in der Spur */
export const liveSamples = (f: LiveFeed) => Math.floor(f.trace.length / 3);
/** Spielzeit der letzten Probe (s) */
export const liveEnd = (f: LiveFeed) => Math.max(0, (liveSamples(f) - 1) * TRACE_DT);

/**
 * Neue Proben anhängen: tail sind die letzten Proben des Laufs, n die Zahl aller Proben bis zur letzten davon.
 * Fehlt etwas dazwischen (Meldungen ausgefallen), wird die Lücke geradlinig überbrückt.
 */
export function mergeTail(f: LiveFeed, n: number, tail: number[]): void {
  const k = Math.floor(tail.length / 3);
  if (k === 0 || n < k) return;
  const first = n - k;
  let have = liveSamples(f);
  if (have === 0 && first > 0) {
    // später dazugekommen: der Anfang ist unbekannt (wird nie gezeigt – die Uhr steht weit hinten)
    for (let i = 0; i < first; i++) f.trace.push(tail[0], tail[1], tail[2]);
    have = first;
  } else if (first > have) {
    const a = (have - 1) * 3;
    const gap = first - have;
    for (let i = 1; i <= gap; i++) {
      const u = i / (gap + 1);
      f.trace.push(Math.round(f.trace[a] + (tail[0] - f.trace[a]) * u), Math.round(f.trace[a + 1] + (tail[1] - f.trace[a + 1]) * u), tail[2]);
    }
    have = first;
  }
  for (let j = have - first; j < k; j++) f.trace.push(tail[j * 3], tail[j * 3 + 1], tail[j * 3 + 2]);
}

/** neue Meldung eingetroffen: Stand der Uhr (ageMs: so alt war sie laut Server, nowMs: jetzt, performance.now) */
export function feedTime(f: LiveFeed, ageMs: number, nowMs: number) {
  f.tLast = liveEnd(f);
  f.age = Math.max(0, Math.min(5, ageMs / 1000));
  f.at = nowMs;
}

/** Zielzeit der Uhr: letzter Stand plus seitdem vergangene Zeit, abzüglich des Puffers */
export function liveTarget(f: LiveFeed, nowMs: number): number {
  return f.tLast + f.age + (nowMs - f.at) / 1000 - LIVE_DELAY;
}

/**
 * Uhr des Geistes einen Schritt weiter (dt: Spielzeit des Schritts): läuft mit dem Spiel und holt sanft auf oder
 * bremst, springt nur bei großem Abstand (Pause, Rückkehr in die App); höchstens LIVE_EXTRAP über die Spur hinaus
 * (bzw. zum Ausrollen, wenn der andere fertig ist)
 */
export function liveAdvance(f: LiveFeed, dt: number, nowMs: number): number {
  const end = liveEnd(f);
  const max = f.racing && !f.gone ? end + LIVE_EXTRAP : end + LIVE_ROLL;
  const target = Math.min(liveTarget(f, nowMs), max);
  if (!f.started || Math.abs(target - f.shown) > 3) {
    f.shown = target;
    f.started = true;
  } else {
    const rate = Math.max(0.5, Math.min(1.6, 1 + (target - f.shown) * 0.8));
    f.shown += dt * rate;
  }
  f.shown = Math.min(f.shown, max);
  return f.shown;
}

/** fertig gezeigt: der andere ist fertig (oder weg) und der Geist ist ausgerollt */
export function liveDone(f: LiveFeed): boolean {
  return (!f.racing || f.gone) && f.shown >= liveEnd(f) + LIVE_ROLL - 0.05;
}

/** die letzten Proben der eigenen Spur für die Meldung */
export function liveTail(trace: number[]): number[] {
  const n = Math.floor(trace.length / 3);
  return trace.slice(Math.max(0, n - LIVE_TAIL) * 3, n * 3);
}

/**
 * Lage des Live-Geists zur Zeit t: auf der Spur wie ein gespeicherter Geist; dahinter mit dem Tempo der letzten
 * Sekunde fortgeschrieben, solange er fährt – ist er fertig, rollt er aus
 */
export function liveAt(f: LiveFeed, t: number, out: { z: number; x: number; m: number }) {
  const n = liveSamples(f);
  const end = liveEnd(f);
  if (n < 2 || t <= end) return ghostAt(f.trace, t, out);
  const b = (n - 1) * 3;
  const a = Math.max(0, n - 5) * 3;
  const v = Math.max(0, (f.trace[b] - f.trace[a]) / 10 / ((b - a) / 3 * TRACE_DT));
  const extra = t - end;
  out.x = f.trace[b + 1] / 100;
  if (f.racing && !f.gone) {
    out.z = f.trace[b] / 10 + v * Math.min(extra, LIVE_EXTRAP);
    out.m = f.trace[b + 2];
  } else {
    // ausrollen: gleichmäßig langsamer bis zum Stand nach LIVE_ROLL
    const e = Math.min(extra, LIVE_ROLL);
    out.z = f.trace[b] / 10 + v * (e - (e * e) / (2 * LIVE_ROLL));
    out.m = 0;
  }
  return out;
}
