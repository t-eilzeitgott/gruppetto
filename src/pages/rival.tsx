/**
 * Dein Rivale: wer in der Saisonwertung eines Spiels direkt vor einem liegt (ist man selbst vorn: wer einen jagt;
 * hat man noch kein Ergebnis: der Letzte der Wertung – das erste Ziel). Im Startblatt steht er mit Abstand, im
 * Rennen fährt sein Geist immer mit (deutlicher, Schild „Rivale“, Ansage beim Überholen), im Ergebnis sagt Beppe,
 * ob er geschlagen ist.
 */
import { useMemo, useRef } from 'react';
import type { GameBest, GameId } from '../data/source';
import { gameInfo } from '../game/games';
import type { Profile } from '../lib/types';
import { Avatar } from '../ui/kit';

export interface Rival {
  userId: string;
  name: string;
  color: string;
  /** sein Platz in der Saison */
  place: number;
  /** sein Bestwert (wie in game_scores) */
  best: number;
  /** liegt vor einem (sonst: jagt einen) */
  ahead: boolean;
  /** Abstand in Wertungseinheiten (Punkte bzw. ms); null: man hat noch kein Ergebnis */
  gap: number | null;
  /** eigener Bestwert, als der Rivale bestimmt wurde (vor dem Lauf) */
  mine: number | null;
}

const first = (name: string | null | undefined) => (name ?? 'Jemand').trim().split(/\s+/)[0] || 'Jemand';

export function rivalOf(season: GameBest[] | undefined, meId: string, members: Profile[] | undefined): Rival | null {
  const rows = [...(season ?? [])].sort((a, b) => b.best - a.best);
  if (!rows.length) return null;
  const i = rows.findIndex((r) => r.user_id === meId);
  const mine = i >= 0 ? rows[i].best : null;
  const pick = (r: GameBest, place: number, ahead: boolean, gap: number | null): Rival => {
    const m = members?.find((x) => x.id === r.user_id);
    return { userId: r.user_id, name: first(m?.display_name), color: m?.avatar_color ?? '#888888', place, best: r.best, ahead, gap, mine };
  };
  if (i > 0) return pick(rows[i - 1], i, true, rows[i - 1].best - rows[i].best);
  if (i === 0) return rows.length > 1 ? pick(rows[1], 2, false, rows[0].best - rows[1].best) : null;
  return pick(rows[rows.length - 1], rows.length, true, null);
}

/**
 * Rivale aus der Saisonwertung; bleibt stehen, solange frozen (im Rennen und beim Ergebnis – sonst wäre nach dem
 * Speichern schon der nächste der Rivale)
 */
export function useRival(season: GameBest[] | undefined, meId: string, members: Profile[] | undefined, frozen: boolean): Rival | null {
  const fresh = useMemo(() => rivalOf(season, meId, members), [season, meId, members]);
  const kept = useRef<Rival | null>(fresh);
  if (!frozen) kept.current = fresh;
  return kept.current;
}

/** Abstand als Text: „0,8 s“ bzw. „34 Pkt“ */
export function rivalGap(game: GameId, gap: number): string {
  if (gameInfo(game).scoring === 'time') {
    const s = Math.abs(gap) / 1000;
    return `${s.toLocaleString('de-DE', { minimumFractionDigits: s < 0.1 ? 2 : 1, maximumFractionDigits: s < 0.1 ? 2 : 1 })} s`;
  }
  return `${Math.round(Math.abs(gap)).toLocaleString('de-DE')} Pkt`;
}

/** nach dem Lauf: Rivale geschlagen – oder wie knapp es war (für Beppe, report.tsx) */
export function rivalVerdict(game: GameId, rival: Rival | null, score: number): { name: string; beaten: boolean; close?: string } | null {
  if (!rival || !rival.ahead) return null;
  const before = rival.mine ?? -Infinity;
  if (score > rival.best && before <= rival.best) return { name: rival.name, beaten: true };
  const left = rival.best - Math.max(score, before);
  if (left <= 0) return null;
  const near = gameInfo(game).scoring === 'time' ? left <= 2500 : left <= Math.max(25, rival.best * 0.15);
  return near ? { name: rival.name, beaten: false, close: rivalGap(game, left) } : null;
}

/** im Startblatt: dein Rivale mit Abstand */
export function RivalLine({ rival, game, ghost }: { rival: Rival; game: GameId; ghost: boolean }) {
  const gap = rival.gap !== null ? rivalGap(game, rival.gap) : null;
  return (
    <div className="rival" aria-label={`Dein Rivale: ${rival.name}`}>
      <Avatar name={rival.name} color={rival.color} size={30} />
      <span className="rival__main">
        <span className="rival__eyebrow">{rival.ahead ? 'Dein Rivale' : 'Dir auf den Fersen'}</span>
        <b>{rival.name} <small>· {rival.place}. der Saison</small></b>
      </span>
      <span className="rival__gap">
        {gap ? <strong>{gap}</strong> : <strong>erstes Ziel</strong>}
        <small>{gap ? (rival.ahead ? 'vor dir' : 'hinter dir') : ghost ? 'fährt als Geist mit' : 'in der Wertung'}</small>
      </span>
    </div>
  );
}
