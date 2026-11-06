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
 *
 * Echtzeit (Lobby-Rennen, src/app/realtime.ts): wer in derselben Lobby fährt, schickt zusätzlich bis zu zehnmal je
 * Sekunde Lage und Tempo direkt an die anderen (WebSocket). Solange solche Meldungen frisch sind (RT_FRESH), steht der
 * andere genau dort (rtAt: letzte Meldung plus Tempo × Alter) statt auf der Spur – und wer im selben Lobby-Rennen
 * gestartet ist, ist kein Geist mehr, sondern ein echter Gegner (solid): man kann sich berühren und rempeln.
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
/** so lange (s) gilt eine Echtzeit-Meldung als frisch; danach zählt wieder die Spur */
export const RT_FRESH = 0.9;
/** höchstens so weit (s) wird eine Echtzeit-Meldung fortgeschrieben: längs mit dem Tempo, seitlich kürzer */
export const RT_AHEAD = 0.6;
export const RT_AHEAD_X = 0.18;

/** Echtzeit-Stand eines Fahrers: Streckenmeter, seitliche Lage (m), Tempo längs und seitlich (m/s), Haltung */
export interface RtState { z: number; x: number; v: number; vx: number; m: number }

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
  /** Echtzeit: letzte Meldung und wann sie galt (ms, performance.now – schon um ihr Alter zurückgerechnet) */
  rt?: RtState;
  rtAt?: number;
  /** im selben Lobby-Rennen gestartet: echter Gegner statt Geist (solange die Echtzeit-Meldungen frisch sind) */
  solid?: boolean;
  /** liegt gerade (Sturz) */
  down?: boolean;
  /** ist in der eigenen Lobby: auf der Strecke deutlich hervorgehoben (großes Namensschild, Ring, voll sichtbar) */
  mate?: boolean;
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

/** Echtzeit-Meldung übernehmen (ageMs: so alt war sie beim Empfang, nowMs: jetzt, performance.now) */
export function rtSet(f: LiveFeed, s: RtState, ageMs: number, nowMs: number) {
  const at = nowMs - Math.max(0, Math.min(1000, ageMs));
  // Meldungen können sich überholen: eine ältere nicht über eine neuere legen
  if (f.rt && f.rtAt !== undefined && at < f.rtAt) return;
  f.rt = s;
  f.rtAt = at;
}

/** sind die Echtzeit-Meldungen frisch? */
export function rtFresh(f: LiveFeed, nowMs: number): boolean {
  return !!f.rt && f.rtAt !== undefined && nowMs - f.rtAt < RT_FRESH * 1000;
}

/** Lage aus der letzten Echtzeit-Meldung, um ihr Alter fortgeschrieben; false, wenn keine frische da ist */
export function rtAt(f: LiveFeed, nowMs: number, out: { z: number; x: number; m: number }): boolean {
  if (!rtFresh(f, nowMs)) return false;
  const r = f.rt!;
  const age = Math.max(0, (nowMs - f.rtAt!) / 1000);
  out.z = r.z + r.v * Math.min(age, RT_AHEAD);
  out.x = r.x + r.vx * Math.min(age, RT_AHEAD_X);
  out.m = r.m;
  return true;
}

/** so lange (s) ist man nach einem Rempler wacklig: ein zweiter in dieser Zeit bringt einen zu Boden */
export const HIT_SHAKY = 2.5;
/** ab dieser seitlichen Annäherung (m/s) zählt eine Berührung als Rempler */
export const HIT_MIN = 0.9;

/** Rempler zwischen zwei Mitspielern – wer ihn bemerkt, meldet ihn dem anderen (damit er bei beiden passiert) */
export interface RtHit {
  /** an wen (Mitglied) */
  to: string;
  /** seitliche Annäherung (m/s) */
  power: number;
  /** Rolle des Empfängers: gerammt ('v') oder selbst hineingezogen ('a') */
  role: 'v' | 'a';
  /** Richtung, in die der Empfänger gestoßen wird (−1 links, 1 rechts) */
  dir: -1 | 1;
}

/**
 * Was ein Rempler mit einem macht: seitlicher Stoß (m/s), Tempoverlust (m/s), Kraft (0–1), Sturz. Der erste Rempler
 * schiebt nur weg und macht wacklig (shaky: kurz zuvor schon einer) – der zweite bringt den Gerammten zu Boden.
 */
export function hitEffect(power: number, role: 'v' | 'a', shaky: boolean, roll: number): { kick: number; slow: number; energy: number; down: boolean } {
  const p = Math.max(0, Math.min(6, power));
  if (role === 'v') return { kick: 0.9 + 0.75 * p, slow: 0.5 + 0.2 * p, energy: 0.03 + 0.008 * p, down: shaky };
  // wer rammt, prallt zurück und zahlt weniger – ist er selbst noch wacklig, kann es auch ihn erwischen
  return { kick: 0.5 + 0.35 * p, slow: 0.25 + 0.1 * p, energy: 0.02 + 0.006 * p, down: shaky && roll < 0.5 };
}

/** Startplatz im Lobby-Rennen: alle Mitglieder der Lobby in fester Reihenfolge – bei allen dieselbe */
export function gridIndex(members: { user_id: string }[], meId: string): number {
  const ids = members.map((m) => m.user_id).sort();
  return Math.max(0, ids.indexOf(meId));
}
