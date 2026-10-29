/**
 * Zeitfahren – alles, was außerhalb des Spiels gebraucht wird (Startseite, Bestenlisten, Datenquellen),
 * ohne 3D-Abhängigkeiten: Zeitformat, die Punktzahl, unter der eine Zeit in den gemeinsamen Bestenlisten
 * liegt (kleinere Zeit = höhere Punktzahl, damit die bestehenden Listen weiter „größer ist besser“ sortieren),
 * und die Geister: die beste Fahrt des Tages je Mitglied als Fahrspur, mit dem Rad, auf dem sie gefahren wurde.
 */

/** Zeiten als Punktzahl in game_scores: 1.000.000 minus Millisekunden (eine Stunde Luft) */
export const TT_SCORE_BASE = 1_000_000;
export const ttScore = (ms: number) => Math.max(1, Math.min(TT_SCORE_BASE - 1, TT_SCORE_BASE - Math.round(ms)));
export const ttMs = (score: number) => Math.max(0, TT_SCORE_BASE - Math.round(score));

/** „3:58,2“ – Minuten, Sekunden, Zehntel */
export function fmtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100));
  const m = Math.floor(t / 600);
  const s = Math.floor((t - m * 600) / 10);
  const d = t % 10;
  return `${m}:${String(s).padStart(2, '0')},${d}`;
}

/** Abstand wie in der Übertragung: „+1,8″“, „−0,4″“, bei Gleichstand „±0,0″“ */
export function fmtGap(ms: number): string {
  const a = Math.abs(ms);
  if (a < 50) return '±0,0″';
  const sign = ms > 0 ? '+' : '−';
  if (a < 60000) return `${sign}${(a / 1000).toFixed(1).replace('.', ',')}″`;
  const m = Math.floor(a / 60000);
  return `${sign}${m}′${String(Math.round((a - m * 60000) / 1000)).padStart(2, '0')}″`;
}

/** Fahrspur eines Geistes: alle TRACE_DT Sekunden Rennzeit drei Zahlen – Streckenmeter ×10, seitliche Lage in cm, Haltung (0 sitzen, 1 drücken, 2 erholen) */
export const TRACE_DT = 0.25;

export interface GhostRider {
  /** Mitglied (user_id), eigener Bestlauf ('me') oder der Tempomacher ('bot') */
  id: string;
  name: string;
  /** Trikotfarbe (Avatarfarbe des Mitglieds) */
  color: string;
  bike: string;
  timeMs: number;
  /** Zwischenzeiten (ms) an den Zwischenzeit-Stationen */
  splits: number[];
  trace: number[];
  me?: boolean;
  bot?: boolean;
  /**
   * Älterer Geist (letzte Fahrt eines Tages davor, z. B. „gestern“ oder „Mo.“): fährt mit, zählt aber nicht für Platz,
   * Zwischenzeiten und Tagesbestzeit – die Strecke war an dem Tag eine andere
   */
  old?: string;
}

/** Geist, wie er in der Datenbank liegt (beste Fahrt des Tages je Mitglied) */
export interface TtGhostRow {
  user_id: string;
  day: string;
  time_ms: number;
  bike: string;
  splits: number[];
  trace: number[];
  created_at: string;
}

/** Geist aus Abfahrt, Sprint- oder Bergfinale (beste Fahrt des Tages je Mitglied und Spiel) */
export interface GameGhostRow {
  user_id: string;
  game: 'abfahrt' | 'sprint' | 'berg';
  day: string;
  score: number;
  meters: number;
  bike: string;
  trace: number[];
  created_at: string;
}

/** Position eines Geistes zur Rennzeit t (s): zwischen den Stützpunkten linear, nach dem Ende ausrollen */
export function ghostAt(trace: number[], t: number, out: { z: number; x: number; m: number }) {
  const n = Math.floor(trace.length / 3);
  if (n === 0) { out.z = 0; out.x = 0; out.m = 0; return out; }
  if (t <= 0) { out.z = trace[0] / 10; out.x = trace[1] / 100; out.m = trace[2]; return out; }
  const f = t / TRACE_DT;
  const i = Math.floor(f);
  if (i >= n - 1) {
    const zEnd = trace[(n - 1) * 3] / 10;
    const extra = t - (n - 1) * TRACE_DT;
    out.z = zEnd + Math.min(extra, 6) * 7;
    out.x = trace[(n - 1) * 3 + 1] / 100;
    out.m = 0;
    return out;
  }
  const u = f - i;
  const a = i * 3;
  const b = a + 3;
  out.z = (trace[a] + (trace[b] - trace[a]) * u) / 10;
  out.x = (trace[a + 1] + (trace[b + 1] - trace[a + 1]) * u) / 100;
  out.m = trace[a + 2];
  return out;
}

/** Rennzeit (s), zu der der Geist die Stelle z erreicht hat (Suche in der monoton steigenden Spur); hinter dem Ende: Zielzeit plus Ausrollen */
export function ghostTimeAt(trace: number[], z: number): number {
  const n = Math.floor(trace.length / 3);
  if (n === 0) return 0;
  const zAt = (i: number) => trace[i * 3] / 10;
  if (z <= zAt(0)) return 0;
  if (z >= zAt(n - 1)) return (n - 1) * TRACE_DT + (z - zAt(n - 1)) / 7;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (zAt(mid) <= z) lo = mid; else hi = mid;
  }
  const z0 = zAt(lo);
  const z1 = zAt(hi);
  const u = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
  return (lo + u) * TRACE_DT;
}

/** „gestern“, „Mo.“ (bis vor sechs Tagen) oder „26.10.“ – wann ein älterer Geist gefahren ist */
export function ghostDayLabel(day: string, today: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((t.getTime() - d.getTime()) / 864e5);
  if (diff <= 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff < 7) return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getUTCDay()]}.`;
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** Name eines Geistes für Schilder, Meldungen und Listen */
export function ghostName(g: GhostRider, long = false): string {
  if (g.bot) return 'Tempomacher';
  if (g.me) return g.old ? `Dein Lauf ${g.old}` : long ? 'Dein Bestlauf' : 'Bestzeit';
  return g.old ? `${firstName(g.name)} (${g.old})` : firstName(g.name);
}

/** Höchstens so viele Geister auf der Strecke (Rechenzeit und Übersicht) */
export const MAX_GHOSTS = 10;

/**
 * Welche Geister mitfahren: immer die Tagesbestzeit und der eigene Geist (Bestlauf von heute, sonst der letzte),
 * dazu die Geister von heute, deren Zeit der eigenen am nächsten liegt (ohne eigene Zeit: die schnellsten), danach
 * die letzten Fahrten derer, die heute noch nicht gefahren sind. Fehlen Mitspieler, fährt der Tempomacher mit.
 */
export function pickGhosts(all: GhostRider[], myBest: number | null, pacer: GhostRider | null, max = MAX_GHOSTS): GhostRider[] {
  const usable = all.filter((g) => g.trace.length >= 6);
  const fresh = usable.filter((g) => !g.old).sort((a, b) => a.timeMs - b.timeMs);
  const older = usable.filter((g) => g.old).sort((a, b) => a.timeMs - b.timeMs);
  const out: GhostRider[] = [];
  const add = (g: GhostRider | undefined) => { if (g && !out.includes(g) && out.length < max) out.push(g); };
  add(fresh[0]);
  add(fresh.find((g) => g.me) ?? older.find((g) => g.me));
  const ref = myBest ?? fresh[0]?.timeMs ?? older[0]?.timeMs ?? 0;
  const near = (list: GhostRider[]) => list.filter((g) => !out.includes(g)).sort((a, b) => Math.abs(a.timeMs - ref) - Math.abs(b.timeMs - ref) || a.timeMs - b.timeMs);
  for (const g of near(fresh)) add(g);
  for (const g of near(older)) add(g);
  if (pacer && usable.filter((g) => !g.me).length < 3) {
    if (out.length >= max) out.pop();
    add(pacer);
  }
  return out;
}

/** Nachname oder Vorname für Schilder: „Felix Müller“ → „Felix“ */
export const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
