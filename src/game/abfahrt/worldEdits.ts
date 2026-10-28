/**
 * Welt-Editor (Admin): Änderungen an einer Tagesstrecke – gesetzte und entfernte Requisiten, Hügel und
 * Mulden im Gelände, Notizen mit Kamerastand. Alles liegt in einem kleinen JSON je Strecke
 * (Spiel + Tag), damit es sich speichern, exportieren und an Claude weitergeben lässt.
 *
 * Die Strecken entstehen aus dem Tages-Seed, darum gilt eine Änderung immer für genau eine Tagesstrecke.
 * Der Export dient vor allem als Vorlage: „hier fehlt ein Haus“, „hier ist ein Loch“ – mit Kamerastand,
 * damit sich jede Stelle wieder exakt aufrufen lässt (scripts/world-shots.mjs).
 */
import type { Seg, Sprite, SpriteKind, Track, TrackKind } from './track';

export const WORLD_EDITS_VERSION = 1;

/** gesetzte Requisite: Streckenmeter z, seitlich x (rechts +), sonst wie Sprite */
export interface PlacedSprite {
  id: string;
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
  z: number;
  x: number;
  k: SpriteKind;
}

/** Hügel (dy > 0) oder Mulde (dy < 0) im Gelände, Weltkoordinaten (x, z), Radius r in m */
export interface TerrainBump {
  id: string;
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

/** Requisiten eines Segments nach den Änderungen: Original minus Entferntes plus Gesetztes */
export function applyEditsToSeg(seg: Seg, e: WorldEdits | null) {
  if (seg.sprites0 === undefined) seg.sprites0 = seg.sprites ? [...seg.sprites] : null;
  const base = seg.sprites0 ?? [];
  if (!e) { seg.sprites = seg.sprites0 ? [...seg.sprites0] : null; return; }
  const out: Sprite[] = base.filter((sp) => !e.removed.some((r) => Math.floor(r.z / SEG_M) === seg.i && r.k === sp.k && Math.abs(r.x - sp.x) < 0.75));
  for (const p of e.sprites) {
    if (Math.floor(p.z / SEG_M) !== seg.i) continue;
    out.push({ k: p.k, x: p.x, h: p.h ?? 0, s: p.s, v: p.v, f: p.f, text: p.text, eid: p.id });
  }
  seg.sprites = out.length ? out : null;
}

/** Änderungen auf alle schon gebauten Segmente eines Bereichs anwenden (Segmentindizes) */
export function applyEditsRange(track: Track, e: WorldEdits | null, from: number, to: number) {
  for (let i = Math.max(from, track.first); i < Math.min(to, track.length); i++) applyEditsToSeg(track.seg(i), e);
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
