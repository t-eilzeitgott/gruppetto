/**
 * Welt-Editor (Admin): Änderungen an einer Tagesstrecke – gesetzte und entfernte Requisiten, Hügel und
 * Mulden im Gelände, Notizen mit Kamerastand. Alles liegt in einem kleinen JSON je Strecke
 * (Spiel + Tag), damit es sich speichern, exportieren und an Claude weitergeben lässt.
 *
 * Die Strecken entstehen aus dem Tages-Seed, darum gilt eine Änderung immer für genau eine Tagesstrecke.
 * Der Export dient vor allem als Vorlage: „hier fehlt ein Haus“, „hier ist ein Loch“ – mit Kamerastand,
 * damit sich jede Stelle wieder exakt aufrufen lässt (scripts/world-shots.mjs).
 */
import type { BiomeId, Seg, Sprite, SpriteKind, Track, TrackKind } from './track';

export const WORLD_EDITS_VERSION = 1;

/**
 * Verankerung einer Änderung „überall“: an jeder markanten Stelle dieser Art auf jeder Strecke –
 * dz Meter dahinter (negativ: davor). Beim Abschnittsanfang zählt auch die Landschaft (biome).
 */
export type AnchorKind = 'bridgeStart' | 'bridgeEnd' | 'tunnelIn' | 'tunnelOut' | 'hairpin' | 'crest' | 'sectionStart';
export interface Anchor {
  kind: AnchorKind;
  biome?: BiomeId;
  dz: number;
  /** nur Gelände: seitlich zur Straße (rechts +) statt Weltkoordinaten */
  dx?: number;
}
export const ANCHOR_LABEL: Record<AnchorKind, string> = {
  bridgeStart: 'Brückenanfang', bridgeEnd: 'Brückenende', tunnelIn: 'Tunneleinfahrt', tunnelOut: 'Tunnelausfahrt',
  hairpin: 'Kehre', crest: 'Kuppe', sectionStart: 'Abschnittsanfang',
};
/** Schlüssel der Änderungen, die überall gelten */
export const GLOBAL_KEY = 'global';

/** gesetzte Requisite: Streckenmeter z, seitlich x (rechts +), sonst wie Sprite; mit at: überall, z unbenutzt */
export interface PlacedSprite {
  id: string;
  at?: Anchor;
  z: number;
  x: number;
  k: SpriteKind;
  s: number;
  v: number;
  f: boolean;
  /** Höhe über der Straße – nur auf der Fahrbahn selbst; daneben kommt sie vom Gelände */
  h?: number;
  text?: string;
}

/** entfernte Requisite der Strecke (passt auf Segment, Art und seitliche Lage) */
export interface RemovedSprite {
  id: string;
  at?: Anchor;
  z: number;
  x: number;
  k: SpriteKind;
}

/** Hügel (dy > 0) oder Mulde (dy < 0) im Gelände, Weltkoordinaten (x, z), Radius r in m */
export interface TerrainBump {
  id: string;
  /** überall: Lage relativ zur markanten Stelle (dz, dx) – x und z werden je Vorkommen berechnet */
  at?: Anchor;
  x: number;
  z: number;
  r: number;
  dy: number;
}

/** Notiz an einer Stelle der Welt – mit Kamera (Position, Blickziel), damit sich der Blick wiederholen lässt */
export interface WorldNote {
  id: string;
  text: string;
  /** Weltpunkt (x, y, z) */
  at: [number, number, number];
  /** Streckenmeter und seitliche Lage des Punktes */
  track: { z: number; x: number };
  /** Kamera: Position (x, y, z) und Blickziel (x, y, z) */
  cam: [number, number, number, number, number, number];
  created: string;
}

export interface WorldEdits {
  v: number;
  /** z. B. „abfahrt:2026-10-28“ */
  key: string;
  kind: TrackKind;
  dayKey: string;
  /** Titel der Strecke zur Orientierung („Passo Giau → Canazei“) */
  title?: string;
  sprites: PlacedSprite[];
  removed: RemovedSprite[];
  terrain: TerrainBump[];
  notes: WorldNote[];
  updated?: string;
}

/** Spielkennung der Strecke (wie in games.ts) */
export type WorldGame = 'abfahrt' | 'sprint' | 'berg';
export const GAME_KIND: Record<WorldGame, TrackKind> = { abfahrt: 'descent', sprint: 'sprint', berg: 'mountain' };
export const KIND_GAME: Record<TrackKind, WorldGame> = { descent: 'abfahrt', sprint: 'sprint', mountain: 'berg' };

export const editsKey = (game: WorldGame, dayKey: string) => `${game}:${dayKey}`;

export function emptyEdits(game: WorldGame, dayKey: string, title?: string): WorldEdits {
  return { v: WORLD_EDITS_VERSION, key: editsKey(game, dayKey), kind: GAME_KIND[game], dayKey, title, sprites: [], removed: [], terrain: [], notes: [] };
}
/** die Änderungen „überall“ (ein Datensatz für alle Spiele und Tage) */
export function emptyGlobal(): WorldEdits {
  return { v: WORLD_EDITS_VERSION, key: GLOBAL_KEY, kind: 'descent', dayKey: '', title: 'Überall', sprites: [], removed: [], terrain: [], notes: [] };
}

/** fremde oder ältere Daten in die aktuelle Form bringen (fehlende Listen ergänzen) */
export function normalizeEdits(raw: unknown, game: WorldGame, dayKey: string, title?: string): WorldEdits {
  const base = emptyEdits(game, dayKey, title);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<WorldEdits>;
  return {
    ...base,
    title: r.title ?? title,
    sprites: Array.isArray(r.sprites) ? r.sprites : [],
    removed: Array.isArray(r.removed) ? r.removed : [],
    terrain: Array.isArray(r.terrain) ? r.terrain : [],
    notes: Array.isArray(r.notes) ? r.notes : [],
    updated: r.updated,
  };
}

export const isEmptyEdits = (e: WorldEdits) => !e.sprites.length && !e.removed.length && !e.terrain.length && !e.notes.length;

/** alle Hügel und Mulden einer Strecke: die der Tagesstrecke (Weltkoordinaten) plus die aufgelösten „überall“ */
export function bumpsOf(e: WorldEdits | null, d: Derived | null): TerrainBump[] {
  const day = (e?.terrain ?? []).filter((b) => !b.at);
  return d?.terrain.length ? [...day, ...d.terrain] : day;
}

export const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

/** Requisitenarten, die sich im Editor setzen lassen (mit Namen für die Auswahl) */
export const PLACEABLE: { k: SpriteKind; name: string; group: string }[] = [
  { k: 'pine', name: 'Fichte', group: 'Bäume' },
  { k: 'pineSnow', name: 'Fichte (Schnee)', group: 'Bäume' },
  { k: 'larch', name: 'Lärche', group: 'Bäume' },
  { k: 'tree', name: 'Laubbaum', group: 'Bäume' },
  { k: 'treeRound', name: 'Kugelbaum', group: 'Bäume' },
  { k: 'cypress', name: 'Zypresse', group: 'Bäume' },
  { k: 'palm', name: 'Palme', group: 'Bäume' },
  { k: 'olive', name: 'Olive', group: 'Bäume' },
  { k: 'bush', name: 'Busch', group: 'Grün' },
  { k: 'flowers', name: 'Blumen', group: 'Grün' },
  { k: 'grassTuft', name: 'Grasbüschel', group: 'Grün' },
  { k: 'sunflowers', name: 'Sonnenblumen', group: 'Grün' },
  { k: 'vinerow', name: 'Rebzeile', group: 'Grün' },
  { k: 'rock', name: 'Stein', group: 'Fels' },
  { k: 'boulder', name: 'Felsbrocken', group: 'Fels' },
  { k: 'chalet', name: 'Chalet', group: 'Gebäude' },
  { k: 'barn', name: 'Scheune', group: 'Gebäude' },
  { k: 'rifugio', name: 'Rifugio', group: 'Gebäude' },
  { k: 'farmhouse', name: 'Bauernhof', group: 'Gebäude' },
  { k: 'fountain', name: 'Brunnen', group: 'Dorf' },
  { k: 'lamp', name: 'Laterne', group: 'Dorf' },
  { k: 'flagpole', name: 'Fahnenmast', group: 'Dorf' },
  { k: 'parasol', name: 'Sonnenschirm', group: 'Dorf' },
  { k: 'campervan', name: 'Wohnmobil', group: 'Dorf' },
  { k: 'fence', name: 'Zaun', group: 'Weide' },
  { k: 'hay', name: 'Heuballen', group: 'Weide' },
  { k: 'logs', name: 'Holzstapel', group: 'Weide' },
  { k: 'cow', name: 'Kuh', group: 'Weide' },
  { k: 'cowBW', name: 'Kuh (schwarzweiß)', group: 'Weide' },
  { k: 'boat', name: 'Boot', group: 'See' },
  { k: 'snowpole', name: 'Schneestange', group: 'Straße' },
  { k: 'chevron', name: 'Kurventafel', group: 'Straße' },
  { k: 'crowd', name: 'Zuschauer', group: 'Straße' },
];

export const spriteName = (k: SpriteKind) => PLACEABLE.find((p) => p.k === k)?.name ?? k;

const SEG_M = 2;

/** aufgelöste Vorkommen der „überall“-Änderungen auf einer Strecke (konkrete Streckenmeter) */
export interface Derived { sprites: PlacedSprite[]; removed: RemovedSprite[]; terrain: TerrainBump[] }
export const emptyDerived = (): Derived => ({ sprites: [], removed: [], terrain: [] });

/** Requisiten eines Segments nach den Änderungen: Original minus Entferntes plus Gesetztes (Tag + überall) */
export function applyEditsToSeg(seg: Seg, e: WorldEdits | null, d: Derived | null) {
  if (seg.sprites0 === undefined) seg.sprites0 = seg.sprites ? [...seg.sprites] : null;
  const base = seg.sprites0 ?? [];
  const removed = [...(e?.removed ?? []), ...(d?.removed ?? [])].filter((r) => !r.at || d);
  const placed = [...(e?.sprites ?? []).filter((p) => !p.at), ...(d?.sprites ?? [])];
  if (!removed.length && !placed.length) { seg.sprites = seg.sprites0 ? [...seg.sprites0] : null; return; }
  const out: Sprite[] = base.filter((sp) => !removed.some((r) => Math.floor(r.z / SEG_M) === seg.i && r.k === sp.k && Math.abs(r.x - sp.x) < 0.75));
  for (const p of placed) {
    if (Math.floor(p.z / SEG_M) !== seg.i) continue;
    out.push({ k: p.k, x: p.x, h: p.h ?? 0, s: p.s, v: p.v, f: p.f, text: p.text, eid: p.id });
  }
  seg.sprites = out.length ? out : null;
}

/** Änderungen auf alle schon gebauten Segmente eines Bereichs anwenden (Segmentindizes) */
export function applyEditsRange(track: Track, e: WorldEdits | null, from: number, to: number) {
  for (let i = Math.max(from, track.first); i < Math.min(to, track.length); i++) applyEditsToSeg(track.seg(i), e, track.derived);
}

/** markante Stellen eines Abschnitts (Segmentindizes from … to): Art, Streckenmeter */
export interface Feature { kind: AnchorKind; z: number; biome: BiomeId }
export function featuresIn(track: Track, from: number, to: number): Feature[] {
  const out: Feature[] = [];
  const sec = track.sections.find((s) => s.start === from);
  const biome = sec?.biome ?? track.sectionOf(track.seg(from)).biome;
  // nur ein echter Abschnittsanfang (nicht der Rest eines schon verworfenen Abschnitts)
  if (sec) out.push({ kind: 'sectionStart', z: from * SEG_M, biome });
  let prevBridge = false;
  let prevHp = 0;
  let prevCrest = false;
  for (let i = from; i < to; i++) {
    const s = track.seg(i);
    const b = s.bridge > 0;
    if (b && !prevBridge) out.push({ kind: 'bridgeStart', z: i * SEG_M, biome });
    if (!b && prevBridge) out.push({ kind: 'bridgeEnd', z: i * SEG_M, biome });
    prevBridge = b;
    if (s.portal === 1) out.push({ kind: 'tunnelIn', z: i * SEG_M, biome });
    if (s.portal === 2) out.push({ kind: 'tunnelOut', z: (i + 1) * SEG_M, biome });
    if (s.hairpin && s.hairpin !== prevHp) out.push({ kind: 'hairpin', z: i * SEG_M, biome });
    prevHp = s.hairpin;
    if (s.crest && !prevCrest) out.push({ kind: 'crest', z: i * SEG_M, biome });
    prevCrest = s.crest;
  }
  return out;
}

/** nächste markante Stelle zu einem Streckenmeter (für das Verankern im Editor), null = keine in Reichweite */
export function nearestFeature(track: Track, z: number, maxD = 120): Feature | null {
  const i = Math.floor(z / SEG_M);
  const sec = track.sectionOf(track.seg(i));
  const list = featuresIn(track, Math.max(track.first, sec.start), Math.min(track.length, sec.end));
  let best: Feature | null = null;
  for (const f of list) if (Math.abs(f.z - z) <= maxD && (!best || Math.abs(f.z - z) < Math.abs(best.z - z))) best = f;
  return best;
}

const fits = (a: Anchor, f: Feature) => a.kind === f.kind && (a.kind !== 'sectionStart' || !a.biome || a.biome === f.biome);

/** „überall“-Änderungen für einen gerade gebauten Abschnitt auflösen und an track.derived anhängen */
export function deriveForSection(track: Track, g: WorldEdits | null, from: number, to: number) {
  if (!g) return;
  const feats = featuresIn(track, from, to);
  if (!feats.length) return;
  const d = track.derived;
  const w = { x: 0, y: 0, z: 0, th: 0 };
  for (const f of feats) {
    for (const p of g.sprites) if (p.at && fits(p.at, f)) d.sprites.push({ ...p, at: undefined, z: f.z + p.at.dz });
    for (const r of g.removed) if (r.at && fits(r.at, f)) d.removed.push({ ...r, at: undefined, z: f.z + r.at.dz });
    for (const b of g.terrain) {
      if (!b.at || !fits(b.at, f)) continue;
      track.world(Math.max(0, f.z + b.at.dz), b.at.dx ?? 0, 0, w);
      d.terrain.push({ id: `${b.id}@${Math.round(f.z)}`, x: w.x, z: w.z, r: b.r, dy: b.dy });
    }
  }
}

/** Höhenänderung durch Hügel und Mulden an einem Weltpunkt (weicher Rand: (1 − t²)²) */
export function bumpAt(bumps: TerrainBump[], x: number, z: number): number {
  let dy = 0;
  for (let i = 0; i < bumps.length; i++) {
    const b = bumps[i];
    const dx = x - b.x;
    const dz = z - b.z;
    const r2 = b.r * b.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r2) continue;
    const t = 1 - d2 / r2;
    dy += b.dy * t * t;
  }
  return dy;
}

/** Export für Claude: knapper Kopf, dann das JSON – lässt sich direkt in den Chat kopieren */
export function exportText(e: WorldEdits): string {
  const head = [
    `Welt-Editor gruppetto – ${e.key}${e.title ? ` (${e.title})` : ''}`,
    `${e.notes.length} Notizen, ${e.sprites.length} gesetzt, ${e.removed.length} entfernt, ${e.terrain.length} Geländeänderungen`,
    'Koordinaten: z = Streckenmeter ab Start, x = seitlich (rechts +, m); Gelände und Kamera in Weltkoordinaten.',
    'Ansicht nachstellen: node scripts/world-shots.mjs <datei.json>',
    '',
  ].join('\n');
  return head + JSON.stringify(e, null, 1);
}
