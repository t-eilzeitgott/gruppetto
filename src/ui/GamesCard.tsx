/**
 * Startseite: alle Minispiele in einer Karte. Wischen nach links/rechts wechselt das Spiel,
 * jedes zeigt seine eigene Bestenliste. Das zur heutigen Etappe passende Spiel steht vorn.
 */
import { useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import type { StageKind } from '../lib/types';
import { GAMES, type GameInfo } from '../game/games';
import { Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { Avatar, Link, cx } from './kit';
import { Icon } from './Icon';
import { GameBadge } from './GameIcon';

/** Bergetappe: Abfahrt zuerst, sonst das Sprintfinale */
function order(kind: StageKind | null): GameInfo[] {
  const first = kind === 'mountain' ? 'abfahrt' : 'sprint';
  return [...GAMES].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
}

export function GamesCard({ stageKind = null, town = '' }: { stageKind?: StageKind | null; town?: string }) {
  const games = useMemo(() => order(stageKind), [stageKind]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    setActive(Math.max(0, Math.min(games.length - 1, Math.round(el.scrollLeft / Math.max(1, w)))));
  };
  const go = (i: number) => {
    const el = scroller.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - (el.firstElementChild as HTMLElement).offsetLeft, behavior: 'smooth' });
  };
  return (
    <section className="card games-card" aria-label="Minispiele">
      <div className="games-scroller" ref={scroller} onScroll={onScroll}>
        {games.map((g) => <GameSlide key={g.id} game={g} stageKind={stageKind} town={town} />)}
      </div>
      {games.length > 1 ? (
        <div className="games-dots" role="tablist" aria-label="Spiel wählen">
          {games.map((g, i) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={g.name}
              className={cx('games-dots__dot', i === active && 'is-on')}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GameSlide({ game, stageKind, town }: { game: GameInfo; stageKind: StageKind | null; town: string }) {
  const { me } = useApp();
  const members = useMembers().data ?? [];
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>(`game:${game.id}:season`, () => source.gameLeaderboard(game.id));
  const today = useQuery<GameBest[]>(`game:${game.id}:day:${day}`, () => source.gameLeaderboard(game.id, since));
  const sprint = game.id === 'sprint';
  const realTown = stageKind === 'flat' || stageKind === 'hilly' ? town : '';
  const sub = useMemo(() => {
    if (!sprint) return new Track(day).title;
    return `${new Track(day, [], 'sprint', realTown).title.replace('Sprintfinale in ', 'Ziel in ')} · 2,4 km`;
  }, [day, sprint, realTown]);
  const useToday = (today.data?.length ?? 0) > 0;
  const rows = (useToday ? today.data : season.data) ?? [];
  const myIdx = rows.findIndex((b) => b.user_id === me.id);
  const shown = rows.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIdx >= 3) shown.push({ r: rows[myIdx], i: myIdx });
  return (
    <Link to={game.path} className="games-slide game-card" ariaLabel={`Minispiel ${game.name} öffnen`}>
      <span className="game-card__head">
        <GameBadge game={game.id} size={48} />
        <span className="game-card__main">
          <strong className="game-card__title">{game.name}</strong>
          <span className="muted game-card__route">{sub}</span>
        </span>
        <Icon name="chevron" className="muted" />
      </span>
      {shown.length ? (
        <span className="game-board" role="list" aria-label={useToday ? 'Bestenliste heute' : 'Bestenliste Saison'}>
          <span className="game-board__label">{useToday ? 'Heute' : 'Saison'}</span>
          {shown.map(({ r, i }) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <span key={r.user_id} role="listitem" className={cx('game-board__row', r.user_id === me.id && 'is-me')}>
                <span className="game-board__rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={24} />
                <span className="game-board__name">{r.user_id === me.id ? 'Du' : m?.display_name ?? 'Jemand'}</span>
                <strong>{r.best.toLocaleString('de-DE')}</strong>
              </span>
            );
          })}
        </span>
      ) : (
        <span className="game-card__meta">{sprint ? 'Hol dir den ersten Tagessieg' : 'Fahr die erste Bestmarke der Runde'}</span>
      )}
    </Link>
  );
}
